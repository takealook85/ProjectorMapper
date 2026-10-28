export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * Ogni superficie viene disegnata come poligono (triangolato); per ogni pixel si calcola
 * l'omografia inversa dei 4 angoli (schermo -> coordinate della faccia uv, 0..1 dentro il
 * quadrilatero degli angoli). Così la prospettiva è esatta, senza la "piega" lungo la
 * diagonale tipica del mapping affine su due triangoli. Il contorno del poligono, già
 * portato in coordinate uv, serve per la sfumatura e per gli effetti che seguono i bordi.
 */
export const FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform mat3 uHinv;
uniform vec2 uRes;
uniform float uTime, uSpeed, uScale, uDelay, uOpacity, uFeather, uAspect, uTexAspect, uMaster;
uniform int uEffect, uRot, uFlip, uFit, uHasTex;
uniform vec3 uC1, uC2;
uniform sampler2D uTex;

const int MAX_POLY = 32;
uniform vec2 uPoly[MAX_POLY];
uniform int uPolyN;

out vec4 outColor;

const float TAU = 6.28318530718;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Distanza dal contorno del poligono in coordinate uv, con l'asse x scalato di sx
float polyDist(vec2 q, float sx) {
  vec2 k = vec2(sx, 1.0);
  float d = 1e9;
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyN) break;
    vec2 a = uPoly[i] * k, ba = uPoly[(i + 1) % uPolyN] * k - a, pa = q * k - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
    d = min(d, length(pa - ba * h));
  }
  return d;
}

// Linea antialiasata: 1 quando d < w
float line(float d, float w) {
  float aa = fwidth(d);
  return 1.0 - smoothstep(w - aa, w + aa, d);
}

// Onda quadra antialiasata a partire da un segnale periodico
float square(float v) {
  float fw = fwidth(v);
  return smoothstep(-fw, fw, v);
}

