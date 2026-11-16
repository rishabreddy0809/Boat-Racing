// Shared Gerstner wave definition. The same numbers drive the GLSL ocean and the
// JS buoyancy sampler, so boats sit on exactly the surface that is drawn.

// [direction angle (rad), wavelength (m), amplitude (m)]
export const WAVES = [
  [0.35, 74, 0.6],
  [-0.62, 47, 0.4],
  [1.25, 29, 0.25],
  [-0.15, 17, 0.14],
  [0.9, 10.5, 0.08],
  [-1.1, 6.3, 0.045],
];

const STEEP = 0.72 / WAVES.length;
const G = 9.81;

const W = WAVES.map(([a, L, A]) => {
  const k = (Math.PI * 2) / L;
  return { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(G * k), A, L, q: STEEP / k };
});

// Height of the water surface above world point (x, z) at time t.
export function waterHeight(x, z, t) {
  let px = x, pz = z;
  for (let it = 0; it < 3; it++) {
    let ox = 0, oz = 0;
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      const c = Math.cos(w.k * (w.dx * px + w.dz * pz) - w.w * t);
      ox += w.q * w.dx * c;
      oz += w.q * w.dz * c;
    }
    px = x - ox;
    pz = z - oz;
  }
  let y = 0;
  for (let i = 0; i < W.length; i++) {
    const w = W[i];
    y += w.A * Math.sin(w.k * (w.dx * px + w.dz * pz) - w.w * t);
  }
  return y;
}

const f = (n) => {
  const s = n.toFixed(6);
  return s.includes('.') ? s : s + '.0';
};

// GLSL: vec3 waveDisplace(vec2 p, float dist) and vec3 waveNormal(vec2 p, float dist, out float crest)
export const WAVES_GLSL = /* glsl */ `
uniform float uTime;
vec3 waveDisplace(vec2 p, float dist) {
  vec3 d = vec3(0.0);
  float ph, fd;
${W.map(
  (w) => `  ph = ${f(w.k)} * dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) - ${f(w.w)} * uTime;
  fd = 1.0 - smoothstep(${f(w.L * 7)}, ${f(w.L * 12)}, dist);
  d.xz += fd * ${f(w.q)} * vec2(${f(w.dx)}, ${f(w.dz)}) * cos(ph);
  d.y += fd * ${f(w.A)} * sin(ph);`
).join('\n')}
  return d;
}
vec3 waveNormal(vec2 p, float dist, out float crest) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  crest = 0.0;
  float ph, fd, c, s;
${W.map(
  (w) => `  ph = ${f(w.k)} * dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) - ${f(w.w)} * uTime;
  fd = 1.0 - smoothstep(${f(w.L * 22)}, ${f(w.L * 60)}, dist);
  c = cos(ph); s = sin(ph);
  n.xz -= fd * ${f(w.k * w.A)} * vec2(${f(w.dx)}, ${f(w.dz)}) * c;
  n.y -= fd * ${f(STEEP)} * s;
  crest += fd * ${f(STEEP)} * s;`
).join('\n')}
  return normalize(n);
}
`;
