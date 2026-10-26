import {SAMPLES,rgbToLab,rotateHue,gamutMap,labToLinear,distance2,labHex} from './color.js';
import {computeWeights,methods,methodNames,colorWeights} from './weights.js';

const canvas=document.querySelector('#capture'),ctx=canvas.getContext('2d',{willReadFrequently:true});
let current,prepared,sourceImage;
const encode=c=>c<=.0031308?12.92*c:1.055*Math.max(0,c)**(1/2.4)-.055;
const inGamut=c=>c.every(v=>v>=-1e-7&&v<=1+1e-7);
const rois={sky:[.58,.02,.95,.20],sea:[.62,.86,.95,.98]};
function inRoi(i,width,height,box){const u=(i%width)/(width-1),v=Math.floor(i/width)/(height-1);return u>=box[0]&&u<=box[2]&&v>=box[1]&&v<=box[3];}
function roiCounts(lab,width,height,box){const counts=Array(8).fill(0);for(let i=0;i<width*height;i++)if(inRoi(i,width,height,box))counts[lab[i*4+3]]++;return counts;}
function commonColor(data){
  const {lab,metadata:{width,height,palette}}=data;
  const sky=roiCounts(lab,width,height,rois.sky),sea=roiCounts(lab,width,height,rois.sea);
  const scores=palette.map((p,k)=>p[2]<-.025?Math.min(sky[k],sea[k]):-1);
  let k=scores.indexOf(Math.max(...scores));
  if(scores[k]<=0)k=sky.map((v,j)=>Math.min(v,sea[j])).indexOf(Math.max(...sky.map((v,j)=>Math.min(v,sea[j]))));
  return {k,skyCounts:sky,seaCounts:sea,rois};
}

async function load(sample){
  const image=new Image();image.src='../../assets/samples/raw/'+SAMPLES[sample].file;await image.decode();
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.drawImage(image,0,0);
  const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const data=await new Promise((resolve,reject)=>{
    const worker=new Worker('./preprocess.js',{type:'module'});
    worker.onmessage=({data})=>{worker.terminate();data.error?reject(new Error(data.error)):resolve(data);};
    worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};
    worker.postMessage({rgba,width:canvas.width,height:canvas.height});
  });
  data.rgba=rgba;data.sample=SAMPLES[sample];data.common=commonColor(data);
  current=data;sourceImage=image;prepared=null;
  return {...data.metadata,id:data.sample.id,common:data.common,rois};
}

function prepare(method){
  if(!current)throw new Error('Load image first');
  prepared={...computeWeights(current,method),method};
  const {weights,gate,model,...report}=prepared;
  const probes=[];
  for(const test of ['b','d'])for(let k=0;k<8;k++){
    const p=current.metadata.palette[k],q=test==='b'?rotateHue(p,120):gamutMap([Math.min(.98,p[0]+.14),p[1],p[2]]);
    const ws=colorWeights(p,method,model),y=p.map((v,j)=>v+ws[k]*(q[j]-p[j]));
    probes.push({test,k,weight:ws[k],target:labHex(q),actual:labHex(y),error:Math.sqrt(distance2(y,q))});
  }
  return {...report,probes,rbfSigma:model.sigma,matrixInverseResidual:model.inverseResidual};
}

function edit(test){
  const palette=current.metadata.palette;
  const k=test==='d'?1:test==='e'?current.common.k:0,p=palette[k];
  const q=test==='d'?gamutMap([Math.min(.98,p[0]+.14),p[1],p[2]]):rotateHue(p,120);
  return {k,p,q,delta:q.map((v,j)=>test==='a'?0:v-p[j])};
}

