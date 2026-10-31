// Offline checks for the evaluator's alignment and scoring (no network, no Gemini).
//   node --experimental-strip-types tests/align_test.mjs
// 1) every bundled script, "transcribed" perfectly, must come back with every word ok;
// 2) a listener writing numbers / abbreviations / spellings differently must still match;
// 3) skipped, replaced and dropped-ending words must be flagged where they are.
import * as C from '../supabase/functions/assess/core.ts';
import fs from 'fs';
const w = {}; new Function('window', fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8'))(w);
let fails = 0; const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };

let n = 0;
for (const sc of w.CONTENT) {
  const U = C.scriptUnits(sc.s.map(p => p[0]));
  const { res } = C.alignUnits(U, C.hypTokens(sc.s.map(p => p[0]).join(' ')));
  U.forEach(u => { if (!u.alts.length) return; n++; ok(res.get(u)?.st === 'ok', `${sc.id} "${u.w}" identity`); });
}
console.log(`identity: ${n} words checked`);

const same = [
  ['The interview is scheduled for Wednesday, November fourth, at 1:30 P.M. at our main office.', 'the interview is scheduled for wednesday november 4th at one thirty PM at our main office'],
  ['Call me back at extension 126 to confirm that you can attend.', 'call me back at extension one two six to confirm that you can attend'],
  ['Hello, Ms. Rivera, this is Mark Sullivan.', 'hello miss rivera this is mark sulivan'],
  ['It is a five-minute walk from Gate 22 to Gate 9.', "it's a five minute walk from gate twenty-two to gate nine"],
  ['The total is $4.50, or 20% off.', 'the total is four dollars fifty cents or twenty percent off'],
  ["Our centre opened in 1995 and we're proud of it.", 'our center opened in nineteen ninety five and we are proud of it'],
  ['Please e-mail the catalogue to Mr. Brown by 9:00 A.M.', 'please email the catalog to mister brown by 9 am'],
  ['We were impressed with your resume.', 'we were impressed with your résumé'],
  ['Westfield Insurance has a new checkout process.', 'West field insurance has a new check out process'],
];
for (const [ref, heard] of same) {
  const U = C.scriptUnits([ref]); const { res } = C.alignUnits(U, C.hypTokens(heard));
  U.filter(u => u.alts.length).forEach(u => ok(res.get(u)?.st === 'ok', `"${u.w}" should match in: ${heard}`));
}

const S = ['Hello, Ms. Rivera, this is Mark Sullivan from the human resources department at Westfield Insurance.',
  'Thank you for applying for the account manager position last week.'];
const check = (heard, expect) => {
  const U = C.scriptUnits(S); const { res } = C.alignUnits(U, C.hypTokens(heard));
  const got = Object.fromEntries(U.filter(u => res.get(u)?.st !== 'ok').map(u => [`${u.s}-${u.i}`, res.get(u).st]));
  ok(JSON.stringify(got) === JSON.stringify(expect), `"${heard}" → ${JSON.stringify(got)} (expected ${JSON.stringify(expect)})`);
};
check('Hello Ms. Rivera this is Mark Sullivan from the department at Westfield Insurance. Thank you for applying for the position last week.',
  { '0-9': 'missing', '0-10': 'missing', '1-6': 'missing', '1-7': 'missing' });
check('Hello Ms. Rivera this is Mark Sullivan from the human resources department at Westfield Insurance. Thank you for applying for the account manager position last month.',
  { '1-10': 'wrong' });
check('Hello Ms. Rivera this is Mark Sullivan from the human resource department at Westfield Insurance. Thank you for apply for the account manager position last week.',
  { '0-10': 'unclear', '1-3': 'unclear' });
check('', Object.fromEntries(C.scriptUnits(S).map(u => [`${u.s}-${u.i}`, 'missing'])));
console.log(fails ? `${fails} failure(s)` : 'all alignment checks passed');
process.exit(fails ? 1 : 0);
