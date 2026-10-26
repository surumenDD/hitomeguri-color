import {spawn,spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const directory=path.dirname(fileURLToPath(import.meta.url));
const decode=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const lut=Float64Array.from({length:256},(_,i)=>decode(i/255));
export async function analyzeVideo(file){
  const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,nb_frames,duration','-of','json',file],{encoding:'utf8',windowsHide:true});
  if(probe.status!==0)throw new Error(probe.stderr||'ffprobe failed');
  const stream=JSON.parse(probe.stdout).streams[0];
  const size=stream.width*stream.height,frameBytes=size*3,frameBuffer=Buffer.alloc(frameBytes);
  let offset=0,frames=0,previous=null,first=null,previousAverage=0,firstAverage=0;
  const pairs=[];
  const consume=(current,average,seam=false)=>{
    let difference=0,maxPixel=0,area=0;
    for(let i=0;i<size;i++){
      const d=Math.abs(current[i]-previous[i]);difference+=d;maxPixel=Math.max(maxPixel,d);if(d>=.10)area++;
    }
    pairs.push({frame:frames,seam,average,averageStep:Math.abs(average-previousAverage),meanAbsolutePixelStep:difference/size,maxPixelStep:maxPixel,areaOverPointOne:area/size});
  };
  const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let errors='';child.stderr.on('data',data=>{errors+=data;});
  const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(errors)));});
  for await(const chunk of child.stdout){
    let source=0;
    while(source<chunk.length){
      const bytes=Math.min(frameBytes-offset,chunk.length-source);
      chunk.copy(frameBuffer,offset,source,source+bytes);offset+=bytes;source+=bytes;
      if(offset===frameBytes){
        const current=new Float32Array(size);let sum=0;
        for(let i=0,p=0;i<size;i++,p+=3){const luminance=.2126*lut[frameBuffer[p]]+.7152*lut[frameBuffer[p+1]]+.0722*lut[frameBuffer[p+2]];current[i]=luminance;sum+=luminance;}
        const average=sum/size;
        if(previous)consume(current,average);else{first=current;firstAverage=average;}
        previous=current;previousAverage=average;frames++;offset=0;
        if(frames%240===0)console.log('ANALYZE',path.basename(file),frames);
      }
    }
  }
  await completion;if(offset||frames!==720)throw new Error(`Unexpected frame count ${frames} or partial frame ${offset}`);
  consume(first,firstAverage,true);
  const max=(key)=>Math.max(...pairs.map(p=>p[key]));
  const result={file:path.relative(directory,file).replaceAll('\\','/'),stream,decodedFrames:frames,framePairs:pairs.length,includesLoopSeam:true,
    units:'relative linear-sRGB luminance, 0 to 1; decoded MP4, every pixel',
    meanBrightnessMaxStep:max('averageStep'),meanAbsolutePixelMaxStep:max('meanAbsolutePixelStep'),maxSinglePixelStep:max('maxPixelStep'),maxAreaWithStepAtLeastPointOne:max('areaOverPointOne'),
    criterion:{meanBrightnessMaxStep:.02,meanAbsolutePixelMaxStep:.03},
    passed:max('averageStep')<.02&&max('meanAbsolutePixelStep')<.03,
    limitation:'This continuity test is not ITU/WCAG flash certification; display luminance and saturated-red flash counting are not measured.',pairs};
  console.log('VIDEO_CHECK',JSON.stringify({...result,pairs:result.pairs.length}));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const files=process.argv.slice(2);if(!files.length)throw new Error('Specify MP4 files');
  const results=[];for(const file of files)results.push(await analyzeVideo(path.resolve(file)));
  await writeFile(path.join(directory,'video-checks.json'),JSON.stringify({date:new Date().toISOString(),results},null,2)+'\n');
  if(results.some(result=>!result.passed))process.exitCode=1;
}
