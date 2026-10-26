import {distance2, labHex} from './color.js';

export const methods=['residual','soft','rbf','shepard','filtered','spatial'];
export const methodNames=['最近傍','正規化 Gaussian','補間 RBF','補間 Shepard','空間平滑 Shepard','空間平滑 と RGBXY の島'];

function inverse(matrix) {
  const n=matrix.length, a=matrix.map((row,i)=>[...row,...Array.from({length:n},(_,j)=>Number(i===j))]);
  for(let j=0;j<n;j++){
    let p=j;for(let i=j+1;i<n;i++)if(Math.abs(a[i][j])>Math.abs(a[p][j]))p=i;
    if(Math.abs(a[p][j])<1e-13)throw new Error('RBF matrix is singular');
    [a[p],a[j]]=[a[j],a[p]];
    const divisor=a[j][j];for(let k=0;k<2*n;k++)a[j][k]/=divisor;
    for(let i=0;i<n;i++)if(i!==j){const v=a[i][j];for(let k=0;k<2*n;k++)a[i][k]-=v*a[j][k];}
  }
  return a.map(row=>row.slice(n));
}

export function makeModel(palette,softSigma){
  let sum=0,count=0;
  for(let i=0;i<8;i++)for(let j=0;j<i;j++){sum+=Math.sqrt(distance2(palette[i],palette[j]));count++;}
  const sigma=sum/count;
  const matrix=palette.map(p=>palette.map(q=>Math.exp(-distance2(p,q)/(2*sigma*sigma))));
  const inv=inverse(matrix);
  const model={palette,softSigma,sigma,inv};
  model.inverseResidual=Math.max(...matrix.flatMap((row,i)=>inv[0].map((_,j)=>Math.abs(row.reduce((s,v,k)=>s+v*inv[k][j],0)-Number(i===j)))));
  return model;
}

// Return nonnegative weights summing to one. Only the original image is used.
export function colorWeights(x,method,model,out=new Float64Array(8)){
  const {palette}=model,ds=palette.map(p=>distance2(x,p));
  const nearest=ds.indexOf(Math.min(...ds));
  out.fill(0);
  if(method==='residual'){out[nearest]=1;return out;}
  // Explicit cardinal limit also avoids the removable Shepard singularity.
  if(method!=='soft'&&ds[nearest]<1e-24){out[nearest]=1;return out;}
  if(method==='soft'){
    for(let k=0;k<8;k++)out[k]=Math.exp(-(ds[k]-ds[nearest])/(2*model.softSigma**2));
  }else if(['shepard','filtered','spatial'].includes(method)){
    // Inverse fourth power in distance: continuous, cardinal, convex.
    for(let k=0;k<8;k++)out[k]=(ds[nearest]/ds[k])**2;
  }else{
    const phi=ds.map(d=>Math.exp(-d/(2*model.sigma**2)));
    for(let k=0;k<8;k++)out[k]=Math.max(0,phi.reduce((s,v,j)=>s+v*model.inv[j][k],0));
  }
  const total=out.reduce((s,v)=>s+v,0);
  if(!(total>1e-20))throw new Error('Empty weight partition');
  for(let k=0;k<8;k++)out[k]/=total;
  return out;
}

export const seedBands={skyMaxY:.30,seaMinY:.60};

export function prepareGate(rgba,width,height){
  const anchors=[];
  for(const [label,ys] of [[1,[.06,.24]],[0,[.70,.94]]])for(const v of ys)for(const u of [.15,.5,.85]){
    const x=Math.round(u*(width-1)),y=Math.round(v*(height-1)),p=(y*width+x)*4;
    anchors.push({u,v,rgb:Array.from(rgba.slice(p,p+3),x=>x/255),label});
  }
  return {anchors,colorScale:.25,positionScale:.35,...seedBands};
}

// A seeded RGBXY partition, not Tan's convex-hull/Delaunay algorithm.
// Fixed seed bands express a user decision about the two islands.
export function spatialGate(rgb,u,v,model){
  if(v<=model.skyMaxY)return 1;
  if(v>=model.seaMinY)return 0;
  let total=0,sky=0;
  for(const a of model.anchors){
    const d=rgb.reduce((s,c,j)=>s+(c-a.rgb[j])**2,0)/model.colorScale**2+((u-a.u)**2+(v-a.v)**2)/model.positionScale**2;
    const weight=1/(d*d+1e-20);total+=weight;sky+=weight*a.label;
  }
  let t=(v-model.skyMaxY)/(model.seaMinY-model.skyMaxY);t=t*t*(3-2*t);
  // The bounded correction retains C1 joins to the fixed seed bands.
  return 1-t+t*(1-t)*(sky/total-.5);
}

