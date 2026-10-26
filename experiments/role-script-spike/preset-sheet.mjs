// Renders 8 evenly spaced moments of each preset and tiles them into results/preset-<id>-<sample>.jpg.
// Usage: node experiments/role-script-spike/preset-sheet.mjs [presetId ...] [--override '{"nightDepth":1.3}']
import {chromium} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from './server.mjs';
import {PRESETS} from './script.js';

const directory=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),flag=args.indexOf('--override');
const overrides=flag>=0?JSON.parse(args[flag+1]):{};
const tag=flag>=0?'-'+Object.entries(overrides).map(([k,v])=>`${k}${v}`).join('-'):'';
const ids=args.filter((a,i)=>!a.startsWith('--')&&(flag<0||i!==flag+1));
const presets=ids.length?ids:Object.keys(PRESETS);
const run=(command,argv)=>new Promise((resolve,reject)=>{
  const child=spawn(command,argv,{cwd:directory,stdio:['ignore','ignore','pipe'],windowsHide:true});let errors='';
  child.stderr.on('data',d=>{errors=(errors+d).slice(-3000);});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(errors)));
});
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/experiments/role-script-spike/?capture=1`;
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.goto(base);
  await page.waitForFunction(()=>window.roleSpike?.state.ready||window.roleSpike?.error,null,{timeout:120000});
  const samples=await page.evaluate(()=>window.roleSpike.metadata().map(m=>m.id));
  for(const id of presets){
    const preset=await page.evaluate(a=>window.roleSpike.setPreset(a.id,a.overrides),{id,overrides});
    for(const [index,sample] of samples.entries()){
      if(sample==='photo')continue;
      const folder=path.join(directory,'shots','presets',id+tag,sample);await mkdir(folder,{recursive:true});
      for(let i=0;i<8;i++){
        const seconds=i*preset.durationSec/8;
        await page.evaluate(a=>window.roleSpike.capture(a.index,a.seconds),{index,seconds});
        const url=await page.evaluate(()=>document.querySelector('#capture').toDataURL('image/png'));
        await writeFile(path.join(folder,`${i}.png`),Buffer.from(url.split(',')[1],'base64'));
      }
      const out=path.join(directory,'results',`preset-${id}${tag}-${sample}.jpg`);
      await run('ffmpeg',['-loglevel','error','-y','-framerate','1','-i',path.join(folder,'%d.png'),
        '-vf','tile=4x2:padding=4:color=0x181818,scale=1600:-1','-frames:v','1','-q:v','4',out]);
      console.log('SHEET',out,`${preset.name} ${preset.durationSec}s nightDepth=${preset.nightDepth} glow=${preset.glow}`);
    }
  }
}finally{await browser.close();server.close();}
