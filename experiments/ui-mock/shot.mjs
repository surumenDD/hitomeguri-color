// Screenshots the mock at desktop and phone widths into the folder given as the first argument.
import {chromium} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import {createServer} from '../role-script-spike/server.mjs';
const out=process.argv[2]??'.';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome'});
try{
  for(const [width,height,name] of [[1440,960,'desktop'],[390,844,'mobile']]){
    const page=await browser.newPage({viewport:{width,height}});
    await page.goto(`http://127.0.0.1:${server.address().port}/experiments/ui-mock/`);
    await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);
    await page.screenshot({path:`${out}/mock-${name}.png`,fullPage:name==='mobile'});
  }
}finally{await browser.close();server.close();}
console.log('shots in',out);
