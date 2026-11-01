export type Vec2 = { x: number; y: number };

/** Matrice 3x3 in ordine row-major: [a b c; d e f; g h i]. */
export type Mat3 = number[];

/**
 * Omografia che porta il quadrato unitario (0,0)(1,0)(1,1)(0,1) nel quadrilatero
 * p[0..3] (in ordine: alto-sx, alto-dx, basso-dx, basso-sx).
 * Formula chiusa di Heckbert, "Fundamentals of Texture Mapping", 1989.
 */
export function squareToQuad(p: Vec2[]): Mat3 {
  const [p0, p1, p2, p3] = p;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;

  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // Parallelogramma: trasformazione affine
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }

  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;

  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

export function applyH(m: Mat3, x: number, y: number): Vec2 {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** GLSL vuole le matrici column-major. */
export function toColumnMajor(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

export function isConvex(q: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], c = q[(i + 2) % q.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Vero se i lati del poligono non si incrociano (può essere concavo). */
export function isSimple(p: Vec2[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // lati adiacenti
      const c = p[j], d = p[(j + 1) % n];
      if (cross(c, d, a) * cross(c, d, b) < 0 && cross(a, b, c) * cross(a, b, d) < 0) return false;
    }
  }
  return true;
}

/**
 * Omografia della superficie e sua inversa, oppure null se non è disegnabile.
 * La prospettiva è data dai 4 angoli (`corners`, indici in `poly`, che devono formare un
 * quadrilatero convesso); gli altri vertici modellano solo il contorno.
 */
export function surfaceMapping(poly: Vec2[], corners: number[]): { h: Mat3; inv: Mat3 } | null {
  const q = corners.map((i) => poly[i]);
  if (!isConvex(q) || !isSimple(poly)) return null;
  const h = squareToQuad(q);
  const inv = invert3(h);
  if (!inv) return null;
  // Tutti i vertici devono stare dalla stessa parte dell'orizzonte della prospettiva
  const w = (p: Vec2) => Math.sign(inv[6] * p.x + inv[7] * p.y + inv[8]);
  const ref = w(centroid(q));
  if (poly.some((p) => w(p) !== ref)) return null;
  return { h, inv };
}

/** Test pari/dispari: funziona anche con poligoni concavi. */
export function pointInPolygon(pt: Vec2, p: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Triangolazione per "ear clipping" di un poligono semplice: indici a terne. */
export function triangulate(p: Vec2[]): number[] {
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sgn = area < 0 ? -1 : 1;
  const idx = p.map((_, i) => i);
  const out: number[] = [];
  const inTri = (q: Vec2, a: Vec2, b: Vec2, c: Vec2) =>
    cross(a, b, q) * sgn > 0 && cross(b, c, q) * sgn > 0 && cross(c, a, q) * sgn > 0;

  for (let guard = p.length * p.length; idx.length > 3 && guard > 0; guard--) {
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = p[i0], b = p[i1], c = p[i2];
      // Vertici concavi o allineati non sono "orecchie"
      if (cross(a, b, c) * sgn <= 1e-9) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inTri(p[j], a, b, c))) continue;
      out.push(i0, i1, i2);
      idx.splice(k, 1);
      break;
    }
  }
  if (idx.length === 3) out.push(...idx);
  return out;
}

export function centroid(q: Vec2[]): Vec2 {
  const s = q.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / q.length, y: s.y / q.length };
}

function segmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Ramer–Douglas–Peucker: tiene solo i punti che si scostano più di eps dalla linea. */
function rdp(p: Vec2[], eps: number): Vec2[] {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1, best = eps;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDist(p[i], p[a], p[b]);
      if (d > best) { best = d; idx = i; }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return p.filter((_, i) => keep[i]);
}

/**
 * Semplifica un tracciato chiuso disegnato a mano (in pixel) fino ad al massimo
 * `maxPoints` punti, aumentando la tolleranza finché serve.
 */
export function simplifyPath(p: Vec2[], maxPoints: number): Vec2[] {
  const pts = p.slice();
  // Il tracciato viene chiuso dallo shader: un ultimo punto sopra il primo è superfluo
  while (pts.length > 3 && Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) < 3) pts.pop();
  let eps = 1;
  let out = rdp(pts, eps);
  while (out.length > maxPoints) out = rdp(pts, (eps *= 1.5));
  return out;
}
