import json, re, subprocess, wave, os, sys
SRC = '/home/claude/shadowing-studio.html'
OUT = '/home/claude/audio'
os.makedirs(OUT, exist_ok=True)
html = open(SRC).read()
# pull the BUILTIN array out of the page and evaluate it with node
js = html.split('<script>')[1].split('</script>')[0]
arr = js.split('const BUILTIN = ')[1].split('\n];')[0] + '\n]'
scripts = json.loads(subprocess.check_output(['node', '-e', 'console.log(JSON.stringify(' + arr + '))']).decode())
GAP = 0.35
timeline = {}
for sc in scripts:
    parts, t = [], 0.0
    segs = []
    for i, (en, ja) in enumerate(sc['s']):
        wav = f"{OUT}/{sc['id']}-{i}.wav"
        voice = '/home/claude/voices/en-us-lessac-medium.onnx' if sc['id'] in ('b2','b4') else '/home/claude/voices/en-us-ryan-medium.onnx'
        subprocess.run(['python3','-m','piper','-m',voice,'-f',wav,'--sentence-silence','0'], input=en.encode(), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with wave.open(wav) as w:
            dur = w.getnframes() / w.getframerate()
        segs.append({'start': round(t, 3), 'end': round(t + dur, 3)})
        parts.append(wav); t += dur + GAP
    combined = f"{OUT}/{sc['id']}.wav"
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
    mp3 = f"{OUT}/{sc['id']}.mp3"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', combined, '-ar', '22050', '-b:a', '64k', mp3], check=True)
    timeline[sc['id']] = {'segs': segs, 'dur': round(t - GAP, 3)}
    print(sc['id'], round(t - GAP, 1), 's', os.path.getsize(mp3) // 1024, 'KB')
json.dump(timeline, open(f"{OUT}/timeline.json", 'w'))
print(json.dumps(timeline))
