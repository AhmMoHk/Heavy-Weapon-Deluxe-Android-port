import sys; sys.path.insert(0, '/home/claude/hw/tools')
from mptlib import *
m, buf = load(sys.argv[1])
no = L.openmpt_module_get_num_orders(m); nch = L.openmpt_module_get_num_channels(m)
for o in range(no):
    p = L.openmpt_module_get_order_pattern(m, o)
    rows = L.openmpt_module_get_pattern_num_rows(m, p)
    for r in range(rows):
        for c in range(nch):
            e = L.openmpt_module_get_pattern_row_channel_command(m, p, r, c, 3)
            if e in (12, 14, 16, 17):
                prm = L.openmpt_module_get_pattern_row_channel_command(m, p, r, c, 5)
                print('order', o, 'pat', p, 'row', r, 'ch', c, {12:'JUMP',14:'BREAK',16:'SPEED',17:'TEMPO'}[e], prm)
