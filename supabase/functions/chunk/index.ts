import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Shadowing Studio — chunk reading data for user-registered scripts.
// POST { sentences: string[] } → { chunks: [ [ [chunkText, ja], ... ] per sentence ] }
// Every sentence's chunk texts joined by one space must equal the sentence; mismatches are repaired or retried.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const SCHEMA = { type: "ARRAY", items: { type: "OBJECT", properties: { chunks: { type: "ARRAY", items: { type: "OBJECT", properties: { en: { type: "STRING" }, ja: { type: "STRING" } }, required: ["en", "ja"] } } }, required: ["chunks"] } };

function prompt(sentences: string[]) {
  return `You prepare "chunk reading" data for a Japanese TOEIC learner. For each English sentence, split it into meaning chunks (sense groups) and give each chunk a short Japanese gloss in CHUNK ORDER (head-first, the order an English listener processes it — not an end-first natural translation).

Rules:
- A chunk is 1-6 words: subject phrase, verb phrase (verb + short object), prepositional phrase, infinitive/participle phrase, clause opener + clause, time/place adverbial, discourse opener ("Hello,", "Thank you for calling"). Articles, prepositions and conjunctions stay attached to the phrase they introduce; never a chunk that is only a function word.
- HARD CONSTRAINT: the "en" values of a sentence, joined with single spaces, must equal the sentence EXACTLY (same words, punctuation, capitalization, order). Split only at word boundaries; keep punctuation attached to its word.
- "ja": 2-12 characters typical, with role particles so that reading the glosses left to right follows the English order ("for the account manager position" → アカウントマネージャー職に, "last week" → 先週). Names in katakana; times as 午後1時30分.
- 5-8 chunks for a long sentence, 1-3 for a short one.
Return a JSON array with one object per sentence, same order: {"chunks":[{"en":"...","ja":"..."}]}.

Sentences:
${sentences.map((s, i) => `[${i}] ${s}`).join("\n")}`;
}

// align model chunk texts to the real sentence words so small punctuation/case slips do not throw the sentence away
function repair(sentence: string, chunks: { en: string; ja: string }[]): [string, string][] | null {
  const words = sentence.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
  const out: [string, string][] = []; let k = 0;
  for (const c of chunks) {
    const cw = c.en.split(/\s+/).filter(Boolean); if (!cw.length) continue;
    const n = cw.length; if (k + n > words.length) return null;
    for (let j = 0; j < n; j++) if (norm(cw[j]) !== norm(words[k + j])) return null;
    out.push([words.slice(k, k + n).join(" "), String(c.ja ?? "").trim() || "…"]); k += n;
  }
  return k === words.length ? out : null;
}

async function chunkSentences(key: string, sentences: string[]) {
  const result: ([string, string][] | null)[] = sentences.map(() => null);
  let last = "";
  for (const model of ["gemini-3.5-flash", "gemini-3.5-flash-lite"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const todo = sentences.map((s, i) => [s, i] as [string, number]).filter(([, i]) => !result[i]);
      if (!todo.length) break;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt(todo.map(([s]) => s)) }] }], generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: "low" }, response_mime_type: "application/json", response_schema: SCHEMA } }),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await r.text();
        if (!r.ok) { last = `Gemini ${r.status}: ${text.slice(0, 200)}`; if (![429, 500, 502, 503, 504].includes(r.status)) break; await new Promise((res) => setTimeout(res, 2000)); continue; }
        const arr = JSON.parse(JSON.parse(text).candidates?.[0]?.content?.parts?.[0]?.text ?? "[]");
        if (Array.isArray(arr)) todo.forEach(([s, i], k) => { const ch = arr[k]?.chunks; if (Array.isArray(ch)) result[i] = repair(s, ch); });
        last = "some sentences did not reconstruct";
      } catch (e) { last = String((e as Error).message ?? e); }
    }
    if (result.every(Boolean)) break;
  }
  // a sentence the model could not split cleanly becomes a single chunk, so the feature still works
  const chunks = result.map((c, i) => c ?? [[sentences[i], ""]]);
  return { chunks, failed: result.filter((c) => !c).length, detail: result.every(Boolean) ? undefined : last };
}

// Background mode: { batch: true } — fill chunks (and readings, via the `kana` function) for mirrored
// user scripts that still lack them (public.shadowing_user_scripts). Run by pg_cron every 2 minutes.
async function runBatch(key: string) {
  // one script and one operation per call (chunks first, readings next time) to stay inside the worker's time budget
  const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H = { "Content-Type": "application/json", apikey: svc, Authorization: "Bearer " + svc, Prefer: "return=minimal" };
  const rows: any[] = await (await fetch(`${url}/rest/v1/shadowing_user_scripts?or=(chunks.is.null,kana.is.null)&order=updated_at.asc&limit=1`, { headers: H })).json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { idle: true };
  const sentences: string[] = Array.isArray(row.sentences) ? row.sentences.map(String) : [];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };   // failures rotate to the back of the queue
  if (!sentences.length) { patch.chunks = []; patch.kana = []; patch.ipa = []; }
  else if (!row.chunks) {
    try { const c = await chunkSentences(key, sentences); patch.chunks = c.chunks; patch.chunk_error = c.failed ? c.detail ?? "partial" : null; }
    catch (e) { patch.chunk_error = String((e as Error).message ?? e).slice(0, 200); }
  } else {
    try {
      const r = await fetch(`${url}/functions/v1/kana`, { method: "POST", headers: { "Content-Type": "application/json", apikey: svc, Authorization: "Bearer " + svc }, body: JSON.stringify({ sentences, accent: "US" }) });
      const g = await r.json();
      if (r.ok && Array.isArray(g.kana) && g.kana.length === sentences.length) { patch.kana = g.kana; patch.ipa = g.ipa; patch.kana_error = null; }
      else patch.kana_error = String(g.error ?? "HTTP " + r.status).slice(0, 200);
    } catch (e) { patch.kana_error = String((e as Error).message ?? e).slice(0, 200); }
  }
  await fetch(`${url}/rest/v1/shadowing_user_scripts?id=eq.${encodeURIComponent(row.id)}`, { method: "PATCH", headers: H, body: JSON.stringify(patch) });
  return { id: row.id, did: Object.keys(patch) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("GEMINI_API_KEY"); if (!key) return json({ error: "GEMINI_API_KEY is not set" }, 500);
  let body: any; try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (body?.batch) return json(await runBatch(key));
  const sentences: string[] = Array.isArray(body?.sentences) ? body.sentences.map((s: unknown) => String(s ?? "").trim().slice(0, 600)) : [];
  if (!sentences.length || sentences.length > 60) return json({ error: "sentences: 1-60 strings" }, 400);
  return json(await chunkSentences(key, sentences));
});
