#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uLab;
uniform sampler2D uW0;
uniform sampler2D uW1;
uniform sampler2D uW2;
uniform sampler2D uW3;
uniform sampler2D uW4;
uniform sampler2D uW5;
uniform sampler2D uW6;
uniform sampler2D uW7;
uniform sampler2D uAlpha;
uniform vec3 uSource[32];
uniform vec3 uPalette[32];
uniform int uSelected;
uniform vec2 uDim;
uniform int uDiagnostic;
uniform float uSplitAt;
uniform bool uSplitLower;
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
  vec3 lab=original.xyz;
  vec4 w0=texture(uW0,uv),w1=texture(uW1,uv);
  for(int k=0;k<4;++k)lab+=w0[k]*(uPalette[k]-uSource[k]);
  for(int k=4;k<8;++k)lab+=w1[k-4]*(uPalette[k]-uSource[k]);
  vec4 w2=texture(uW2,uv),w3=texture(uW3,uv);
  for(int k=8;k<12;++k)lab+=w2[k-8]*(uPalette[k]-uSource[k]);
  for(int k=12;k<16;++k)lab+=w3[k-12]*(uPalette[k]-uSource[k]);
  vec4 w4=texture(uW4,uv),w5=texture(uW5,uv),w6=texture(uW6,uv),w7=texture(uW7,uv);
  for(int k=16;k<20;++k)lab+=w4[k-16]*(uPalette[k]-uSource[k]);
  for(int k=20;k<24;++k)lab+=w5[k-20]*(uPalette[k]-uSource[k]);
  for(int k=24;k<28;++k)lab+=w6[k-24]*(uPalette[k]-uSource[k]);
  for(int k=28;k<32;++k)lab+=w7[k-28]*(uPalette[k]-uSource[k]);
  if(uDiagnostic==1){outColor=vec4(float(lab.x<0.||lab.x>1.),float(!inGamut(labToLinear(lab))),0.,1.);return;}
  // Main's M1 fallback: diagnose the raw L above, then bound L before hue/chroma mapping.
  lab.x=clamp(lab.x,0.,1.);
  float kept=1.;
  if(uSelected>=0){
    vec4 ws[8]=vec4[8](w0,w1,w2,w3,w4,w5,w6,w7);
    float selected=ws[uSelected/4][uSelected%4];
    kept=clamp(selected,0.,1.);
  }
  if(uSplitAt>0.&&(uSplitLower?uv.y<uSplitAt:uv.y>uSplitAt))kept=0.;
  // Preview emphasis belongs to OKLab, before gamut mapping, and is omitted from exports.
  lab*=mix(vec3(uDim.x,uDim.y,uDim.y),vec3(1.),kept);
  vec3 linear=gamutMap(lab);
  outColor=vec4(encode(linear.r),encode(linear.g),encode(linear.b),texture(uAlpha,uv).r);
}
