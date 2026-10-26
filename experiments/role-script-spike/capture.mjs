import {chromium} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from './server.mjs';
import {MOMENTS} from './script.js';

const directory=path.dirname(fileURLToPath(import.meta.url));
const shots=path.join(directory,'shots'),out=path.join(directory,'out'),results=path.join(directory,'results');
const video=process.argv.includes('--video');
for(const folder of [shots,out,results])await mkdir(folder,{recursive:true});
const run=(command,args)=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:directory,stdio:['ignore','ignore','pipe'],windowsHide:true});let errors='';
  child.stderr.on('data',data=>{errors=(errors+data).slice(-5000);});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} (${code}): ${errors}`)));
});
const saveCanvas=async(page,file,type='image/png',quality)=>{
  const url=await page.evaluate(({type,quality})=>document.querySelector('#capture').toDataURL(type,quality),{type,quality});
  await writeFile(file,Buffer.from(url.split(',')[1],'base64'));
};
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,base=`${origin}/experiments/role-script-spike/`;
let browser;
const errors=[],networkFailures=[],requests=[],manifest=[],checks={};
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();
    networkFailures.push({url:url.href,reason:'non-local blocked'});return route.abort();
  });
  context.on('page',page=>{
    page.on('pageerror',error=>errors.push(error.message));
    page.on('requestfailed',request=>networkFailures.push({url:request.url(),error:request.failure()?.errorText}));
    page.on('response',response=>{requests.push({url:response.url().replace(origin,''),status:response.status()});if(response.status()>=400)networkFailures.push({url:response.url(),status:response.status()});});
  });
  const page=await context.newPage();await page.goto(base+'?capture=1');
  await page.waitForFunction(()=>window.roleSpike?.state.ready||window.roleSpike?.error,null,{timeout:120000});
  if(await page.evaluate(()=>window.roleSpike.error))throw new Error(await page.evaluate(()=>window.roleSpike.error));
  const metadata=await page.evaluate(()=>window.roleSpike.metadata());
  await writeFile(path.join(directory,'roles.json'),JSON.stringify(metadata,null,2)+'\n');
  const diagnostics=[];
  for(let sample=0;sample<metadata.length;sample++){
    console.log('CAPTURE',metadata[sample].id,metadata[sample].inference.map(x=>x.role).join(','));
    for(let moment=0;moment<MOMENTS.length;moment++){
      const [seconds,label]=MOMENTS[moment];
      const info=await page.evaluate(a=>window.roleSpike.capture(a.sample,a.seconds),{sample,seconds});
      const file=`${metadata[sample].id}-role-${moment}.png`;await saveCanvas(page,path.join(shots,file));manifest.push({file,label,...info});
      diagnostics.push({sample:metadata[sample].id,...await page.evaluate(a=>window.roleSpike.diagnostic(a.sample,a.seconds),{sample,seconds})});
    }
    await page.evaluate(sample=>window.roleSpike.capture(sample,0,960,'original'),sample);
    await saveCanvas(page,path.join(shots,`${metadata[sample].id}-original.png`));
    // Preserve the old c key times exactly for a same-clock comparison.
    for(const [i,seconds] of [0,60/7,80/7,120/7].entries()){
      await page.evaluate(a=>window.roleSpike.capture(a.sample,a.seconds),{sample,seconds});
      await saveCanvas(page,path.join(shots,`${metadata[sample].id}-same-clock-${i}.png`));
      await page.evaluate(a=>window.roleSpike.capture(a.sample,a.seconds,960,'legacy'),{sample,seconds});
      await saveCanvas(page,path.join(shots,`${metadata[sample].id}-controlled-old-c-${i}.png`));
    }
    if(video&&sample<2){
      const frames=path.join(out,`${metadata[sample].id}-frames`);await mkdir(frames,{recursive:true});
      for(let frame=0;frame<720;frame++){
        await page.evaluate(a=>window.roleSpike.capture(a.sample,a.frame/30,960),{sample,frame});
        await saveCanvas(page,path.join(frames,`${String(frame).padStart(5,'0')}.png`));
        if(frame%180===0)console.log('FRAME',metadata[sample].id,frame,'/720');
      }
      const file=path.join(out,`${metadata[sample].id}-24s.mp4`);
      await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','30','-i',path.join(frames,'%05d.png'),'-frames:v','720','-c:v','libx264','-crf','12','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart',file]);
      console.log('VIDEO',file);
    }
  }
  checks.diagnostics=diagnostics;
  checks.lightnessInsideGamut=diagnostics.every(d=>d.lightnessOut===0);
  // Old renderer and original 8-color decomposition are read unchanged.
  const legacy=await context.newPage();await legacy.goto(`${origin}/experiments/recolor-spike/?capture=1`);
  await legacy.waitForFunction(()=>window.spike?.state.ready||window.spike?.error,null,{timeout:120000});
  if(await legacy.evaluate(()=>window.spike.error))throw new Error(await legacy.evaluate(()=>window.spike.error));
  for(const [sample,id] of [[0,'flat'],[1,'painterly'],[3,'photo']]){
    for(const [i,seconds] of [0,60/7,80/7,120/7].entries()){
      await legacy.evaluate(a=>window.spike.capture(a.sample,2,'c',a.seconds),{sample,seconds});
      await saveCanvas(legacy,path.join(shots,`${id}-old-c-${i}.png`));
    }
  }
  await legacy.close();
  const sheet=await context.newPage();await sheet.goto(base+'index.html?capture=1');
  await sheet.waitForFunction(()=>window.roleSpike?.state.ready||window.roleSpike?.error,null,{timeout:120000});
  async function contact(id,comparison=false,controlled=false){
    const jpeg=await sheet.evaluate(async({base,id,comparison,controlled,moments})=>{
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      const cols=comparison?2:4,cellWidth=1600/cols,cellHeight=cellWidth*2/3,header=80,label=40;
      const rows=comparison?4:2;canvas.width=1600;canvas.height=header+rows*(cellHeight+label);
      ctx.fillStyle='#181818';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#eeeeea';ctx.font='24px "Yu Gothic UI",sans-serif';
      ctx.fillText(id+(comparison?' / 同じ秒数で比較：左 従来の規則 ・右 役割の台本':' / 役割の台本・24秒の8時点'),16,32);
      ctx.font='18px "Yu Gothic UI",sans-serif';
      ctx.fillText(comparison?(controlled?'両列とも同じ16色・同じ固定重み。左20秒、右24秒。各時点の秒数は同じ。':'従来は20秒・8色、今回は24秒・16色。各時点の秒数は同じ。'):'自動推定した役割をそのまま使用。手修正なし。',16,64);
      for(let i=0;i<8;i++){
        const row=Math.floor(i/cols),col=i%cols;
        const file=comparison?`${id}-${col===0?(controlled?'controlled-old-c':'old-c'):'same-clock'}-${row}.png`:`${id}-role-${i}.png`;
        const image=new Image();image.src=base+'shots/'+file;await image.decode();
        const x=col*cellWidth,y=header+row*(cellHeight+label);
        const caption=comparison?`${col===0?'従来 c':'役割'} · ${[0,60/7,80/7,120/7][row].toFixed(3)}秒`:`${moments[i][1]} · ${moments[i][0].toFixed(1)}秒`;
        ctx.fillStyle='#eeeeea';ctx.fillText(caption,x+16,y+28);
        ctx.drawImage(image,x,y+label,cellWidth,cellHeight);
      }
      return canvas.toDataURL('image/jpeg',.86);
    },{base,id,comparison,controlled,moments:MOMENTS});
    const file=path.join(results,`${id}-${controlled?'controlled-comparison':comparison?'comparison':'eight-times'}.jpg`);
    await writeFile(file,Buffer.from(jpeg.split(',')[1],'base64'));
  }
  for(const id of ['flat','painterly','photo']){await contact(id);await contact(id,true);if(id!=='photo')await contact(id,true,true);}
  await sheet.close();await page.close();
  const ui=await context.newPage();await ui.goto(base);await ui.waitForFunction(()=>window.roleSpike?.state.ready,null,{timeout:120000});
  const atLoad=await ui.evaluate(()=>({...window.roleSpike.state,rows:undefined}));
  checks.noAutoplay=!atLoad.playing&&atLoad.seconds===0;
  const select=ui.getByLabel('色 1 の役割',{exact:true});const before=await select.inputValue();
  await select.selectOption(before==='sky'?'light':'sky');
  checks.roleControl=await ui.evaluate(before=>window.roleSpike.state.rows[0].roles[0]!==before,before);
  await ui.getByRole('button',{name:'自動推定に戻す'}).click();
  checks.resetRole=(await select.inputValue())===before;
  await ui.getByRole('button',{name:'色 1 の場所を確認'}).click();
  checks.selection=await ui.evaluate(()=>window.roleSpike.state.selected===0);
  await ui.getByRole('button',{name:'色 1 の場所を確認'}).click();
  await ui.getByRole('button',{name:'再生',exact:true}).click();
  await ui.waitForFunction(()=>window.roleSpike.state.seconds>.15);
  await ui.getByRole('button',{name:'一時停止',exact:true}).click();
  checks.playAdvanced=await ui.evaluate(()=>window.roleSpike.state.seconds>.15&&!window.roleSpike.state.playing);
  await ui.locator('#time').fill('11.4');
  checks.slider=await ui.evaluate(()=>window.roleSpike.state.seconds===11.4);
  await ui.screenshot({path:path.join(shots,'ui-night.png'),fullPage:true});
  await ui.locator('#sample').selectOption('painterly');
  checks.sampleControl=await ui.evaluate(()=>window.roleSpike.state.sample===1);
  await ui.setViewportSize({width:390,height:900});await ui.screenshot({path:path.join(shots,'ui-mobile.png'),fullPage:true});
  checks.mobileOverflow=await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  checks.errors=errors;checks.networkFailures=networkFailures;checks.requests=requests;
  checks.browserVersion=browser.version();checks.playwrightCore='1.61.1';checks.date=new Date().toISOString();
  checks.resultsBytes=(await Promise.all(['flat','painterly','photo'].flatMap(id=>(id==='photo'?['comparison','eight-times']:['comparison','eight-times','controlled-comparison']).map(kind=>stat(path.join(results,`${id}-${kind}.jpg`)))))).reduce((sum,s)=>sum+s.size,0);
  await writeFile(path.join(shots,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(path.join(directory,'checks.json'),JSON.stringify(checks,null,2)+'\n');
  console.log('CHECKS',JSON.stringify({...checks,diagnostics:checks.diagnostics.length,requests:checks.requests.length}));
  if(errors.length||networkFailures.length||checks.mobileOverflow||checks.resultsBytes>6e6||!checks.lightnessInsideGamut||!checks.noAutoplay||!checks.roleControl||!checks.resetRole||!checks.playAdvanced||!checks.slider)throw new Error('Verification failed: inspect checks.json');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
if(video)await run(process.execPath,[path.join(directory,'measure-video.mjs'),path.join(out,'flat-24s.mp4'),path.join(out,'painterly-24s.mp4')]);
