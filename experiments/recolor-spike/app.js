import {SAMPLES,METHODS,METHOD_NAMES,paletteAt,labHex,STAGE_TIMES,distance2,gamutMap,labToLinear} from './color.js';
import {Renderer,benchmark} from './renderer.js';

const captureMode=new URLSearchParams(location.search).has('capture');
if(captureMode)document.body.classList.add('capture');
const status=document.querySelector('#status'),main=document.querySelector('main');
const state={test:'a',seconds:0,playing:false,measuring:false,ready:false,rows:[],previous:null};
const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
const median=values=>{const a=values.slice().sort((a,b)=>a-b);return (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2;};
const setStatus=text=>{status.textContent=text;};
let bench=null;

async function loadImage(sample){
  const start=performance.now(),image=new Image();
  image.src=`../../assets/samples/raw/${sample.file}`;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});ctx.drawImage(image,0,0);
  const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const worker=new Worker('./preprocess.js',{type:'module'});
  const data=await new Promise((resolve,reject)=>{
    worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data);
    worker.onerror=event=>reject(new Error(event.message));
    // Retain decoded sRGB bytes for the full-resolution PSNR comparison.
    const input=rgba.slice();worker.postMessage({rgba:input,width:canvas.width,height:canvas.height},[input.buffer]);
  }).finally(()=>worker.terminate());
  data.rgba=rgba;data.metadata.loadAndProcessMs=performance.now()-start;
  return {...sample,data,renderer:null,swatches:[]};
}

