// Renders one moment of a sample at full width with the spike engine (v4.2 defaults).
// Usage: node render-frame.mjs <sampleId> <seconds> <out.png> [width]
import {chromium} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import {writeFile} from 'node:fs/promises';
import {createServer} from '../role-script-spike/server.mjs';
const [id,seconds,out,width='1536']=process.argv.slice(2);
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/experiments/role-script-spike/?capture=1`);
  await page.waitForFunction(()=>window.roleSpike?.state.ready,null,{timeout:180000});
  const index=await page.evaluate(id=>window.roleSpike.metadata().findIndex(m=>m.id===id),id);
  await page.evaluate(a=>window.roleSpike.capture(a.index,a.seconds,a.width),{index,seconds:+seconds,width:+width});
  const url=await page.evaluate(()=>document.querySelector('#capture').toDataURL('image/png'));
  await writeFile(out,Buffer.from(url.split(',')[1],'base64'));console.log('WROTE',out);
}finally{await browser.close();server.close();}
