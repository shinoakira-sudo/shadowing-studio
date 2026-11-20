import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Shadowing Studio — Japanese translation for user-registered scripts.
// POST { sentences: string[] } → { ja: string[] }  (same length and order; Gemini flash-lite, falls back to flash on quota errors)
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const SCHEMA = { type: "OBJECT", properties: { ja: { type: "ARRAY", items: { type: "STRING" } } }, required: ["ja"] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("GEMINI_API_KEY"); if (!key) return json({ error: "GEMINI_API_KEY is not set" }, 500);
  let body: any; try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const sentences = Array.isArray(body?.sentences) ? body.sentences.map((s: unknown) => String(s ?? "").slice(0, 600)) : [];
  if (!sentences.length || sentences.length > 80) return json({ error: "sentences: 1-80 strings" }, 400);
  const prompt = `Translate each English sentence below into natural, concise Japanese (丁寧体 for speech, plain style for narration) as it would appear in a TOEIC textbook's answer key.
Return exactly ${sentences.length} translations in the same order, one per input sentence. Never merge or split sentences. Keep names, numbers, times and prices as written.
${sentences.map((s: string, i: number) => `[${i}] ${s}`).join("\n")}`;
  let last = "";
  for (const model of ["gemini-3.5-flash-lite", "gemini-3.5-flash"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, response_mime_type: "application/json", response_schema: SCHEMA } }),
          signal: AbortSignal.timeout(40_000),
        });
        const text = await r.text();
        if (r.ok) {
          const out = JSON.parse(JSON.parse(text).candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
          if (Array.isArray(out.ja) && out.ja.length === sentences.length) return json({ ja: out.ja.map((x: unknown) => String(x ?? "").replace(/^\[\d+\]\s*/, "").trim()), model });
          last = "length mismatch";
        } else { last = `Gemini ${r.status}: ${text.slice(0, 200)}`; if (![429, 500, 502, 503, 504].includes(r.status)) break; }
      } catch (e) { last = String((e as Error).message ?? e); }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return json({ error: "翻訳に失敗しました", detail: last }, 502);
});
