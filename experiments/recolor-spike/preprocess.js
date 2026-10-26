import {K,rgbToLab,distance2} from './color.js';

self.onmessage = ({data:{rgba,width,height}}) => {
  try {
    const start=performance.now(), n=width*height;
    const lab=new Float32Array(n*4);
    for(let i=0;i<n;i++) lab.set(rgbToLab(rgba[i*4],rgba[i*4+1],rgba[i*4+2]),i*4);
    const converted=performance.now();
    // Deterministic sampling and farthest-point seeding make captures reproducible.
    const samples=[], sampleCount=Math.min(32768,n);
    for(let i=0;i<sampleCount;i++) {
      const p=Math.floor((i+.5)*n/sampleCount)*4;
      samples.push([lab[p],lab[p+1],lab[p+2]]);
    }
    const palette=[samples[Math.floor(sampleCount/2)].slice()];
    const nearest=new Float64Array(sampleCount).fill(Infinity);
    while(palette.length<K) {
      let farthest=0;
      for(let i=0;i<sampleCount;i++) {
        nearest[i]=Math.min(nearest[i],distance2(samples[i],palette.at(-1)));
        if(nearest[i]>nearest[farthest]) farthest=i;
      }
      palette.push(samples[farthest].slice());
    }
    for(let iteration=0;iteration<20;iteration++) {
      const sums=Array.from({length:K},()=>[0,0,0,0]);
      for(const p of samples) {
        let index=0, best=Infinity;
        for(let k=0;k<K;k++) {const d=distance2(p,palette[k]); if(d<best){best=d;index=k;}}
        for(let j=0;j<3;j++) sums[index][j]+=p[j];
        sums[index][3]++;
      }
      let movement=0;
      for(let k=0;k<K;k++) if(sums[k][3]) {
        const next=sums[k].slice(0,3).map(v=>v/sums[k][3]);
        movement+=distance2(next,palette[k]); palette[k]=next;
      }
      if(movement<1e-10) break;
    }
    const extracted=performance.now();
    const counts=new Uint32Array(K);
    for(let i=0;i<n;i++) {
      const p=i*4; let best=Infinity,index=0;
      for(let k=0;k<K;k++) {
        const c=palette[k], d=(lab[p]-c[0])**2+(lab[p+1]-c[1])**2+(lab[p+2]-c[2])**2;
        if(d<best) {best=d;index=k;}
      }
      lab[p+3]=index; counts[index]++;
    }
    const assigned=performance.now();
    const order=Array.from({length:K},(_,i)=>i).sort((a,b)=>counts[b]-counts[a]);
    const remap=Array.from({length:K},(_,i)=>order.indexOf(i));
    const sorted=order.map(i=>palette[i]);
    for(let i=0;i<n;i++) lab[i*4+3]=remap[lab[i*4+3]];
    const mapped=performance.now();
    // Normalized Gaussian RBF weights form a continuous partition of unity.
    // A retained residual makes the identity independent of the approximation error.
    const nearestPalette=sorted.map((p,i)=>Math.sqrt(Math.min(...sorted.filter((_,j)=>j!==i).map(q=>distance2(p,q))))).sort((a,b)=>a-b);
    const sigma=Math.max(.035,Math.min(.12,nearestPalette[K/2]*.8));
    const weights0=new Float32Array(n*4),weights1=new Float32Array(n*4),ds=new Float64Array(K);
    for(let i=0;i<n;i++) {
      const p=i*4; let min=Infinity,total=0;
      for(let k=0;k<K;k++) {
        const c=sorted[k]; ds[k]=(lab[p]-c[0])**2+(lab[p+1]-c[1])**2+(lab[p+2]-c[2])**2;
        min=Math.min(min,ds[k]);
      }
      // Subtract the minimum exponent to avoid underflow for outliers.
      for(let k=0;k<K;k++) total+=(ds[k]=Math.exp(-(ds[k]-min)/(2*sigma*sigma)));
      for(let k=0;k<4;k++) {weights0[p+k]=ds[k]/total; weights1[p+k]=ds[k+4]/total;}
    }
    const done=performance.now();
    // Count sorting/remapping is shared by every candidate; exclude soft-only work.
    const assignment=mapped-extracted;
    const metadata={width,height,palette:sorted,counts:order.map(i=>counts[i]),sigma,
      timing:{conversion:converted-start,palette:extracted-converted,assignment,
        hard:mapped-start,residual:mapped-start,soft:done-start},
      bytes:lab.byteLength+weights0.byteLength+weights1.byteLength};
    self.postMessage({lab,weights0,weights1,metadata},[lab.buffer,weights0.buffer,weights1.buffer]);
  } catch(error) {self.postMessage({error:error.stack||error.message});}
};
