#!/usr/bin/env python3
"""Make a labelled contact sheet of images on a grey checker background (for inspection)."""
import sys, os
from PIL import Image, ImageDraw
out = sys.argv[1]; maxw = int(sys.argv[2]); paths = sys.argv[3:]
rows = []
for p in paths:
    im = Image.open(p).convert('RGBA')
    s = min(1.0, maxw / im.size[0])
    if s < 1: im = im.resize((max(1,int(im.size[0]*s)), max(1,int(im.size[1]*s))), Image.LANCZOS)
    rows.append((os.path.basename(os.path.dirname(p)) + '/' + os.path.basename(p) + ' %dx%d (x%.2f)' % (Image.open(p).size + (s,)), im))
W = max(maxw, max(r[1].size[0] for r in rows)) + 10
H = sum(r[1].size[1] + 18 for r in rows) + 10
sheet = Image.new('RGBA', (W, H), (90, 90, 110, 255))
d = ImageDraw.Draw(sheet)
# checker
for y in range(0, H, 16):
    for x in range(0, W, 16):
        if (x // 16 + y // 16) % 2: d.rectangle([x, y, x + 15, y + 15], fill=(110, 110, 130, 255))
y = 5
for label, im in rows:
    d.text((5, y), label, fill=(255, 255, 0, 255))
    y += 14
    sheet.alpha_composite(im, (5, y))
    y += im.size[1] + 4
sheet.convert('RGB').save(out)
