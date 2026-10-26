export const K = 16;
export const METHODS = ['hard', 'residual', 'soft'];
export const METHOD_NAMES = ['硬い量子化', '差分を保つ置き換え', '柔らかい重み + 残差'];
export const SAMPLES = [
  { id: 'flat', file: 'flat-dusk-harbor.png', name: '平らな色面', detail: '港のポスター · 空には階調がある' },
  { id: 'painterly', file: 'painterly-blue-hour-lake.png', name: '絵画調', detail: '湖と筆致 · 連続した空と水面' },
  { id: 'pixel', file: 'pixel-rain-street.png', name: 'にせのドット絵', detail: '雨の街路 · 格子と色数は不均一' },
  { id: 'photo', file: 'photo-sunset-shore.png', name: '写真調', detail: '夕日の海岸 · 岩、雲、水の質感' }
];
const decode = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const encode = c => c <= .0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - .055;
const LUT = Float64Array.from({length:256}, (_,i)=>decode(i/255));
export function rgbToLab(r, g, b) {
  r = LUT[r]; g = LUT[g]; b = LUT[b];
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return [.2104542553*l + .793617785*m - .0040720468*s,
    1.9779984951*l - 2.428592205*m + .4505937099*s,
    .0259040371*l + .7827717662*m - .808675766*s];
}
export function labToLinear([L,a,b]) {
  const l=(L+.3963377774*a+.2158037573*b)**3;
  const m=(L-.1055613458*a-.0638541728*b)**3;
  const s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,
    -1.2684380046*l+2.6097574011*m-.3413193965*s,
    -.0041960863*l-.7034186147*m+1.707614701*s];
}
const inGamut = rgb => rgb.every(x=>x>=-1e-7 && x<=1+1e-7);
export function gamutMap(lab) {
  if(inGamut(labToLinear(lab))) return [...lab];
  let low=0, high=1;
  for(let i=0;i<20;i++) {
    const mid=(low+high)/2;
    if(inGamut(labToLinear([lab[0],lab[1]*mid,lab[2]*mid]))) low=mid;
    else high=mid;
  }
  return [lab[0],lab[1]*low,lab[2]*low];
}
export function labHex(lab) {
  return '#'+labToLinear(gamutMap(lab)).map(v=>Math.round(Math.min(1,Math.max(0,encode(v)))*255).toString(16).padStart(2,'0')).join('');
}
export function rotateHue(lab, degrees) {
  const h=Math.atan2(lab[2],lab[1])+degrees*Math.PI/180, c=Math.hypot(lab[1],lab[2]);
  return gamutMap([lab[0],c*Math.cos(h),c*Math.sin(h)]);
}
export const SEGMENTS = [60/7,20/7,40/7,20/7];
export const STAGE_NAMES = ['夕方','残照','夜','夜明け'];
export const STAGE_TIMES = [0,60/7,80/7,120/7];
export function scriptKeys(palette) {
  // Preserve palette identities and lightness order; design a closed dusk/night cycle.
  const settings = [[.94,.018,.85,24],[.80,.06,.72,-18],[.65,.09,.58,-38],[.98,.006,.7,10]];
  return settings.map(([scale,offset,chroma,rotate])=>palette.map(p=>{
    const rotated=rotateHue(p,rotate);
    return gamutMap([p[0]*scale+offset,rotated[1]*chroma,rotated[2]*chroma]);
  }));
}
export function paletteAt(palette, test='a', seconds=0) {
  if(test==='a') return palette.map(p=>[...p]);
  if(test==='b') return palette.map((p,i)=>i===0?rotateHue(p,120):[...p]);
  const keys=scriptKeys(palette);
  let t=((seconds%20)+20)%20, segment=0;
  while(segment<3 && t>=SEGMENTS[segment]) t-=SEGMENTS[segment++];
  let u=t/SEGMENTS[segment]; u=u*u*(3-2*u);
  return keys[segment].map((p,i)=>p.map((v,j)=>v*(1-u)+keys[(segment+1)%4][i][j]*u));
}
export const distance2 = (a,b) => (a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
