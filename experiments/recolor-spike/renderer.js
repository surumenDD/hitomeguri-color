import {K} from './color.js';

const vertex=`#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const fragment=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uLab;
uniform sampler2D uW0;
uniform sampler2D uW1;
uniform vec3 uSource[8];
uniform vec3 uPalette[8];
uniform int uMode;
uniform int uDiagnostic;
uniform vec4 uViewport;
uniform vec2 uImageSize;
uniform bool uContain;
out vec4 outColor;
vec3 labToLinear(vec3 p){
  float l=p.x+.3963377774*p.y+.2158037573*p.z;
  float m=p.x-.1055613458*p.y-.0638541728*p.z;
  float s=p.x-.0894841775*p.y-1.291485548*p.z;
  l=l*l*l;m=m*m*m;s=s*s*s;
  return vec3(4.0767416621*l-3.3077115913*m+.2309699292*s,
    -1.2684380046*l+2.6097574011*m-.3413193965*s,
    -.0041960863*l-.7034186147*m+1.707614701*s);
}
bool inGamut(vec3 rgb){return all(greaterThanEqual(rgb,vec3(-.000001)))&&all(lessThanEqual(rgb,vec3(1.000001)));}
vec3 gamutMap(vec3 p){
  vec3 rgb=labToLinear(p); if(inGamut(rgb))return rgb;
  float lo=0.,hi=1.;
  for(int i=0;i<18;++i){float mid=(lo+hi)*.5;if(inGamut(labToLinear(vec3(p.x,p.yz*mid))))lo=mid;else hi=mid;}
  return labToLinear(vec3(p.x,p.yz*lo));
}
float encode(float c){return c<=.0031308?12.92*c:1.055*pow(max(0.,c),1./2.4)-.055;}
void main(){
  vec2 uv=(gl_FragCoord.xy-uViewport.xy)/uViewport.zw;
  uv.y=1.-uv.y;
  if(uContain){
    float imageAspect=uImageSize.x/uImageSize.y,viewAspect=uViewport.z/uViewport.w;
    if(imageAspect>viewAspect)uv.y=(uv.y-.5)*(imageAspect/viewAspect)+.5;
    else uv.x=(uv.x-.5)*(viewAspect/imageAspect)+.5;
    if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){outColor=vec4(vec3(.094),1.);return;}
  }
  vec4 original=texture(uLab,uv);
  int index=int(original.w+.5);
  vec3 lab=original.xyz;
  if(uMode==0)lab=uPalette[index];
  if(uMode==1)lab+=uPalette[index]-uSource[index];
  if(uMode==2){
    vec4 w0=texture(uW0,uv),w1=texture(uW1,uv);
    for(int k=0;k<4;++k)lab+=w0[k]*(uPalette[k]-uSource[k]);
    for(int k=4;k<8;++k)lab+=w1[k-4]*(uPalette[k]-uSource[k]);
  }
  if(uDiagnostic==1){outColor=vec4(float(lab.x<0.||lab.x>1.),float(!inGamut(labToLinear(lab))),0.,1.);return;}
  // With L outside [0,1] no hue/chroma-only mapping exists. Diagnostics expose it.
  // The supplied script is checked to avoid this condition on all four images.
  vec3 linear=gamutMap(lab);
  outColor=vec4(encode(linear.r),encode(linear.g),encode(linear.b),1.);
}`;

export class Renderer {
  constructor(canvas){
    this.canvas=canvas;
    const gl=this.gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
    if(!gl)throw new Error('WebGL2 を使用できません。ブラウザのハードウェア アクセラレーションを確認してください。');
    const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(this.program);
    this.loc=Object.fromEntries(['uLab','uW0','uW1','uSource[0]','uPalette[0]','uMode','uDiagnostic','uViewport','uImageSize','uContain'].map(k=>[k,gl.getUniformLocation(this.program,k)]));
    this.timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    this.info={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION),timerQuery:!!this.timer};
    this.textures=[];
    gl.disable(gl.DITHER);gl.disable(gl.BLEND);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;});
  }
  upload(data){
    const gl=this.gl;for(const texture of this.textures)gl.deleteTexture(texture);this.textures=[];
    this.data=data;
    [data.lab,data.weights0,data.weights1].forEach((array,i)=>{
      const texture=gl.createTexture();this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,data.metadata.width,data.metadata.height,0,gl.RGBA,gl.FLOAT,array);
    });
    gl.uniform1i(this.loc.uLab,0);gl.uniform1i(this.loc.uW0,1);gl.uniform1i(this.loc.uW1,2);
    gl.uniform2f(this.loc.uImageSize,data.metadata.width,data.metadata.height);
    gl.uniform3fv(this.loc['uSource[0]'],new Float32Array(data.metadata.palette.flat()));
    if(gl.getError()!==gl.NO_ERROR)throw new Error('画像の GPU 転送に失敗しました。');
  }
  size(width,height){
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
  }
  draw(mode,palette,{viewport=[0,0,this.canvas.width,this.canvas.height],contain=false,diagnostic=0}={}){
    if(this.lost)throw new Error('WebGL context lost');
    const gl=this.gl;
    gl.useProgram(this.program);gl.viewport(...viewport);
    gl.uniform4f(this.loc.uViewport,...viewport);
    gl.uniform1i(this.loc.uMode,mode);gl.uniform1i(this.loc.uContain,contain?1:0);gl.uniform1i(this.loc.uDiagnostic,diagnostic);
    gl.uniform3fv(this.loc['uPalette[0]'],new Float32Array(palette.flat()));
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  read(){
    const out=new Uint8Array(this.canvas.width*this.canvas.height*4);
    this.gl.readPixels(0,0,this.canvas.width,this.canvas.height,this.gl.RGBA,this.gl.UNSIGNED_BYTE,out);return out;
  }
  dispose(){for(const t of this.textures)this.gl.deleteTexture(t);this.gl.deleteProgram(this.program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}

export async function benchmark(renderer,mode,palettes){
  renderer.size(1920,1080);
  const gl=renderer.gl,ext=renderer.timer, queries=[], wall=[];
  const pixel=new Uint8Array(4);
  for(let i=0;i<12;i++)renderer.draw(mode,palettes[i%palettes.length]);
  gl.finish();
  for(let i=0;i<31;i++){
    const query=ext?gl.createQuery():null;
    const start=performance.now();
    if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
    renderer.draw(mode,palettes[i%palettes.length]);
    if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(query);}
    gl.finish();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    wall.push(performance.now()-start);
    if(i%5===0)await new Promise(r=>setTimeout(r,0));
  }
  const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
  let gpu=[];
  if(ext){
    const deadline=performance.now()+10000;
    while(!gl.getQueryParameter(queries.at(-1),gl.QUERY_RESULT_AVAILABLE)&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));
    if(!gl.getParameter(ext.GPU_DISJOINT_EXT)&&queries.every(q=>gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)))gpu=queries.map(q=>gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
    queries.forEach(q=>gl.deleteQuery(q));
  }
  return {resolution:[1920,1080],samples:31,warmup:12,gpuMedianMs:gpu.length?median(gpu):null,
    wallMedianMs:median(wall),wallMaxMs:Math.max(...wall),kind:gpu.length?'GPU timer query':'synchronous wall time',gpuSamplesMs:gpu,wallSamplesMs:wall};
}
