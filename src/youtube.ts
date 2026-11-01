import { applyH, invert3, squareToQuad, surfaceMapping, type Vec2 } from './geometry';
import { shapeOutline, surfacePoints, type Scene, type Surface } from './state';

/** Estrae l'ID (11 caratteri) e l'eventuale secondo di inizio da un link YouTube. */
export function parseYouTube(input: string): { id: string; start: number } | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return { id: s, start: 0 };
  let url: URL;
  try {
    url = new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null;
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;

  // t=90, t=90s, t=1m30s
  const t = url.searchParams.get('t') ?? url.searchParams.get('start') ?? '';
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = m ? (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) : 0;
  return { id, start };
}

function embedUrl(id: string, start: number): string {
  const p = new URLSearchParams({
    autoplay: '1', mute: '1', loop: '1', playlist: id, controls: '0', rel: '0',
    iv_load_policy: '3', disablekb: '1', playsinline: '1', enablejsapi: '1',
    origin: location.origin,
  });
  if (start) p.set('start', String(start));
  return `https://www.youtube-nocookie.com/embed/${id}?${p}`;
}

// Dimensione "nativa" del player prima della deformazione
const VW = 1280, VH = 720;
const FLIP = [1, 0, 3, 2];

interface Entry {
  wrap: HTMLDivElement;
  frame: HTMLIFrameElement;
  src: string;
  audio: boolean | null;
}

export interface YouTubeOptions {
  master: number;
  blackout: boolean;
  calibration: boolean;
}

/**
 * I player YouTube non si possono usare come texture WebGL (iframe di un altro dominio),
 * quindi vengono messi nel DOM sopra il canvas e deformati con una trasformazione CSS
 * matrix3d ricavata dalla stessa omografia usata dallo shader.
 */
export class YouTubeLayer {
  private entries = new Map<string, Entry>();

  constructor(private root: HTMLElement) {}

  update(scene: Scene, o: YouTubeOptions): void {
    const W = this.root.clientWidth, H = this.root.clientHeight;
    const active = new Set<string>();
    this.root.style.display = o.blackout || o.calibration ? 'none' : '';
    this.root.style.filter = o.master < 1 ? `brightness(${o.master})` : '';

    scene.surfaces.forEach((s, z) => {
      const c = s.content;
      const yt = c.effect === 'youtube' && c.youtubeUrl ? parseYouTube(c.youtubeUrl) : null;
      if (!yt) return;
      active.add(s.id);
      const e = this.entry(s.id, embedUrl(yt.id, yt.start));
      this.place(e, scene, s, W, H);
      e.wrap.style.zIndex = String(z);
      e.wrap.style.opacity = String(s.opacity);
      if (e.audio !== c.audio) this.setAudio(e, c.audio);
    });

    for (const [id, e] of this.entries) {
      if (!active.has(id)) {
        e.wrap.remove();
        this.entries.delete(id);
      }
    }
  }

  private entry(id: string, src: string): Entry {
    let e = this.entries.get(id);
    if (e && e.src !== src) {
      e.wrap.remove();
      e = undefined;
    }
    if (!e) {
      const wrap = document.createElement('div');
      wrap.className = 'yt-face';
      const frame = document.createElement('iframe');
      frame.src = src;
      frame.allow = 'autoplay; encrypted-media';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.width = String(VW);
      frame.height = String(VH);
      wrap.append(frame);
      this.root.append(wrap);
      const entry: Entry = { wrap, frame, src, audio: null };
      // Il player accetta comandi solo dopo il caricamento
      frame.addEventListener('load', () => {
        const want = entry.audio;
        entry.audio = null;
        if (want !== null) this.setAudio(entry, want);
      });
      e = entry;
      this.entries.set(id, e);
    }
    return e;
  }

  private setAudio(e: Entry, on: boolean): void {
    e.audio = on;
    const send = (func: string) =>
      e.frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
    send(on ? 'unMute' : 'mute');
    send('playVideo');
  }

  private place(e: Entry, scene: Scene, s: Surface, W: number, H: number): void {
    const c = s.content;
    const poly = surfacePoints(scene, s).map((p) => ({ x: p.x * W, y: p.y * H }));
    if (!s.visible || !surfaceMapping(poly, s.corners)) {
      e.wrap.style.visibility = 'hidden';
      return;
    }
    e.wrap.style.visibility = '';
    const face = s.corners.map((i) => poly[i]);

    // Stessa rotazione/specchiatura dello shader: si permutano gli angoli della faccia
    const pts: Vec2[] = [0, 1, 2, 3].map((i) => {
      const k = (i + c.rot) % 4;
      return face[c.flip ? FLIP[k] : k];
    });

    // Il contenitore ha le proporzioni reali della faccia
    const asp = c.rot % 2 ? 1 / s.aspect : s.aspect;
    const ww = VH * asp, wh = VH;
    e.wrap.style.width = `${ww}px`;
    e.wrap.style.height = `${wh}px`;

    const sx = c.fit === 'cover' ? Math.max(ww / VW, wh / VH) : ww / VW;
    const sy = c.fit === 'cover' ? sx : wh / VH;
    e.frame.style.transform = `translate(${(ww - VW * sx) / 2}px, ${(wh - VH * sy) / 2}px) scale(${sx}, ${sy})`;

    // Omografia dal rettangolo ww×wh al quadrilatero sullo schermo
    const m = squareToQuad(pts);
    const [a, b, cc, d, ee, f, g, hh, i] = [m[0] / ww, m[1] / wh, m[2], m[3] / ww, m[4] / wh, m[5], m[6] / ww, m[7] / wh, m[8]];
    e.wrap.style.transform = `matrix3d(${a},${d},0,${g},${b},${ee},0,${hh},0,0,1,0,${cc},${f},0,${i})`;

    // Forma o vertici aggiuntivi ritagliano il player (nelle coordinate del contenitore).
    // La forma è in coordinate della faccia: si porta sullo schermo e poi nel contenitore ruotato.
    const shape = shapeOutline(s);
    const faceH = squareToQuad(face);
    const clip = shape ? shape.map((q) => applyH(faceH, q.x, q.y)) : poly.length > 4 ? poly : null;
    const mi = clip ? invert3(m) : null;
    e.wrap.style.clipPath = clip && mi
      ? `polygon(${clip.map((p) => { const q = applyH(mi, p.x, p.y); return `${q.x * ww}px ${q.y * wh}px`; }).join(',')})`
      : '';
  }
}
