/* ---------- Word alignment: English word ↔ IPA token ↔ katakana chunk (drives the moving marker on 読み方) ----------
   IPA tokens are space-separated; words spoken together are joined with ‿ inside one token.
   Katakana chunks are space-separated and normally match the IPA tokens one-to-one.
   English words are matched to IPA sub-words with a small monotonic alignment over consonant "skeletons",
   allowing one English token to cover several IPA words (numbers, times, A.M., hyphenated words)
   and several English words to cover one IPA word (Thank you → θæŋkju, we are → wiɚ). */
const ALIGN = (() => {
  const NUM = ['zeero','wun','too','three','for','five','six','seven','eyt','nine','ten','eleven','twelve','thirteen','forteen','fifteen','sixteen','seventeen','eyteen','nineteen'];
  const TENS = {2:'twenty',3:'thirty',4:'forty',5:'fifty',6:'sixty',7:'seventy',8:'eyty',9:'ninety'};
  const LETTER = {a:'ay',b:'bee',c:'see',d:'dee',e:'ee',f:'ef',g:'jee',h:'aych',i:'eye',j:'jay',k:'kay',l:'el',m:'em',n:'en',o:'oh',p:'pee',q:'kyoo',r:'ar',s:'es',t:'tee',u:'yoo',v:'vee',w:'dubbelyoo',x:'eks',y:'wy',z:'zee'};
  const ABBR = {mr:['mister'],mrs:['misiz'],ms:['miz'],dr:['doctor'],st:['street'],jr:['junior'],vs:['versus'],ok:['okay'],etc:['etsetera'],ave:['avenue'],blvd:['boulevard'],dept:['department']};
  const under100 = n => n < 20 ? [NUM[n]] : (n % 10 ? [TENS[Math.floor(n/10)], NUM[n%10]] : [TENS[Math.floor(n/10)]]);
  const tail = r => r === 0 ? [] : (r < 10 ? ['oh', NUM[r]] : under100(r));
  function cardinal(n){
    if (n < 100) return under100(n);
    if (n < 1000) { const r = n % 100; return [NUM[Math.floor(n/100)], 'hundred'].concat(r ? under100(r) : []); }
    if (n < 10000) { const r = n % 1000; return under100(Math.floor(n/1000)).concat(['thousand'], r ? cardinal(r) : []); }
    return String(n).split('').map(d => NUM[+d]);
  }
  function numberCands(tok){
    const out = [];
    let m = tok.match(/^(\d{1,2}):(\d{2})$/);
    if (m) { const h = under100(+m[1]), mm = +m[2];
      if (mm === 0) out.push(h, h.concat(['oklok']), h.concat(['hundred']));
      else out.push(h.concat(tail(mm)), h.concat(under100(mm)));
      return out; }
    m = tok.match(/^(\d+)(st|nd|rd|th)?$/i);
    if (!m) return [tok.replace(/\D/g, '').split('').map(d => NUM[+d] || d)];
    const n = +m[1];
    out.push(cardinal(n));
    if (n >= 100 && n < 1000) {
      const r = n % 100;
      if (r) { out.push([NUM[Math.floor(n/100)]].concat(tail(r)));                                   // flight style: two eighteen
               out.push([NUM[Math.floor(n/100)], 'hundred', 'and'].concat(under100(r))); }           // British: two hundred and eighteen
      if (n < 200) out.push(['a', 'hundred'].concat(r ? under100(r) : []));
    }
    if (n >= 1100 && n < 2000) out.push(under100(Math.floor(n/100)).concat(n % 100 ? tail(n % 100) : ['hundred']));   // years
    if (n >= 2000 && n < 2100) { out.push(['twenty'].concat(n % 100 ? under100(n % 100) : ['hundred'])); out.push(['too', 'thousand'].concat(n % 100 ? under100(n % 100) : [])); }
    if (m[1].length >= 3) out.push(m[1].split('').map(d => NUM[+d]));                                      // digit by digit
    return out;
  }
  // English token → candidate spoken word lists; `multi` tokens may cover several IPA words cheaply
  function enKind(raw){
    const t = String(raw).replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.]+$/, '');
    const core = t.replace(/\.+$/, '');
    if (/^\d/.test(core)) return { cands: numberCands(core.replace(/,/g, '')), multi: true };
    if (/^[A-Za-z](\.[A-Za-z])+\.?$/.test(t)) return { cands: [t.toLowerCase().replace(/\./g, '').split('').map(c => LETTER[c] || c)], multi: true };
    const low = core.toLowerCase().replace(/[^a-z'-]/g, '');
    const plain = low.replace(/'/g, '');
    if (ABBR[plain] && (/\.$/.test(t) || /^(Mr|Mrs|Ms|Dr)$/.test(core))) return { cands: [ABBR[plain]], multi: false };
    if (/^[A-Z]{2,4}$/.test(core)) return { cands: [core.toLowerCase().split('').map(c => LETTER[c]), [plain]], multi: true };
    if (low.includes('-')) return { cands: [low.split('-').filter(Boolean)], multi: true };
    return { cands: [[plain]], multi: false };
  }
  const collapse = s => s.replace(/(.)\1+/g, '$1');
  // auxiliaries as they sound when contracted onto the previous word (I'd, it'll, we've, she's, they're)
  const CONTR = { would: 't', had: 't', will: 'l', shall: 'l', have: 'f', has: 's', is: 's', are: '', am: 'm', not: 'nt', us: 's' };
  function enSkel(w){
    let s = String(w).toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return '';
    s = s.replace(/^who/, 'hu').replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^wh/, 'w').replace(/^ps/, 's').replace(/mb$/, 'm').replace(/mn$/, 'm')
         .replace(/[ts]ion/g, 'Sn').replace(/ture/g, 'Cr').replace(/sure/g, 'Sr').replace(/[ct]ial/g, 'Sl').replace(/dge/g, 'C').replace(/ge$/, 'C')
         .replace(/tch/g, 'C').replace(/ch/g, 'C').replace(/sh/g, 'S').replace(/th/g, 'T').replace(/ph/g, 'f').replace(/gh/g, '')
         .replace(/ck/g, 'k').replace(/qu/g, 'kw').replace(/x/g, 'ks').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k');
    s = s[0] + s.slice(1).replace(/y/g, 'a');                       // y is a consonant only at the start
    s = s.replace(/([aeiou])w(?![aeiou])/g, '$1');                  // ow/aw/ew: the w is part of the vowel (how, new, brown)
    s = s.replace(/[aeiou]/g, '')
         .replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k').replace(/v/g, 'f').replace(/z/g, 's').replace(/j/g, 'C').replace(/[rh]/g, '');
    return collapse(s);
  }
  function ipaSkel(x){
    let s = String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ˈˌː‿.]/g, '');
    s = s.replace(/tʃ/g, 'C').replace(/dʒ/g, 'C').replace(/[ʃʒ]/g, 'S').replace(/[θð]/g, 'T').replace(/ŋ/g, 'nk').replace(/[ɾʔ]/g, 't').replace(/[ɡg]/g, 'k')
         .replace(/b/g, 'p').replace(/d/g, 't').replace(/v/g, 'f').replace(/z/g, 's').replace(/j/g, 'y').replace(/[rɹhɦ]/g, '');
    return collapse(s.replace(/[^ptkfsTSCmnlyw]/g, ''));
  }
  function lev(a, b){
    if (!a.length) return b.length; if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      prev = cur; }
    return prev[b.length];
  }
  function cmp(a, b){ a = a.replace(/t$/, ''); b = b.replace(/t$/, ''); const L = Math.max(a.length, b.length); return L ? lev(a, b) / L : 0; }   // final t/d is often dropped in speech

  const ARROW = /(↘↗|↗|↘)/g;
  const ipaTokens = t => { const s = String(t || '').replace(ARROW, ' ').replace(/\//g, ' ').trim(); return s ? s.split(/\s+/) : []; };
  const kanaChunks = t => { const s = String(t || '').replace(ARROW, ' ').trim(); return s ? s.split(/\s+/) : []; };
  const plainLen = s => Math.max(1, String(s).replace(/[*ˈˌː‿]/g, '').length);

  // Returns { w: [[t0,t1]...], k: [[c0,c1]...] } — for each English word, the IPA token range and the katakana chunk range
  function align(en, kana, ipa){
    const E = String(en).split(/\s+/).filter(Boolean);
    const toks = ipaTokens(ipa), chunks = kanaChunks(kana);
    const n = E.length;
    if (!n || !toks.length) return null;
    const subs = []; toks.forEach((tk, ti) => tk.split('‿').filter(Boolean).forEach(sw => subs.push({ ti, sk: ipaSkel(sw) })));
    const m = subs.length;
    const kinds = E.map(enKind);
    const enSk = kinds.map(k => k.cands.map(c => collapse(c.map(enSkel).join(''))));
    const subSk = (j, b) => collapse(subs.slice(j, j + b).map(s => s.sk).join(''));
    const INF = 1e9, D = [], P = [];
    for (let i = 0; i <= n; i++) { D.push(new Array(m + 1).fill(INF)); P.push(new Array(m + 1).fill(null)); }
    D[0][0] = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      const d = D[i][j]; if (d >= INF) continue;
      const relax = (a, b, c) => { const ni = i + a, nj = j + b; if (ni > n || nj > m) return; if (d + c < D[ni][nj] - 1e-9) { D[ni][nj] = d + c; P[ni][nj] = [a, b]; } };
      if (i < n) {
        const kd = kinds[i], maxB = kd.multi ? 6 : 3;
        for (let b = 1; b <= maxB && j + b <= m; b++) {
          const B = subSk(j, b); let c = INF; for (const A of enSk[i]) c = Math.min(c, cmp(A, B));
          relax(1, b, c + (kd.multi ? 0.08 * (b - 1) : [0, 0, 0.4, 0.8][b]));
        }
        for (let a = 2; a <= 3 && i + a <= n && j < m; a++) {
          const full = collapse(enSk.slice(i, i + a).map(x => x[0]).join(''));
          const contracted = collapse([enSk[i][0]].concat(E.slice(i + 1, i + a).map((e, q) => { const key = e.toLowerCase().replace(/[^a-z]/g, ''); return key in CONTR ? CONTR[key] : enSk[i + 1 + q][0]; })).join(''));
          relax(a, 1, Math.min(cmp(full, subs[j].sk), cmp(contracted, subs[j].sk)) + (a === 2 ? 0.4 : 0.8));
        }
        relax(1, 0, 1.2);
      }
      if (j < m) relax(0, 1, 1.2);
    }
    const w = new Array(n).fill(null);
    let i = n, j = m; const groups = [];
    while (i > 0 || j > 0) { const p = P[i][j]; if (!p) break; groups.push([i - p[0], p[0], j - p[1], p[1]]); i -= p[0]; j -= p[1]; }
    groups.reverse();
    for (const [i0, a, j0, b] of groups) for (let x = 0; x < a; x++) w[i0 + x] = b ? [subs[j0].ti, subs[j0 + b - 1].ti] : null;
    for (let x = 0; x < n; x++) if (!w[x]) w[x] = x ? w[x - 1].slice() : [0, 0];

    // katakana: match IPA tokens to katakana chunks by sound (they usually pair one-to-one, but the
    // writer sometimes links words in one line and not the other, e.g. ʃɪˈkɑɡoʊ‿ɑn ↔ シカーゴウ オン)
    const tokChunk = chunks.length === toks.length ? toks.map((_, x) => [x, x]) : tokenToChunks(toks, chunks);
    const k = w.map(([t0, t1]) => [tokChunk[t0][0], tokChunk[t1][1]]);
    return { w, k };
  }

  // consonant skeletons for katakana and an IPA variant that follows katakana conventions (r→ラ行, θ/ð→サ/ザ行)
  const KSKEL = (() => { const m = {}; const set = (chars, v) => { for (const c of chars) m[c] = v; };
    set('アイウエオァィゥェォヮーッ', ''); set('ャュョ', 'y'); set('カキクケコガギグゲゴ', 'k'); set('サスセソザズゼゾ', 's'); set('シ', 'S'); set('ジヂ', 'C'); set('チ', 'C');
    set('タテトダデド', 't'); set('ツヅ', 'ts'); set('ナニヌネノン', 'n'); set('ハヒヘホ', ''); set('フヴ', 'f'); set('バビブベボパピプペポ', 'p');
    set('マミムメモ', 'm'); set('ヤユヨ', 'y'); set('ラリルレロ', 'l'); set('ワヲ', 'w'); return m; })();
  function kanaSkel(s){
    s = String(s).replace(/\*/g, '').replace(/ウ(?=[ィェォ])/g, 'ワ');   // ウィ/ウェ/ウォ = w
    let out = ''; for (const c of s) out += (c in KSKEL) ? KSKEL[c] : '';
    return collapse(out.replace(/([SC])y/g, '$1'));
  }
  function ipaKanaSkel(x){
    let s = String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ˈˌː‿.]/g, '');
    s = s.replace(/tʃ/g, 'C').replace(/dʒ/g, 'C').replace(/[ʃ]/g, 'S').replace(/[ʒ]/g, 'C').replace(/[θð]/g, 's').replace(/ŋ/g, 'n').replace(/[ɾ]/g, 'l').replace(/ʔ/g, '')
         .replace(/[ɡg]/g, 'k').replace(/b/g, 'p').replace(/d/g, 't').replace(/v/g, 'f').replace(/z/g, 's').replace(/j/g, 'y').replace(/[rɹ]/g, 'l')
         .replace(/h(?=[uʊ])/g, 'f').replace(/[hɦ]/g, '');   // katakana writes hu as フ (who → フー)
    return collapse(s.replace(/[^ptkfsSCmnlyw]/g, ''));
  }
  function tokenToChunks(toks, chunks){
    const T = toks.length, K = chunks.length;
    const out = toks.map(() => null);
    if (!K) return toks.map(() => [0, 0]);
    const ts = toks.map(ipaKanaSkel), ks = chunks.map(kanaSkel);
    const cat = (arr, i, n) => collapse(arr.slice(i, i + n).join(''));
    const INF = 1e9, D = [], P = [];
    for (let i = 0; i <= T; i++) { D.push(new Array(K + 1).fill(INF)); P.push(new Array(K + 1).fill(null)); }
    D[0][0] = 0;
    const PEN = { '1,1': 0, '1,2': 0.3, '2,1': 0.3, '1,3': 0.6, '3,1': 0.6 };
    for (let i = 0; i <= T; i++) for (let j = 0; j <= K; j++) {
      const d = D[i][j]; if (d >= INF) continue;
      const relax = (a, b, c) => { const ni = i + a, nj = j + b; if (ni > T || nj > K) return; if (d + c < D[ni][nj] - 1e-9) { D[ni][nj] = d + c; P[ni][nj] = [a, b]; } };
      for (const key in PEN) { const [a, b] = key.split(',').map(Number); if (i + a > T || j + b > K) continue;
        const linked = a === 1 && b > 1 && (toks[i].split('‿').length - 1) >= b - 1;
        relax(a, b, cmp(cat(ts, i, a), cat(ks, j, b)) + (linked ? 0.1 : PEN[key])); }
      if (i < T) relax(1, 0, 1.0);
      if (j < K) relax(0, 1, 1.0);
    }
    let i = T, j = K; const groups = [];
    while (i > 0 || j > 0) { const p = P[i][j]; if (!p) break; groups.push([i - p[0], p[0], j - p[1], p[1]]); i -= p[0]; j -= p[1]; }
    groups.reverse();
    for (const [i0, a, j0, b] of groups) for (let x = 0; x < a; x++) out[i0 + x] = b ? [j0, j0 + b - 1] : null;
    for (let x = 0; x < T; x++) if (!out[x]) out[x] = x ? out[x - 1].slice() : [0, 0];
    return out;
  }
  return { align, ipaTokens, kanaChunks, enSkel, ipaSkel, kanaSkel, ipaKanaSkel };
})();
if (typeof module !== 'undefined') module.exports = ALIGN;