export function computeWeights(data,method){
  const start=performance.now(),{lab,rgba,metadata:{width,height,palette,sigma}}=data;
  const n=width*height,model=makeModel(palette,sigma),gateModel=prepareGate(rgba,width,height);
  const weights=new Float32Array(n*8),gate=method==='spatial'?new Float32Array(n):null,out=new Float64Array(8);
  let min=Infinity,max=-Infinity,sumError=0;
  for(let i=0;i<n;i++){
    const p=i*4;
    colorWeights([lab[p],lab[p+1],lab[p+2]],method,model,out);
    weights.set(out,i*8);
    let sum=0;for(let k=0;k<8;k++){const w=weights[i*8+k];sum+=w;min=Math.min(min,w);max=Math.max(max,w);}
    sumError=Math.max(sumError,Math.abs(sum-1));
    if(gate)gate[i]=spatialGate([rgba[p]/255,rgba[p+1]/255,rgba[p+2]/255],(i%width)/(width-1),Math.floor(i/width)/(height-1),gateModel);
  }
  if(['filtered','spatial'].includes(method))smoothWeights(weights,lab,width,height,palette);
  // Validate the actual stored partition after spatial filtering.
  min=Infinity;max=-Infinity;sumError=0;
  for(let i=0;i<n;i++){
    let sum=0;for(let k=0;k<8;k++){const w=weights[i*8+k];sum+=w;min=Math.min(min,w);max=Math.max(max,w);}
    sumError=Math.max(sumError,Math.abs(sum-1));
  }
  const cardinal=palette.map((p,k)=>Array.from(colorWeights(p,method,model)).map((v,j)=>Math.abs(v-Number(k===j))));
  return {weights,gate,model,gateModel,timingMs:performance.now()-start,min,max,sumError,
    cardinalError:Math.max(...cardinal.flat()),swatches:palette.map(labHex)};
}

export const smoothing={radius:4,spatialSigma:2,colorSigma:.04,cardinalRadius:.025};

// Two joint bilateral passes, guided by the original OKLab, at load time only.
// Blend back to the cardinal color rule with a continuous factor that vanishes
// at every palette point. Convexity and the interpolation condition both remain.
function smoothWeights(weights,lab,width,height,palette){
  const {radius,spatialSigma,colorSigma,cardinalRadius}=smoothing,n=width*height;
  const initial=weights.slice(),temp=new Float32Array(weights.length);
  const sums=new Float64Array(8),spatial=Array.from({length:2*radius+1},(_,i)=>Math.exp(-((i-radius)**2)/(2*spatialSigma**2)));
  for(const horizontal of [true,false]){
    const source=horizontal?weights:temp,destination=horizontal?temp:weights;
    for(let i=0;i<n;i++){
      sums.fill(0);let total=0;
      const x=i%width,y=Math.floor(i/width),p=i*4;
      for(let offset=-radius;offset<=radius;offset++){
        const xx=horizontal?x+offset:x,yy=horizontal?y:y+offset;
        if(xx<0||xx>=width||yy<0||yy>=height)continue;
        const j=yy*width+xx,q=j*4;
        const d=(lab[p]-lab[q])**2+(lab[p+1]-lab[q+1])**2+(lab[p+2]-lab[q+2])**2;
        const w=spatial[offset+radius]*Math.exp(-d/(2*colorSigma**2));total+=w;
        for(let k=0;k<8;k++)sums[k]+=w*source[j*8+k];
      }
      for(let k=0;k<8;k++)destination[i*8+k]=sums[k]/total;
    }
  }
  for(let i=0;i<n;i++){
    const p=i*4;let nearest=Infinity;
    for(const color of palette){const d=(lab[p]-color[0])**2+(lab[p+1]-color[1])**2+(lab[p+2]-color[2])**2;nearest=Math.min(nearest,d);}
    const alpha=Math.min(1,nearest/cardinalRadius**2);
    for(let k=0;k<8;k++)weights[i*8+k]=(1-alpha)*initial[i*8+k]+alpha*weights[i*8+k];
  }
}
