import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.42, 0.56, -0.71).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.93, 0.82);
export const HORIZON = new THREE.Color(0.5, 0.66, 0.86);

const skyFrag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun;
uniform vec3 uHorizon;

float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec3(11.7, 3.1, 7.9); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float up = max(d.y, 0.0);

  // Atmosphere
  vec3 zenith = vec3(0.075, 0.2, 0.56);
  vec3 mid = vec3(0.2, 0.4, 0.78);
  vec3 col = mix(mid, zenith, smoothstep(0.0, 0.75, up));
  col = mix(uHorizon, col, smoothstep(0.0, 0.22, pow(up, 0.75)));
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.82, 0.6) * (pow(sd, 6.0) * 0.12 + pow(sd, 40.0) * 0.25);

  // Horizon cumulus bank
  vec2 circ = normalize(d.xz + vec2(1e-5));
  vec3 cp = vec3(circ.x, 0.0, circ.y);
  float cover = fbm(cp * 2.2 + 4.0);
  float topEl = 0.035 + 0.24 * smoothstep(0.36, 0.72, cover);
  float billow = fbm(vec3(circ * 7.0, el * 16.0) + 9.0);
  float fine = fbm(vec3(circ * 22.0, el * 50.0) + 2.0);
  float edge = (topEl - el) + (billow - 0.5) * 0.16 + (fine - 0.5) * 0.045;
  float dens = smoothstep(0.0, 0.035, edge);
  float baseEl = 0.022 + (fbm(cp * 5.0) - 0.5) * 0.02;
  dens *= smoothstep(baseEl, baseEl + 0.012, el);
  float hgt = clamp((el - baseEl) / max(topEl - baseEl, 0.01), 0.0, 1.0);
  float sunSide = dot(circ, normalize(uSun.xz)) * 0.5 + 0.5;
  float light = clamp(hgt * 0.75 + billow * 0.5 - 0.15 + sunSide * 0.25, 0.0, 1.0);
  vec3 cloudCol = mix(vec3(0.42, 0.5, 0.64), vec3(1.25, 1.2, 1.12), light);
  cloudCol = mix(cloudCol, uHorizon * 1.15, smoothstep(0.09, 0.0, el) * 0.7);
  col = mix(col, cloudCol, dens * 0.96);

  // High thin cirrus
  if (d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.25);
    float c = fbm(vec3(uv * vec2(1.3, 3.2), 1.7));
    float wisp = smoothstep(0.52, 0.8, c) * smoothstep(0.1, 0.45, d.y);
    col = mix(col, vec3(1.0, 1.0, 1.02), wisp * 0.35);
  }

  // Haze band and below-horizon
  col = mix(col, uHorizon, smoothstep(0.03, -0.01, el) * 0.85);
  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.55, smoothstep(0.0, -0.4, d.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

const domeFrag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform samplerCube uSky;
uniform vec3 uSun;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = textureCube(uSky, d).rgb;
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.9, 0.72) * (smoothstep(0.99955, 0.9998, sd) * 45.0 + pow(sd, 900.0) * 3.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}
`;

export function createSky(renderer, scene) {
  const cubeRT = new THREE.WebGLCubeRenderTarget(1024, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const tmp = new THREE.Scene();
  const bake = new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthTest: false,
      uniforms: { uSun: { value: SUN_DIR }, uHorizon: { value: HORIZON } },
    })
  );
  tmp.add(bake);
  const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
  cubeCam.update(renderer, tmp);
  bake.geometry.dispose();
  bake.material.dispose();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: domeFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSky: { value: cubeRT.texture }, uSun: { value: SUN_DIR } },
    })
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);
  return { dome, cube: cubeRT.texture };
}
