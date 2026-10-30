"""Render each song section of the MO3 (start order -> loop) to WAV with loop points.
Output: intro + loop pass 1 + loop pass 2; loopStart = sample of first jump, loopEnd = sample of second jump."""
import sys, json, wave, struct, ctypes; sys.path.insert(0, '/home/claude/hw/tools')
from mptlib import *
import numpy as np
SR = 44100
src, outdir = sys.argv[1], sys.argv[2]
songs = [  # (name, start order, loop target order)
    ('songA', 0, 4), ('songB', 42, 42), ('songC', 59, 59), ('songD', 73, 73), ('songE', 79, 81)]
meta = {}
for name, start, target in songs:
    m, buf = load(src)
    # select the subsong containing start so initial state (tempo/speed) is right
    ns = L.openmpt_module_get_num_subsongs(m)
    chosen = None
    for s in range(ns):
        L.openmpt_module_select_subsong(m, s)
        if L.openmpt_module_get_current_order(m) == start: chosen = s; break
    L.openmpt_module_select_subsong(m, chosen)
    L.openmpt_module_set_repeat_count(m, -1)
    L.openmpt_module_set_render_param(m, 3, 0)  # INTERPOLATIONFILTER_LENGTH default
    chunk = 32
    arr = (ctypes.c_float * (chunk * 2))()
    out = []
    total = 0
    prev_order = L.openmpt_module_get_current_order(m)
    jumps = []
    while len(jumps) < 2 and total < SR * 600:
        n = L.openmpt_module_read_interleaved_float_stereo(m, SR, chunk, arr)
        if n == 0: break
        out.append(np.frombuffer(arr, dtype=np.float32, count=n * 2).copy())
        total += n
        o = L.openmpt_module_get_current_order(m)
        if o < prev_order:
            jumps.append(total)  # approx (chunk granularity)
        prev_order = o
    # tail a bit after the 2nd jump so loopEnd lies inside the buffer
    for _ in range(int(SR * 0.05 / chunk)):
        n = L.openmpt_module_read_interleaved_float_stereo(m, SR, chunk, arr)
        out.append(np.frombuffer(arr, dtype=np.float32, count=n * 2).copy()); total += n
    pcm = np.concatenate(out)
    pcm16 = (np.clip(pcm, -1, 1) * 32767).astype('<i2')
    w = wave.open(f'{outdir}/{name}.wav', 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm16.tobytes()); w.close()
    meta[name] = {'loopStart': jumps[0] / SR, 'loopEnd': jumps[1] / SR, 'length': total / SR}
    print(name, 'chosen subsong', chosen, meta[name])
json.dump(meta, open(f'{outdir}/music.json', 'w'), indent=1)
