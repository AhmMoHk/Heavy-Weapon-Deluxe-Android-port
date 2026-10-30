import sys; sys.path.insert(0, '/home/claude/hw/tools')
from mptlib import *
m, buf = load(sys.argv[1])
ns = L.openmpt_module_get_num_subsongs(m)
print('subsongs', ns)
for s in range(ns):
    L.openmpt_module_select_subsong(m, s)
    print(s, 'start order', L.openmpt_module_get_current_order(m), 'dur %.1f' % L.openmpt_module_get_duration_seconds(m), L.openmpt_module_get_subsong_name(m, s))
no = L.openmpt_module_get_num_orders(m); nch = L.openmpt_module_get_num_channels(m)
print('orders', no, 'channels', nch)
CMD_EFFECT, CMD_PARAM = 3, 5
for o in range(no):
    p = L.openmpt_module_get_order_pattern(m, o)
    if p >= 0xFFFE or p < 0 or p >= L.openmpt_module_get_num_patterns(m):
        print('order', o, 'pattern', p, '(marker/end)'); continue
    rows = L.openmpt_module_get_pattern_num_rows(m, p)
    cmds = []
    for r in range(rows):
        for c in range(nch):
            e = L.openmpt_module_get_pattern_row_channel_command(m, p, r, c, CMD_EFFECT)
            if e:
                prm = L.openmpt_module_get_pattern_row_channel_command(m, p, r, c, CMD_PARAM)
                # libopenmpt effect numbers are internal; record all
                cmds.append((r, c, e, prm))
    # keep only interesting: show unique effect types
    print('order', o, 'pat', p, 'rows', rows, 'fx', sorted(set(e for _, _, e, _ in cmds)))
