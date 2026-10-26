# Builds index.html of the chrome mock from template.html and the strip data.
# Usage: python -X utf8 -I build.py
import json
from pathlib import Path

here = Path(__file__).parent
strip = json.loads((here / 'strip-canal-day.json').read_text(encoding='utf-8'))
# Islands of the canal picture, grouped by role (roles-all.json + the hand-set roles in assets/hero/roles.json).
ROLE_ORDER = [('sky', '空'), ('water', '水'), ('light', '灯り'), ('celestial', '天体'), ('shadow', '影'), ('middle', '中間')]
def lab_hex(lab):
    L, a, b = lab
    l, m, s_ = [(L + x * a + y * b) ** 3 for x, y in ((0.3963377774, 0.2158037573), (-0.1055613458, -0.0638541728), (-0.0894841775, -1.2914855480))]
    rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s_, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s_,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s_]
    enc = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * max(c, 0) ** (1 / 2.4) - 0.055
    return '#' + ''.join(f'{min(255, max(0, round(enc(c) * 255))):02x}' for c in rgb)
def hex_lab(h):
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b_ = (lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l, m, s_ = (v ** (1 / 3) for v in (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b_,
                                      0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b_,
                                      0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b_))
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s_, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s_,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s_]
meta = next(m for m in json.loads((here.parent / 'role-script-spike' / 'roles-all.json').read_text(encoding='utf-8')) if m['id'] == 'canal')
roles = [i['role'] for i in meta['inference']]
curation = json.loads((here.parent.parent / 'assets' / 'hero' / 'roles.json').read_text(encoding='utf-8'))
for entry in curation['images']['canal']['colors']:
    lab = hex_lab(entry['hex'])
    k = min(range(len(meta['palette'])), key=lambda i: sum((meta['palette'][i][j] - lab[j]) ** 2 for j in range(3)))
    roles[k] = entry['role']
total = sum(meta['counts'])
rows = []
for role, name in ROLE_ORDER:
    ks = sorted((k for k in range(len(roles)) if roles[k] == role), key=lambda k: -meta['counts'][k])
    if not ks:
        continue
    swatches = ''.join(f'<button class="swatch" style="background:{lab_hex(meta["palette"][k])}" aria-label="{name}、面積 {meta["counts"][k] / total * 100:.1f}%"></button>' for k in ks)
    rows.append(f'<div class="role-row"><span>{name}</span><div>{swatches}</div></div>')
html = (here / 'template.html').read_text(encoding='utf-8')
html = html.replace('__UPPER__', strip['upper']).replace('__LOWER__', strip['lower'])
html = html.replace('__ISLANDS__', '\n        '.join(rows))
(here / 'index.html').write_text(html, encoding='utf-8', newline='\n')
print('written', len(html))
