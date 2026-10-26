import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {methods,methodNames} from './weights.js';

const dir=path.dirname(fileURLToPath(import.meta.url));
const data=JSON.parse(await readFile(path.join(dir,'metrics.json'),'utf8'));
const checks=JSON.parse(await readFile(path.join(dir,'checks.json'),'utf8'));
const fmt=(v,n=3)=>v===null?'—':Number(v).toFixed(n);
const name=method=>methodNames[methods.indexOf(method)];
let output=`実測: ${data.environment.date}、Windows / Chrome ${data.environment.browserVersion}、DPR ${data.environment.dpr}、論理CPU ${data.environment.hardwareConcurrency}。CPUによる原寸の計測。\n\n`;
for(const image of data.images){
  output+=`### ${image.id}（${image.width} × ${image.height}）\n\n`;
  output+='| 候補 | 試験 | 到達 % | 漏れ ×10⁻³ | 斑点 ×10⁻³ | 斑点/到達移動量 | 再現PSNR dB | L範囲外 画素 |\n|---|---|---:|---:|---:|---:|---:|---:|\n';
  for(const method of methods)for(const test of ['b','d','e']){
    const r=data.results.find(r=>r.image===image.id&&r.method===method&&r.test===test);
    const a=data.results.find(r=>r.image===image.id&&r.method===method&&r.test==='a');
    if(!r||!a)throw new Error(`Missing ${image.id}/${method}/${test}`);
    output+=`| ${name(method)} | ${test} | ${fmt(r.reach*100,2)} | ${fmt(r.leakage*1000)} | ${fmt(r.speckle*1000)} | ${fmt(r.specklePerReachedDelta)} | ${a.psnrDb==='Infinity'?'∞':fmt(a.psnrDb)} | ${r.lightnessOutPixels} |\n`;
  }
  output+=`\n一覧: [b](results/${image.id}-b.jpg)、[d](results/${image.id}-d.jpg)、[e](results/${image.id}-e.jpg)。eの番号は${image.common.k}。\n\n`;
}
output+='### e の空・海を分けた結果（平らな色面）\n\n';
output+='| 候補 | 空の到達 % | 海の到達 % | 空の画素数 | 海の画素数 |\n|---|---:|---:|---:|---:|\n';
for(const method of methods){
  const r=data.results.find(r=>r.image==='flat'&&r.method===method&&r.test==='e');
  output+=`| ${name(method)} | ${fmt(r.region.sky.reach*100,2)} | ${fmt(r.region.sea.reach*100,2)} | ${r.region.sky.count} | ${r.region.sea.count} |\n`;
}
output+='\n### 補間と前処理\n\n';
output+='前処理msは共通の色変換・k-means・番号割当てを除く重みの計算。GPU描画時間と比較しない。補間誤差は元のパレット点での `max|w_k(P_j)-1[k=j]|`。\n\n';
output+='| 画像 | 候補 | 重み計算 ms | 補間誤差 | 重みの総和誤差 最大 |\n|---|---|---:|---:|---:|\n';
for(const image of data.images)for(const candidate of image.candidates){
  output+=`| ${image.id} | ${name(candidate.method)} | ${fmt(candidate.timingMs,1)} | ${candidate.cardinalError.toExponential(2)} | ${candidate.sumError.toExponential(2)} |\n`;
}
const jpegFiles=(await readdir(path.join(dir,'results'))).filter(f=>f.endsWith('.jpg'));
let bytes=0;for(const f of jpegFiles)bytes+=(await stat(path.join(dir,'results',f))).size;
output+=`\n再現は全${data.results.filter(r=>r.test==='a').length}組でRGB誤差0。固定重みの不変=${checks.storedWeightsUnchanged}、行列の検査=${checks.matrixSolve}、外部リクエスト=${checks.externalRequests.length}、ブラウザエラー=${checks.errors.length}、撮影=${checks.captures}/${checks.expectedCaptures}。JPEGは${jpegFiles.length}枚、合計${bytes.toLocaleString('en-US')}バイト（${fmt(bytes/1e6,2)}MB）。L範囲外0の全条件成立=${checks.allLightnessInRange}で、失敗条件は上表に残した。\n`;
const notesPath=path.join(dir,'NOTES.md');
const notes=await readFile(notesPath,'utf8');
await writeFile(notesPath,notes.replace(/<!-- METRICS_START -->[\s\S]*?<!-- METRICS_END -->/,'<!-- METRICS_START -->\n'+output+'<!-- METRICS_END -->'),'utf8');
console.log(`Updated NOTES.md: ${data.results.length} measurements, ${bytes} JPEG bytes`);