// ed: distanza dal bordo con proporzioni fisiche (altezza = 1)
vec3 gridPattern(vec2 t, vec2 p, float ed) {
  vec2 g = p * 8.0 * uScale;
  vec2 gl = abs(fract(g + 0.5) - 0.5);
  float grid = max(line(gl.x, 0.03), line(gl.y, 0.03));
  float border = line(ed, 0.012);
  float diag = max(line(abs(t.x - t.y), 0.004), line(abs(t.x + t.y - 1.0), 0.004));
  float circle = line(abs(length(p) - 0.4), 0.006);
  // Freccia "su" per riconoscere l'orientamento del contenuto
  float arrow = (p.y > -0.45 && p.y < -0.32 && abs(p.x) < (p.y + 0.45) * 0.6) ? 1.0 : 0.0;
  vec3 col = uC1 * 0.12;
  col = mix(col, uC1, grid * 0.8);
  col = mix(col, uC2 * 0.7, diag);
  col = mix(col, uC2, max(circle, arrow));
  col = mix(col, vec3(1.0), border);
  return col;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 hp = uHinv * vec3(frag, 1.0);
  vec2 uv = hp.xy / hp.z;

  float mask = uFeather > 0.0 ? smoothstep(0.0, uFeather, polyDist(uv, 1.0)) : 1.0;
  float ed = polyDist(uv, uAspect);

  // Trasformazione del contenuto (specchio + rotazione a passi di 90°).
  // Fuori dal quadrilatero degli angoli t esce da 0..1 e gli effetti proseguono.
  vec2 t = uv;
  if (uFlip == 1) t.x = 1.0 - t.x;
  if (uRot == 1) t = vec2(t.y, 1.0 - t.x);
  else if (uRot == 2) t = 1.0 - t;
  else if (uRot == 3) t = vec2(1.0 - t.y, t.x);
  float asp = (uRot == 1 || uRot == 3) ? 1.0 / uAspect : uAspect;

  // Coordinate centrate con proporzioni fisiche corrette (altezza = 1)
  vec2 p = (t - 0.5) * vec2(asp, 1.0);
  float time = (uTime - uDelay) * uSpeed;
  vec3 col = vec3(0.0);

  if (uEffect == 0) {
    col = gridPattern(t, p, ed);

  } else if (uEffect == 1) {
    col = uC1;

  } else if (uEffect == 2) {
    float f = 0.5 + 0.5 * sin(TAU * ((t.x + t.y * 0.5) * uScale - time * 0.25));
    col = mix(uC1, uC2, f);

  } else if (uEffect == 3) {
    float s = square(sin(TAU * ((p.x + p.y) * 4.0 * uScale - time * 0.5)));
    col = mix(uC1, uC2, s);

  } else if (uEffect == 4) {
    vec2 q = p * 4.0 * uScale + vec2(time * 0.25, 0.0);
    float s = square(sin(3.14159 * q.x) * sin(3.14159 * q.y));
    col = mix(uC1, uC2, s);

  } else if (uEffect == 5) {
    vec2 q = p * 3.0 * uScale;
    float v = sin(q.x * 2.0 + time) + sin(q.y * 2.6 - time * 1.2)
            + sin((q.x + q.y) * 1.4 + time * 0.7) + sin(length(q) * 4.0 - time * 1.5);
    float f = 0.5 + 0.5 * sin(v * 1.5);
    col = mix(uC1, uC2, f) * (0.6 + 0.4 * sin(v + time));

  } else if (uEffect == 6) {
    float d = ed;
    float pulse = 0.5 + 0.5 * sin(time * 3.0);
    float glow = exp(-d * 28.0 / uScale) * (0.55 + 0.45 * pulse) + line(d, 0.01);
    float a = atan(p.y, p.x) / TAU + 0.5;
    float chase = pow(fract(a - time * 0.3), 10.0) * exp(-d * 12.0);
    col = uC1 * glow + uC2 * chase * 1.5;

  } else if (uEffect == 7) {
    float pos = fract(time * 0.4) * 1.4 - 0.2;
    float d = abs(t.y - pos);
    col = uC1 * exp(-d * 40.0 / uScale) + uC2 * exp(-d * 6.0 / uScale) * 0.25;

  } else if (uEffect == 8) {
    float s = square(sin(length(p) * 25.0 * uScale - time * 4.0));
    col = mix(uC2 * 0.15, uC1, s);

  } else if (uEffect == 9) {
    float row = floor(t.y * 40.0 * uScale);
    float tick = floor(time * 12.0);
    vec2 q = t;
    q.x += (hash(vec2(row, tick)) - 0.5) * 0.25 * step(0.85, hash(vec2(floor(time * 6.0), row * 0.1)));
    float v = noise(q * vec2(60.0, 8.0) * uScale + time * 5.0);
    col = mix(uC2 * 0.2, uC1, step(0.55, v));
    col += vec3(step(0.97, hash(vec2(tick, 7.0)))) * 0.6;

  } else if (uEffect == 10) {
    float h = 1.0 - t.y;
    float level = 0.5 + 0.42 * sin(time * 0.5);
    float wave = 0.02 * sin(t.x * 12.0 + time * 3.0) + 0.015 * sin(t.x * 7.0 - time * 2.0);
    float surf = level + wave;
    float inside = smoothstep(-0.004, 0.004, surf - h);
    vec3 liquid = mix(uC1 * 0.5, uC1, h / max(surf, 0.01));
    col = mix(uC2 * 0.08, liquid, inside) + uC2 * line(abs(surf - h), 0.005);

  } else if (uEffect == 11) {
    float c = max(abs(t.x - 0.5), abs(t.y - 0.5)) * 2.0;
    float z = log(max(c, 1e-3));
    float f = fract(z * 2.0 * uScale + time * 0.4);
    float ring = 1.0 - smoothstep(0.0, 0.12, min(f, 1.0 - f));
    float diag = line(abs(abs(t.x - 0.5) - abs(t.y - 0.5)), 0.004);
    col = (uC1 * ring + uC2 * diag) * smoothstep(0.0, 0.5, c) * (0.3 + 0.7 * c);

  } else if (uEffect == 12) {
    if (uHasTex == 1) {
      vec2 st = t;
      if (uFit == 0) {
        float ra = asp / uTexAspect;
        if (ra > 1.0) st.y = (st.y - 0.5) / ra + 0.5;
        else st.x = (st.x - 0.5) * ra + 0.5;
      }
      bool out01 = any(lessThan(st, vec2(0.0))) || any(greaterThan(st, vec2(1.0)));
      col = out01 ? vec3(0.0) : texture(uTex, st).rgb;
    } else {
      col = gridPattern(t, p, ed) * 0.5;
    }

  } else if (uEffect == 13) {
    col = uC1 * step(0.5, fract(time * 2.0));
  }

  float a = mask * uOpacity;
  outColor = vec4(col * uMaster * a, a);
}
`;
