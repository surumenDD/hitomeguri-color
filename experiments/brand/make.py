# Builds the brand assets of ひとめぐり: the ring mark (the horizon colour of one day closed into a
# circle, evening at 12 o'clock), the favicon, and the HTML pages that render the share images.
# From the repo root:
#   node experiments/ui-mock/strip.mjs canal day 96 > experiments/brand/strip-canal-day-v42.json
#   node experiments/brand/render-frame.mjs canal 3 experiments/brand/canal-3s.png 1536
#   python -X utf8 -I experiments/brand/make.py
#   node experiments/brand/shot.mjs
import json
import math
import re
from pathlib import Path

here = Path(__file__).parent
strip = json.loads((here / 'strip-canal-day-v42.json').read_text(encoding='utf-8'))
horizon = [h for h, _ in re.findall(r'(#[0-9a-f]{6}) ([0-9.]+)%', strip['lower'])]


def lift(hex_color, floor=0.5):
    """The mark is a symbol, not data: keep hue and chroma, raise OKLab L to the floor so the night
    part of the ring stays visible on the dark tile. Out-of-gamut chroma is reduced, never clipped."""
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(int(hex_color[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l, m, s = (v ** (1 / 3) for v in (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
                                     0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
                                     0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b))
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    L = max(L, floor)

    def to_rgb(a, b_):
        l_, m_, s_ = ((L + x * a + y * b_) ** 3 for x, y in ((0.3963377774, 0.2158037573), (-0.1055613458, -0.0638541728), (-0.0894841775, -1.2914855480)))
        return (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
                -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
    lo, hi = 0.0, 1.0
    if not all(-1e-6 <= v <= 1 + 1e-6 for v in to_rgb(A, B)):
        for _ in range(30):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if all(-1e-6 <= v <= 1 + 1e-6 for v in to_rgb(A * mid, B * mid)) else (lo, mid)
        A, B = A * lo, B * lo
    enc = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * max(c, 0) ** (1 / 2.4) - 0.055
    return '#' + ''.join(f'{min(255, max(0, round(enc(c) * 255))):02x}' for c in to_rgb(A, B))


horizon = [lift(h) for h in horizon]


def smooth(colors, steps=4):
    """Interpolates between neighbours (the ring is closed) so 96 samples do not show as spokes."""
    rgb = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in colors]
    out = []
    for i, a in enumerate(rgb):
        b = rgb[(i + 1) % len(rgb)]
        for k in range(steps):
            t = k / steps
            out.append('#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(a, b)))
    return out


ring_colors = smooth(horizon)
# favicon.svg is drawn at 32px, where the smoothed ring's many thin antialiased arcs read as noise.
tile_colors = horizon[::2]


def ring(size, thickness, colors, background=None):
    """Arc segments from 12 o'clock clockwise; each overlaps the next slightly so no seam shows."""
    c, r = size / 2, size / 2 - thickness / 2 - (size * 0.08 if background else 0)
    n = len(colors)
    parts = []
    if background:
        parts.append(f'<rect width="{size}" height="{size}" rx="{size * 0.22:.2f}" fill="{background}"/>')
    for i, color in enumerate(colors):
        a0 = -math.pi / 2 + 2 * math.pi * i / n
        a1 = -math.pi / 2 + 2 * math.pi * (i + 1.6) / n
        x0, y0 = c + r * math.cos(a0), c + r * math.sin(a0)
        x1, y1 = c + r * math.cos(a1), c + r * math.sin(a1)
        parts.append(f'<path d="M{x0:.2f} {y0:.2f}A{r:.2f} {r:.2f} 0 0 1 {x1:.2f} {y1:.2f}" stroke="{color}" '
                     f'stroke-width="{thickness:.2f}" fill="none"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">' + ''.join(parts) + '</svg>\n'


# Rasters use a CSS conic gradient, which is smooth at every size; the arcs above are for the SVG files.
conic = 'conic-gradient(' + ', '.join(f'{c} {100 * i / len(horizon):.3f}%' for i, c in enumerate(horizon + horizon[:1])) + ')'


def hole(inner):
    """Mask that cuts the ring's hole; inner is the hole radius as a fraction of the outer radius."""
    return f'radial-gradient(closest-side, transparent calc({inner:.2%} - .5px), #000 calc({inner:.2%} + .5px))'


(here / 'mark.svg').write_text(ring(256, 56, ring_colors), encoding='utf-8', newline=chr(10))
(here / 'favicon.svg').write_text(ring(64, 14, tile_colors, background='#181818'), encoding='utf-8', newline=chr(10))
(here / 'icon.html').write_text(
    '<!doctype html><meta charset="utf-8"><title>ひとめぐり — アイコン</title><style>'
    'html,body{margin:0;background:transparent}'
    '.tile{width:100vw;height:100vh;border-radius:22%;background:#181818;display:grid;place-items:center}'
    f'.ring{{width:84%;height:84%;border-radius:50%;background:{conic};mask:{hole(12.88 / 26.88)}}}'
    '</style><div class="tile"><div class="ring"></div></div>' + chr(10), encoding='utf-8', newline=chr(10))

share = (here / 'share-template.html').read_text(encoding='utf-8')
share = share.replace('__UPPER__', strip['upper']).replace('__LOWER__', strip['lower'])
share = share.replace('__CONIC__', conic).replace('__HOLE__', hole(72 / 128))
(here / 'share.html').write_text(share, encoding='utf-8', newline=chr(10))
print('mark.svg favicon.svg icon.html share.html written;', len(horizon), 'horizon colours')
