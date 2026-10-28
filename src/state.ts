import type { Vec2 } from './geometry';

/** L'ordine conta: l'indice è il valore di uEffect nello shader. */
export const EFFECTS = [
  { id: 'grid', label: 'Griglia di calibrazione' },
  { id: 'solid', label: 'Colore pieno' },
  { id: 'gradient', label: 'Gradiente animato' },
  { id: 'stripes', label: 'Strisce in movimento' },
  { id: 'checker', label: 'Scacchiera' },
  { id: 'plasma', label: 'Plasma' },
  { id: 'edges', label: 'Bordi al neon' },
  { id: 'scan', label: 'Scansione' },
  { id: 'rings', label: 'Cerchi concentrici' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'liquid', label: 'Riempimento liquido' },
  { id: 'tunnel', label: 'Tunnel (scatola cava)' },
  { id: 'media', label: 'Immagine / video' },
  { id: 'strobe', label: 'Strobo' },
  { id: 'youtube', label: 'Video YouTube' },
] as const;

export type EffectId = (typeof EFFECTS)[number]['id'];

export function effectIndex(id: EffectId): number {
  return EFFECTS.findIndex((e) => e.id === id);
}

export interface Content {
  effect: EffectId;
  c1: string;
  c2: string;
  speed: number;
  scale: number;
  /** Secondi di ritardo: con valori diversi per faccia gli effetti "si inseguono". */
  delay: number;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
  fit: 'cover' | 'stretch';
  mediaId: string | null;
  mediaName: string | null;
  youtubeUrl: string | null;
  /** Audio del video YouTube (di default muto, necessario per l'autoplay). */
  audio: boolean;
}

export interface Surface {
  id: string;
  name: string;
  /** ID dei vertici del contorno, in ordine lungo il bordo. */
  v: string[];
  /**
   * Indici in `v` dei 4 angoli che definiscono la prospettiva: alto-sx, alto-dx,
   * basso-dx, basso-sx. Gli altri vertici modellano solo il contorno.
   */
  corners: [number, number, number, number];
  visible: boolean;
  opacity: number;
  feather: number;
  /** Rapporto larghezza/altezza reale della faccia fisica (1 per un cubo). */
  aspect: number;
  content: Content;
}

export interface Scene {
  version: 1;
  /** Coordinate normalizzate 0..1 rispetto all'area di proiezione. */
  vertices: Record<string, Vec2>;
  surfaces: Surface[];
}

/** Limite di vertici per superficie (dimensione dell'array uniform nello shader). */
export const MAX_VERTICES = 32;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultContent(over: Partial<Content> = {}): Content {
  return {
    effect: 'grid', c1: '#00e5ff', c2: '#ff2bd6', speed: 1, scale: 1, delay: 0,
    rot: 0, flip: false, fit: 'cover', mediaId: null, mediaName: null,
    youtubeUrl: null, audio: false, ...over,
  };
}

function makeSurface(name: string, v: Surface['v'], content: Partial<Content>): Surface {
  return { id: uid(), name, v, corners: [0, 1, 2, 3], visible: true, opacity: 1, feather: 0, aspect: 1, content: defaultContent(content) };
}

export function emptyScene(): Scene {
  return { version: 1, vertices: {}, surfaces: [] };
}

/** Aggiunge un quadrilatero indipendente centrato in c (coordinate normalizzate). */
export function addQuad(scene: Scene, c: Vec2, screenAspect: number): Surface {
  const hy = 0.15, hx = hy / screenAspect;
  const ids = [uid(), uid(), uid(), uid()] as Surface['v'];
  const pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  ids.forEach((id, i) => (scene.vertices[id] = { x: c.x + pts[i][0], y: c.y + pts[i][1] }));
  const s = makeSurface(`Superficie ${scene.surfaces.length + 1}`, ids, {});
  scene.surfaces.push(s);
  return s;
}

/**
 * Cubo visto a 3/4: esagono con vertice centrale condiviso, 3 facce visibili.
 * I vertici sono condivisi: spostando uno spigolo si aggiornano tutte le facce adiacenti.
 */
export function addCube(scene: Scene, screenAspect: number): Surface[] {
  const k = 1 / screenAspect;
  const C = { x: 0.5, y: 0.52 };
  const at = (dx: number, dy: number) => ({ x: C.x + dx * k, y: C.y + dy });
  const V = {
    T: at(0, -0.3), UR: at(0.26, -0.15), LR: at(0.26, 0.15),
    B: at(0, 0.3), LL: at(-0.26, 0.15), UL: at(-0.26, -0.15), C: at(0, 0),
  };
  const id: Record<string, string> = {};
  for (const [name, p] of Object.entries(V)) {
    id[name] = uid();
    scene.vertices[id[name]] = p;
  }
  const faces = [
    makeSurface('Cubo – sopra', [id.UL, id.T, id.UR, id.C], { c1: '#ffd400', c2: '#ff6a00' }),
    makeSurface('Cubo – sinistra', [id.UL, id.C, id.B, id.LL], { c1: '#00e5ff', c2: '#0057ff' }),
    makeSurface('Cubo – destra', [id.C, id.UR, id.LR, id.B], { c1: '#ff2bd6', c2: '#7a00ff' }),
  ];
  scene.surfaces.push(...faces);
  return faces;
}

