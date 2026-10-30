import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Shadowing Studio — pronunciation / intonation assessment via Gemini.
// POST { audio: <base64 WAV>, mimeType: "audio/wav", sentences: string[], speed: number, lang?: "ja" }
// Returns structured JSON (see SCHEMA). Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING", description: "What the learner actually said, verbatim, in English." },
    overall: { type: "INTEGER", description: "0-100 overall shadowing score." },
    pronunciation: { type: "INTEGER", description: "0-100 segmental accuracy (vowels, consonants, word stress)." },
    intonation: { type: "INTEGER", description: "0-100 prosody: pitch movement, sentence stress, rhythm, linking." },
    fluency: { type: "INTEGER", description: "0-100 smoothness: pace, pauses, hesitations, completeness." },
    words: {
      type: "ARRAY",
      description: "One entry per word of the reference script, in order.",
      items: {
        type: "OBJECT",
        properties: {
          w: { type: "STRING" },
          s: { type: "INTEGER", description: "0-based sentence index in the script." },
          st: { type: "STRING", enum: ["ok", "unclear", "wrong", "missing"] },
          note: { type: "STRING", description: "Japanese, max 40 chars, only when st != ok." },
        },
        required: ["w", "s", "st"],
      },
    },
    points: {
      type: "ARRAY",
      description: "3 to 5 most valuable coaching points, in Japanese, most impactful first.",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Japanese, max 24 chars." },
          detail: { type: "STRING", description: "Japanese, 1-2 sentences, concrete: which word, what to do." },
          kind: { type: "STRING", enum: ["pronunciation", "intonation", "rhythm", "linking", "fluency"] },
        },
        required: ["title", "detail", "kind"],
      },
    },
    good: { type: "STRING", description: "One sentence in Japanese: what was done well." },
    leakage: { type: "BOOLEAN", description: "true if a second (model/TTS) voice is audible in the recording." },
  },
  required: ["transcript", "overall", "pronunciation", "intonation", "fluency", "words", "points", "good", "leakage"],
};

function prompt(sentences: string[], speed: number) {
  const script = sentences.map((s, i) => `[${i}] ${s}`).join("\n");
  return `You are a strict but encouraging English pronunciation coach for a Japanese adult learner preparing for TOEIC (business English, American accent).
The learner was SHADOWING the reference script below at ${speed.toFixed(1)}x speed: repeating it aloud while listening. Judge the attached recording of the learner against the script.

Reference script:
${script}

Scoring rules:
- Score each dimension 0-100 honestly. 90+ means near-native; 70-89 clearly intelligible with some issues; 50-69 noticeable Japanese-accent problems; below 50 large parts missing or unintelligible. Do not inflate.
- "words": exactly one item per word of the script, same order, with the sentence index. Mark "missing" if not spoken, "wrong" if a different word or badly mispronounced, "unclear" if weak but recognizable. Typical issues to listen for: r/l, th, v/b, f/h, word-final consonants dropped or given an extra vowel (e.g. "and-o"), unreduced function words, flat sentence intonation, missing linking.
- If the recording also contains the model voice (TTS) in the background, set leakage=true and judge only the learner's voice as best you can.
- "points": 3-5 concrete coaching points in Japanese, each tied to specific words from the script. Prefer intonation and rhythm feedback that text-only tools cannot give.
- All Japanese text in natural, concise Japanese (常体ではなく丁寧体).`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "GEMINI_API_KEY is not set in Edge Function secrets" }, 500);
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";

  let body: { audio?: string; mimeType?: string; sentences?: string[]; speed?: number };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { audio, mimeType = "audio/wav", sentences, speed = 1 } = body;
  if (!audio || !Array.isArray(sentences) || !sentences.length) return json({ error: "audio and sentences are required" }, 400);
  if (audio.length > 12_000_000) return json({ error: "audio too large (max ~8MB)" }, 413);

  const gReq = {
    contents: [{ role: "user", parts: [{ text: prompt(sentences, Number(speed) || 1) }, { inline_data: { mime_type: mimeType, data: audio } }] }],
    generationConfig: { temperature: 0.2, response_mime_type: "application/json", response_schema: SCHEMA },
  };
  const t0 = Date.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(gReq),
  });
  const text = await r.text();
  if (!r.ok) return json({ error: `Gemini ${r.status}`, detail: text.slice(0, 800), model }, 502);
  try {
    const g = JSON.parse(text);
    const out = JSON.parse(g.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
    const usage = g.usageMetadata ?? {};
    return json({ ...out, meta: { model, ms: Date.now() - t0, promptTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount } });
  } catch (e) {
    return json({ error: "could not parse Gemini response", detail: text.slice(0, 800) }, 502);
  }
});
