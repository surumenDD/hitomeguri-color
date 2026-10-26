# Builds index.html of the chrome mock from template.html and the strip data.
# Usage: python -X utf8 -I build.py
import json
from pathlib import Path

here = Path(__file__).parent
strip = json.loads((here / 'strip-canal-day.json').read_text(encoding='utf-8'))
islands = [('#134c8a', '空'), ('#f27a2f', '空'), ('#04111f', '影'), ('#052240', '影'),
           ('#ef5723', '灯り'), ('#f9c469', '灯り'), ('#223a5e', '中間'), ('#c66c44', '空')]
html = (here / 'template.html').read_text(encoding='utf-8')
html = html.replace('__UPPER__', strip['upper']).replace('__LOWER__', strip['lower'])
html = html.replace('__ISLANDS__', '\n        '.join(
    f'<button class="island"><i style="background:{h}"></i>{r}</button>' for h, r in islands))
(here / 'index.html').write_text(html, encoding='utf-8', newline='\n')
print('written', len(html))
