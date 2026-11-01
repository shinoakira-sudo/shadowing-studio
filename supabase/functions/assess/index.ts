import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { assessV2 } from "./core.ts";

// Shadowing Studio — pronunciation assessment, evaluator v2 (pipeline and rationale in core.ts).
// POST { audio: <base64 16 kHz WAV>, mimeType: "audio/wav", sentences: string[], speed?: number, accent?: "US" | "UK" | "AU", ipa?: string[] (per sentence, for the coaching text) }
// Secrets: GEMINI_API_KEY (required); GEMINI_MODEL_ASR / GEMINI_MODEL_JUDGE (optional, default gemini-3.5-flash-lite).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "GEMINI_API_KEY is not set in Edge Function secrets" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { audio, mimeType = "audio/wav", sentences, speed = 1, accent = "US", ipa } = body ?? {};
  if (typeof audio !== "string" || !audio || !Array.isArray(sentences) || !sentences.length) return json({ error: "audio and sentences are required" }, 400);
  if (audio.length > 12_000_000) return json({ error: "audio too large (max ~8MB)" }, 413);
  if (sentences.length > 60 || sentences.some((s: unknown) => typeof s !== "string" || s.length > 600)) return json({ error: "script too long" }, 413);

  const lite = "gemini-3.5-flash-lite", flash = "gemini-3.5-flash";
  const asr = Deno.env.get("GEMINI_MODEL_ASR") || lite, judge = Deno.env.get("GEMINI_MODEL_JUDGE") || lite;
  try {
    // the second model is only a fallback for quota / overload errors on the first
    const out = await assessV2({ audio, mimeType, sentences, speed, accent, ipa: Array.isArray(ipa) ? ipa : undefined },
      { key, asrModels: [asr, asr === lite ? flash : lite], judgeModels: [judge, judge === lite ? flash : lite] });
    return json(out);
  } catch (e) {
    return json({ error: "評価に失敗しました", detail: String((e as Error)?.message ?? e).slice(0, 500) }, 502);
  }
});
