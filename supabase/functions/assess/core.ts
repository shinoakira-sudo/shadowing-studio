// Shadowing Studio — evaluator v2 core (shared by the `assess` and `assess_lab` Edge Functions).
//
// Why v2: v1 sent the script and the audio to Gemini in ONE call and asked it to judge every word. With the
// script in front of it the model "hears" what it expects: skipped or replaced words came back as "ok" and the
// transcript was the script itself. v2 separates listening from judging:
//   1. blind transcription — Gemini transcribes the recording WITHOUT seeing the script;
//   2. deterministic alignment — this file aligns that transcript to the script's words (numbers, times,
//      abbreviations, contractions, British/American spelling and homophones are normalised);
//   3. judge — Gemini rates pronunciation / intonation / fluency and writes coaching points, with the alignment given
//      as fact. It does not mark words: in testing, a second model listening with the script flagged unaltered words
//      and missed real slips, so every word mark comes from what the blind listener actually heard;
//   4. score — overall = ½ coverage + ½ mean(P, I, F), with a ceiling that drops 1.5 points per missed point of coverage.
// Word results are addressed by (sentence index, whitespace-word index) so the app can mark the exact span.

export type Status = "ok" | "unclear" | "wrong" | "missing" | "skip";
export interface Unit { s: number; i: number; w: string; alts: string[][]; weight: number }
export interface HypTok { t: string; wi: number }
export interface WordResult { s: number; i: number; w: string; st: Status; heard?: string; note?: string }

/* ------------------------------------------------------------------ numbers */
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD_IRREG: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

