import type { Lab } from '../color';
import {
  type ForegroundData,
  type ForegroundLight,
  type ForegroundSettings,
  foregroundBounds,
} from '../foreground';
import type { Decomposition } from '../palette/types';
import fragment from './fragment.glsl?raw';

const vertex = `#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly info: { renderer: string; version: string };
  private readonly program: WebGLProgram;
  private readonly loc: Record<string, WebGLUniformLocation | null>;
  private textures: WebGLTexture[] = [];
  private source?: Decomposition;
  private foreground?: ForegroundData;
  private foregroundTexture?: WebGLTexture;
  private lost = false;
  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
  };

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl)
      throw new Error(
        'WebGL2 を使用できません。ブラウザのハードウェア アクセラレーションを確認してください。',
      );
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('シェーダを作成できません。');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message ?? 'シェーダのコンパイルに失敗しました。');
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (!program) throw new Error('描画プログラムを作成できません。');
    this.program = program;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(message ?? 'シェーダを連結できません。');
    }
    this.loc = Object.fromEntries(
      [
        'uLab',
        'uW0',
        'uW1',
        'uW2',
        'uW3',
        'uW4',
        'uW5',
        'uW6',
        'uW7',
        'uAlpha',
        'uSource[0]',
        'uPalette[0]',
        'uSelected',
        'uDiagnostic',
        'uSplitAt',
        'uSplitLower',
        'uViewport',
        'uImageSize',
        'uContain',
        'uForeground',
        'uHasForeground',
        'uForegroundBounds',
        'uForegroundK',
        'uForegroundShift',
        'uForegroundBlend',
      ].map((key) => [key, gl.getUniformLocation(program, key)]),
    );
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.info = {
      renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      version: String(gl.getParameter(gl.VERSION)),
    };
    gl.disable(gl.DITHER);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.uploadForeground();
  }
  uploadForeground(data?: ForegroundData): void {
    if (this.foregroundTexture && this.foreground === data) return;
    const gl = this.gl;
    if (this.foregroundTexture) gl.deleteTexture(this.foregroundTexture);
    const texture = gl.createTexture();
    if (!texture) throw new Error('人物用の GPU メモリを確保できません。');
    this.foregroundTexture = texture;
    gl.activeTexture(gl.TEXTURE0 + 10);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      data?.width ?? 1,
      data?.height ?? 1,
      0,
      gl.RGBA,
      gl.FLOAT,
      data?.lab ?? new Float32Array(4),
    );
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook.
    gl.useProgram(this.program);
    gl.uniform1i(this.loc.uForeground, 10);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('人物の GPU 転送に失敗しました。');
    this.foreground = data;
  }
  upload(data: Decomposition): void {
    const gl = this.gl;
    const { width, height, palette } = data.metadata;
    if (
      width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
      height > gl.getParameter(gl.MAX_TEXTURE_SIZE)
    )
      throw new Error('この GPU で扱える画像の大きさを超えています。');
    if (palette.length > 32 || data.weights.length > 8)
      throw new Error('16色の分解データが必要です。');
    for (const texture of this.textures) gl.deleteTexture(texture);
    this.textures = [];
    this.source = undefined;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook.
    gl.useProgram(this.program);
    [
      data.lab,
      ...Array.from({ length: 8 }, (_, i) => data.weights[i] ?? new Float32Array(4)),
      data.alpha,
    ].forEach((array, i) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('画像用の GPU メモリを確保できません。');
      this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        i === 9 ? gl.R8 : gl.RGBA32F,
        array.length === 4 && i > 0 && i < 9 ? 1 : width,
        array.length === 4 && i > 0 && i < 9 ? 1 : height,
        0,
        i === 9 ? gl.RED : gl.RGBA,
        i === 9 ? gl.UNSIGNED_BYTE : gl.FLOAT,
        array,
      );
    });
    ['uLab', 'uW0', 'uW1', 'uW2', 'uW3', 'uW4', 'uW5', 'uW6', 'uW7', 'uAlpha'].forEach((key, i) => {
      gl.uniform1i(this.loc[key], i);
    });
    gl.uniform3fv(
      this.loc['uSource[0]'],
      new Float32Array([...palette.flat(), ...new Array((32 - palette.length) * 3).fill(0)]),
    );
    gl.uniform2f(this.loc.uImageSize, width, height);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('画像の GPU 転送に失敗しました。');
    this.source = data;
  }
  size(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }
  draw(
    palette: Lab[],
    {
      selected = -1,
      diagnostic = false,
      contain = false,
      splitAt = 0,
      splitLower = false,
      foreground,
    }: {
      selected?: number;
      diagnostic?: boolean;
      contain?: boolean;
      splitAt?: number;
      splitLower?: boolean;
      foreground?: ForegroundSettings & { light: ForegroundLight };
    } = {},
  ): void {
    if (this.lost) throw new Error('GPU の接続が失われました。ページを再読み込みしてください。');
    if (!this.source) return;
    const gl = this.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook.
    gl.useProgram(this.program);
    this.textures.forEach((texture, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    });
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform4f(this.loc.uViewport, 0, 0, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.loc.uContain, contain ? 1 : 0);
    gl.uniform1i(this.loc.uSelected, selected);
    gl.uniform1f(this.loc.uSplitAt, splitAt);
    gl.uniform1i(this.loc.uSplitLower, splitLower ? 1 : 0);
    gl.uniform1i(this.loc.uDiagnostic, diagnostic ? 1 : 0);
    const hasForeground = !!foreground && !!this.foreground;
    gl.uniform1i(this.loc.uHasForeground, hasForeground ? 1 : 0);
    if (foreground && this.foreground) {
      gl.activeTexture(gl.TEXTURE0 + 10);
      gl.bindTexture(gl.TEXTURE_2D, this.foregroundTexture ?? null);
      const bounds = foregroundBounds(
        this.foreground,
        this.source.metadata.width / this.source.metadata.height,
        foreground,
      );
      gl.uniform4f(this.loc.uForegroundBounds, bounds.x, bounds.y, bounds.width, bounds.height);
      gl.uniform1f(this.loc.uForegroundK, foreground.light.k);
      gl.uniform2fv(this.loc.uForegroundShift, foreground.light.shift);
      gl.uniform1f(this.loc.uForegroundBlend, foreground.blend);
    }
    gl.uniform3fv(
      this.loc['uPalette[0]'],
      new Float32Array([...palette.flat(), ...new Array((32 - palette.length) * 3).fill(0)]),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  /** Top-down RGBA8, through the real shader including inverse OKLab and gamut mapping. */
  read(): Uint8Array<ArrayBuffer> {
    const { width, height } = this.canvas;
    const raw = new Uint8Array(width * height * 4),
      out = new Uint8Array(raw.length);
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, raw);
    for (let y = 0; y < height; y++)
      out.set(raw.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
    return out;
  }
  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    if (this.foregroundTexture) this.gl.deleteTexture(this.foregroundTexture);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.source = undefined;
  }
}
