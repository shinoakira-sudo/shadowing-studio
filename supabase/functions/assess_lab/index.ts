import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// Regression helper: sends one of the hosted test recordings (GitHub Pages tests/audio/*.wav) through the deployed
// /functions/v1/assess, so the evaluator can be re-checked from SQL (pg_net) without a browser.
// POST { audio_url, sentences, speed?, accent? }  — audio_url must be under the tests/audio/ folder of the app.
const ALLOWED = "https://shinoakira-sudo.github.io/shadowing-studio/tests/audio/";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { audio_url, sentences, speed = 1, accent = "US", ipa } = body ?? {};
  if (typeof audio_url !== "string" || !audio_url.startsWith(ALLOWED) || audio_url.includes("..")) return json({ error: "audio_url not allowed" }, 400);
  if (!Array.isArray(sentences) || !sentences.length) return json({ error: "sentences required" }, 400);
  const ar = await fetch(audio_url);
  if (!ar.ok) return json({ error: "audio fetch " + ar.status }, 502);
  const audio = encodeBase64(new Uint8Array(await ar.arrayBuffer()));
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const t0 = Date.now();
  const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + anon, apikey: anon },
    body: JSON.stringify({ audio, mimeType: "audio/wav", sentences, speed, accent, ipa }),
  });
  return json({ mode: "prod", status: r.status, ms: Date.now() - t0, result: await r.json().catch(() => null) });
});
