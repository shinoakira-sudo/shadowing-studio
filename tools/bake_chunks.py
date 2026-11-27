#!/usr/bin/env python3
"""Validate content/chunks_out/*.json and bake them into content/chunks.json + window.CONTENT_CHUNK in content.js.
Chunk files: { "<script id>": [ [ [chunkText, ja], ... ] per sentence ] }. Each sentence's chunk texts joined by one space must equal the script sentence."""
import json, glob, re, sys
all_ = {x['id']: x for x in json.load(open('content/all.json'))}
out, bad = {}, []
for f in sorted(glob.glob('content/chunks_out/*.json')):
    for sid, sents in json.load(open(f)).items():
        sc = all_.get(sid)
        if not sc: bad.append(f'{f}: unknown id {sid}'); continue
        if len(sents) != len(sc['s']): bad.append(f'{sid}: {len(sents)} sentences, script has {len(sc["s"])}'); continue
        ok = True
        for i, ch in enumerate(sents):
            if not ch or ' '.join(c[0] for c in ch) != sc['s'][i][0] or any(not c[1] for c in ch):
                bad.append(f'{sid}:{i} mismatch'); ok = False
        if ok: out[sid] = sents
if bad: print('\n'.join(bad)); sys.exit(1)
json.dump(out, open('content/chunks.json', 'w'), ensure_ascii=False, indent=0)
src = open('content.js').read()
src = re.sub(r'\nwindow\.CONTENT_CHUNK=.*?;\n', '\n', src, flags=re.S)
src = src.rstrip('\n') + '\nwindow.CONTENT_CHUNK=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
open('content.js', 'w').write(src)
print(f'baked {len(out)} scripts, {sum(len(v) for v in out.values())} sentences, {sum(len(c) for v in out.values() for c in v)} chunks')
