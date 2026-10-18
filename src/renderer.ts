import { invert3, isConvex, squareToQuad, toColumnMajor } from './geometry';
import { mediaSize, type MediaLibrary } from './media';
import { FRAG, VERT } from './shaders';
import { effectIndex, surfacePoints, type Scene } from './state';

export interface RenderOptions {
  time: number;
  master: number;
  blackout: boolean;
  calibration: boolean;
}

const UNIFORMS = [
  'uHinv', 'uRes', 'uTime', 'uSpeed', 'uScale', 'uDelay', 'uOpacity', 'uFeather', 'uAspect',
  'uTexAspect', 'uMaster', 'uEffect', 'uRot', 'uFlip', 'uFit', 'uHasTex', 'uC1', 'uC2', 'uTex',
] as const;

type UniformMap = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private u: UniformMap;
  private vbo: WebGLBuffer;
  private textures = new Map<string, { tex: WebGLTexture; uploaded: boolean }>();

  constructor(private canvas: HTMLCanvasElement, private media: MediaLibrary) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: false });
    if (!gl) throw new Error('WebGL2 non disponibile in questo browser.');
    this.gl = gl;

    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);

    this.u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)])) as UniformMap;

    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.u.uTex, 0);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private textureFor(id: string): WebGLTexture | null {
    const item = this.media.get(id);
    if (!item) return null;
    const { w, h } = mediaSize(item.el);
    if (!w || !h) return null;

    const gl = this.gl;
    let entry = this.textures.get(id);
    if (!entry) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex, uploaded: false };
      this.textures.set(id, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    // I video vanno ricaricati a ogni frame, le immagini una volta sola
    if (!entry.uploaded || item.el instanceof HTMLVideoElement) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, item.el);
      entry.uploaded = true;
    }
    return entry.tex;
  }

  render(scene: Scene, o: RenderOptions): void {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (o.blackout) return;

    gl.uniform2f(this.u.uRes, W, H);
    gl.uniform1f(this.u.uTime, o.time);
    gl.uniform1f(this.u.uMaster, o.master);

    for (const s of scene.surfaces) {
      if (!s.visible) continue;
      const px = surfacePoints(scene, s).map((p) => ({ x: p.x * W, y: p.y * H }));
      if (!isConvex(px)) continue;
      const inv = invert3(squareToQuad(px));
      if (!inv) continue;

      const clip = px.map((p) => [(p.x / W) * 2 - 1, 1 - (p.y / H) * 2]);
      const verts = new Float32Array([...clip[0], ...clip[1], ...clip[2], ...clip[0], ...clip[2], ...clip[3]]);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);

      const c = s.content;
      if (c.effect === 'youtube' && !o.calibration) continue;
      const effect = o.calibration ? 0 : effectIndex(c.effect);
      let hasTex = 0, texAspect = 1;
      if (effect === effectIndex('media') && c.mediaId) {
        const tex = this.textureFor(c.mediaId);
        const item = this.media.get(c.mediaId);
        if (tex && item) {
          const { w, h } = mediaSize(item.el);
          hasTex = 1;
          texAspect = w / h;
        }
      }

      gl.uniformMatrix3fv(this.u.uHinv, false, toColumnMajor(inv));
      gl.uniform1i(this.u.uEffect, effect);
      gl.uniform1f(this.u.uSpeed, c.speed);
      gl.uniform1f(this.u.uScale, Math.max(c.scale, 0.05));
      gl.uniform1f(this.u.uDelay, c.delay);
      gl.uniform1f(this.u.uOpacity, s.opacity);
      gl.uniform1f(this.u.uFeather, s.feather);
      gl.uniform1f(this.u.uAspect, Math.max(s.aspect, 0.05));
      gl.uniform1f(this.u.uTexAspect, texAspect);
      gl.uniform1i(this.u.uRot, c.rot);
      gl.uniform1i(this.u.uFlip, c.flip ? 1 : 0);
      gl.uniform1i(this.u.uFit, c.fit === 'cover' ? 0 : 1);
      gl.uniform1i(this.u.uHasTex, hasTex);
      gl.uniform3fv(this.u.uC1, hexToRgb(c.c1));
      gl.uniform3fv(this.u.uC2, hexToRgb(c.c2));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  /** Libera le texture dei media non più presenti. */
  prune(): void {
    for (const [id, e] of this.textures) {
      if (!this.media.get(id)) {
        this.gl.deleteTexture(e.tex);
        this.textures.delete(id);
      }
    }
  }
}
