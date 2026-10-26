import {chromium} from 'playwright';
import {mkdir,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from './server.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const shotDirectory=path.join(directory,'shots');
await mkdir(shotDirectory,{recursive:true});
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const base=`${origin}/experiments/recolor-spike/`;
const candidates=[process.env.RECOLOR_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executablePath;
for(const file of candidates)try{await access(file);executablePath=file;break;}catch{}
let browser;
const errors=[],requests=[],failedRequests=[];
try{
  browser=await chromium.launch({executablePath,headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin||url.protocol==='data:'||url.protocol==='blob:')return route.continue();
    failedRequests.push({url:url.href,reason:'blocked non-local request'});return route.abort();
  });
  context.on('page',page=>{
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{requests.push({url:response.url().replace(origin,''),status:response.status()});if(response.status()>=400)failedRequests.push({url:response.url(),status:response.status()});});
    page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  });
  const page=await context.newPage();await page.goto(`${base}?capture=1`);
  await page.waitForFunction(()=>window.spike?.state.ready||window.spike?.error,{},{timeout:180000});
  if(await page.evaluate(()=>window.spike.error))throw new Error(await page.evaluate(()=>window.spike.error));
  const metadata=await page.evaluate(()=>window.spike.metadata());
  const environment={...await page.evaluate(()=>window.spike.environment()),browserVersion:browser.version(),executablePath,playwright:'1.56.1',headless:true};
  const results=[],captureManifest=[];
  console.log('ENVIRONMENT',JSON.stringify(environment));
  const saveMetrics=()=>writeFile(path.join(directory,'metrics.json'),JSON.stringify({environment,images:metadata,results},null,2)+'\n');
  for(let sample=0;sample<4;sample++)for(let mode=0;mode<3;mode++){
    const name=`${metadata[sample].id}-${['hard','residual','soft'][mode]}`;
    console.log('MEASURING',name);
    const result=await page.evaluate(async({sample,mode})=>window.spike.measure(sample,mode),{sample,mode});
    results.push(result);await saveMetrics();
    console.log('RESULT',JSON.stringify({sample:result.sample,method:result.method,psnr:result.identity.psnrDb,preprocessMs:result.preprocessMs,gpuMs:result.render.gpuMedianMs,wallMs:result.render.wallMedianMs,temporalMax:result.temporal.max,temporalMedian:result.temporal.median,reference:result.reference,lightness:result.gamut.map(x=>x.lightnessOutPixels)}));
    const times=await page.evaluate(()=>window.spike.stageTimes);
    const tests=[['a',0,'a'],['b',0,'b'],...times.map((time,i)=>['c',time,`c${i}`])];
    for(const [test,seconds,suffix] of tests){
      const info=await page.evaluate(args=>window.spike.capture(args.sample,args.mode,args.test,args.seconds),{sample,mode,test,seconds});
      const file=`${name}-${suffix}.png`;
      await page.locator('#capture').screenshot({path:path.join(shotDirectory,file),animations:'disabled'});
      captureManifest.push({file,...info});
    }
  }
  await writeFile(path.join(shotDirectory,'manifest.json'),JSON.stringify(captureManifest,null,2)+'\n');
  for(const sample of metadata){
    await page.evaluate(async({base,id,label})=>{
      const width=1440,cellWidth=480,cellHeight=320,rowHeight=360,header=80;
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=header+rowHeight*6;
      canvas.id='contact-sheet';document.body.replaceChildren(canvas);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#edf2f6';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#23313d';ctx.font='22px sans-serif';ctx.fillText(label,16,30);
      ctx.font='16px sans-serif';['硬い量子化','差分を保つ置き換え','柔らかい重み + 残差'].forEach((title,i)=>ctx.fillText(title,i*cellWidth+16,64));
      const captions=['a · 元のパレット','b · 最大色の色相 +120°','c · 夕方 0.000秒','c · 残照 8.571秒','c · 夜 11.429秒','c · 夜明け 17.143秒'];
      for(let row=0;row<6;row++)for(let col=0;col<3;col++){
        const file=`${id}-${['hard','residual','soft'][col]}-${['a','b','c0','c1','c2','c3'][row]}.png`;
        const image=new Image();image.src=base+'shots/'+file;await image.decode();
        const y=header+row*rowHeight;
        ctx.fillStyle='#23313d';ctx.fillText(captions[row],col*cellWidth+16,y+22);
        ctx.fillStyle='#181818';ctx.fillRect(col*cellWidth,y+32,cellWidth,cellHeight);
        const scale=Math.min(cellWidth/image.naturalWidth,cellHeight/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
        ctx.drawImage(image,col*cellWidth+(cellWidth-w)/2,y+32+(cellHeight-h)/2,w,h);
      }
    },{base,id:sample.id,label:sample.id});
    await page.locator('#contact-sheet').screenshot({path:path.join(shotDirectory,`${sample.id}-contact.png`)});
  }
  await page.close();
  const ui=await context.newPage();await ui.goto(base);await ui.waitForFunction(()=>window.spike?.state.ready||window.spike?.error,{},{timeout:180000});
  if(await ui.evaluate(()=>window.spike.error))throw new Error(await ui.evaluate(()=>window.spike.error));
  await ui.screenshot({path:path.join(shotDirectory,'comparison-a.png'),fullPage:true});
  await ui.getByLabel('b · 最大の色を +120°').check();
  if(await ui.evaluate(()=>window.spike.state.test)!=='b')throw new Error('Test b control failed');
  await ui.screenshot({path:path.join(shotDirectory,'comparison-b.png'),fullPage:true});
  await ui.getByLabel('c · 夕方から夜へ').check();await ui.getByRole('button',{name:'再生',exact:true}).click();
  await ui.waitForFunction(()=>window.spike.state.seconds>.2);
  await ui.getByRole('button',{name:'一時停止',exact:true}).click();
  const paused=await ui.evaluate(()=>window.spike.state.seconds);
  await ui.evaluate(()=>window.spike.setTest('c',80/7));
  await ui.screenshot({path:path.join(shotDirectory,'comparison-c-night.png'),fullPage:true});
  await ui.setViewportSize({width:390,height:900});
  await ui.screenshot({path:path.join(shotDirectory,'comparison-mobile.png'),fullPage:true});
  const overflow=await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  const checks={shaderReference:results.every(r=>r.reference.passed),identityResidualExact:results.filter(r=>r.method!=='hard').every(r=>r.identity.psnrDb==='Infinity'),
    lightnessInsideGamut:results.every(r=>r.gamut.every(g=>g.lightnessOutPixels===0)&&r.editDiagnostic.lightnessOutPixels===0),
    captures:captureManifest.length,expectedCaptures:72,testB:true,animationAdvanced:paused>.2,mobileViewportOverflow:overflow,errors,failedRequests,requests};
  await writeFile(path.join(directory,'checks.json'),JSON.stringify(checks,null,2)+'\n');
  console.log('CHECKS',JSON.stringify({...checks,requests:requests.length}));
  if(errors.length||failedRequests.length||!checks.shaderReference||overflow||!checks.lightnessInsideGamut)throw new Error('Verification failed; inspect checks.json');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
