import { applyH, centroid, pointInPolygon, simplifyPath, surfaceMapping, type Vec2 } from './geometry';
import { MediaLibrary } from './media';
import { Renderer } from './renderer';
import {
  addCube, addQuad, connectedVertices, detachVertex, emptyScene, insertVertex, isCorner, loadScene,
  MAX_FREEFORM, mergeVertex, pruneVertices, removeVertex, saveScene, shapeOutline, surfacePoints,
  validateScene, type Scene, type ShapeId, type Surface,
} from './state';
import { Panel } from './ui';
import { YouTubeLayer } from './youtube';

const HIT_RADIUS = 14;
const SNAP_RADIUS = 12;

type Drag =
  | { kind: 'vertex'; id: string; offset: Vec2 }
  | { kind: 'move'; verts: Set<string>; last: Vec2 };

export class App {
  scene: Scene;
  readonly media = new MediaLibrary();
  readonly renderer: Renderer;
  readonly panel: Panel;
  private readonly youtube: YouTubeLayer;

  selected: string | null = null;
  selVertex: string | null = null;
  uiVisible = true;
  blackout = false;
  calibration = false;
  master = 1;
  /** Modalità disegno: il prossimo trascinamento traccia la forma a mano libera. */
  drawing = false;

  private ctx: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private snapTarget: string | null = null;
  /** Tracciato a mano libera in corso, in pixel. */
  private stroke: Vec2[] | null = null;
  private undoStack: string[] = [];
  private saveTimer = 0;
  private t0 = performance.now();

  constructor(
    private glCanvas: HTMLCanvasElement,
    private overlay: HTMLCanvasElement,
    panelEl: HTMLElement,
    ytLayer: HTMLElement,
  ) {
    this.renderer = new Renderer(glCanvas, this.media);
    this.youtube = new YouTubeLayer(ytLayer);
    this.ctx = overlay.getContext('2d')!;
    this.scene = loadScene() ?? emptyScene();
    if (this.scene.surfaces.length === 0) addCube(this.scene, this.screenAspect());
    this.selected = this.scene.surfaces[0]?.id ?? null;

    this.panel = new Panel(this, panelEl);
    this.media.onChange = () => this.panel.render();
    this.media.restore(this.mediaIds());

    overlay.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    overlay.addEventListener('pointermove', (e) => this.onPointerMove(e));
    overlay.addEventListener('pointerup', (e) => this.onPointerUp(e));
    overlay.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('fullscreenchange', () => this.panel.render());

    this.panel.render();
    requestAnimationFrame(this.frame);
  }

  // ---------- stato ----------

  screenAspect(): number {
    return this.glCanvas.clientWidth / Math.max(this.glCanvas.clientHeight, 1);
  }

  get surface(): Surface | undefined {
    return this.scene.surfaces.find((s) => s.id === this.selected);
  }

  private mediaIds(): string[] {
    return this.scene.surfaces.map((s) => s.content.mediaId).filter((x): x is string => !!x);
  }