function measure(test){
  const start=performance.now(),data=current,{lab,rgba,metadata:{width,height}}=data,{weights,gate,method}=prepared;
  const {k,p,q,delta}=edit(test),n=width*height,amplitude=Math.hypot(...delta),out=new Uint8ClampedArray(n*4),movement=new Float32Array(n*3);
  let identityError=0,targetMovement=0,targetProjection=0,targetCount=0,leakMovement=0,leakCount=0,compressed=0,lightnessOut=0;
  const region={sky:{movement:0,count:0,weight:0},sea:{movement:0,count:0,weight:0}};
  let preTarget=0,preLeak=0,minWeight=1,maxWeight=0;
  for(let i=0;i<n;i++){
    const at=i*4;
    let w=weights[i*8+k];if(test==='e'&&gate)w*=gate[i];
    minWeight=Math.min(minWeight,w);maxWeight=Math.max(maxWeight,w);
    const x=[lab[at],lab[at+1],lab[at+2]],y=x.map((v,j)=>v+w*delta[j]);
    if(y[0]<0||y[0]>1)lightnessOut++;
    let linear=labToLinear(y);
    if(!inGamut(linear)){compressed++;linear=labToLinear(gamutMap(y));}
    for(let j=0;j<3;j++)out[at+j]=Math.round(Math.max(0,Math.min(1,encode(linear[j])))*255);
    out[at+3]=rgba[at+3];
    const actual=rgbToLab(out[at],out[at+1],out[at+2]);
    const reference=rgbToLab(rgba[at],rgba[at+1],rgba[at+2]);
    const displacement=actual.map((v,j)=>v-reference[j]),norm=Math.hypot(...displacement);
    movement.set(displacement,i*3);
    for(let j=0;j<3;j++)identityError+=(out[at+j]-rgba[at+j])**2;
    if(lab[at+3]===k){targetMovement+=norm;targetProjection+=displacement.reduce((s,v,j)=>s+v*delta[j],0);targetCount++;preTarget+=w;}
    else{leakMovement+=norm;leakCount++;preLeak+=w;}
    if(test==='e')for(const name of ['sky','sea'])if(lab[at+3]===k&&inRoi(i,width,height,rois[name])){region[name].movement+=norm;region[name].weight+=w;region[name].count++;}
  }
  let hf=0,hfCount=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;
    for(let j=0;j<3;j++){
      const value=movement[(i-1)*3+j]+movement[(i+1)*3+j]+movement[(i-width)*3+j]+movement[(i+width)*3+j]-4*movement[i*3+j];
      hf+=value*value;
    }
    hfCount++;
  }
  ctx.putImageData(new ImageData(out,width,height),0,0);
  const reach=amplitude?targetMovement/targetCount/amplitude:null;
  const speckle=Math.sqrt(hf/hfCount);
  return {image:data.sample.id,method,test,width,height,k,source:p,target:q,delta,amplitude,
    reach,projectionReach:amplitude?targetProjection/targetCount/amplitude**2:null,
    leakage:leakMovement/leakCount,speckle,specklePerReachedDelta:reach?speckle/(amplitude*reach):null,
    preGamutReach:preTarget/targetCount,preGamutLeakage:preLeak/leakCount*amplitude,
    targetCount,leakCount,compressedPixels:compressed,lightnessOutPixels:lightnessOut,
    psnrDb:identityError===0?'Infinity':10*Math.log10(255**2/(identityError/(n*3))),squaredRgbError:identityError,
    weightRange:[minWeight,maxWeight],
    region:test==='e'?Object.fromEntries(Object.entries(region).map(([name,r])=>[name,{count:r.count,reach:r.count?r.movement/r.count/amplitude:null,meanWeight:r.count?r.weight/r.count:null}])):null,
    renderAndMeasureMs:performance.now()-start};
}

function original(){canvas.width=sourceImage.naturalWidth;canvas.height=sourceImage.naturalHeight;ctx.drawImage(sourceImage,0,0);}

async function sheet(id,test){
  const width=1600,cell=400,row=320;
  canvas.width=width;canvas.height=row*2+64;
  ctx.fillStyle='#181818';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#eeeeee';ctx.font='24px sans-serif';ctx.fillText(`${id} / ${test}`,16,32);
  for(let i=0;i<7;i++){
    const name=i===0?'original':methods[i-1],label=i===0?'原画':methodNames[i-1];
    const image=new Image();image.src=`shots/${id}-${name}${i===0?'':'-'+test}.png`;await image.decode();
    const x=(i%4)*cell,y=Math.floor(i/4)*row+64;
    ctx.fillStyle='#eeeeee';ctx.font='16px sans-serif';ctx.fillText(label,x+16,y+24);
    const scale=Math.min(cell/image.width,(row-40)/image.height),w=image.width*scale,h=image.height*scale;
    ctx.drawImage(image,x+(cell-w)/2,y+40,w,h);
  }
  return canvas.toDataURL('image/jpeg',.88);
}

window.weightsSpike={load,prepare,measure,original,sheet,methods,methodNames,samples:SAMPLES,
  fingerprint:async()=>{
    const buffers=[prepared.weights.buffer,...(prepared.gate?[prepared.gate.buffer]:[])];
    return Promise.all(buffers.map(async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('')));
  },
  environment:()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,date:new Date().toISOString(),dpr:devicePixelRatio})};
window.weightsReady=true;