function buildRow(row){
  const section=document.createElement('section');section.className='sample';
  section.innerHTML=`<div class="rowtitle"><div><h2>${row.name}</h2><p>${row.detail}</p></div><span class="dimensions">${row.data.metadata.width} × ${row.data.metadata.height} · 8色</span></div><div class="comparison"><div class="labels"><div>原画<small>比較の基準</small></div>${METHOD_NAMES.map((name,i)=>`<div>${name}<small>${['最も近い1色','元の色との差を足す','複数の色を混ぜる'][i]}</small></div>`).join('')}</div><canvas aria-label="${row.name}の原画と3方式の比較"></canvas></div><div class="palette" aria-label="面積順のパレット"></div>`;
  main.append(section);row.section=section;
  row.renderer=new Renderer(section.querySelector('canvas'));row.renderer.upload(row.data);
  row.swatches=row.data.metadata.palette.map((p,i)=>{
    const swatch=document.createElement('div');swatch.className='swatch';
    swatch.innerHTML=`<span>${i+1} · ${(row.data.metadata.counts[i]/(row.data.metadata.width*row.data.metadata.height)*100).toFixed(1)}%</span>`;
    section.querySelector('.palette').append(swatch);return swatch;
  });
}
function draw(){
  if(captureMode)return;
  for(const row of state.rows){
    if(!row.renderer)continue;
    const canvas=row.renderer.canvas,width=Math.round(Math.max(800,row.section.querySelector('.comparison').clientWidth));
    const cell=Math.floor(width/4),height=Math.round(cell*2/3),palette=paletteAt(row.data.metadata.palette,state.test,state.seconds);
    row.renderer.size(cell*4,height);
    row.renderer.draw(-1,row.data.metadata.palette,{viewport:[0,0,cell,height],contain:true});
    for(let i=0;i<3;i++)row.renderer.draw(i,palette,{viewport:[cell*(i+1),0,cell,height],contain:true});
    row.swatches.forEach((swatch,i)=>{swatch.style.background=labHex(palette[i]);swatch.title=`色 ${i+1}: ${labHex(palette[i])}`;});
  }
  document.querySelector('#time').value=state.seconds;
  document.querySelector('#clock').textContent=`${state.seconds.toFixed(2)} / 20秒`;
}
function setTest(test,seconds=0){
  state.playing=false;state.previous=null;state.test=test;state.seconds=seconds;
  document.querySelector(`input[value="${test}"]`).checked=true;
  document.querySelector('#play').disabled=test!=='c';document.querySelector('#time').disabled=test!=='c';
  document.querySelector('#play').textContent='再生';draw();
}
function getBench(index){
  if(!bench)bench=new Renderer(document.querySelector('#capture'));
  const row=state.rows[index];if(bench.data!==row.data)bench.upload(row.data);return bench;
}
function readPSNR(output,original,width,height){
  let squared=0,max=0,changed=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
    const d=output[((height-1-y)*width+x)*4+c]-original[(y*width+x)*4+c];
    squared+=d*d;max=Math.max(max,Math.abs(d));if(d)changed++;
  }
  const mse=squared/(width*height*3);
  return {psnrDb:mse===0?'Infinity':10*Math.log10(255*255/mse),mse,maxChannelError:max,changedChannels:changed};
}
function diagnostic(renderer,mode,palette){
  renderer.draw(mode,palette,{diagnostic:1});const pixels=renderer.read();let lightness=0,gamut=0;
  for(let i=0;i<pixels.length;i+=4){if(pixels[i])lightness++;if(pixels[i+1])gamut++;}
  return {lightnessOutPixels:lightness,chromaMappedPixels:gamut,pixels:pixels.length/4};
}
function referenceCheck(renderer,mode,palette,data){
  renderer.draw(mode,palette);const output=renderer.read(),{width,height}=data.metadata;
  let maxError=0;
  for(let i=0;i<257;i++){
    const pixel=Math.floor((i+.5)*width*height/257),p=pixel*4,id=data.lab[p+3];
    let lab=Array.from(data.lab.subarray(p,p+3));
    if(mode===0)lab=palette[id].slice();
    if(mode===1)lab=lab.map((v,c)=>v+palette[id][c]-data.metadata.palette[id][c]);
    if(mode===2)for(let k=0;k<8;k++){
      const w=k<4?data.weights0[p+k]:data.weights1[p+k-4];
      lab=lab.map((v,c)=>v+w*(palette[k][c]-data.metadata.palette[k][c]));
    }
    const expected=labToLinear(gamutMap(lab)).map(c=>Math.round(255*(c<=.0031308?12.92*c:1.055*Math.max(0,c)**(1/2.4)-.055)));
    const x=pixel%width,y=Math.floor(pixel/width),q=((height-1-y)*width+x)*4;
    for(let c=0;c<3;c++)maxError=Math.max(maxError,Math.abs(expected[c]-output[q+c]));
  }
  return {samples:257,maxChannelError:maxError,passed:maxError<=1};
}
async function measure(index,mode){
  state.measuring=true;state.playing=false;
  const row=state.rows[index],data=row.data,palette=data.metadata.palette,renderer=getBench(index);
  const {width,height}=data.metadata;
  setStatus(`${row.name} / ${METHOD_NAMES[mode]}：元画像の再現と1080p描画を計測中`);
  renderer.size(width,height);renderer.draw(mode,palette);
  const identity=readPSNR(renderer.read(),data.rgba,width,height);
  const reference=referenceCheck(renderer,mode,paletteAt(palette,'b'),data);
  const keys=STAGE_TIMES.map(t=>paletteAt(palette,'c',t));
  const gamut=keys.map((key,i)=>({seconds:STAGE_TIMES[i],...diagnostic(renderer,mode,key)}));
  const editDiagnostic=diagnostic(renderer,mode,paletteAt(palette,'b'));
  const timing=await benchmark(renderer,mode,[palette,paletteAt(palette,'b'),...keys]);
  // The temporal test uses the actual fragment shader and 8-bit framebuffer.
  // Sample the full image area on an aspect-preserving 192px-wide grid.
  const tw=192,th=Math.round(tw*height/width),fps=60,steps=20*fps;
  renderer.size(tw,th);renderer.draw(mode,keys[0]);let previous=renderer.read(),prevPalette=keys[0];
  const diffs=[],ratios=[],speeds=[],maxChannel=[],pixelCount=tw*th*3;
  for(let frame=1;frame<=steps;frame++){
    const next=paletteAt(palette,'c',frame/fps);renderer.draw(mode,next);const current=renderer.read();
    let sum=0,localMax=0;
    for(let p=0;p<current.length;p+=4)for(let c=0;c<3;c++){
      const d=Math.abs(current[p+c]-previous[p+c]);sum+=d;localMax=Math.max(localMax,d);
    }
    const diff=sum/pixelCount,speed=Math.sqrt(Math.max(...next.map((p,i)=>distance2(p,prevPalette[i]))));
    diffs.push(diff);speeds.push(speed);maxChannel.push(localMax);
    if(speed>=1e-5)ratios.push(diff/(255*speed));
    previous=current;prevPalette=next;
    if(frame%60===0){setStatus(`${row.name} / ${METHOD_NAMES[mode]}：時間の検査 ${frame/fps} / 20秒`);await yieldUI();}
  }
  const maxValue=Math.max(...diffs),worst=diffs.indexOf(maxValue)+1;
  const temporal={resolution:[tw,th],fps,framePairs:steps,includesLoopSeam:true,
    unit:'mean absolute sRGB byte difference across RGB channels',max:maxValue,median:median(diffs),
    maxSingleChannelStep:Math.max(...maxChannel),worstTimeSeconds:worst/fps,
    paletteNormalizedMax:Math.max(...ratios),paletteNormalizedMedian:median(ratios),normalizationMinPaletteDelta:1e-5,
    loopSeamDifference:diffs.at(-1),differences:diffs,paletteStepsOKLab:speeds,maxSingleChannelByFrame:maxChannel};
  const result={sample:row.id,name:row.name,method:METHODS[mode],width,height,
    preprocessMs:data.metadata.timing[METHODS[mode]],identity,reference,render:timing,temporal,gamut,editDiagnostic};
  setStatus(`${row.name} / ${METHOD_NAMES[mode]}：計測完了`);
  return result;
}
function capture(index,mode,test,seconds=0,width=960){
  state.playing=false;const row=state.rows[index],renderer=getBench(index);
  const height=Math.round(width*row.data.metadata.height/row.data.metadata.width);
  renderer.size(width,height);renderer.draw(mode,paletteAt(row.data.metadata.palette,test,seconds));
  return {width,height,sample:row.id,method:METHODS[mode],test,seconds};
}