export function surfacePoints(scene: Scene, s: Surface): Vec2[] {
  return s.v.map((id) => scene.vertices[id]);
}

/** Vero se `vid` è uno dei 4 angoli prospettici di qualche superficie. */
export function isCorner(scene: Scene, vid: string): boolean {
  return scene.surfaces.some((s) => s.corners.some((i) => s.v[i] === vid));
}

/**
 * Inserisce un nuovo vertice in p sul lato a–b, in tutte le superfici che hanno quel lato
 * (così uno spigolo condiviso resta unito). Restituisce l'ID o null se non è possibile.
 */
export function insertVertex(scene: Scene, a: string, b: string, p: Vec2): string | null {
  const edits: [Surface, number][] = [];
  for (const s of scene.surfaces) {
    const n = s.v.length;
    const i = s.v.findIndex((v, k) => (v === a && s.v[(k + 1) % n] === b) || (v === b && s.v[(k + 1) % n] === a));
    if (i < 0) continue;
    if (n >= MAX_VERTICES) return null;
    edits.push([s, i]);
  }
  if (!edits.length) return null;
  const id = uid();
  scene.vertices[id] = { ...p };
  for (const [s, i] of edits) {
    s.v.splice(i + 1, 0, id);
    s.corners = s.corners.map((c) => (c > i ? c + 1 : c)) as Surface['corners'];
  }
  return id;
}

/** Rimuove un vertice di contorno (non un angolo) da tutte le superfici che lo usano. */
export function removeVertex(scene: Scene, vid: string): boolean {
  let removed = false;
  for (const s of scene.surfaces) {
    const i = s.v.indexOf(vid);
    if (i < 0 || s.corners.includes(i)) continue;
    s.v.splice(i, 1);
    s.corners = s.corners.map((c) => (c > i ? c - 1 : c)) as Surface['corners'];
    removed = true;
  }
  if (removed) pruneVertices(scene);
  return removed;
}

/** Rimuove i vertici non più usati da nessuna superficie. */
export function pruneVertices(scene: Scene): void {
  const used = new Set(scene.surfaces.flatMap((s) => s.v));
  for (const id of Object.keys(scene.vertices)) if (!used.has(id)) delete scene.vertices[id];
}

/** Unisce il vertice `from` in `into` (tutte le superfici che usavano `from` usano `into`). */
export function mergeVertex(scene: Scene, from: string, into: string): void {
  for (const s of scene.surfaces) {
    // Non unire due vertici della stessa superficie: degenererebbe il poligono
    if (s.v.includes(from) && s.v.includes(into)) return;
  }
  for (const s of scene.surfaces) s.v = s.v.map((v) => (v === from ? into : v)) as Surface['v'];
  delete scene.vertices[from];
}

/** Stacca un vertice condiviso: ogni superficie ne riceve una copia indipendente. */
export function detachVertex(scene: Scene, vid: string): void {
  const users = scene.surfaces.filter((s) => s.v.includes(vid));
  const p = scene.vertices[vid];
  users.slice(1).forEach((s) => {
    const nid = uid();
    scene.vertices[nid] = { ...p };
    s.v = s.v.map((v) => (v === vid ? nid : v)) as Surface['v'];
  });
}

/** Tutti i vertici delle superfici collegate (per vertici condivisi) a `start`. */
export function connectedVertices(scene: Scene, start: Surface): Set<string> {
  const verts = new Set<string>(start.v);
  let grown = true;
  while (grown) {
    grown = false;
    for (const s of scene.surfaces) {
      if (s.v.some((v) => verts.has(v)) && !s.v.every((v) => verts.has(v))) {
        s.v.forEach((v) => verts.add(v));
        grown = true;
      }
    }
  }
  return verts;
}

const STORAGE_KEY = 'projector-mapper.scene';

export function loadScene(): Scene | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateScene(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveScene(scene: Scene): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
  } catch {
    /* storage pieno o non disponibile: ignora */
  }
}

export function validateScene(data: unknown): Scene | null {
  const d = data as Scene;
  if (!d || typeof d !== 'object' || typeof d.vertices !== 'object' || !Array.isArray(d.surfaces)) return null;
  for (const s of d.surfaces) {
    if (!Array.isArray(s.v) || s.v.length < 4 || s.v.length > MAX_VERTICES || s.v.some((v) => !d.vertices[v])) return null;
    // Le scene salvate prima dei poligoni hanno solo i 4 angoli
    s.corners ??= [0, 1, 2, 3];
    const c = s.corners;
    if (!Array.isArray(c) || c.length !== 4 || c.some((k, i) => !Number.isInteger(k) || k < 0 || k >= s.v.length || (i > 0 && k <= c[i - 1]))) return null;
    s.content = defaultContent(s.content);
    s.opacity ??= 1;
    s.feather ??= 0;
    s.aspect ??= 1;
    s.visible ??= true;
  }
  return { version: 1, vertices: d.vertices, surfaces: d.surfaces };
}
