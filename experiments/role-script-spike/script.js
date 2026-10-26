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
// Named states of the light. Index 0 is the picture as drawn; a preset is a sequence of states.
export const STATES=['original','afterglow','blueHour','midnight','lateNight','twilight','sunrise','morning'];
const DELAYS={sky:0,water:.65,shadow:.25,middle:.38,light:-.45,celestial:-.2};
const night=[0,.35,.75,1,1,.8,.35,0];
const GLOW=[0,.55,.85,1,1,.85,.45,0];
const DAWN=[0,0,0,0,0,.25,.65,1];

// nightDepth and glow are 1 for the tuned look; the day preset at 1 reproduces v2 exactly.
export const PRESETS={
  day:{id:'day',name:'1日の光',durationSec:24,nightDepth:1,glow:1,sequence:[
    ['original',0],['afterglow',2.8/24],['blueHour',5.2/24],['midnight',8.2/24],['lateNight',13.6/24],
    ['twilight',15/24],['sunrise',17.2/24],['morning',20/24],['original',1]]},
  // The magic hour breathes: the sky sinks into the blue hour and rises back into the afterglow.
  longDusk:{id:'longDusk',name:'長い夕暮れ',durationSec:20,nightDepth:.85,glow:1,sequence:[
    ['original',0],['afterglow',.30],['blueHour',.55],['afterglow',.80],['original',1]]},
  // Most of the loop is night, so the lamps carry the picture.
  nightLights:{id:'nightLights',name:'夜の灯り',durationSec:32,nightDepth:1.1,glow:1.25,sequence:[
    ['original',0],['afterglow',.09],['blueHour',.20],['midnight',.38],['lateNight',.60],
    ['midnight',.76],['blueHour',.90],['original',1]]},
};

// How much of a colour belongs to the warm side of the scene (horizon, glow, reflections).
function warmth(p){
  const C=Math.hypot(p[1],p[2]),H=Math.atan2(p[2],p[1])*180/Math.PI;
  return clamp((C-.02)/.08,0,1)*clamp(Math.cos((H-40)*Math.PI/180)*1.25,0,1);
}
// Below 1 the scale darkens and lifts the floor so the deepest residuals stay above zero.
// Above 1 it moves the colour toward white, which keeps the original order of values.
const darken=(L,scale)=>scale<=1?L*scale+(1-scale)*.14:L+(1-L)*(scale-1)*2;

// [scale, chroma, hue] per key for the cool overhead sky and for the warm horizon.
// v3: midnight and late night are a saturated indigo; at chroma .03 they read as slate grey.
const SKY_COOL=[null,[.86,.075,282],[.70,.060,268],[.50,.055,266],[.52,.052,258],[.64,.050,256],[.86,.058,244],[1.18,.070,236],null];
const SKY_WARM=[null,[.92,.150,14],[.72,.075,322],[.50,.050,272],[.54,.050,262],[.70,.100,22],[.95,.135,58],[1.14,.055,96],null];
// [scale, chroma, hue] for shadows: violet at dusk, near-black blue at night, cool at dawn.
const SHADOW=[null,[.88,.050,276],[.74,.044,268],[.58,.040,266],[.58,.040,262],[.64,.036,266],[.80,.042,272],[.98,.034,246],null];
// [scale, chroma factor, pull toward night blue] for everything else.
const MIDDLE=[null,[.90,.85,.10],[.76,.60,.30],[.60,.36,.50],[.61,.36,.50],[.69,.50,.35],[.86,.75,.15],[1.02,.95,0],null];

function target(p,role,key,o){
  if(key===0)return p.slice();
  // nightDepth scales how far the night-weighted states darken (1 keeps the tuned values).
  const deep=scale=>scale<=1?1-(1-scale)*(1+(o.nightDepth-1)*night[key]):scale;
  const L=p[0],C=Math.hypot(p[1],p[2]),H=(Math.atan2(p[2],p[1])*180/Math.PI+360)%360;
  if(role==='sky'||role==='water'){
    const w=warmth(p),[sc,cc,hc]=SKY_COOL[key],[sw,cw,hw]=SKY_WARM[key];
    let q=mix(lch(darken(L,deep(sc)),cc,hc),lch(darken(L,deep(sw)),cw,hw),w);
    if(role==='water'){q[0]-=.02+.02*night[key];q[1]*=.85;q[2]*=.85;}
    return q;
  }
  if(role==='light'){
    // Lamps come on with the afterglow, burn amber through the night and go out by morning.
    const glow=GLOW[key]*o.glow,on=Math.min(1,glow);
    const lit=lch(Math.min(.93,Math.max(L,.74+.08*glow)),.10+.05*glow,70-6*on);
    const off=lch(darken(L,.78),C*.30,H);
    return mix(off,lit,on);
  }
  if(role==='celestial'){
    // The moon cools to a pale white at night and dissolves into the morning sky.
    const pale=lch(Math.min(.93,L+.03*night[key]),.045,96);
    return mix(pale,lch(.80,.035,232),DAWN[key]);
  }
  if(role==='shadow'){
    const [s,c,h]=SHADOW[key];
    return lch(darken(L,deep(s)),Math.min(c,C+.02),h);
  }
  const [s,cf,blue]=MIDDLE[key];
  const kept=lch(darken(L,deep(s)),C*cf,H);
  return mix(kept,lch(darken(L,deep(s)),C*cf*.6,258),blue);
}

export function rolePaletteAt(palette,roles,seconds,preset=PRESETS.day){
  const D=preset.durationSec,seq=preset.sequence.map(([name,at])=>[STATES.indexOf(name),at*D]);
  return palette.map((p,k)=>{
    const role=roles[k];
    // A smooth phase envelope returns to zero delay at the loop seam.
    const global=((seconds%D)+D)%D;
    const envelope=Math.sin(Math.PI*global/D)**2;
    const t=((global-DELAYS[role]*envelope+D)%D);
    let s=0;while(s<seq.length-2&&t>=seq[s+1][1])s++;
    const u=smooth((t-seq[s][1])/(seq[s+1][1]-seq[s][1]));
    const q=mix(target(p,role,seq[s][0],preset),target(p,role,seq[s+1][0],preset),u);
    if(role==='light'){
      // Periods of D/8 and D/5 divide the loop, so the flicker joins at the seam (3 s and 4.8 s at 24 s).
      q[0]+=.0012*preset.glow*envelope*(Math.sin(2*Math.PI*global/(D/8))+.5*Math.sin(2*Math.PI*global/(D/5)));
    }
    return gamutMap(q);
  });
}
