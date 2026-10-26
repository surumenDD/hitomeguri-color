import {SAMPLES,paletteAt,labHex} from './color.js';
import {Renderer} from './renderer.js';
import {ROLES,DURATION,MOMENTS,inferRoles,rolePaletteAt} from './script.js';

const $=q=>document.querySelector(q),captureMode=new URLSearchParams(location.search).has('capture');
if(captureMode){document.body.classList.add('capture-mode');$('#capture').hidden=false;}
const state={rows:[],ready:false,seconds:0,playing:false,previous:null,sample:0,mode:'role',weights:'soft',selected:-1};
const renderer=new Renderer($('#scene')),captureRenderer=new Renderer($('#capture'));
const status=text=>{$('#status').textContent=text;};
function palette(row,seconds,mode='role'){
  if(mode==='original')return row.data.metadata.palette;
  if(mode==='legacy')return paletteAt(row.data.metadata.palette,'c',seconds);
  return rolePaletteAt(row.data.metadata.palette,row.roles,seconds);
}
function stop(){state.playing=false;state.previous=null;$('#play').textContent='再生';}
function draw(){
  if(!state.ready)return;
  const row=state.rows[state.sample],q=palette(row,state.seconds,state.mode);
  if(renderer.data!==row.data)renderer.upload(row.data);
  const width=Math.min(1536,Math.max(320,$('#art').clientWidth));
  renderer.size(width,Math.round(width*row.data.metadata.height/row.data.metadata.width));
  renderer.draw(state.mode==='original'?-1:state.weights==='soft'?2:1,q,{selected:state.selected});
  $('#time').value=state.seconds;$('#clock').textContent=`${state.seconds.toFixed(2)} / ${state.mode==='legacy'?20:24}秒`;
  const index=MOMENTS.findLastIndex(([t])=>state.seconds>=t);
  $('#stage').textContent=state.mode==='legacy'?'従来の試験 c':MOMENTS[Math.max(0,index)][1];
  document.querySelectorAll('.swatch').forEach((node,i)=>node.style.background=labHex(q[i]));
}
function buildPalette(){
  const row=state.rows[state.sample];$('#palette').replaceChildren();
  row.inference.forEach((info,k)=>{
    const card=document.createElement('div');card.className='chip';card.setAttribute('aria-current',String(state.selected===k));
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',`色 ${k+1} の場所を確認`);button.setAttribute('aria-pressed',String(state.selected===k));
    const swatch=document.createElement('span');swatch.className='swatch';swatch.style.background=labHex(row.data.metadata.palette[k]);
    button.append(swatch,document.createTextNode(`${String(k+1).padStart(2,'0')} · ${(info.area*100).toFixed(1)}%`));
    button.addEventListener('click',()=>{state.selected=state.selected===k?-1:k;buildPalette();draw();});
    const select=document.createElement('select');select.setAttribute('aria-label',`色 ${k+1} の役割`);
    Object.entries(ROLES).forEach(([value,label])=>select.add(new Option(label,value,false,row.roles[k]===value)));
    select.addEventListener('change',()=>{stop();row.roles[k]=select.value;draw();});
    const detail=document.createElement('small');detail.textContent=`自動: ${ROLES[info.role]} / L ${info.L.toFixed(2)} / 上 ${(info.top*100).toFixed(0)}%`;
    card.append(button,select,detail);$('#palette').append(card);
  });
}
async function load(sample){
  const image=new Image();image.src=`../../assets/samples/raw/${sample.file}`;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});ctx.drawImage(image,0,0);
  const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const worker=new Worker('./preprocess.js',{type:'module'});
  const data=await new Promise((resolve,reject)=>{
    worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data);
    worker.onerror=e=>reject(new Error(e.message));
    worker.postMessage({rgba,width:canvas.width,height:canvas.height},[rgba.buffer]);
  }).finally(()=>worker.terminate());
  const inference=inferRoles(data.metadata);
  return {...sample,data,inference,roles:inference.map(info=>info.role)};
}
function capture(index,seconds,width=960,mode='role',weights='soft'){
  stop();const row=state.rows[index];if(captureRenderer.data!==row.data)captureRenderer.upload(row.data);
  captureRenderer.size(width,Math.round(width*row.data.metadata.height/row.data.metadata.width));
  captureRenderer.draw(mode==='original'?-1:weights==='soft'?2:1,palette(row,seconds,mode));
  return {sample:row.id,seconds,width,height:captureRenderer.canvas.height,mode,weights};
}
function diagnostic(index,seconds){
  const row=state.rows[index];capture(index,seconds,row.data.metadata.width);
  captureRenderer.draw(2,palette(row,seconds),{diagnostic:1});
  const pixels=captureRenderer.read();let lightnessOut=0,chromaMapped=0,minOut=Infinity,maxOut=-Infinity;
  const q=palette(row,seconds),examples=[];
  for(let i=0;i<pixels.length;i+=4){
    if(pixels[i]){
      lightnessOut++;
      const w=row.data.metadata.width,h=row.data.metadata.height,x=(i/4)%w,y=Math.floor(i/4/w),p=((h-1-y)*w+x)*4;
      let L=row.data.lab[p];
      for(let k=0;k<q.length;k++)L+=row.data.weights[Math.floor(k/4)][p+k%4]*(q[k][0]-row.data.metadata.palette[k][0]);
      minOut=Math.min(minOut,L);maxOut=Math.max(maxOut,L);
      if(examples.length<3)examples.push({x,y:h-1-y,sourceL:row.data.lab[p],L,nearest:row.data.lab[p+3]});
    }
    if(pixels[i+1])chromaMapped++;
  }
  return {seconds,lightnessOut,chromaMapped,pixels:pixels.length/4,minOut:lightnessOut?minOut:null,maxOut:lightnessOut?maxOut:null,examples};
}
function metadata(){return state.rows.map(row=>({id:row.id,name:row.name,...row.data.metadata,inference:row.inference,roles:row.roles}));}
window.roleSpike={state,capture,diagnostic,metadata,palette:(i,t)=>palette(state.rows[i],t),moments:MOMENTS,duration:DURATION};
$('#sample').addEventListener('change',e=>{stop();state.sample=state.rows.findIndex(row=>row.id===e.target.value);state.selected=-1;buildPalette();draw();});
$('#mode').addEventListener('change',e=>{stop();state.mode=e.target.value;state.seconds=0;$('#time').max=state.mode==='legacy'?20:24;draw();});
$('#weights').addEventListener('change',e=>{state.weights=e.target.value;draw();});
$('#play').addEventListener('click',()=>{state.playing=!state.playing;state.previous=null;$('#play').textContent=state.playing?'一時停止':'再生';});
$('#time').addEventListener('input',e=>{stop();state.seconds=+e.target.value;draw();});
$('#reset').addEventListener('click',()=>{stop();const row=state.rows[state.sample];row.roles=row.inference.map(info=>info.role);buildPalette();draw();});
addEventListener('resize',draw);
document.addEventListener('visibilitychange',()=>{state.previous=null;});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',stop);
function tick(now){
  if(state.playing&&!document.hidden){
    if(state.previous!==null)state.seconds=(state.seconds+Math.min(.1,(now-state.previous)/1000))%(state.mode==='legacy'?20:24);
    state.previous=now;draw();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
try{
  for(const sample of SAMPLES.filter(sample=>sample.id!=='pixel')){status(`${sample.name}の色と位置を調べています。`);state.rows.push(await load(sample));}
  state.ready=true;buildPalette();draw();
  for(const id of ['sample','play','time','reset'])$('#'+id).disabled=false;
  status('色の推定が完了しました。再生するか、時刻を動かしてください。');
}catch(error){window.roleSpike.error=error.message;status(`画像を表示できません。静的サーバーから開き直してください。${error.message}`);$('#status').classList.add('error');console.error(error);}
