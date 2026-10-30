"""Render song sections and write separate intro / loop OGG files for gapless native playback."""
import sys, json, wave, ctypes, subprocess, os; sys.path.insert(0, '/home/claude/hw/tools')
from mptlib import *
import numpy as np
SR = 44100
src, outdir, tmp = sys.argv[1], sys.argv[2], sys.argv[3]
songs = [('songA', 0, 4), ('songB', 42, 42), ('songC', 59, 59), ('songD', 73, 73), ('songE', 79, 81)]
meta = {}
for name, start, target in songs:
    m, buf = load(src)
    for s in range(L.openmpt_module_get_num_subsongs(m)):
        L.openmpt_module_select_subsong(m, s)
        if L.openmpt_module_get_current_order(m) == start: break
    L.openmpt_module_set_repeat_count(m, -1)
    chunk = 16
    arr = (ctypes.c_float * (chunk * 2))()
    out = []; total = 0
    prev = L.openmpt_module_get_current_order(m)
    first_target = 0 if start == target else None
    jumps = []
    while len(jumps) < 2:
        n = L.openmpt_module_read_interleaved_float_stereo(m, SR, chunk, arr)
        out.append(np.frombuffer(arr, dtype=np.float32, count=n * 2).copy()); total += n
        o = L.openmpt_module_get_current_order(m)
        if o != prev:
            if o == target and first_target is None: first_target = total
            if o < prev: jumps.append(total)
        prev = o
    pcm = np.concatenate(out).reshape(-1, 2)
    def write(fn, a):
        w = wave.open(fn, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype('<i2').tobytes()); w.close()
    loop = pcm[jumps[0]:jumps[1]]
    files = []
    write(f'{tmp}/{name}_loop.wav', loop)
    has_intro = start != target
    if has_intro:
        write(f'{tmp}/{name}_intro.wav', pcm[:first_target])
        files += [name + '_intro']
        out_loop = name + '_loop'
    else:
        os.replace(f'{tmp}/{name}_loop.wav', f'{tmp}/{name}.wav')
        out_loop = name
    files.append(out_loop)
    for f in files:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', f'{tmp}/{f}.wav', '-c:a', 'libvorbis', '-q:a', '4', f'{outdir}/{f}.ogg'], check=True)
    meta[name] = {'intro': has_intro, 'introLen': (first_target / SR) if has_intro else 0, 'loopLen': len(loop) / SR}
    print(name, meta[name])
json.dump(meta, open(f'{outdir}/music.json', 'w'), indent=1)
