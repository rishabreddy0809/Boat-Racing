import * as THREE from 'three';

// Deterministic RNG
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 3D value noise
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf);
  yf = yf * yf * (3 - 2 * yf);
  zf = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), xf), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), xf), yf),
    l(
      l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), xf),
      l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), xf),
      yf
    ),
    zf
  );
}
export function fbm3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x, y, z);
    n += a;
    x *= 2.03; y *= 2.03; z *= 2.03;
    a *= 0.5;
  }
  return s / n;
}
export function ridged3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(noise3(x, y, z) * 2 - 1);
    s += a * v * v;
    n += a;
    x *= 2.1; y *= 2.1; z *= 2.1;
    a *= 0.5;
  }
  return s / n;
}

// Tileable height field built from random integer-frequency sinusoids.
function tileHeight(size, count, minF, maxF, falloff, seed) {
  const rnd = mulberry(seed);
  const h = new Float32Array(size * size);
  const cosT = new Float32Array(size), sinT = new Float32Array(size);
  const cx = new Float32Array(size), sx = new Float32Array(size);
  for (let w = 0; w < count; w++) {
    let fx = 0, fy = 0;
    while (fx === 0 && fy === 0) {
      const mag = minF + (maxF - minF) * Math.pow(rnd(), 1.6);
      const ang = rnd() * Math.PI * 2;
      fx = Math.round(Math.cos(ang) * mag);
      fy = Math.round(Math.sin(ang) * mag);
    }
    const amp = Math.pow(Math.hypot(fx, fy), -falloff);
    const ph = rnd() * Math.PI * 2;
    for (let i = 0; i < size; i++) {
      const a = (i / size) * Math.PI * 2;
      cx[i] = Math.cos(a * fx + ph); sx[i] = Math.sin(a * fx + ph);
      cosT[i] = Math.cos(a * fy); sinT[i] = Math.sin(a * fy);
    }
    for (let y = 0; y < size; y++) {
      const cy = cosT[y], sy = sinT[y], row = y * size;
      for (let x = 0; x < size; x++) h[row + x] += amp * (sx[x] * cy + cx[x] * sy);
    }
  }
  return h;
}

// Tileable ripple normal map (RG = slope, B = height)
export function makeRippleTexture(size = 512) {
  const h = tileHeight(size, 70, 2, 46, 1.05, 1337);
  let max = 0;
  for (let i = 0; i < h.length; i++) max = Math.max(max, Math.abs(h[i]));
  const data = new Uint8Array(size * size * 4);
  const s = size / 24 / max;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (h[y * size + ((x + 1) % size)] - h[y * size + ((x + size - 1) % size)]) * s;
      const dy = (h[((y + 1) % size) * size + x] - h[((y + size - 1) % size) * size + x]) * s;
      data[i * 4] = clamp(128 + dx * 127, 0, 255);
      data[i * 4 + 1] = clamp(128 + dy * 127, 0, 255);
      data[i * 4 + 2] = clamp(128 + (h[i] / max) * 127, 0, 255);
      data[i * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Tileable foam: cellular, lacy pattern in R; soft cloud noise in G
export function makeFoamTexture(size = 256) {
  const rnd = mulberry(99);
  const cells = 22;
  const pts = [];
  for (let i = 0; i < cells * cells; i++) pts.push([rnd(), rnd()]);
  const soft = tileHeight(size, 40, 1, 14, 1.1, 4242);
  let smax = 0;
  for (let i = 0; i < soft.length; i++) smax = Math.max(smax, Math.abs(soft[i]));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells, v = (y / size) * cells;
      const cx = Math.floor(u), cy = Math.floor(v);
      let d1 = 9, d2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox, gy = cy + oy;
          const p = pts[((gy + cells) % cells) * cells + ((gx + cells) % cells)];
          const d = Math.hypot(gx + p[0] - u, gy + p[1] - v);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      }
      const edge = 1 - clamp((d2 - d1) * 2.6, 0, 1); // bright along cell walls
      const i = (y * size + x) * 4;
      data[i] = Math.pow(edge, 1.8) * 255;
      data[i + 1] = clamp(0.5 + (soft[y * size + x] / smax) * 0.5, 0, 1) * 255;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
