#!/usr/bin/env python3
"""Merge PopCap colour images with their alpha masks (name_.png/gif) into RGBA PNGs."""
import os, sys, json
from PIL import Image

SRC = sys.argv[1]   # .../Heavy.Weapon.Deluxe/Images
DST = sys.argv[2]   # build/www/img
os.makedirs(DST, exist_ok=True)

files = {}
for root, dirs, fs in os.walk(SRC):
    for f in fs:
        rel = os.path.relpath(os.path.join(root, f), SRC)
        base, ext = os.path.splitext(rel)
        if ext.lower() not in ('.jpg', '.png', '.gif'):
            continue
        files[(base.lower(), ext.lower())] = rel

def find(base):
    for ext in ('.png', '.gif', '.jpg'):
        if (base, ext) in files:
            return files[(base, ext)]
    return None

manifest = {}
for (base, ext), rel in sorted(files.items()):
    name = os.path.basename(base)
    if name.endswith('_') and not name.startswith('_'):
        continue  # mask
    if name.startswith('_cursor') or name.startswith('cursor_'):
        continue
    # prefer png over jpg/gif duplicates of the same base
    if find(base) != rel and (base, '.png') in files and ext != '.png':
        pass
    src = os.path.join(SRC, rel)
    im = Image.open(src)
    mask_rel = find(base + '_')
    if mask_rel:
        m = Image.open(os.path.join(SRC, mask_rel)).convert('L')
        rgb = im.convert('RGB')
        if m.size != rgb.size:
            print('mask size mismatch', rel, rgb.size, m.size)
            m = m.resize(rgb.size)
        out = rgb.copy(); out.putalpha(m)
        kind = 'masked'
    else:
        if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
            out = im.convert('RGBA'); kind = 'alpha'
        else:
            out = im.convert('RGB'); kind = 'opaque'
    key = base.replace('\\', '/').replace(' ', '_')
    dst = os.path.join(DST, key + '.png')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    out.save(dst, optimize=True)
    manifest[key] = {'w': out.size[0], 'h': out.size[1], 'kind': kind}

json.dump(manifest, open(os.path.join(DST, '..', 'imgmanifest.json'), 'w'), indent=0, sort_keys=True)
print(len(manifest), 'images')
