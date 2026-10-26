import {gamutMap} from './color.js';

export const DURATION=24;
export const ROLES={sky:'空',light:'灯り',celestial:'天体',water:'水',shadow:'影',middle:'中間'};
export const MOMENTS=[
  [0,'夕方の始まり'],[4.2,'残照'],[7.2,'夜の入り'],[11.4,'深夜'],
  [14.6,'夜の終わり'],[17.2,'夜明け'],[20,'朝'],[23.6,'夕方へ戻る直前']
];
export const lch=(L,C,H)=>[L,C*Math.cos(H*Math.PI/180),C*Math.sin(H*Math.PI/180)];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const mix=(a,b,u)=>a.map((v,i)=>v+(b[i]-v)*u);
const smooth=u=>u*u*(3-2*u);

export function inferRoles(metadata){
  const total=metadata.width*metadata.height;
  return metadata.palette.map((p,k)=>{
    const C=Math.hypot(p[1],p[2]),H=(Math.atan2(p[2],p[1])*180/Math.PI+360)%360;
    const area=metadata.counts[k]/total,s=metadata.spatial[k],warm=H>=25&&H<=105;
    let role='middle',reason='ほかの条件に届かない中間色';
    if(p[0]<.30){role='shadow';reason='L < 0.30 の暗い色';}
    else if(p[0]>.80&&area<.004&&s.top>.85){role='celestial';reason='上部に85%以上の、ごく小さく明るい色（月など）';}
    else if(p[0]>.73&&C>.065&&warm&&area<.035&&(s.top<.6||area<.008)){role='light';reason='明るい小面積の暖色、上部優勢の空色を除く';}
    else if(p[0]>.46&&C>.085&&warm&&area<.006&&s.top<.4){role='light';reason='下部の希少な高彩度暖色（灯り・反射の候補）';}
    else if(s.top>.56&&p[0]>.39){role='sky';reason='上部に56%以上、L > 0.39';}
    else if(s.bottom>.52&&p[0]>.32){role='water';reason='下部に52%以上、L > 0.32';}
    else if(p[0]>.60&&s.y<.52&&C>.045){role='sky';reason='上寄りの明るい有彩色';}
    return {index:k,role,reason,L:p[0],C,H,area,...s};
  });
}

// Art direction (main, 2026-10-27): the loop leaves the picture as drawn and comes back to it.
// Keys 0 and 8 are the original palette. Every key in between keeps the original's
// warm-horizon / cool-overhead contrast instead of tinting the whole frame one hue.
const TIMES=[0,2.8,5.2,8.2,13.6,15,17.2,20,24];
const DELAYS={sky:0,water:.65,shadow:.25,middle:.38,light:-.45,celestial:-.2};
const night=[0,.35,.75,1,1,.8,.35,0,0];
const LAST=TIMES.length-1;

// How much of a colour belongs to the warm side of the scene (horizon, glow, reflections).
function warmth(p){
  const C=Math.hypot(p[1],p[2]),H=Math.atan2(p[2],p[1])*180/Math.PI;
  return clamp((C-.02)/.08,0,1)*clamp(Math.cos((H-40)*Math.PI/180)*1.25,0,1);
}
// Below 1 the scale darkens and lifts the floor so the deepest residuals stay above zero.
// Above 1 it moves the colour toward white, which keeps the original order of values.
const darken=(L,scale)=>scale<=1?L*scale+(1-scale)*.14:L+(1-L)*(scale-1)*2;

// [scale, chroma, hue] per key for the cool overhead sky and for the warm horizon.
const SKY_COOL=[null,[.86,.075,282],[.70,.060,268],[.50,.032,262],[.52,.036,252],[.64,.050,256],[.86,.058,244],[1.18,.070,236],null];
const SKY_WARM=[null,[.92,.150,14],[.72,.075,322],[.50,.030,268],[.54,.034,252],[.70,.100,22],[.95,.135,58],[1.14,.055,96],null];
// [scale, chroma, hue] for shadows: violet at dusk, near-black blue at night, cool at dawn.
const SHADOW=[null,[.88,.050,276],[.74,.044,268],[.58,.030,262],[.58,.030,258],[.64,.036,266],[.80,.042,272],[.98,.034,246],null];
// [scale, chroma factor, pull toward night blue] for everything else.
const MIDDLE=[null,[.90,.85,.10],[.76,.60,.30],[.60,.36,.50],[.61,.36,.50],[.69,.50,.35],[.86,.75,.15],[1.02,.95,0],null];

function target(p,role,key){
  if(key===0||key===LAST)return p.slice();
  const L=p[0],C=Math.hypot(p[1],p[2]),H=(Math.atan2(p[2],p[1])*180/Math.PI+360)%360;
  if(role==='sky'||role==='water'){
    const w=warmth(p),[sc,cc,hc]=SKY_COOL[key],[sw,cw,hw]=SKY_WARM[key];
    let q=mix(lch(darken(L,sc),cc,hc),lch(darken(L,sw),cw,hw),w);
    if(role==='water'){q[0]-=.02+.02*night[key];q[1]*=.85;q[2]*=.85;}
    return q;
  }
  if(role==='light'){
    // Lamps come on with the afterglow, burn amber through the night and go out by morning.
    const glow=[null,.55,.85,1,1,.85,.45,0,null][key];
    const lit=lch(Math.max(L,.74+.08*glow),.10+.05*glow,70-6*glow);
    const off=lch(darken(L,.78),C*.30,H);
    return mix(off,lit,glow);
  }
  if(role==='celestial'){
    // The moon cools to a pale white at night and dissolves into the morning sky.
    const n=night[key],dawn=[0,0,0,0,0,.25,.65,1,0][key];
    const pale=lch(Math.min(.93,L+.03*n),.045,96);
    return mix(pale,lch(.80,.035,232),dawn);
  }
  if(role==='shadow'){
    const [s,c,h]=SHADOW[key];
    return lch(darken(L,s),Math.min(c,C+.02),h);
  }
  const [s,cf,blue]=MIDDLE[key];
  const kept=lch(darken(L,s),C*cf,H);
  return mix(kept,lch(darken(L,s),C*cf*.6,258),blue);
}

export function rolePaletteAt(palette,roles,seconds){
  return palette.map((p,k)=>{
    const role=roles[k];
    // A smooth phase envelope returns to zero delay at the loop seam.
    const global=((seconds%DURATION)+DURATION)%DURATION;
    const envelope=Math.sin(Math.PI*global/DURATION)**2;
    const t=((global-DELAYS[role]*envelope+DURATION)%DURATION);
    let segment=0;while(segment<LAST-1&&t>=TIMES[segment+1])segment++;
    const u=smooth((t-TIMES[segment])/(TIMES[segment+1]-TIMES[segment]));
    const q=mix(target(p,role,segment),target(p,role,segment+1),u);
    if(role==='light'){
      // 3 s and 4.8 s are integer divisors of the 24 s cycle: continuous seam.
      q[0]+=.0012*envelope*(Math.sin(2*Math.PI*global/3)+.5*Math.sin(2*Math.PI*global/4.8));
    }
    return gamutMap(q);
  });
}
