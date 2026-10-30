"""Merge content/kana_out/*.json into content.js as window.CONTENT_KANA (and content/kana.json for the repo).

Each entry: {"<script id>": {"accent": "US|UK|AU", "kana": [...], "ipa": [...]}} — one kana and one IPA line per sentence.
Re-running is safe: any existing CONTENT_KANA line in content.js is replaced.
"""
import glob, json, re, sys

ROOT = '/home/claude'
scripts = json.load(open(f'{ROOT}/content/all.json'))
want = {sc['id']: len(sc['s']) for sc in scripts}

merged = {}
for path in sorted(glob.glob(f'{ROOT}/content/kana_out/*.json')):
    merged.update(json.load(open(path)))

problems = []
for sid, n in want.items():
    v = merged.get(sid)
    if not v:
        problems.append((sid, 'missing')); continue
    if len(v.get('kana', [])) != n or len(v.get('ipa', [])) != n:
        problems.append((sid, 'count'))
    for i, s in enumerate(v.get('kana', [])):
        if s.count('**') % 2 or '****' in s: problems.append((sid, i, 'stars'))
        if not re.search(r'(↘↗|↗|↘)\s*$', s): problems.append((sid, i, 'arrow'))
        if re.search(r'[A-Za-z]', s): problems.append((sid, i, 'latin'))
extra = [k for k in merged if k not in want]
if problems or extra:
    print('NOT baked. problems:', problems[:20], 'unknown ids:', extra[:10]); sys.exit(1)

kana = {sid: {'accent': merged[sid]['accent'], 'kana': merged[sid]['kana'], 'ipa': merged[sid]['ipa']} for sid in want}
json.dump(kana, open(f'{ROOT}/content/kana.json', 'w'), ensure_ascii=False, indent=1)

js = open(f'{ROOT}/content.js').read()
js = re.sub(r'^window\.CONTENT_KANA = .*\n?', '', js, flags=re.M)
if not js.endswith('\n'): js += '\n'
js += 'window.CONTENT_KANA = ' + json.dumps(kana, ensure_ascii=False) + ';\n'
open(f'{ROOT}/content.js', 'w').write(js)
print('baked', len(kana), 'scripts,', sum(len(v['kana']) for v in kana.values()), 'sentences; content.js', len(js.encode()) // 1024, 'KB')
