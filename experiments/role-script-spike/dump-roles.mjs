// Writes roles-all.json: the extracted palette, measurements and inferred role of every sample.
import {chromium} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from './server.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/experiments/role-script-spike/?capture=1`);
  await page.waitForFunction(()=>window.roleSpike?.state.ready||window.roleSpike?.error,null,{timeout:180000});
  const metadata=await page.evaluate(()=>window.roleSpike.metadata());
  await writeFile(path.join(directory,'roles-all.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log('WROTE roles-all.json',metadata.map(m=>m.id).join(','));
}finally{await browser.close();server.close();}
