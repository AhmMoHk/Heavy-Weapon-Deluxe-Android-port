#!/usr/bin/env python3
"""Lenient conversion of the game's data XML files into one JSON bundle."""
import re, json, sys, os
SRC, DST = sys.argv[1], sys.argv[2]   # .../Heavy.Weapon.Deluxe , build/www/data
def attrs(s):
    return {k: v for k, v in re.findall(r'(\w+)\s*=\s*"([^"]*)"', s, re.S)}
def num(v):
    try:
        return int(v)
    except ValueError:
        try: return float(v)
        except ValueError: return v
def nattrs(s): return {k: num(v) for k, v in attrs(s).items()}
out = {}
d = os.path.join(SRC, 'data')
# levels.xml
t = open(os.path.join(d, 'levels.xml'), encoding='latin-1').read()
levels = []
for m in re.finditer(r'<Level(.*?)>(.*?)</Level>', t, re.S):
    a = attrs(m.group(1))
    intel = [x for x in re.findall(r'<Intel\s+text="(.*?)"\s*/>', m.group(2), re.S)]
    levels.append({'name': a['name'], 'length': int(a['length']), 'intel': intel})
out['levels'] = levels
# craft.xml
t = open(os.path.join(d, 'craft.xml'), encoding='latin-1').read()
t = re.sub(r'<!--.*?-->', '', t, flags=re.S)
out['craft'] = [nattrs(m.group(1)) for m in re.finditer(r'<Craft(.*?)/>', t, re.S)]
# waves / survival
def waves(fn):
    t = open(os.path.join(d, fn), encoding='latin-1').read()
    t = re.sub(r'<!--.*?-->', '', t, flags=re.S)
    res = []
    for lm in re.finditer(r'<Level>(.*?)</Level>', t, re.S):
        lv = []
        for wm in re.finditer(r'<Wave(.*?)>(.*?)</Wave>', lm.group(1), re.S):
            lv.append({'length': int(attrs(wm.group(1))['length']),
                       'craft': [[a['id'], int(a['qty'])] for a in (attrs(x) for x in re.findall(r'<Craft(.*?)/>', wm.group(2)))]})
        res.append(lv)
    return res
out['waves'] = waves('waves.xml')
out['survival'] = [waves('survival%d.xml' % i) for i in range(10)]
# bosses.xml
t = open(os.path.join(d, 'bosses.xml'), encoding='latin-1').read()
t = re.sub(r'<!--.*?-->', '', t, flags=re.S)
bosses = []
for m in re.finditer(r'<(\w+)\s+info="(.*?)">(.*?)</\1>', t, re.S):
    name, info, body = m.groups()
    lvls = []
    for lm in re.finditer(r'<(Level\d?)(.*?)>(.*?)</\1>', body, re.S):
        lv = nattrs(lm.group(2))
        for cm in re.finditer(r'<(\w+)(.*?)/>', lm.group(3), re.S):
            lv[cm.group(1)] = nattrs(cm.group(2))
        lvls.append(lv)
    bosses.append({'name': name, 'info': info, 'levels': lvls})
out['bosses'] = bosses
# anims.xml
t = open(os.path.join(SRC, 'Images/Anims/Anims.xml'), encoding='latin-1').read()
t = re.sub(r'<!--.*?-->', '', t, flags=re.S)
anims = []
for lm in re.finditer(r'<Level>(.*?)</Level>', t, re.S):
    lst = []
    # Anim tags may be self-closing or contain Delay children; one is malformed ('/ rare="yes">')
    for am in re.finditer(r'<Anim\b(.*?)(/\s*>|>(.*?)</Anim>|/\s+rare="yes">)', lm.group(1), re.S):
        a = nattrs(am.group(1))
        if 'rare="yes"' in am.group(2): a['rare'] = 'yes'
        a['delays'] = [nattrs(x) for x in re.findall(r'<Delay(.*?)/>', am.group(3) or '')]
        a['name'] = a['name'].replace('\\', '/').lower()
        lst.append(a)
    anims.append(lst)
out['anims'] = anims
# credits
t = open(os.path.join(d, 'credits.xml'), encoding='latin-1').read()
out['credits'] = re.findall(r'<(h|t|l|b)>(.*?)</\1>', t, re.S)
json.dump(out, open(os.path.join(DST, 'gamedata.json'), 'w'), indent=None, separators=(',', ':'))
print('levels', len(levels), 'craft', len(out['craft']), 'waves', len(out['waves']), 'bosses', [b['name'] for b in bosses], 'anims', [len(a) for a in anims])