  /** Da chiamare dopo ogni modifica. `structural` ricostruisce il pannello. */
  changed(structural = false): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => saveScene(this.scene), 300);
    if (structural) {
      this.media.collect(this.mediaIds()).then(() => this.renderer.prune());
      this.panel.render();
    }
  }

  /** Salva lo stato corrente nella pila di annullamento, prima di una modifica. */
  snapshot(): void {
    this.undoStack.push(JSON.stringify(this.scene));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.scene = JSON.parse(prev);
    if (!this.surface) this.selected = this.scene.surfaces[0]?.id ?? null;
    if (this.selVertex && !this.scene.vertices[this.selVertex]) this.selVertex = null;
    this.changed(true);
  }

  select(id: string | null): void {
    if (id !== this.selected) this.drawing = false;
    this.selected = id;
    if (this.selVertex && !this.surface?.v.includes(this.selVertex)) this.selVertex = null;
    this.panel.render();
  }

  addSurface(at?: Vec2): void {
    this.snapshot();
    const s = addQuad(this.scene, at ?? { x: 0.5, y: 0.5 }, this.screenAspect());
    this.selected = s.id;
    this.selVertex = null;
    this.changed(true);
  }

  addCube(): void {
    this.snapshot();
    const faces = addCube(this.scene, this.screenAspect());
    this.selected = faces[0].id;
    this.selVertex = null;
    this.changed(true);
  }

  deleteSelected(): void {
    const s = this.surface;
    if (!s) return;
    this.snapshot();
    const i = this.scene.surfaces.indexOf(s);
    this.scene.surfaces.splice(i, 1);
    pruneVertices(this.scene);
    this.selected = this.scene.surfaces[Math.min(i, this.scene.surfaces.length - 1)]?.id ?? null;
    this.selVertex = null;
    this.changed(true);
  }

  /** Sposta la superficie nell'ordine di disegno (le ultime stanno sopra). */
  reorder(id: string, dir: -1 | 1): void {
    const list = this.scene.surfaces;
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    this.snapshot();
    [list[i], list[j]] = [list[j], list[i]];
    this.changed(true);
  }

  detachSelectedVertex(): void {
    if (!this.selVertex) return;
    this.snapshot();
    detachVertex(this.scene, this.selVertex);
    this.changed(true);
  }

  /** Inserisce un vertice a metà del lato che parte dal vertice selezionato (o del lato più lungo). */
  insertVertexOnSelected(): void {
    const s = this.surface;
    if (!s) return;
    const n = s.v.length;
    const pts = surfacePoints(this.scene, s).map((p) => this.toPx(p));
    const len = (k: number) => Math.hypot(pts[(k + 1) % n].x - pts[k].x, pts[(k + 1) % n].y - pts[k].y);
    let i = this.selVertex ? s.v.indexOf(this.selVertex) : -1;
    if (i < 0) i = pts.reduce((best, _, k) => (len(k) > len(best) ? k : best), 0);
    const a = this.scene.vertices[s.v[i]], b = this.scene.vertices[s.v[(i + 1) % n]];
    this.insertVertex(s.v[i], s.v[(i + 1) % n], { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  private insertVertex(a: string, b: string, p: Vec2): void {
    this.snapshot();
    const id = insertVertex(this.scene, a, b, p);
    if (!id) {
      this.undoStack.pop();
      return;
    }
    this.selVertex = id;
    this.changed(true);
  }

  /** Rimuove il vertice selezionato se non è uno dei 4 angoli prospettici. */
  removeSelectedVertex(): void {
    const s = this.surface, vid = this.selVertex;
    if (!s || !vid || s.corners.some((i) => s.v[i] === vid)) return;
    this.snapshot();
    if (!removeVertex(this.scene, vid)) {
      this.undoStack.pop();
      return;
    }
    if (!this.scene.vertices[vid]) this.selVertex = null;
    this.changed(true);
  }

  /** Cambia la forma della superficie selezionata; "mano libera" senza tracciato avvia il disegno. */
  setShape(shape: ShapeId): void {
    const s = this.surface;
    if (!s) return;
    this.snapshot();
    s.shape = shape;
    this.drawing = shape === 'free' && s.freeform.length < 3;
    this.changed(true);
  }

  startDrawing(): void {
    if (!this.surface) return;
    this.drawing = true;
    this.selVertex = null;
    this.panel.render();
  }

  cancelDrawing(): void {
    this.drawing = false;
    this.stroke = null;
    this.panel.render();
  }

  /** Converte il tracciato in coordinate della faccia e lo salva come forma a mano libera. */
  private finishStroke(): void {
    const s = this.surface, stroke = this.stroke;
    this.stroke = null;
    this.drawing = false;
    const map = s && surfaceMapping(surfacePoints(this.scene, s).map((p) => this.toPx(p)), s.corners);
    const pts = stroke ? simplifyPath(stroke, MAX_FREEFORM) : [];
    if (!s || !map || pts.length < 3) {
      this.panel.render();
      return;
    }
    this.snapshot();
    s.freeform = pts.map((p) => {
      const q = applyH(map.inv, p.x, p.y);
      return { x: +q.x.toFixed(4), y: +q.y.toFixed(4) };
    });
    s.shape = 'free';
    this.changed(true);
  }

  clearScene(): void {
    this.snapshot();
    this.scene = emptyScene();
    this.selected = null;
    this.selVertex = null;
    this.changed(true);
  }

  exportScene(): void {
    const blob = new Blob([JSON.stringify(this.scene, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mapping.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async importScene(file: File): Promise<void> {
    const scene = validateScene(JSON.parse(await file.text()));
    if (!scene) {
      alert('File non valido.');
      return;
    }
    this.snapshot();
    this.scene = scene;
    this.selected = scene.surfaces[0]?.id ?? null;
    this.selVertex = null;
    await this.media.restore(this.mediaIds());
    this.changed(true);
  }

  setUiVisible(v: boolean): void {
    this.uiVisible = v;
    document.body.classList.toggle('show-mode', !v);
    this.panel.render();
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // ---------- rendering ----------

  private frame = (now: number): void => {
    this.renderer.resize();
    this.renderer.render(this.scene, {
      time: (now - this.t0) / 1000,
      master: this.master,
      blackout: this.blackout,
      calibration: this.calibration,
    });
    this.youtube.update(this.scene, { master: this.master, blackout: this.blackout, calibration: this.calibration });
    this.drawOverlay();
    requestAnimationFrame(this.frame);
  };

  private toPx(p: Vec2): Vec2 {
    return { x: p.x * this.overlay.clientWidth, y: p.y * this.overlay.clientHeight };
  }

  private drawOverlay(): void {
    const c = this.overlay, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.uiVisible) return;

    // Mirino a tutto schermo sul vertice trascinato/selezionato: aiuta ad allineare gli spigoli
    const focus = this.drag?.kind === 'vertex' ? this.drag.id : this.selVertex;
    if (focus && this.scene.vertices[focus]) {
      const p = this.toPx(this.scene.vertices[focus]);
      ctx.strokeStyle = 'rgba(255,255,0,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, p.y); ctx.lineTo(w, p.y);
      ctx.moveTo(p.x, 0); ctx.lineTo(p.x, h);
      ctx.stroke();
    }

    const useCount = new Map<string, number>();
    for (const s of this.scene.surfaces) for (const v of s.v) useCount.set(v, (useCount.get(v) ?? 0) + 1);

    for (const s of this.scene.surfaces) {
      const pts = surfacePoints(this.scene, s).map((p) => this.toPx(p));
      const sel = s.id === this.selected;
      const map = surfaceMapping(pts, s.corners);
      const bad = !map;
      ctx.setLineDash(sel ? [] : [6, 5]);
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeStyle = bad ? '#ff3b3b' : sel ? '#ffffff' : 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();

      // Forma inscritta (ellisse o mano libera), portata sullo schermo dall'omografia
      const shape = map && !(sel && this.drawing) ? shapeOutline(s) : null;
      if (map && shape) {
        ctx.setLineDash(sel ? [] : [4, 4]);
        ctx.lineWidth = sel ? 1.5 : 1;
        ctx.strokeStyle = sel ? '#00e5ff' : 'rgba(0,229,255,0.5)';
        ctx.beginPath();
        shape.forEach((q, i) => {
          const p = applyH(map.h, q.x, q.y);
          if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.stroke();
      }

      // Con vertici aggiuntivi o una forma mostra il quadrilatero degli angoli che regge la prospettiva
      if (sel && (pts.length > 4 || shape || this.drawing)) {
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,230,0,0.5)';
        ctx.beginPath();
        s.corners.forEach((k, i) => (i ? ctx.lineTo(pts[k].x, pts[k].y) : ctx.moveTo(pts[k].x, pts[k].y)));
        ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const cpt = centroid(pts);
      const label = (s.visible ? '' : '◌ ') + s.name + (bad ? ' (non valida)' : '');
      ctx.font = '12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = sel ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.5)';
      ctx.fillRect(cpt.x - tw / 2 - 6, cpt.y - 10, tw + 12, 20);
      ctx.fillStyle = bad ? '#ff8080' : sel ? '#fff' : 'rgba(255,255,255,0.75)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cpt.x, cpt.y);
    }

    // Maniglie: prima quelle non selezionate, poi quelle della superficie selezionata sopra
    const selVerts = new Set(this.surface?.v ?? []);
    const ordered = Object.keys(this.scene.vertices).sort((a, b) => +selVerts.has(a) - +selVerts.has(b));
    for (const id of ordered) {
      const p = this.toPx(this.scene.vertices[id]);
      const shared = (useCount.get(id) ?? 0) > 1;
      const active = id === this.selVertex || (this.drag?.kind === 'vertex' && this.drag.id === id);
      // I vertici di contorno (non angoli) hanno maniglie più piccole
      const r = (selVerts.has(id) ? 7 : 5) * (isCorner(this.scene, id) ? 1 : 0.65);
      ctx.beginPath();
      if (shared) {
        ctx.moveTo(p.x, p.y - r - 1); ctx.lineTo(p.x + r + 1, p.y);
        ctx.lineTo(p.x, p.y + r + 1); ctx.lineTo(p.x - r - 1, p.y);
        ctx.closePath();
      } else {
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = active ? '#ffe600' : selVerts.has(id) ? 'rgba(255,230,0,0.25)' : 'rgba(255,255,255,0.15)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = selVerts.has(id) ? '#ffe600' : 'rgba(255,255,255,0.7)';
      ctx.stroke();
    }

    if (this.stroke && this.stroke.length > 1) {
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00e5ff';
      ctx.beginPath();
      this.stroke.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }

    if (this.drawing) {
      const msg = 'Disegna la forma tenendo premuto il mouse · Esc annulla';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(msg).width;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(w / 2 - tw / 2 - 10, 14, tw + 20, 26);
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(msg, w / 2, 27);
    }

    if (this.snapTarget && this.scene.vertices[this.snapTarget]) {
      const p = this.toPx(this.scene.vertices[this.snapTarget]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, SNAP_RADIUS + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ---------- input ----------

  private eventPos(e: MouseEvent): Vec2 {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toNorm(p: Vec2): Vec2 {
    return { x: p.x / this.overlay.clientWidth, y: p.y / this.overlay.clientHeight };
  }

  private hitVertex(px: Vec2, exclude?: string, radius = HIT_RADIUS): string | null {
    const selVerts = new Set(this.surface?.v ?? []);
    let best: string | null = null, bestD = radius, bestSel = false;
    for (const [id, v] of Object.entries(this.scene.vertices)) {
      if (id === exclude) continue;
      const p = this.toPx(v);
      const d = Math.hypot(p.x - px.x, p.y - px.y);
      const isSel = selVerts.has(id);
      // A parità di vicinanza vincono i vertici della superficie selezionata
      if (d <= radius && (d < bestD || (isSel && !bestSel))) {
        best = id; bestD = d; bestSel = isSel;
      }
    }
    return best;
  }

  private hitSurface(px: Vec2): Surface | null {
    for (let i = this.scene.surfaces.length - 1; i >= 0; i--) {
      const s = this.scene.surfaces[i];
      const pts = surfacePoints(this.scene, s).map((p) => this.toPx(p));
      if (surfaceMapping(pts, s.corners) && pointInPolygon(px, pts)) return s;
    }
    return null;
  }

  /** Lato più vicino al punto (entro HIT_RADIUS); a parità vince la superficie selezionata. */
  private hitEdge(px: Vec2): { a: string; b: string; p: Vec2 } | null {
    let best: { a: string; b: string; p: Vec2 } | null = null, bestD = HIT_RADIUS;
    const list = [...this.scene.surfaces].sort((x, y) => +(y.id === this.selected) - +(x.id === this.selected));
    for (const s of list) {
      const pts = surfacePoints(this.scene, s).map((p) => this.toPx(p));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((px.x - a.x) * dx + (px.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const q = { x: a.x + dx * t, y: a.y + dy * t };
        const d = Math.hypot(px.x - q.x, px.y - q.y);
        if (d < bestD) {
          bestD = d;
          best = { a: s.v[i], b: s.v[(i + 1) % pts.length], p: this.toNorm(q) };
        }
      }
    }
    return best;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.uiVisible || e.button !== 0) return;
    const px = this.eventPos(e);
    if (this.drawing) {
      this.stroke = [px];
      this.overlay.setPointerCapture(e.pointerId);
      return;
    }
    const vid = this.hitVertex(px);

    if (vid) {
      this.snapshot();
      if (!this.surface?.v.includes(vid)) {
        const owner = this.scene.surfaces.find((s) => s.v.includes(vid));
        if (owner) this.selected = owner.id;
      }
      this.selVertex = vid;
      const vp = this.toPx(this.scene.vertices[vid]);
      this.drag = { kind: 'vertex', id: vid, offset: { x: vp.x - px.x, y: vp.y - px.y } };
      this.overlay.setPointerCapture(e.pointerId);
      this.panel.render();
      return;
    }

    const s = this.hitSurface(px);
    if (s) {
      this.snapshot();
      this.selected = s.id;
      this.selVertex = null;
      // Trascinando l'interno si sposta l'intero gruppo collegato (es. tutto il cubo);
      // con Alt solo la singola superficie.
      const verts = e.altKey ? new Set(s.v) : connectedVertices(this.scene, s);
      this.drag = { kind: 'move', verts, last: px };
      this.overlay.setPointerCapture(e.pointerId);
    } else {
      this.selected = null;
      this.selVertex = null;
    }
    this.panel.render();
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.stroke) {
      const px = this.eventPos(e), last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(px.x - last.x, px.y - last.y) >= 2) this.stroke.push(px);
      return;
    }
    if (!this.drag) return;
    const px = this.eventPos(e);
    if (this.drag.kind === 'vertex') {
      const id = this.drag.id;
      const target = { x: px.x + this.drag.offset.x, y: px.y + this.drag.offset.y };
      this.scene.vertices[id] = this.toNorm(target);
      const snap = e.shiftKey ? null : this.hitVertex(target, id, SNAP_RADIUS);
      // Non proporre l'aggancio a un vertice della stessa superficie
      this.snapTarget = snap && !this.scene.surfaces.some((s) => s.v.includes(snap) && s.v.includes(id)) ? snap : null;
    } else {
      const dx = (px.x - this.drag.last.x) / this.overlay.clientWidth;
      const dy = (px.y - this.drag.last.y) / this.overlay.clientHeight;
      for (const id of this.drag.verts) {
        const v = this.scene.vertices[id];
        v.x += dx;
        v.y += dy;
      }
      this.drag.last = px;
    }
    this.changed();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.stroke) {
      this.overlay.releasePointerCapture(e.pointerId);
      this.finishStroke();
      return;
    }
    if (!this.drag) return;
    if (this.drag.kind === 'vertex' && this.snapTarget) {
      mergeVertex(this.scene, this.drag.id, this.snapTarget);
      this.selVertex = this.snapTarget;
      this.changed(true);
    }
    this.snapTarget = null;
    this.drag = null;
    this.overlay.releasePointerCapture(e.pointerId);
    this.changed();
  }

  private onDoubleClick(e: MouseEvent): void {
    if (!this.uiVisible || this.drawing) return;
    const px = this.eventPos(e);
    if (this.hitVertex(px)) return;
    // Doppio clic su un lato: nuovo vertice di contorno
    const edge = this.hitEdge(px);
    if (edge) this.insertVertex(edge.a, edge.b, edge.p);
    else if (!this.hitSurface(px)) this.addSurface(this.toNorm(px));
  }

  private nudge(dx: number, dy: number): void {
    const nx = dx / this.overlay.clientWidth, ny = dy / this.overlay.clientHeight;
    const s = this.surface;
    const ids = this.selVertex ? [this.selVertex] : s ? [...connectedVertices(this.scene, s)] : [];
    if (!ids.length) return;
    for (const id of ids) {
      this.scene.vertices[id].x += nx;
      this.scene.vertices[id].y += ny;
    }
    this.changed();
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const k = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (k) {
      case 'h': this.setUiVisible(!this.uiVisible); break;
      case 'f': this.toggleFullscreen(); break;
      case 'b': this.blackout = !this.blackout; this.panel.render(); break;
      case 'g': this.calibration = !this.calibration; this.panel.render(); break;
      case 'n': this.addSurface(); break;
      case 'd': this.detachSelectedVertex(); break;
      case 'i': this.insertVertexOnSelected(); break;
      case 'x': this.removeSelectedVertex(); break;
      case 'delete': this.deleteSelected(); break;
      case 'escape':
        if (this.drawing) this.cancelDrawing();
        else { this.selVertex = null; this.panel.render(); }
        break;
      case 'tab': {
        e.preventDefault();
        const list = this.scene.surfaces;
        if (!list.length) break;
        const i = list.findIndex((s) => s.id === this.selected);
        this.select(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].id);
        break;
      }
      case 'v': {
        // Cicla tra i vertici della superficie selezionata
        const s = this.surface;
        if (!s) break;
        const i = this.selVertex ? s.v.indexOf(this.selVertex) : -1;
        this.selVertex = s.v[(i + 1) % s.v.length];
        this.panel.render();
        break;
      }
      case 'arrowleft': if (this.uiVisible) { e.preventDefault(); this.snapshotOnce(e); this.nudge(-step, 0); } break;
      case 'arrowright': if (this.uiVisible) { e.preventDefault(); this.snapshotOnce(e); this.nudge(step, 0); } break;
      case 'arrowup': if (this.uiVisible) { e.preventDefault(); this.snapshotOnce(e); this.nudge(0, -step); } break;
      case 'arrowdown': if (this.uiVisible) { e.preventDefault(); this.snapshotOnce(e); this.nudge(0, step); } break;
    }
  }

  /** Una sola voce di annullamento per una pressione prolungata delle frecce. */
  private snapshotOnce(e: KeyboardEvent): void {
    if (!e.repeat) this.snapshot();
  }
}
