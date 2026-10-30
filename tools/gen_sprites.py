#!/usr/bin/env python3
"""Generate sprite layout table (cols, rows) from the original exe's image table + known extras."""
import sys, json, struct
sys.path.insert(0, '/home/claude/hw/re')
from pe import *
out = {}
va = 0x527820
while True:
    b = read(va, 0x34)
    n = b.split(b'\0')[0]
    if not n or not all(32 <= c < 127 for c in n): break
    name = n.decode().replace('\\', '/').lower()
    cols, rows, flag = struct.unpack('<3i', b[0x28:0x34])
    out[name] = [cols, rows]
    va += 0x34
extra = {
    'hugecopter/hugecopter': [1, 1], 'hugecopter/copterblades': [5, 1], 'hugecopter/launcher': [1, 1], 'hugecopter/turret': [21, 1],
    'battleship/gun': [21, 1], 'battleship/hull': [1, 1], 'battleship/main': [1, 1],
    'rainer/rainer': [1, 1], 'rainer/prop': [8, 1], 'rainer/dish': [1, 1], 'rainer/beam': [1, 1],
    'wrecker/body': [1, 1], 'wrecker/tower': [1, 1], 'wrecker/wheel': [12, 1], 'wrecker/ball': [1, 1], 'wrecker/link': [1, 1], 'wrecker/shadow': [1, 1],
    'head/head': [1, 1], 'ape/ape': [9, 1], 'ape/shadow': [1, 1],
    'eye/body': [1, 1], 'eye/eye': [6, 1], 'eye/arm': [1, 1], 'eye/hand': [1, 1], 'eye/handglow': [1, 1], 'eye/glow': [1, 1], 'eye/bolt': [1, 1],
    'worm/head': [10, 1], 'worm/rib': [4, 1], 'worm/sand': [4, 1], 'worm/turret': [1, 1],
    'robot/body': [1, 1], 'robot/arms': [2, 1], 'robot/foot': [1, 1], 'robot/launchers': [2, 1], 'robot/waist': [1, 1], 'robot/panel': [4, 1], 'robot/eyeglow': [1, 1],
    'finalboss/body1': [1, 1], 'finalboss/body2': [1, 1], 'finalboss/body3': [1, 1], 'finalboss/turret': [16, 1], 'finalboss/laser': [5, 1], 'finalboss/laserglow': [5, 1],
    'target1': [1, 1], 'copterblades': [5, 1],
}
out.update(extra)
gd = json.load(open('/home/claude/hw/build/www/data/gamedata.json'))
for lv in gd['anims']:
    for a in lv:
        out['anims/' + a['name']] = [a['frames'], 1]
json.dump(out, open('/home/claude/hw/build/www/data/sprites.json', 'w'), indent=0, sort_keys=True)
print(len(out))