function under100(n: number): string[] {
  if (n < 20) return [ONES[n]];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? [t, ONES[n % 10]] : [t];
}
function cardinal(n: number, and = false): string[] {
  if (!Number.isFinite(n) || n < 0) return [];
  if (n < 100) return under100(n);
  if (n < 1000) {
    const r = n % 100;
    return [ONES[Math.floor(n / 100)], "hundred", ...(r ? [...(and ? ["and"] : []), ...under100(r)] : [])];
  }
  if (n < 1_000_000) {
    const r = n % 1000;
    return [...cardinal(Math.floor(n / 1000), and), "thousand", ...(r ? [...(and && r < 100 ? ["and"] : []), ...cardinal(r, and)] : [])];
  }
  if (n < 1_000_000_000) {
    const r = n % 1_000_000;
    return [...cardinal(Math.floor(n / 1_000_000), and), "million", ...(r ? cardinal(r, and) : [])];
  }
  return String(n).split("").map((d) => ONES[+d]);
}
function ordinal(n: number): string[] {
  const w = cardinal(n);
  const last = w[w.length - 1];
  w[w.length - 1] = ORD_IRREG[last] ?? (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th");
  return w;
}
function pairsReading(d: string): string[] | null {   // 1895 → eighteen ninety five, 507 → five oh seven, 126 → one twenty six
  if (d.length === 3) {
    const a = +d[0], r = +d.slice(1);
    return [ONES[a], ...(r === 0 ? ["hundred"] : r < 10 ? ["oh", ONES[r]] : under100(r))];
  }
  if (d.length === 4) {
    const a = +d.slice(0, 2), b = +d.slice(2);
    if (a < 10) return null;
    return [...under100(a), ...(b === 0 ? ["hundred"] : b < 10 ? ["oh", ONES[b]] : under100(b))];
  }
  return null;
}
function intAlts(raw: string): string[][] {
  const d = raw.replace(/,/g, "");
  const n = parseInt(d, 10);
  const alts: string[][] = [cardinal(n)];
  if (n >= 100) alts.push(cardinal(n, true));
  if (d.length >= 2) {
    alts.push(d.split("").map((c) => ONES[+c]));
    alts.push(d.split("").map((c) => (c === "0" ? "oh" : ONES[+c])));
  }
  const p = pairsReading(d); if (p) alts.push(p);
  if (d.length === 4 && n % 100 === 0 && n % 1000 !== 0) alts.push([...under100(Math.floor(n / 100)), "hundred"]);
  if (d.length === 4 && n >= 2000 && n < 2010) alts.push(["twenty", "oh", ONES[n % 10]]);
  return alts;
}
function timeAlts(h: number, m: number): string[][] {
  const H = under100(h);
  if (m === 0) return [H, [...H, "o'clock"], [...H, "hundred"], [...H, "oh", "oh"]];
  const M = m < 10 ? ["oh", ONES[m]] : under100(m);
  const alts = [[...H, ...M]];
  if (m < 10) alts.push([...H, "o", ONES[m]], [...H, "zero", ONES[m]]);
  if (m === 30) alts.push(["half", "past", ...H]);
  if (m === 15) alts.push(["quarter", "past", ...H], ["a", "quarter", "past", ...H]);
  return alts;
}
const CUR: Record<string, [string, string]> = { "$": ["dollar", "dollars"], "£": ["pound", "pounds"], "€": ["euro", "euros"] };
function moneyAlts(sym: string, whole: string, cents?: string, mult?: string): string[][] {
  const [one, many] = CUR[sym] ?? ["dollar", "dollars"];
  const n = parseInt(whole.replace(/,/g, ""), 10);
  const D = cardinal(n);
  if (mult) {
    const M = ({ k: "thousand", m: "million", bn: "billion", million: "million", billion: "billion" } as Record<string, string>)[mult] ?? mult;
    const lead = cents ? [...D, "point", ...cents.split("").map((c) => ONES[+c])] : D;
    return [[...lead, M, many], [...lead, M]];
  }
  const unit = n === 1 ? one : many;
  if (!cents || +cents === 0) return [[...D, unit], [...D, n === 1 ? many : one], D];
  const c = +(cents.length === 1 ? cents + "0" : cents);
  const C = cardinal(c);
  return [[...D, unit, ...C, "cents"], [...D, unit, "and", ...C, "cents"], [...D, ...C], [...D, unit, ...C]];
}

/* ------------------------------------------------------------ word forms */
const ABBR: Record<string, string[][]> = {
  mr: [["mister"]], mrs: [["missus"], ["misses"], ["missis"]], ms: [["ms"], ["miss"], ["mizz"]], dr: [["doctor"]],
  st: [["street"], ["saint"]], jr: [["junior"]], sr: [["senior"]], vs: [["versus"]], etc: [["etcetera"], ["et", "cetera"]],
  inc: [["incorporated"], ["inc"]], ltd: [["limited"]], corp: [["corporation"]], dept: [["department"]], ave: [["avenue"]],
  blvd: [["boulevard"]], rd: [["road"]], approx: [["approximately"]], ok: [["okay"]], okay: [["okay"]], intl: [["international"]],
  mt: [["mount"]], ft: [["feet"], ["foot"]], km: [["kilometers"], ["kilometer"]], kg: [["kilograms"], ["kilogram"]],
  cm: [["centimeters"]], mins: [["minutes"]], hrs: [["hours"]], asap: [["asap"], ["a", "s", "a", "p"]],
};
const INITIALISM_SPECIAL: Record<string, string[][]> = { eg: [["for", "example"], ["e", "g"]], ie: [["that", "is"], ["i", "e"]] };
const CONTR: Record<string, string[]> = {
  "won't": ["will", "not"], "can't": ["can", "not"], cannot: ["can", "not"], "shan't": ["shall", "not"], "ain't": ["is", "not"],
  "let's": ["let", "us"], "i'm": ["i", "am"], "y'all": ["you", "all"], "o'clock": ["o'clock"],
};
function expandContraction(t: string): string[] | null {
  if (CONTR[t]) return CONTR[t];
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(.+)n't$/))) return [m[1], "not"];
  if ((m = t.match(/^(.+)'re$/))) return [m[1], "are"];
  if ((m = t.match(/^(.+)'ve$/))) return [m[1], "have"];
  if ((m = t.match(/^(.+)'ll$/))) return [m[1], "will"];
  if ((m = t.match(/^(.+)'d$/))) return [m[1], "would"];
  if ((m = t.match(/^(it|that|there|here|what|who|where|when|why|how|he|she|this|everything|everyone|everybody|nothing|something|someone|somebody|nobody)'s$/))) return [m[1], "is"];
  return null;
}
// words that sound like a contraction (its ~ it's ...), both directions
const CONTR_HOMO: Record<string, string[][]> = { its: [["it", "is"]], your: [["you", "are"]], their: [["they", "are"]], there: [["they", "are"]], whose: [["who", "is"]], lets: [["let", "us"]] };
const CONTR_HOMO_REV: Record<string, string[][]> = { "it is": [["its"]], "you are": [["your"]], "they are": [["their"], ["there"]], "who is": [["whose"]], "let us": [["lets"]] };

// British → American spelling, applied to every token on both sides so either spelling matches.
const SPELL: Record<string, string> = {
  cheque: "check", cheques: "checks", grey: "gray", tyre: "tire", tyres: "tires", aluminium: "aluminum", jewellery: "jewelry",
  storey: "story", storeys: "stories", mum: "mom", kerb: "curb", practise: "practice", practised: "practiced", practising: "practicing",
  enrol: "enroll", enrolment: "enrollment", fulfil: "fulfill", fulfilment: "fulfillment", instalment: "installment", judgement: "judgment",
  ageing: "aging", cosy: "cozy", sceptical: "skeptical", aeroplane: "airplane", plough: "plow", pyjamas: "pajamas", mould: "mold",
  programme: "program", programmes: "programs", catalogue: "catalog", catalogues: "catalogs", dialogue: "dialog", analogue: "analog",
  signalled: "signaled", totalled: "totaled", labour: "labor", email: "email", "e-mail": "email",
};
function spellCanon(t: string): string {
  if (SPELL[t]) return SPELL[t];
  if (t.length >= 5) {
    t = t.replace(/(..)our(s|ed|ing|ite|ites|able|ably|er|ers|ful|hood|less|ly)?$/, (_m, a, suf) => a + "or" + (suf || ""));
    t = t.replace(/(..)tre(s|d)?$/, (_m, a, suf) => a + "ter" + (suf || ""));
    t = t.replace(/(..)ell(ed|ing|er|ers)$/, (_m, a, suf) => a + "el" + suf);
  }
  if (t.length >= 6) {
    t = t.replace(/(...)is(e|ed|es|ing|ation|ations|er|ers)$/, (_m, a, suf) => a + "iz" + suf);
    t = t.replace(/(...)ys(e|ed|es|ing)$/, (_m, a, suf) => a + "yz" + suf);
    t = t.replace(/(...)ence(s)?$/, (_m, a, suf) => a + "ense" + (suf || ""));
  }
  return t;
}

function clean(raw: string): string {
  let w = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[’‘`´]/g, "'").replace(/[“”«»„]/g, '"').replace(/[‐‑‒–—―]/g, "-");
  w = w.replace(/^["'(\[{¿¡*_~#]+/, "").replace(/["')\]}!?,;*_~…]+$/, "").replace(/:+$/, "");
  if (!/^([a-z]\.)+[a-z]?\.?$/.test(w)) w = w.replace(/\.+$/, "");
  return w;
}
function plainTokens(w: string): string[] {
  return w.split(/[^a-z0-9']+/).map((x) => x.replace(/^'+|'+$/g, "")).filter(Boolean).map(spellCanon);
}
function dedupe(alts: string[][]): string[][] {
  const seen = new Set<string>(); const out: string[][] = [];
  for (const a of alts) { const t = a.map(spellCanon).filter(Boolean); const k = t.join(" "); if (t.length && !seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

/** All accepted spoken forms of one written word, canonical form first. [] for pure punctuation. */
export function wordAlts(raw: string): string[][] {
  const w = clean(raw);
  if (!w) return [];
  let m: RegExpMatchArray | null;
  if ((m = w.match(/^(\d{1,2}):(\d{2})(am|pm|a\.m\.?|p\.m\.?)?$/))) {
    const suf = m[3] ? [m[3].replace(/\./g, "")] : [];
    return dedupe(timeAlts(+m[1], +m[2]).map((a) => [...a, ...suf]));
  }
  if ((m = w.match(/^([$£€])(\d[\d,]*)(?:\.(\d{1,2}))?(k|m|bn|million|billion)?$/))) return dedupe(moneyAlts(m[1], m[2], m[3], m[4]));
  if ((m = w.match(/^(\d[\d,]*(?:\.\d+)?)%$/))) {
    const base = wordAlts(m[1]);
    return dedupe(base.flatMap((b) => [[...b, "percent"], [...b, "per", "cent"]]));
  }
  if ((m = w.match(/^(\d[\d,]*)(st|nd|rd|th)$/))) return dedupe([ordinal(parseInt(m[1].replace(/,/g, ""), 10))]);
  if ((m = w.match(/^'?(\d{2}|\d{4})s$/))) {
    const d = m[1]; const base = d.length === 2 ? under100(+d) : (pairsReading(d) ?? cardinal(+d));
    const last = base[base.length - 1];
    return dedupe([[...base.slice(0, -1), last.endsWith("y") ? last.slice(0, -1) + "ies" : last + "s"]]);
  }
  if ((m = w.match(/^(\d[\d,]*)\.(\d+)$/))) return dedupe([[...cardinal(parseInt(m[1].replace(/,/g, ""), 10)), "point", ...m[2].split("").map((c) => ONES[+c])]]);
  if (/^\d[\d,]*$/.test(w)) return dedupe(intAlts(w));
  if (/^([a-z]\.)+[a-z]?\.?$/.test(w)) {
    const letters = w.replace(/\./g, "");
    return dedupe([...(INITIALISM_SPECIAL[letters] ? [] : [[letters]]), ...(INITIALISM_SPECIAL[letters] ?? []), letters.split(""), [letters]]);
  }
  const ab = ABBR[w.replace(/\.$/, "")];
  if (ab) return dedupe([...ab, [w.replace(/\.$/, "")]]);
  if (/[-\/&]/.test(w) && w.length > 1) {
    const parts = w.split(/[-\/&]+/).filter(Boolean);
    const canon: string[] = [];
    for (const p of parts) canon.push(...(wordAlts(p)[0] ?? []));
    const alts = [canon];
    if (parts.every((p) => /^[a-z']+$/.test(p))) alts.push([parts.join("")]);
    if (w.includes("&")) alts.push(w.split("&").flatMap((p, k) => (k ? ["and", ...plainTokens(p)] : plainTokens(p))));
    return dedupe(alts);
  }
  if ((m = w.match(/^([a-z]{1,3})(\d+)$/)) || (m = w.match(/^(\d+)([a-z]{1,3})$/))) {
    const out: string[] = [];
    for (const p of [m[1], m[2]]) out.push(...(/^\d/.test(p) ? intAlts(p)[0] : p.split("")));
    return dedupe([out]);
  }
  const ex = expandContraction(w);
  if (ex) return dedupe([ex, ...(CONTR_HOMO_REV[ex.join(" ")] ?? [])]);
  const toks = plainTokens(w);
  if (toks.length === 1 && CONTR_HOMO[toks[0]]) return dedupe([toks, ...CONTR_HOMO[toks[0]]]);
  return toks.length ? [toks] : [];
}

/** Canonical tokens for a transcript (the listener's side). "[?]" becomes two <unk> tokens. */
export const UNK = "<unk>";
export function hypTokens(transcript: string): { words: string[]; toks: HypTok[] } {
  const words = transcript.replace(/\[\s*\?+\s*\]|\(\s*\?+\s*\)|\[(?:unclear|inaudible|unintelligible)\]/gi, " [?] ")
    .replace(/[‐‑‒–—―]{1,}/g, (s) => (s.length > 1 ? " " : "-")).replace(/(\s)-+(\s)/g, " ")
    .split(/\s+/).filter(Boolean);
  const toks: HypTok[] = [];
  words.forEach((w, wi) => {
    if (w === "[?]") { toks.push({ t: UNK, wi }, { t: UNK, wi }); return; }
    const a = wordAlts(w.replace(/-+$/, ""))[0];
    if (a) for (const t of a) toks.push({ t, wi });
  });
  return { words, toks };
}

/* ------------------------------------------------------------ similarity */
const HOMOPHONES: string[][] = [
  ["to", "too", "two"], ["for", "four", "fore"], ["there", "their"], ["by", "buy", "bye"], ["know", "no"], ["knew", "new"], ["hour", "our"],
  ["right", "write", "rite"], ["here", "hear"], ["week", "weak"], ["meet", "meat"], ["sale", "sail"], ["mail", "male"], ["cell", "sell"],
  ["site", "sight", "cite"], ["fair", "fare"], ["plane", "plain"], ["whole", "hole"], ["wait", "weight"], ["piece", "peace"],
  ["through", "threw"], ["way", "weigh"], ["would", "wood"], ["one", "won"], ["be", "bee"], ["see", "sea"], ["ate", "eight"],
  ["flour", "flower"], ["principal", "principle"], ["stationary", "stationery"], ["suite", "sweet"], ["board", "bored"], ["brake", "break"],
  ["cereal", "serial"], ["council", "counsel"], ["guest", "guessed"], ["higher", "hire"], ["made", "maid"], ["pair", "pear", "pare"],
  ["past", "passed"], ["patience", "patients"], ["presence", "presents"], ["road", "rode", "rowed"], ["root", "route"], ["seen", "scene"],
  ["so", "sew"], ["some", "sum"], ["son", "sun"], ["steal", "steel"], ["tail", "tale"], ["waist", "waste"], ["wear", "where", "ware"],
  ["which", "witch"], ["weather", "whether"], ["allowed", "aloud"], ["fourth", "forth"], ["missed", "mist"], ["bare", "bear"],
  ["cent", "sent", "scent"], ["course", "coarse"], ["dear", "deer"], ["due", "dew"], ["fined", "find"], ["flew", "flu"], ["great", "grate"],
  ["hi", "high"], ["in", "inn"], ["night", "knight"], ["not", "knot"], ["lead", "led"], ["lessen", "lesson"], ["loan", "lone"],
  ["mind", "mined"], ["morning", "mourning"], ["none", "nun"], ["oh", "owe"], ["pain", "pane"], ["peak", "peek"], ["role", "roll"],
  ["raise", "rays"], ["read", "red"], ["real", "reel"], ["sole", "soul"], ["stair", "stare"], ["tide", "tied"], ["weekly", "weakly"],
  ["main", "mane"], ["feet", "feat"], ["boarder", "border"], ["ceiling", "sealing"], ["seller", "cellar"], ["complement", "compliment"],
  ["sundae", "sunday"], ["throne", "thrown"], ["warn", "worn"], ["ad", "add"], ["base", "bass"], ["band", "banned"], ["build", "billed"],
  ["blue", "blew"], ["cheap", "cheep"], ["aisle", "isle"], ["air", "heir"], ["hall", "haul"], ["heal", "heel"], ["poll", "pole"],
  ["vain", "vein", "vane"], ["ways", "weighs"], ["tea", "tee"], ["toe", "tow"], ["knows", "nose"], ["rain", "reign", "rein"],
  ["ok", "okay"], ["email", "e-mail"], ["alright", "allright"], ["till", "til"], ["percent", "per-cent"],
];
const HOMO = new Map<string, number>();
HOMOPHONES.forEach((g, k) => g.forEach((w) => HOMO.set(w, k)));

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0).map((_, j) => j), cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
const sEnd = (t: string) => /(?:'s|s'|s)$/.test(t);
const stemS = (t: string) => t.replace(/'s$|s'$/, "").replace(/ies$/, "y").replace(/(ch|sh|x|ss|z)es$/, "$1").replace(/s$/, "");

/** 0..1 how alike a script token and a heard token are (1 = same word or same sound). */
export function sim(a: string, b: string): number {
  if (a === b) return 1;
  if (a === UNK || b === UNK) return 0.5;
  const ha = HOMO.get(a);
  if (ha !== undefined && ha === HOMO.get(b)) return 1;
  if (sEnd(a) && sEnd(b) && stemS(a) === stemS(b)) return 1;               // company's ~ companies
  if (a.replace(/(.)\1+/g, "$1") === b.replace(/(.)\1+/g, "$1")) return 1;   // Sullivan ~ Sulivan (spelling only)
  if (/^\d/.test(a) || /^\d/.test(b)) return 0;
  if (Math.min(a.length, b.length) <= 2) return 0;                          // a/an/is/it/on/in: exact only
  return Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length));
}

/* ------------------------------------------------------------- alignment */
const FUNC = new Set(("a an the to of and in on at for it is are was were be been am can will would could should shall may might must " +
  "have has had do does did that this these those or but if as by with from we you i he she they our your their us me him her my its " +
  "not so than then there them what which who oh o'clock").split(" "));
const FILLERS = new Set(["um", "uh", "erm", "er", "ah", "hmm", "mm", "uhm", "eh", "uh-huh", "mhm"]);

export function scriptUnits(sentences: string[]): Unit[] {
  const units: Unit[] = [];
  sentences.forEach((sent, s) => {
    (String(sent).match(/\S+/g) ?? []).forEach((w, i) => {
      const alts = wordAlts(w);
      const weight = alts.length && alts[0].every((t) => FUNC.has(t)) ? 0.5 : 1;
      units.push({ s, i, w, alts, weight });
    });
  });
  return units;
}

function innerMatch(alt: string[], seg: HypTok[]): { d: number; s: number } {   // d = edit cost in tokens, s = similarity 0..1
  if (alt.length === 1 && seg.length === 1) { const s = sim(alt[0], seg[0].t); return { d: 1 - s, s }; }
  const L = alt.length, K = seg.length;
  const D: number[][] = Array.from({ length: L + 1 }, (_, i) => Array.from({ length: K + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= L; i++) for (let j = 1; j <= K; j++)
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (1 - sim(alt[i - 1], seg[j - 1].t)));
  return { d: D[L][K], s: Math.max(0, 1 - D[L][K] / Math.max(L, K)) };
}

interface Step { pu: number; ph: number; kind: "match" | "del" | "ins"; sim?: number }

/** Monotonic alignment of script units to heard tokens. Returns per-unit status and heard text. */
export function alignUnits(units: Unit[], hyp: { words: string[]; toks: HypTok[] }) {
  const live = units.filter((u) => u.alts.length);
  // a looping/hallucinated transcript must not blow up the DP: anything far beyond the script length is surplus
  const H = hyp.toks.slice(0, 3 * live.reduce((n, u) => n + u.alts[0].length, 0) + 40), U = live.length, N = H.length;
  const cost = Array.from({ length: U + 1 }, () => new Float64Array(N + 1).fill(Infinity));
  const back: (Step | null)[][] = Array.from({ length: U + 1 }, () => new Array(N + 1).fill(null));
  cost[0][0] = 0;
  const relax = (u: number, h: number, c: number, st: Step) => { if (c < cost[u][h] - 1e-9) { cost[u][h] = c; back[u][h] = st; } };
  const insCost = (t: string) => (FILLERS.has(t) ? 0.05 : t === UNK ? 0.15 : 1.0001);
  for (let u = 0; u <= U; u++) for (let h = 0; h <= N; h++) {
    const c0 = cost[u][h]; if (c0 === Infinity) continue;
    if (h < N) relax(u, h + 1, c0 + insCost(H[h].t), { pu: u, ph: h, kind: "ins" });
    if (u === U) continue;
    relax(u + 1, h, c0 + 1, { pu: u, ph: h, kind: "del" });
    for (const alt of live[u].alts) {
      const L = alt.length;
      for (let k = Math.max(1, L - 1); k <= L + 1 && h + k <= N; k++) {
        const seg = H.slice(h, h + k);
        if (seg.some((x) => FILLERS.has(x.t))) continue;
        const m = innerMatch(alt, seg);
        // absolute token edit cost, so absorbing a neighbouring extra word is never cheaper than an insertion
        relax(u + 1, h + k, c0 + m.d + (k !== L ? 0.01 : 0), { pu: u, ph: h, kind: "match", sim: m.s });
      }
      if (L === 1 && h + 2 <= N && !FILLERS.has(H[h].t) && !FILLERS.has(H[h + 1].t) && H[h].t !== UNK && H[h + 1].t !== UNK) {
        const s = sim(alt[0], H[h].t + H[h + 1].t);
        if (s > 0.6) relax(u + 1, h + 2, c0 + (1 - s) + 0.05, { pu: u, ph: h, kind: "match", sim: s });
      }
      if (L === 2 && h + 1 <= N && H[h].t !== UNK) {
        const s = sim(alt.join(""), H[h].t);
        if (s > 0.6) relax(u + 1, h + 1, c0 + (1 - s) + 0.05, { pu: u, ph: h, kind: "match", sim: s });
      }
    }
  }
  // backtrack
  const res = new Map<Unit, { st: Status; heard?: string; sim?: number }>();
  const extra: string[] = [];
  let u = U, h = N;
  const heardText = (a: number, b: number) => {
    const idx: number[] = []; for (let x = a; x < b; x++) if (!idx.includes(H[x].wi)) idx.push(H[x].wi);
    return idx.map((i) => hyp.words[i]).join(" ").replace(/^[^\w$£€\[]+|[^\w%\]]+$/g, "");
  };
  while (u > 0 || h > 0) {
    const st = back[u][h]; if (!st) break;
    if (st.kind === "ins") { const t = H[st.ph].t; if (!FILLERS.has(t) && t !== UNK) extra.unshift(hyp.words[H[st.ph].wi]); }
    else if (st.kind === "del") res.set(live[st.pu], { st: "missing" });
    else {
      const allUnk = H.slice(st.ph, h).every((x) => x.t === UNK);
      const s = st.sim ?? 0;
      res.set(live[st.pu], allUnk ? { st: "unclear", heard: "?", sim: s } : { st: s >= 0.999 ? "ok" : s >= 0.6 ? "unclear" : "wrong", heard: heardText(st.ph, h), sim: s });
    }
    u = st.pu; h = st.ph;
  }
  return { res, extra: [...new Set(extra)].slice(0, 20) };
}

const SUFFIX = ["s", "es", "ed", "d", "ing", "er", "ers", "ly", "t"];
function asrNote(u: Unit, r: { st: Status; heard?: string }): string | undefined {
  if (r.st === "missing") return "聞こえませんでした";
  if (r.heard === "?") return "はっきり聞き取れませんでした";
  if (r.st === "wrong") return `「${r.heard}」と聞こえました`;
  if (r.st === "unclear" && r.heard) {
    const ref = u.alts[0].join(""), got = r.heard.toLowerCase().replace(/[^a-z0-9']/g, "");
    if (ref.startsWith(got)) { const rem = ref.slice(got.length); if (SUFFIX.includes(rem)) return `語尾「-${rem}」が聞こえません（「${r.heard}」）`; }
    return `「${r.heard}」に近く聞こえました`;
  }
  return undefined;
}

/* -------------------------------------------------------------- scoring */
export function score(words: WordResult[], units: Unit[], P: number, I: number, F: number) {
  let tot = 0, got = 0;
  const counts = { total: 0, ok: 0, unclear: 0, wrong: 0, missing: 0 };
  units.forEach((u, k) => {
    const w = words[k]; if (w.st === "skip") return;
    counts.total++; counts[w.st as "ok"]++;
    tot += u.weight;
    got += u.weight * (w.st === "ok" ? 1 : w.st === "unclear" ? 0.5 : 0);
  });
  const coverage = tot ? Math.round((100 * got) / tot) : 0;
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  let p = clamp(P), i = clamp(I), f = clamp(F);
  if (coverage < 5) { p = 0; i = 0; f = 0; }
  f = Math.min(f, coverage + 10);                         // stopping early is a fluency problem
  // half coverage, half quality; every missed or misheard word lowers the ceiling at 1.5× its share
  // (coverage 95 → max 92, 90 → 85, 85 → 78, 70 → 55), so a recording with many gaps cannot reach the 80-point "mastered" line
  const ceiling = Math.max(coverage / 2, 1.5 * coverage - 50);
  const overall = Math.round(Math.min(ceiling, 0.5 * coverage + 0.5 * ((p + i + f) / 3)));
  return { coverage, counts, pronunciation: p, intonation: i, fluency: f, overall };
}

/* --------------------------------------------------------------- Gemini */
const ACCENT: Record<string, string> = { US: "General American", UK: "British (RP)", AU: "Australian" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function gemini(key: string, models: string[], parts: unknown[], schema: unknown, temperature: number, timeoutMs = 45_000) {
  let last = "";
  const tries: [string, number][] = models.flatMap((m) => [[m, 0], [m, 1]] as [string, number][]);
  for (let n = 0; n < tries.length; n++) {
    const [model, attempt] = tries[n];
    const t0 = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature, response_mime_type: "application/json", response_schema: schema } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await r.text();
      if (r.ok) {
        const g = JSON.parse(text);
        const out = JSON.parse(g.candidates?.[0]?.content?.parts?.[0]?.text ?? "null");
        if (out) return { out, model, ms: Date.now() - t0, usage: g.usageMetadata ?? {} };
        last = "empty response";
      } else {
        last = `Gemini ${r.status}: ${text.slice(0, 300)}`;
        if (![429, 500, 502, 503, 504].includes(r.status) && attempt === 0) { n++; continue; }   // not retryable → next model
      }
    } catch (e) { last = String((e as Error)?.message ?? e); }
    if (n < tries.length - 1) await sleep(attempt ? 600 : 1500);
  }
  throw new Error(last);
}

const ASR_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING", description: "Verbatim transcript of what is audible. Empty if no speech." },
    speech: { type: "BOOLEAN", description: "false if the recording contains no intelligible speech." },
  },
  required: ["transcript", "speech"],
};
const ASR_PROMPT = `Transcribe this recording verbatim. The speaker is a Japanese learner of English reading English aloud.
- Write exactly what is audible, word by word. Do not fix grammar, do not complete sentences, do not add words that were not spoken, and do not guess from context.
- If a word sounds like a different English word, write the word you actually hear. If a stretch is not recognizable as English words, write [?] in its place.
- Keep repetitions and false starts. Write hesitations as "uh" or "um".
- Write numbers as digits (for example 507, 1:30) and times with a.m./p.m.
- If there is no speech, return an empty transcript and speech=false.`;
const JUDGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    pronunciation: { type: "INTEGER", description: "0-100, spoken part only: vowels, consonants, word stress." },
    intonation: { type: "INTEGER", description: "0-100, spoken part only: sentence stress, pitch movement, rhythm, linking." },
    fluency: { type: "INTEGER", description: "0-100: pace, pauses, hesitations, restarts, stopping early." },
    points: {
      type: "ARRAY",
      description: "3 to 5 coaching points in Japanese, most impactful first.",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Japanese, max 24 chars." },
          detail: { type: "STRING", description: "Japanese, 2-3 sentences: the word(s), how it sounded, and exactly how to say it correctly (tongue / lips / breath / stress / rhythm). Quote the target pronunciation in IPA when given." },
          kind: { type: "STRING", enum: ["pronunciation", "intonation", "rhythm", "linking", "fluency", "completeness"] },
        },
        required: ["title", "detail", "kind"],
      },
    },
    good: { type: "STRING", description: "One sentence in Japanese: what was done well." },
  },
  required: ["pronunciation", "intonation", "fluency", "points", "good"],
};
function judgePrompt(sentences: string[], words: WordResult[], transcript: string, speed: number, accent: string, ipa: string[] = []) {
  const lines = sentences.map((_, s) => `[${s}] ` + words.filter((w) => w.s === s).map((w) => {
    const flag = w.st === "missing" ? "{MISSING}" : w.st === "wrong" ? `{HEARD "${w.heard}"}` : w.st === "unclear" ? (w.heard === "?" ? "{UNINTELLIGIBLE}" : `{NEAR "${w.heard}"}`) : "";
    return `${w.s}-${w.i}:${w.w}${flag}`;
  }).join(" ") + (ipa[s] ? `\n     IPA: ${ipa[s]}` : "")).join("\n");
  return `You are an English pronunciation coach for a Japanese adult learner preparing for TOEIC.
The learner SHADOWED the script below at ${speed.toFixed(1)}x speed, speaking along with a model recording in a ${ACCENT[accent] ?? ACCENT.US} accent. Accept any standard native accent (American, British, Australian); never penalize a different native-like variety.

A separate listener transcribed the recording WITHOUT seeing the script, and the transcription was aligned to the script automatically. Treat the alignment as fact:
- {MISSING}: the word was not heard at all.
- {HEARD "x"}: the word sounded like a different word x.
- {NEAR "x"}: the word sounded close to x (often a dropped ending).
- {UNINTELLIGIBLE}: something was said but it was not recognizable.
Never describe a MISSING word as spoken, and never praise words that were missing or misheard.

Blind transcription: "${transcript.replace(/"/g, "'")}"

Script (id:word, with alignment flags):
${lines}

Tasks:
1. Rate the spoken part: pronunciation (vowels, consonants, word stress), intonation (sentence stress, pitch movement, rhythm, linking), fluency (pace, pauses, hesitations, restarts; stopping before the end lowers it). Scale, do not inflate: 95 = indistinguishable from the native model; 85 = very clear, slight accent; 70 = clearly intelligible, noticeable Japanese accent; 55 = intelligible with effort, frequent errors; 40 = often unintelligible; 20 or below = almost nothing intelligible.
2. points: 3-5 coaching points in natural Japanese (丁寧体), most impactful first. Each point must (a) name the word or phrase, (b) say how it actually sounded in this recording, and (c) explain concretely HOW to say it correctly: tongue and lip position, breath, which syllable to stress, how to link or reduce, e.g. 「th は舌先を上の前歯の裏に軽く当てて息を通す（s のように歯を閉じない）」「week の最後の k は口を閉じるだけで母音を足さない」. Quote the correct pronunciation in IPA from the script's IPA line when it is given, e.g. /ˈɹɪvɛɹə/. If words were missing, say which phrase to practise and at what speed. Mention a pronunciation problem on an unflagged word only if you clearly hear it in this recording; never assume an error just because Japanese speakers often make it.
3. good: one sentence in Japanese (丁寧体) about what was done well. If nothing was intelligible, say so kindly.`;
}

/* ------------------------------------------------------------ pipeline */
export interface AssessInput { audio: string; mimeType?: string; sentences: string[]; speed?: number; accent?: string; ipa?: string[] }
export interface AssessOptions { key: string; asrModels: string[]; judgeModels: string[] }

export async function assessV2(inp: AssessInput, opt: AssessOptions) {
  const t0 = Date.now();
  const speed = Number(inp.speed) || 1;
  const accent = ["US", "UK", "AU"].includes(String(inp.accent)) ? String(inp.accent) : "US";
  const audioPart = { inline_data: { mime_type: inp.mimeType || "audio/wav", data: inp.audio } };
  const units = scriptUnits(inp.sentences);

  // 1) blind transcription
  const asr = await gemini(opt.key, opt.asrModels, [{ text: ASR_PROMPT }, audioPart], ASR_SCHEMA, 0);
  const transcript = String(asr.out.transcript ?? "").trim();

  // 2) alignment
  const hyp = hypTokens(transcript);
  const { res, extra } = alignUnits(units, hyp);
  const words: WordResult[] = units.map((u) => {
    if (!u.alts.length) return { s: u.s, i: u.i, w: u.w, st: "skip" as Status };
    const r = res.get(u) ?? { st: "missing" as Status };
    const out: WordResult = { s: u.s, i: u.i, w: u.w, st: r.st };
    if (r.st !== "ok") { if (r.heard) out.heard = r.heard; const n = asrNote(u, r); if (n) out.note = n; }
    return out;
  });
  const recognised = words.filter((w) => w.st === "ok" || w.st === "unclear").length;

  // 3) judge (skipped when nothing intelligible was said)
  let judge: any = null, judgeMeta: any = null;
  if (recognised > 0) {
    try {
      const ipa = Array.isArray(inp.ipa) ? inp.ipa.map((x) => String(x ?? "").slice(0, 400)) : [];
      const j = await gemini(opt.key, opt.judgeModels, [{ text: judgePrompt(inp.sentences, words, transcript, speed, accent, ipa) }, audioPart], JUDGE_SCHEMA, 0.2);
      judge = j.out; judgeMeta = { model: j.model, ms: j.ms, usage: j.usage };
    } catch (e) { throw new Error("judge: " + String((e as Error).message ?? e).slice(0, 300)); }
  }
  // 4) score
  const sc = score(words, units, judge?.pronunciation ?? 0, judge?.intonation ?? 0, judge?.fluency ?? 0);
  const KINDS = ["pronunciation", "intonation", "rhythm", "linking", "fluency", "completeness"];
  let points = (Array.isArray(judge?.points) ? judge.points : []).slice(0, 5)
    .filter((p: any) => p && p.title && p.detail)
    .map((p: any) => ({ title: String(p.title).slice(0, 40), detail: String(p.detail).slice(0, 400), kind: KINDS.includes(p.kind) ? p.kind : "pronunciation" }));
  let good = typeof judge?.good === "string" ? judge.good.slice(0, 200) : "";
  if (!recognised) {
    points = [{ title: "声が録音されていません", detail: "マイクの位置と入力音量を確認し、お手本に合わせて声に出して録音してください。", kind: "completeness" }];
    good = "";
  }
  return {
    version: 2,
    transcript,
    overall: sc.overall, pronunciation: sc.pronunciation, intonation: sc.intonation, fluency: sc.fluency, coverage: sc.coverage,
    counts: { ...sc.counts, extra: extra.length },
    words, extra, points, good, leakage: false,
    meta: { ms: Date.now() - t0, asr: { model: asr.model, ms: asr.ms, usage: asr.usage }, judge: judgeMeta, model: asr.model + (judgeMeta?.model && judgeMeta.model !== asr.model ? " + " + judgeMeta.model : "") },
  };
}