document.querySelectorAll('input[name=test]').forEach(input=>input.addEventListener('change',()=>setTest(input.value)));
document.querySelector('#play').addEventListener('click',()=>{state.playing=!state.playing;state.previous=null;document.querySelector('#play').textContent=state.playing?'一時停止':'再生';});
document.querySelector('#time').addEventListener('input',event=>{state.seconds=+event.target.value;state.playing=false;state.previous=null;document.querySelector('#play').textContent='再生';draw();});
addEventListener('resize',()=>{if(state.ready)draw();});
document.addEventListener('visibilitychange',()=>{state.previous=null;});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{state.playing=false;state.previous=null;document.querySelector('#play').textContent='再生';});
function tick(now){
  if(state.ready&&state.playing&&!state.measuring&&!document.hidden){
    if(state.previous!==null)state.seconds=(state.seconds+Math.min(.1,(now-state.previous)/1000))%20;
    state.previous=now;draw();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
document.querySelector('#measure').addEventListener('click',async()=>{
  const button=document.querySelector('#measure');button.disabled=true;
  try{
    const results=[];
    for(let i=0;i<SAMPLES.length;i++)for(let m=0;m<3;m++)results.push(await measure(i,m));
    const blob=new Blob([JSON.stringify({environment:environment(),images:state.rows.map(row=>({id:row.id,...row.data.metadata})),results},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='recolor-metrics.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    setStatus('12組の計測結果を保存しました。');
  }catch(error){setStatus(`計測を中断しました：${error.message}`);console.error(error);}
  finally{state.measuring=false;button.disabled=false;draw();}
});
function environment(){return {userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio,webgl:getBench(0).info,date:new Date().toISOString()};}
window.spike={state,measure,capture,setTest,draw,environment,stageTimes:STAGE_TIMES,
  metadata:()=>state.rows.map(row=>({id:row.id,...row.data.metadata})),
  paletteAt:(index,test,seconds)=>paletteAt(state.rows[index].data.metadata.palette,test,seconds)};
try{
  for(let i=0;i<SAMPLES.length;i++){
    setStatus(`${SAMPLES[i].name}を分解中（${i+1} / 4）`);
    state.rows.push(await loadImage(SAMPLES[i]));
  }
  main.replaceChildren();if(!captureMode)state.rows.forEach(buildRow);
  state.ready=true;draw();document.querySelector('#measure').disabled=false;
  setStatus('4枚の分解が完了しました。a・b・c を切り替えて比較できます。');
  document.documentElement.dataset.ready='true';
}catch(error){setStatus(`比較を開始できません：${error.message}`);main.className='error';main.textContent='静的サーバーでリポジトリを配信して開き直してください。詳しくは NOTES.md を参照してください。';console.error(error);window.spike.error=error.message;}
