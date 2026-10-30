import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const CONTENT_URL = "https://shinoakira-sudo.github.io/shadowing-studio/content/all.json";

// Shadowing Studio — katakana pronunciation guides (connected speech, stress in **bold**) via Gemini.
// POST { sentences: string[], accent?: "US"|"UK"|"AU" } → { kana: string[], ipa: string[] }
// POST { script_ids: string[], force?: boolean } → batch: reads scripts from the app, uses each script's TTS accent, stores into public.shadowing_kana
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL_KANA (optional, default gemini-3.5-flash)

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function prompt(sentences: string[], accent: string) {
  const acc = accent === "UK" ? "British (RP): non-rhotic, 'water' ウォータ, 'better' ベタ, 'can't' カーント" : accent === "AU" ? "Australian: non-rhotic like British, 'today' トゥダイ-ish but keep it readable; use British conventions" : "General American: flap t ('water' ワーラー, 'better' ベラー, 'little' リロー), rhotic r (アー, オー with r color written as ァー/ォー is not needed, just ー)";
  return `You write katakana pronunciation guides for Japanese adults practicing English shadowing (business English). The guide must show how a native speaker ACTUALLY says the sentence at natural speed, not dictionary pronunciation, so the learner copies rhythm, stress and linking.

Accent: ${acc}.

Rules:
1. Output a JSON array with one object per input sentence, same order: {"kana": "...", "ipa": "..."}. Nothing else.
2. Write connected speech. Link consonant+vowel across words into one chunk ("pick it up" → ピッキ**ラッ**プ, "an hour" → ア**ナ**ワー). Drop or weaken sounds natives drop ("next day" → ネクス**デ**イ). Reduce function words to weak forms (to→タ/トゥ, of→ァヴ/ア, and→ァン/ン, for→ファ, can→クン, you→ヤ, your→ヤ, the→ザ/ズィ before vowels, a→ア, have→ハヴ/ァヴ, at→アッ, that→ザッ).
3. Mark the stressed syllable of each CONTENT word (and any emphatic function word) with ** around that syllable only: **テ**ンション. Do not bold whole words. Function words in weak form get no bold.
4. Separate words with a single space. Linked words are written as one chunk without a space. Use "ッ" for word-final stops that are held/unreleased (good → グッ(ド) → write グッ), "ー" for long vowels, small kana for ティ/トゥ/ディ/ドゥ/ファ/フィ/フェ/フォ/ヴァ/ヴィ/ヴ/ヴェ/ヴォ/ウィ/ウェ/ウォ/シェ/ジェ/チェ. Do not add a vowel after a final consonant: "flight" → フ**ラ**イッ, not フライト. "s" endings: "passengers" → **パ**センジャーズ.
5. th: voiceless → ス系 (think スィンク), voiced → ズ系 (the ザ). r vs l: r → ゥ-colored (right ゥ**ラ**イッ is too much; just use ラ but avoid confusion with l by writing l as ラ and r as ゥラ only at word start when needed). Keep readable: prefer simplicity over phonetic perfection.
6. Numbers, times, names: write as spoken ("482" → フォー **エ**イティ **トゥ**ー, "9:30 A.M." → **ナ**イン **サ**ーティ **エ**イ **エ**ム, "Mr. Collins" → **ミ**スタ **コ**リンズ).
7. End each line with an intonation arrow: ↘ for falling (statements, wh-questions), ↗ for rising (yes/no questions, lists not finished), ↘↗ for polite requests/fall-rise.
8. Maximum one line per sentence in kana. No romaji, no English letters in kana.
9. "ipa": the same connected-speech pronunciation in IPA for this accent, between slashes. Mark primary stress with ˈ on content words (ˈflaɪt), use weak forms for function words (tə, ə, ən, fɚ or fə, kən, jə, ðə/ði), join linked words with ‿ (ˈpæsəndʒɚz‿ɑn), show flap t as ɾ for American (ˈwɑɾɚ), use ɚ/ɝ for American r-colored vowels and ə/ɜː with no r for British/Australian, length mark ː where relevant, and end with the same intonation arrow as the kana line. Example: "Please have your boarding pass ready." → /ˈpliːz hæv jɚ ˈbɔɚdɪŋ ˈpæs ˈrɛdi ↘/

Sentences:
${sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
}

async function kanaFor(sentences: string[], accent: string, key: string, model: string): Promise<{ kana?: string[]; ipa?: string[]; error?: string; tokens?: number }> {
  let r: Response | null = null, text = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt(sentences, accent) }] }], generationConfig: { temperature: 0.2, response_mime_type: "application/json", response_schema: { type: "ARRAY", items: { type: "OBJECT", properties: { kana: { type: "STRING" }, ipa: { type: "STRING" } }, required: ["kana", "ipa"] } } } }),
    });
    text = await r.text();
    if (r.ok || (r.status !== 429 && r.status !== 503)) break;
    await new Promise(res => setTimeout(res, 3000 * (attempt + 1)));   // back off on quota / high demand
  }
  if (!r || !r.ok) return { error: `Gemini ${r ? r.status : 0}: ${text.slice(0, 300)}` };
  try {
    const g = JSON.parse(text); const arr = JSON.parse(g.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]");
    if (!Array.isArray(arr) || arr.length !== sentences.length) return { error: `length mismatch ${arr.length}/${sentences.length}` };
    const cleanKana = (k: string) => k.replace(/[ˈˌ]/g, "").replace(/\*\*\*\*/g, "").replace(/\s+/g, " ").trim();
    return { kana: arr.map((x: { kana?: string }) => cleanKana(String(x.kana ?? ""))), ipa: arr.map((x: { ipa?: string }) => String(x.ipa ?? "").trim()), tokens: g.usageMetadata?.totalTokenCount };
  } catch { return { error: "parse: " + text.slice(0, 300) }; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("GEMINI_API_KEY"); if (!key) return json({ error: "GEMINI_API_KEY not set" }, 500);
  const model = Deno.env.get("GEMINI_MODEL_KANA") || "gemini-3.5-flash";
  let body: { sentences?: string[]; accent?: string; script_ids?: string[]; force?: boolean; limit?: number }; try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  if (Array.isArray(body.script_ids) && body.script_ids.length) {   // batch mode
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const all: { id: string; s: [string, string][] }[] = await (await fetch(CONTENT_URL)).json();
    const { data: acc } = await sb.from("shadowing_audio").select("id,accent").in("id", body.script_ids);
    const accentOf: Record<string, string> = {}; (acc ?? []).forEach((r: { id: string; accent: string }) => accentOf[r.id] = r.accent);
    let targets = all.filter(sc => body.script_ids!.includes(sc.id));
    if (!body.force) { const { data: done } = await sb.from("shadowing_kana").select("id").in("id", targets.map(t => t.id)).not("ipa", "is", null); const d = new Set((done ?? []).map((x: { id: string }) => x.id)); targets = targets.filter(t => !d.has(t.id)); }
    if (body.limit) targets = targets.slice(0, body.limit);
    const results: Record<string, string> = {};
    for (const sc of targets) {
      const accent = accentOf[sc.id] || "US";
      const out = await kanaFor(sc.s.map(p => p[0]), accent, key, model);
      if (out.error) { results[sc.id] = out.error; continue; }
      const { error } = await sb.from("shadowing_kana").upsert({ id: sc.id, accent, kana: out.kana, ipa: out.ipa, model, updated_at: new Date().toISOString() });
      results[sc.id] = error ? "db: " + error.message : `ok ${accent} ${out.tokens}tok`;
    }
    const { count } = await sb.from("shadowing_kana").select("id", { count: "exact", head: true });
    return json({ processed: targets.length, done_total: count, results });
  }

  const sentences = (body.sentences || []).map(s => String(s).trim()).filter(Boolean);
  if (!sentences.length || sentences.length > 40) return json({ error: "1-40 sentences" }, 400);
  let used = model, out = await kanaFor(sentences, body.accent || "US", key, model);
  if (out.error && /429|503/.test(out.error) && model !== "gemini-3.5-flash-lite") { used = "gemini-3.5-flash-lite"; out = await kanaFor(sentences, body.accent || "US", key, used); }   // quota fallback
  if (out.error) return json({ error: out.error }, 502);
  return json({ kana: out.kana, ipa: out.ipa, meta: { model: used, tokens: out.tokens } });
});
