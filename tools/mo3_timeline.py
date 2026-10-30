import sys, ctypes; sys.path.insert(0, '/home/claude/hw/tools')
from mptlib import *
m, buf = load(sys.argv[1]); sub = int(sys.argv[2])
L.openmpt_module_select_subsong(m, sub)
print('dur', L.openmpt_module_get_duration_seconds(m))
L.openmpt_module_set_repeat_count(m, -1)
arr = (ctypes.c_float * 2048)()
t = 0; prev = None
while t < 44100 * 100:
    n = L.openmpt_module_read_interleaved_float_stereo(m, 44100, 1024, arr); t += n
    o = L.openmpt_module_get_current_order(m)
    if o != prev:
        print('%.2f order %d speed %d tempo %d' % (t / 44100, o, L.openmpt_module_get_current_speed(m), L.openmpt_module_get_current_tempo(m))); prev = o
