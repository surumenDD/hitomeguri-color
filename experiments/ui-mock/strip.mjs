// Computes the two-band colour-script strip for one sample: the upper band follows the largest sky
// colour (overhead), the lower band the warmest sky or water colour of the picture (the horizon).
// Usage: node strip.mjs <sampleId> [presetId] [N]  -> prints two CSS gradients as JSON
import fs from 'node:fs';
import {rolePaletteAt,PRESETS,inferRoles} from '../role-script-spike/script.js';
import {labHex,rgbToLab,distance2} from '../role-script-spike/color.js';

const [id='canal',presetId='day',n='96']=process.argv.slice(2);
const meta=JSON.parse(fs.readFileSync(new URL('../role-script-spike/roles-all.json',import.meta.url))).find(m=>m.id===id);
const preset=PRESETS[presetId],roles=inferRoles(meta).map(r=>r.role);
// Same hand-set roles as the spike page (assets/hero/roles.json).
const curation=JSON.parse(fs.readFileSync(new URL('../../assets/hero/roles.json',import.meta.url)));
for(const {hex,role} of curation.images[id]?.colors??[]){
  const lab=rgbToLab(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
  let best=-1,d=Infinity;meta.palette.forEach((p,k)=>{const e=distance2(p,lab);if(e<d){d=e;best=k;}});
  if(d<=curation.maxDistance**2)roles[best]=role;
}
const warm=p=>{const C=Math.hypot(p[1],p[2]),H=Math.atan2(p[2],p[1])*180/Math.PI;return Math.max(0,(C-.02)/.08)*Math.max(0,Math.cos((H-40)*Math.PI/180));};
const skyish=meta.palette.map((p,k)=>k).filter(k=>roles[k]==='sky'||roles[k]==='water');
const overhead=skyish.filter(k=>roles[k]==='sky').sort((a,b)=>meta.counts[b]-meta.counts[a])[0];
const horizon=skyish.sort((a,b)=>warm(meta.palette[b])*Math.sqrt(meta.counts[b])-warm(meta.palette[a])*Math.sqrt(meta.counts[a]))[0];
const bands={overhead:[],horizon:[]};
for(let i=0;i<+n;i++){
  const q=rolePaletteAt(meta.palette,roles,i/n*preset.durationSec,preset),at=(i/(+n-1)*100).toFixed(2)+'%';
  bands.overhead.push(`${labHex(q[overhead])} ${at}`);bands.horizon.push(`${labHex(q[horizon])} ${at}`);
}
console.log(JSON.stringify({id,preset:presetId,overhead:labHex(meta.palette[overhead]),horizon:labHex(meta.palette[horizon]),
  upper:`linear-gradient(90deg, ${bands.overhead.join(', ')})`,lower:`linear-gradient(90deg, ${bands.horizon.join(', ')})`}));
