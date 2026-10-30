#!/usr/bin/env python3
"""Parse PopCap ImageFont descriptor files into JSON + PNG atlases."""
import os, re, sys, json
from PIL import Image
SRC, DST = sys.argv[1], sys.argv[2]
os.makedirs(DST, exist_ok=True)

tok_re = re.compile(r"""\s*(?:(//[^\n]*)|('[^']*')|("(?:[^"\\]|\\.)*")|(-?\d+\.?\d*)|([A-Za-z_][A-Za-z0-9_]*)|(.))""", re.S)
def tokenize(s):
    pos = 0; out = []
    while pos < len(s):
        m = tok_re.match(s, pos)
        if not m: break
        pos = m.end()
        com, ch, st, num, ident, other = m.groups()
        if com: continue
        if ch is not None: out.append(('str', ch[1:-1]))
        elif st is not None: out.append(('str', st[1:-1]))
        elif num is not None: out.append(('num', float(num) if '.' in num else int(num)))
        elif ident is not None: out.append(('id', ident))
        elif other is not None and other.strip(): out.append(('p', other))
    return out

def parse_value(toks, i, defs):
    t = toks[i]
    if t == ('p', '('):
        lst = []; i += 1
        while toks[i] != ('p', ')'):
            if toks[i] == ('p', ','): i += 1; continue
            v, i = parse_value(toks, i, defs); lst.append(v)
        return lst, i + 1
    if t[0] == 'id' and t[1] in defs: return defs[t[1]], i + 1
    return t[1], i + 1

def parse(path):
    toks = tokenize(open(path, encoding='latin-1').read())
    defs = {}; layers = {}; order = []; i = 0; default_pt = None
    while i < len(toks):
        cmd = toks[i][1]; i += 1
        args = []
        while toks[i] != ('p', ';'):
            v, i = parse_value(toks, i, defs); args.append(v)
        i += 1
        if cmd == 'Define': defs[args[0]] = args[1]
        elif cmd == 'CreateLayer':
            layers[args[0]] = {'chars': {}, 'ascent': 0, 'colorMult': [1, 1, 1, 1], 'lineSpacingOffset': 0, 'ascentPadding': 0, 'offset': [0, 0], 'kerning': {}}
            order.append(args[0])
        elif cmd == 'SetDefaultPointSize': default_pt = args[0]
        elif cmd.startswith('Layer'):
            L = layers[args[0]]
            if cmd == 'LayerSetImage': L['image'] = args[1]
            elif cmd == 'LayerSetAscent': L['ascent'] = args[1]
            elif cmd == 'LayerSetAscentPadding': L['ascentPadding'] = args[1]
            elif cmd == 'LayerSetLineSpacingOffset': L['lineSpacingOffset'] = args[1]
            elif cmd == 'LayerSetPointSize': L['pointSize'] = args[1]
            elif cmd == 'LayerSetColorMult': L['colorMult'] = args[1]
            elif cmd == 'LayerSetOffset': L['offset'] = args[1]
            elif cmd == 'LayerSetCharWidths':
                for c, w in zip(args[1], args[2]): L['chars'].setdefault(c, {})['w'] = w
            elif cmd == 'LayerSetImageMap':
                for c, r in zip(args[1], args[2]): L['chars'].setdefault(c, {})['r'] = r
            elif cmd == 'LayerSetCharOffsets':
                for c, o in zip(args[1], args[2]): L['chars'].setdefault(c, {})['o'] = o
            elif cmd == 'LayerSetKerningPairs':
                for pr, v in zip(args[1], args[2]): L['kerning'][pr] = v
            else: print('unhandled', cmd, args[:2])
        else: print('unhandled', cmd)
    return {'layers': [dict(name=n, **layers[n]) for n in order], 'pointSize': default_pt}

images_done = set()
for f in sorted(os.listdir(SRC)):
    if not f.endswith('.txt'): continue
    name = f[:-4]
    font = parse(os.path.join(SRC, f))
    for L in font['layers']:
        img = L['image']
        if img not in images_done:
            p = os.path.join(SRC, img + '.png')
            if os.path.exists(p):
                im = Image.open(p).convert('RGBA')
            else:  # PopCap alpha-only image: _name.png -> white with alpha = luminance
                g = Image.open(os.path.join(SRC, '_' + img + '.png')).convert('L')
                im = Image.new('RGBA', g.size, (255, 255, 255, 255)); im.putalpha(g)
            im.save(os.path.join(DST, img + '.png'), optimize=True)
            images_done.add(img)
    json.dump(font, open(os.path.join(DST, name + '.json'), 'w'))
    print(name, [ (L['name'], L['image'], len(L['chars'])) for L in font['layers']])
