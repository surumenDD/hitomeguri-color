import {chromium} from 'playwright';
import {mkdir,writeFile,access,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,root} from './server.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url)),shots=path.join(dir,'shots'),resultsDir=path.join(dir,'results');
await mkdir(shots,{recursive:true});await mkdir(resultsDir,{recursive:true});
const sha=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const assetDir=path.join(root,'assets/samples/raw');
const sourceFiles=(await readdir(assetDir)).filter(f=>f.endsWith('.png'));
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,await sha(path.join(assetDir,f))])));
const referenceFiles=['color.js','preprocess.js','renderer.js','NOTES.md'];
const referenceHashes=Object.fromEntries(await Promise.all(referenceFiles.map(async f=>[f,await sha(path.join(root,'experiments/recolor-spike',f))])));
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,base=`${origin}/experiments/weights-spike/`;
let browser;
const errors=[],externalRequests=[],failedRequests=[],requests=[],images=[],results=[],manifest=[];
const candidates=[process.env.WEIGHTS_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executablePath;
for(const candidate of candidates)try{await access(candidate);executablePath=candidate;break;}catch{}
try{
  browser=await chromium.launch({executablePath,headless:true,args:['--disable-background-networking']});
  const context=await browser.newContext({viewport:{width:1800,height:1200},deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'reduce'});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue();
    externalRequests.push(u.href);return route.abort();
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',req=>failedRequests.push({url:req.url(),error:req.failure()?.errorText}));
  page.on('response',response=>requests.push({url:response.url().replace(origin,''),status:response.status()}));
  page.setDefaultTimeout(180000);
  await page.goto(base+'?capture');await page.waitForFunction(()=>window.weightsReady);
  const environment={...await page.evaluate(()=>window.weightsSpike.environment()),browserVersion:browser.version(),executablePath,playwright:'1.56.1',headless:true,computation:'CPU Float64 / stored weights Float32 / Canvas2D sRGB8'};
  const save=()=>writeFile(path.join(dir,'metrics.json'),JSON.stringify({environment,sourceHashes,referenceHashes,images,results},null,2)+'\n');
  const methods=await page.evaluate(()=>window.weightsSpike.methods);
  for(let sample=0;sample<4;sample++){
    const metadata=await page.evaluate(s=>window.weightsSpike.load(s),sample);images.push({...metadata,candidates:[]});
    const id=metadata.id;console.log('IMAGE',id);
    await page.evaluate(()=>window.weightsSpike.original());
    await page.locator('#capture').screenshot({path:path.join(shots,`${id}-original.png`)});
    for(const method of methods){
      const prep=await page.evaluate(m=>window.weightsSpike.prepare(m),method);images.at(-1).candidates.push(prep);
      const before=await page.evaluate(()=>window.weightsSpike.fingerprint());
      for(const test of ['a','b','d','e']){
        const result=await page.evaluate(t=>window.weightsSpike.measure(t),test);results.push(result);
        const file=`${id}-${method}-${test}.png`;
        await page.locator('#capture').screenshot({path:path.join(shots,file)});
        manifest.push({file,image:id,method,test,width:metadata.width,height:metadata.height});
        console.log('RESULT',JSON.stringify({image:id,method,test,reach:result.reach,leak:result.leakage,hf:result.speckle,psnr:result.psnrDb,region:result.region,lightnessOut:result.lightnessOutPixels}));
      }
      const after=await page.evaluate(()=>window.weightsSpike.fingerprint());
      prep.weightHashes=before;prep.weightsUnchanged=JSON.stringify(before)===JSON.stringify(after);
      await save();
    }
  }
  for(const image of images)for(const test of ['b','d','e']){
    const data=await page.evaluate(args=>window.weightsSpike.sheet(args.id,args.test),{id:image.id,test});
    await writeFile(path.join(resultsDir,`${image.id}-${test}.jpg`),Buffer.from(data.split(',')[1],'base64'));
    await page.locator('#capture').screenshot({path:path.join(shots,`${image.id}-${test}-contact.png`)});
  }
  await writeFile(path.join(shots,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const unchangedSources=(await Promise.all(sourceFiles.map(async f=>sourceHashes[f]===await sha(path.join(assetDir,f))))).every(Boolean);
  const unchangedReferences=(await Promise.all(referenceFiles.map(async f=>referenceHashes[f]===await sha(path.join(root,'experiments/recolor-spike',f))))).every(Boolean);
  const checks={identityExact:results.filter(r=>r.test==='a').every(r=>r.psnrDb==='Infinity'&&r.squaredRgbError===0&&r.speckle===0),
    storedWeightsUnchanged:images.every(i=>i.candidates.every(c=>c.weightsUnchanged)),
    cardinal:images.every(i=>i.candidates.filter(c=>c.method!=='soft').every(c=>c.cardinalError<1e-10)),
    convex:images.every(i=>i.candidates.every(c=>c.min>=0&&c.max<=1&&c.sumError<2e-7)),
    matrixSolve:images.every(i=>i.candidates.every(c=>c.matrixInverseResidual<1e-8&&c.probes.filter(p=>c.method!=='soft').every(p=>p.error<1e-10))),
    allLightnessInRange:results.every(r=>r.lightnessOutPixels===0),
    unchangedSources,unchangedReferences,captures:manifest.length,expectedCaptures:96,
    errors,externalRequests,failedRequests,requests};
  const ui=await context.newPage();await ui.goto(base);await ui.locator('#gallery img').first().waitFor({state:'visible'});
  await ui.setViewportSize({width:390,height:900});
  checks.mobileOverflow=await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await ui.screenshot({path:path.join(shots,'gallery-mobile.png'),fullPage:true});
  await writeFile(path.join(dir,'checks.json'),JSON.stringify(checks,null,2)+'\n');
  console.log('CHECKS',JSON.stringify({...checks,requests:requests.length}));
  if(!checks.identityExact||!checks.storedWeightsUnchanged||!checks.cardinal||!checks.convex||!checks.matrixSolve||!unchangedSources||!unchangedReferences||errors.length||externalRequests.length||failedRequests.length||checks.mobileOverflow||manifest.length!==96)throw new Error('Verification failed: see checks.json');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  console.log('CLEANUP browser and HTTP server closed');
}
