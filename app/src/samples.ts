import canal from './assets/samples/canal.webp?url';
import festival from './assets/samples/festival.webp?url';
import flat from './assets/samples/flat.webp?url';
import girl from './assets/samples/girl.webp?url';
import girlYukata from './assets/samples/girl-yukata.webp?url';
import lighthouse from './assets/samples/lighthouse.webp?url';
import oasis from './assets/samples/oasis.webp?url';
import seaside from './assets/samples/seaside.webp?url';
import snow from './assets/samples/snow.webp?url';
import canalThumb from './assets/samples/thumbs/canal.webp?url';
import festivalThumb from './assets/samples/thumbs/festival.webp?url';
import flatThumb from './assets/samples/thumbs/flat.webp?url';
import lighthouseThumb from './assets/samples/thumbs/lighthouse.webp?url';
import oasisThumb from './assets/samples/thumbs/oasis.webp?url';
import seasideThumb from './assets/samples/thumbs/seaside.webp?url';
import snowThumb from './assets/samples/thumbs/snow.webp?url';
import type { ForegroundSettings } from './foreground';

export interface Sample {
  id: string;
  name: string;
  url: string;
  thumbnail: string;
  foreground?: ForegroundSettings & { url: string; name: string };
}

export const SAMPLES: Sample[] = [
  {
    id: 'seaside',
    name: '海辺',
    url: seaside,
    thumbnail: seasideThumb,
    foreground: { url: girl, name: '海辺の女の子', x: 0.76, y: 1.6, size: 1.2, blend: 0.8 },
  },
  {
    id: 'festival',
    name: 'お祭り',
    url: festival,
    thumbnail: festivalThumb,
    foreground: { url: girlYukata, name: '浴衣の女の子', x: 0.5, y: 1.26, size: 1.05, blend: 0.8 },
  },
  { id: 'canal', name: '運河の街', url: canal, thumbnail: canalThumb },
  { id: 'snow', name: '雪の村', url: snow, thumbnail: snowThumb },
  { id: 'lighthouse', name: '灯台の岬', url: lighthouse, thumbnail: lighthouseThumb },
  { id: 'oasis', name: 'オアシス', url: oasis, thumbnail: oasisThumb },
  { id: 'flat', name: '港町', url: flat, thumbnail: flatThumb },
];
