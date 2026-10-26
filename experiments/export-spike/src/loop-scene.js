// The 8-second loop. `renderAt(t)` is a pure function of t: no requestAnimationFrame,
// no clocks, no randomness, so the same t always produces the same pixels.
//
// The look: six soft rounded planes drift around an ellipse while their hue completes
// exactly one turn of OKLCH hue per loop, over a slowly bruising background gradient.
// Colours are interpolated in OKLab by the fragment shader, so the gradients are
// perceptual rather than gamma-space.

export const LOOP_SECONDS = 8;
const TAU = Math.PI * 2;
const PLANES = 6;

const VERT = `#version 300 es
in vec2 aUv;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uAngle;
uniform float uAspect;   // width / height
out vec2 vLocal;
out vec2 vUv;
void main() {
  vec2 local = (aUv * 2.0 - 1.0) * uHalf;
  float c = cos(uAngle);
  float s = sin(uAngle);
  vec2 world = uCenter + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  // Clip space is [-1,1]; the world keeps its aspect by widening x instead.
  gl_Position = vec4(world.x / uAspect, world.y, 0.0, 1.0);
  vLocal = local;
  vUv = aUv;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vUv;
uniform vec3 uLabTL;
uniform vec3 uLabTR;
uniform vec3 uLabBL;
uniform vec3 uLabBR;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uAlpha;
uniform float uAA;
out vec4 outColor;

vec3 labToLinearSrgb(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  // Rounded-box SDF, evaluated in world units so the edge stays round.
  vec2 q = abs(vLocal) - (uHalf - uRadius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float coverage = 1.0 - smoothstep(-uAA, uAA, d);
  if (coverage <= 0.0) discard;
  vec3 lab = mix(mix(uLabTL, uLabTR, vUv.x), mix(uLabBL, uLabBR, vUv.x), vUv.y);
  outColor = vec4(linearToSrgb(labToLinearSrgb(lab)), coverage * uAlpha);
}`;

// OKLCH -> OKLab. The shader needs plain Cartesian Lab, so a/b come out here.
export function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

function background(t) {
  // A slow diagonal wash. L and hue both complete one turn per loop.
  const phase = TAU * (t / LOOP_SECONDS);
  const hue = 30 + 360 * (t / LOOP_SECONDS);
  const l = 0.30 + 0.035 * Math.sin(phase);
  return [
    oklch(l, 0.045, hue + 18),
    oklch(l - 0.05, 0.05, hue + 40),
    oklch(l - 0.12, 0.035, hue + 70),
    oklch(l - 0.09, 0.05, hue + 4),
  ];
}

function plane(t, i) {
  const phase = TAU * (t / LOOP_SECONDS);
  const ring = phase + (TAU * i) / PLANES;
  const hue = 360 * (t / LOOP_SECONDS) + i * (360 / PLANES) * 1.7;
  const L = 0.68 + 0.07 * Math.sin(phase + i * 1.1);
  const C = 0.135 + 0.045 * Math.cos(phase * 2 + i * 0.6);
  const grow = 1 + 0.08 * Math.sin(phase + i);
  const half = [0.30 * grow, 0.215 * (2 - grow)];
  const colors = [
    oklch(L + 0.05, C * 0.85, hue + 26),
    oklch(L - 0.02, C, hue + 8),
    oklch(L - 0.10, C * 1.05, hue - 12),
    oklch(L + 0.01, C * 0.8, hue + 44),
  ];
  return {
    center: [Math.cos(ring) * 0.92, Math.sin(ring) * 0.52],
    half,
    angle: phase + i * 0.9,
    radius: 0.075,
    alpha: 0.9,
    colors,
  };
}

export function createScene(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // VideoFrame / toBlob must see the drawn pixels
  });
  if (!gl) throw new Error('WebGL2 is unavailable in this browser');

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW,
  );
  const aUv = gl.getAttribLocation(program, 'aUv');
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  for (const name of ['uCenter', 'uHalf', 'uAngle', 'uAspect', 'uLabTL', 'uLabTR', 'uLabBL', 'uLabBR', 'uRadius', 'uAlpha', 'uAA']) {
    u[name] = gl.getUniformLocation(program, name);
  }

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);

  const state = { width: 0, height: 0, aspect: 1 };

  function setSize(width, height) {
    state.width = width;
    state.height = height;
    state.aspect = width / height;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    // Only affects the on-screen preview; exports read the backing buffer.
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    gl.viewport(0, 0, width, height);
  }

  function drawQuad({ center, half, angle, radius, alpha, colors }) {
    // World y spans [-1, 1], so one pixel is 2 / height world units.
    const aa = (2 / state.height) * 1.2;
    gl.uniform2f(u.uCenter, center[0], center[1]);
    gl.uniform2f(u.uHalf, half[0], half[1]);
    gl.uniform1f(u.uAngle, angle);
    gl.uniform1f(u.uAspect, state.aspect);
    gl.uniform3fv(u.uLabTL, colors[0]);
    gl.uniform3fv(u.uLabTR, colors[1]);
    gl.uniform3fv(u.uLabBL, colors[2]);
    gl.uniform3fv(u.uLabBR, colors[3]);
    gl.uniform1f(u.uRadius, radius);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uAA, aa);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderAt(t) {
    const tt = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pad = 1.02;
    drawQuad({
      center: [0, 0],
      half: [state.aspect * pad, pad],
      angle: 0,
      radius: 0,
      alpha: 1,
      colors: background(tt),
    });
    for (let i = 0; i < PLANES; i++) drawQuad(plane(tt, i));
    return tt;
  }

  // FNV-1a over the RGBA backbuffer: a cheap way to prove two renders are identical.
  function hashFrame() {
    const px = new Uint8Array(state.width * state.height * 4);
    gl.readPixels(0, 0, state.width, state.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let h = 0x811c9dc5;
    for (let i = 0; i < px.length; i++) {
      h ^= px[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  setSize(canvas.width || 1280, canvas.height || 720);
  return { gl, renderAt, setSize, hashFrame, state };
}
