import {gamutMap} from './color.js';

export const DURATION=24;
export const ROLES={sky:'空',light:'灯り',water:'水',shadow:'影',middle:'中間'};
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
    else if(p[0]>.73&&C>.065&&warm&&area<.035&&(s.top<.6||area<.008)){role='light';reason='明るい小面積の暖色、上部優勢の空色を除く';}
    else if(p[0]>.46&&C>.085&&warm&&area<.006&&s.top<.4){role='light';reason='下部の希少な高彩度暖色（灯り・反射の候補）';}
    else if(s.top>.56&&p[0]>.39){role='sky';reason='上部に56%以上、L > 0.39';}
    else if(s.bottom>.52&&p[0]>.32){role='water';reason='下部に52%以上、L > 0.32';}
    else if(p[0]>.60&&s.y<.52&&C>.045){role='sky';reason='上寄りの明るい有彩色';}
    return {index:k,role,reason,L:p[0],C,H,area,...s};
  });
}

// The scene shares landmarks, but each material follows its own delayed clock.
// Night receives 6.8 seconds, while twilight and dawn receive distinct transitions.
const TIMES=[0,2.8,5.2,8.2,13.6,15,17.2,20,24];
const DELAYS={sky:0,water:.65,shadow:.25,middle:.38,light:-.45};
const night=[0,.10,.65,1,1,.85,.25,0,0];
function target(p,role,key){
  const L=p[0],C=Math.hypot(p[1],p[2]);
  if(role==='sky'||role==='water'){
    // Retain the value structure: blue overhead and bright horizon stay distinct.
    const settings=[
      [.90,.045,.98,70],[.78,.02,.82,12],[.59,.025,.66,300],
      [.39,.012,.37,264],[.35,.018,.30,263],[.49,.025,.36,215],
      [.77,.045,.60,24],[1.02,.025,.52,208],[.90,.045,.98,70]
    ];
    const [scale,offset,sat,hue]=settings[key];
    // Golden light is carried mainly by the already-warm horizon, not every blue.
    const warm=clamp((p[2]+.025)/.13,0,1);
    const skyHue=key===0||key===8?246-176*warm:key===1?286-274*warm:hue;
    let q=lch(L*scale+offset,clamp(C*sat,.014,.12),skyHue);
    if(role==='water'){
      q[0]-=.018+.018*night[key];q[1]*=.86;q[2]*=.86;
    }
    return q;
  }
  if(role==='light'){
    const n=night[key];
    return lch(clamp(L*.92+.035+.045*n,.72,.90),clamp(C*.8+.035,.075,.15),72-7*n);
  }
  if(role==='shadow'){
    const scales=[.94,.85,.69,.50,.47,.58,.82,1.06,.94];
    const offsets=[.008,.020,.04,.065,.065,.05,.025,.008,.008];
    return lch(L*scales[key]+offsets[key],clamp(C*(.60-.25*night[key]),.008,.035),255);
  }
  // Desaturate middle values at night; no Purkinje model is claimed.
  const scales=[.96,.85,.68,.49,.46,.60,.83,1.02,.96];
  const neutral=lch(L*scales[key]+.008,C*(.88-.63*night[key]),255);
  return mix([L*scales[key]+.008,p[1]*.9,p[2]*.9],neutral,night[key]*.8);
}

export function rolePaletteAt(palette,roles,seconds){
  return palette.map((p,k)=>{
    const role=roles[k];
    // A smooth phase envelope returns to zero delay at the loop seam.
    const global=((seconds%DURATION)+DURATION)%DURATION;
    const envelope=Math.sin(Math.PI*global/DURATION)**2;
    const t=((global-DELAYS[role]*envelope+DURATION)%DURATION);
    let segment=0;while(segment<TIMES.length-2&&t>=TIMES[segment+1])segment++;
    const u=smooth((t-TIMES[segment])/(TIMES[segment+1]-TIMES[segment]));
    const q=mix(target(p,role,segment),target(p,role,segment+1),u);
    if(role==='light'){
      // 3 s and 4.8 s are integer divisors of the 24 s cycle: continuous seam.
      q[0]+=.0012*envelope*(Math.sin(2*Math.PI*global/3)+.5*Math.sin(2*Math.PI*global/4.8));
    }
    return gamutMap(q);
  });
}
