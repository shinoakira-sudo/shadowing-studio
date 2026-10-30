import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Shadowing Studio — model audio with Google Cloud Text-to-Speech (Neural2), mixed native accents.
// POST { ids?: string[], offset?: number, limit?: number, force?: boolean }
// Reads the script list from the public app, synthesizes SSML with sentence marks, stores MP3 in Storage
// (bucket shadowing-audio, path v2/<id>.mp3) and the timeline in public.shadowing_audio.
// Secrets: GOOGLE_TTS_API_KEY (required), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (provided).

const CONTENT_URL = "https://shinoakira-sudo.github.io/shadowing-studio/content/all.json";
// Roster of native voices: accent × gender. Scripts cycle through the roster of their gender.
const VOICES: Record<string, { name: string; lang: string; accent: string }[]> = {
  m: [
    { name: "en-US-Neural2-D", lang: "en-US", accent: "US" },
    { name: "en-GB-Neural2-B", lang: "en-GB", accent: "UK" },
    { name: "en-AU-Neural2-B", lang: "en-AU", accent: "AU" },
    { name: "en-US-Neural2-J", lang: "en-US", accent: "US" },
    { name: "en-GB-Neural2-D", lang: "en-GB", accent: "UK" },
    { name: "en-AU-Neural2-D", lang: "en-AU", accent: "AU" },
  ],
  f: [
    { name: "en-US-Neural2-F", lang: "en-US", accent: "US" },
    { name: "en-GB-Neural2-A", lang: "en-GB", accent: "UK" },
    { name: "en-AU-Neural2-A", lang: "en-AU", accent: "AU" },
    { name: "en-US-Neural2-C", lang: "en-US", accent: "US" },
    { name: "en-GB-Neural2-C", lang: "en-GB", accent: "UK" },
    { name: "en-AU-Neural2-C", lang: "en-AU", accent: "AU" },
  ],
};
const GAP_MS = 350;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("GOOGLE_TTS_API_KEY");
  if (!key) return json({ error: "GOOGLE_TTS_API_KEY is not set" }, 500);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { ids?: string[]; offset?: number; limit?: number; force?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }

  const all: { id: string; voice: string; s: [string, string][] }[] = await (await fetch(CONTENT_URL)).json();
  let targets = body.ids ? all.filter(sc => body.ids!.includes(sc.id)) : all.slice(body.offset ?? 0, (body.offset ?? 0) + (body.limit ?? 10));
  if (!body.force) {
    const { data: done } = await sb.from("shadowing_audio").select("id").in("id", targets.map(t => t.id));
    const doneIds = new Set((done ?? []).map((d: { id: string }) => d.id));
    targets = targets.filter(t => !doneIds.has(t.id));
  }
  const results: Record<string, string> = {};
  for (const sc of targets) {
    const idx = all.findIndex(x => x.id === sc.id);
    const roster = VOICES[sc.voice === "m" ? "m" : "f"];
    const v = roster[idx % roster.length];
    const ssml = "<speak>" + sc.s.map((p, i) => `<mark name="s${i}"/>${esc(p[0])}<mark name="e${i}"/>` + (i < sc.s.length - 1 ? `<break time="${GAP_MS}ms"/>` : "")).join("") + "</speak>";
    const r = await fetch("https://texttospeech.googleapis.com/v1beta1/text:synthesize", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ input: { ssml }, voice: { languageCode: v.lang, name: v.name }, audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, sampleRateHertz: 24000 }, enableTimePointing: ["SSML_MARK"] }),
    });
    if (!r.ok) { results[sc.id] = `TTS ${r.status}: ${(await r.text()).slice(0, 300)}`; continue; }
    const g = await r.json();
    const tp: Record<string, number> = {}; for (const t of g.timepoints ?? []) tp[t.markName] = t.timeSeconds;
    const segs = sc.s.map((_, i) => ({ start: +(tp[`s${i}`] ?? 0).toFixed(3), end: +(tp[`e${i}`] ?? 0).toFixed(3) }));
    const dur = segs.length ? segs[segs.length - 1].end : 0;
    const bytes = Uint8Array.from(atob(g.audioContent), c => c.charCodeAt(0));
    const path = `v2/${sc.id}.mp3`;
    const up = await sb.storage.from("shadowing-audio").upload(path, bytes, { contentType: "audio/mpeg", upsert: true, cacheControl: "31536000" });
    if (up.error) { results[sc.id] = "upload: " + up.error.message; continue; }
    const url = sb.storage.from("shadowing-audio").getPublicUrl(path).data.publicUrl;
    const chars = sc.s.reduce((n, p) => n + p[0].length, 0);
    const { error } = await sb.from("shadowing_audio").upsert({ id: sc.id, voice: v.name, accent: v.accent, gender: sc.voice === "m" ? "m" : "f", url, timeline: { segs, dur }, chars, updated_at: new Date().toISOString() });
    results[sc.id] = error ? "db: " + error.message : `ok ${v.name} ${dur.toFixed(1)}s`;
  }
  return json({ processed: targets.length, results });
});
