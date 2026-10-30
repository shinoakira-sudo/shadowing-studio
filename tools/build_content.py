"""Build audio (audio/<id>.mp3) and content.js (scripts + timelines) from content/all.json."""
import json, subprocess, wave, os, sys
SRC = '/home/claude/content/all.json'
OUT = '/home/claude/audio'
TMP = '/tmp/claude-0/-home-claude/3287ad1a-6c5b-5330-98c9-fd12ef608e0e/scratchpad/wav'
os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
VOICES = {'m': '/home/claude/voices/en-us-ryan-medium.onnx', 'f': '/home/claude/voices/en-us-lessac-medium.onnx'}
GAP = 0.35
scripts = json.load(open(SRC))
timeline = {}
import concurrent.futures
def build(n_sc):
    n, sc = n_sc
    mp3 = f"{OUT}/{sc['id']}.mp3"
    parts, segs, t = [], [], 0.0
    for i, (en, ja) in enumerate(sc['s']):
        wav = f"{TMP}/{sc['id']}-{i}.wav"
        if not os.path.exists(wav):
            subprocess.run(['python3', '-m', 'piper', '-m', VOICES[sc['voice']], '-f', wav, '--sentence-silence', '0'],
                           input=en.encode(), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with wave.open(wav) as w:
            dur = w.getnframes() / w.getframerate()
        segs.append({'start': round(t, 3), 'end': round(t + dur, 3)})
        parts.append(wav); t += dur + GAP
    combined = f"{TMP}/{sc['id']}.wav"
    with wave.open(parts[0]) as w0:
        params = w0.getparams()
    with wave.open(combined, 'wb') as out:
        out.setparams(params)
        gap = b'\x00' * int(GAP * params.framerate) * params.sampwidth * params.nchannels
        for k, pth in enumerate(parts):
            with wave.open(pth) as w:
                out.writeframes(w.readframes(w.getnframes()))
            if k < len(parts) - 1:
                out.writeframes(gap)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', combined, '-ar', '22050', '-b:a', '64k', mp3], check=True)
    tl = {'segs': segs, 'dur': round(t - GAP, 3)}
    print(f"{n+1}/{len(scripts)} {sc['id']} {t-GAP:.1f}s", flush=True)
    return sc['id'], tl

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
    for sid, tl in ex.map(build, list(enumerate(scripts))):
        timeline[sid] = tl
with open('/home/claude/content.js', 'w') as f:
    f.write('window.CONTENT = ' + json.dumps(scripts, ensure_ascii=False) + ';\n')
    f.write('window.CONTENT_TL = ' + json.dumps(timeline) + ';\n')
print('content.js written', os.path.getsize('/home/claude/content.js') // 1024, 'KB')
