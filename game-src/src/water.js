import * as THREE from 'three';
import { WAVES_GLSL } from './waves.js';
import { SUN_DIR, SUN_COLOR, HORIZON } from './sky.js';
import { makeRippleTexture, makeFoamTexture } from './util.js';

export const FOG_DENSITY = 0.00017;
export const REFLECT_LAYER = 1;
export const MAX_BOATS = 8;

const vert = /* glsl */ `
uniform vec3 uCenter;
varying vec2 vP0;
varying vec3 vWorld;
${WAVES_GLSL}
void main() {
  vec2 p = position.xz + uCenter.xz;
  float dist = length(position.xz);
  vec3 d = waveDisplace(p, dist);
  vec3 wp = vec3(p.x, 0.0, p.y) + d;
  vP0 = p;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const frag = /* glsl */ `
precision highp float;
uniform vec3 uCam, uSun, uSunColor, uFogColor;
uniform float uFogDensity;
uniform samplerCube uSky;
uniform sampler2D uRipple, uFoam, uRefl;
uniform mat4 uReflMatrix;
uniform vec4 uBoats[${MAX_BOATS}];
varying vec2 vP0;
varying vec3 vWorld;
${WAVES_GLSL}
void main() {
  vec3 toCam = uCam - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float crest;
  vec3 N = waveNormal(vP0, dist, crest);

  float t = uTime;
  vec3 r1 = texture2D(uRipple, vP0 * 0.021 + t * vec2(0.006, 0.004)).xyz * 2.0 - 1.0;
  vec3 r2 = texture2D(uRipple, vP0 * 0.083 + t * vec2(-0.017, 0.012)).xyz * 2.0 - 1.0;
  vec3 r3 = texture2D(uRipple, vP0 * 0.31 + t * vec2(0.03, -0.045)).xyz * 2.0 - 1.0;
  vec2 rip = r1.xy * 0.2 / (1.0 + dist * 0.0012) + r2.xy * 0.2 / (1.0 + dist * 0.006) + r3.xy * 0.17 / (1.0 + dist * 0.03);
  N = normalize(vec3(N.x + rip.x, N.y, N.z + rip.y));
  float nv = dot(N, V);
  if (nv < 0.03) N = normalize(N + V * (0.03 - nv));
  float ndv = max(dot(N, V), 0.0);

  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fres *= mix(1.0, 0.72, smoothstep(150.0, 2500.0, dist));

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  R = normalize(R + vec3(0.0, 0.04, 0.0));
  vec3 sky = textureCube(uSky, R).rgb;

  // Planar reflection of rocks and boats
  vec4 rc = uReflMatrix * vec4(vWorld.x + N.x * 5.0, 0.0, vWorld.z + N.z * 5.0, 1.0);
  if (rc.w > 0.0) {
    vec4 pr = texture2D(uRefl, clamp(rc.xy / rc.w, 0.002, 0.998));
    sky = mix(sky, pr.rgb, pr.a * 0.92);
  }

  // Boat contact shadows
  float shade = 1.0;
  vec2 sOff = -uSun.xz / uSun.y * 0.9;
  for (int i = 0; i < ${MAX_BOATS}; i++) {
    vec4 b = uBoats[i];
    vec2 dl = vWorld.xz - b.xy - sOff;
    vec2 fw = vec2(sin(b.z), cos(b.z));
    float al = dot(dl, fw), sd = dot(dl, vec2(fw.y, -fw.x));
    float d = length(vec2(al / 6.4, sd / 2.8));
    shade *= 1.0 - 0.6 * b.w * smoothstep(1.0, 0.4, d);
  }

  float sr = max(dot(R, uSun), 0.0);
  vec3 spec = uSunColor * (pow(sr, 800.0) * 36.0 + pow(sr, 70.0) * 0.5) * shade;

  vec3 deep = vec3(0.004, 0.02, 0.048);
  vec3 scatter = vec3(0.0, 0.1, 0.115);
  vec3 sunFlat = normalize(vec3(uSun.x, 0.0, uSun.z));
  float toward = pow(max(dot(V, -sunFlat), 0.0), 2.0);
  float sss = smoothstep(-0.3, 1.1, vWorld.y) * (0.3 + 0.7 * toward);
  vec3 body = deep * (0.7 + 1.3 * max(dot(N, uSun), 0.0)) + scatter * sss * (1.0 - ndv * 0.6);
  body *= mix(0.6, 1.0, shade);

  vec3 col = mix(body, sky * mix(0.75, 1.0, shade), fres) + spec;

  // Whitecaps
  vec4 f1 = texture2D(uFoam, vP0 * 0.055 + t * vec2(0.004, 0.002));
  vec4 f2 = texture2D(uFoam, vP0 * 0.17 - t * vec2(0.006, 0.003));
  float fn = f1.g * 0.6 + f2.g * 0.4;
  float fm = smoothstep(0.3, 0.5, crest + (fn - 0.5) * 0.42);
  float lace = max(f1.r, f2.r * 0.85);
  float foam = fm * smoothstep(0.1, 0.55, lace + fm * 0.55);
  foam *= 1.0 - 0.75 * smoothstep(250.0, 1200.0, dist);
  vec3 foamCol = vec3(0.82, 0.88, 0.94) * (0.4 + 0.8 * max(dot(N, uSun), 0.0)) * mix(0.55, 1.0, shade);
  col = mix(col, foamCol, foam * 0.9);

  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createWater(renderer, scene, skyCube) {
  const NR = 330, NS = 384;
  const a = 17.5, k = 0.02;
  const pos = new Float32Array((NR + 1) * NS * 3);
  for (let i = 0; i <= NR; i++) {
    const r = a * (Math.exp(k * i) - 1);
    for (let j = 0; j < NS; j++) {
      const th = (j / NS) * Math.PI * 2;
      const o = (i * NS + j) * 3;
      pos[o] = Math.cos(th) * r;
      pos[o + 1] = 0;
      pos[o + 2] = Math.sin(th) * r;
    }
  }
  const idx = new Uint32Array(NR * NS * 6);
  let n = 0;
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NS; j++) {
      const j2 = (j + 1) % NS;
      const p00 = i * NS + j, p01 = i * NS + j2, p10 = (i + 1) * NS + j, p11 = (i + 1) * NS + j2;
      idx[n++] = p00; idx[n++] = p01; idx[n++] = p10;
      idx[n++] = p01; idx[n++] = p11; idx[n++] = p10;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const ripple = makeRippleTexture(512);
  const foam = makeFoamTexture(256);

  const reflRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: true });
  const boats = [];
  for (let i = 0; i < MAX_BOATS; i++) boats.push(new THREE.Vector4(0, 0, 0, 0));

  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uCam: { value: new THREE.Vector3() },
    uSun: { value: SUN_DIR },
    uSunColor: { value: SUN_COLOR },
    uFogColor: { value: HORIZON },
    uFogDensity: { value: FOG_DENSITY },
    uSky: { value: skyCube },
    uRipple: { value: ripple },
    uFoam: { value: foam },
    uRefl: { value: reflRT.texture },
    uReflMatrix: { value: new THREE.Matrix4() },
    uBoats: { value: boats },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  scene.add(mesh);

  // Planar reflection
  const vcam = new THREE.PerspectiveCamera();
  vcam.layers.set(REFLECT_LAYER);
  const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.35)];
  const noClip = [];
  const cp = new THREE.Vector3(), tg = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const clearCol = new THREE.Color();

  function setSize(w, h) {
    reflRT.setSize(Math.max(8, Math.floor(w / 2)), Math.max(8, Math.floor(h / 2)));
  }

  function renderReflection(camera) {
    camera.getWorldPosition(cp);
    camera.getWorldDirection(fw);
    tg.copy(cp).add(fw);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    vcam.position.set(cp.x, -cp.y, cp.z);
    vcam.up.set(up.x, -up.y, up.z);
    vcam.lookAt(tg.x, -tg.y, tg.z);
    vcam.near = camera.near;
    vcam.far = camera.far;
    vcam.projectionMatrix.copy(camera.projectionMatrix);
    vcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    vcam.updateMatrixWorld();
    uniforms.uReflMatrix.value.copy(bias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);

    const prevRT = renderer.getRenderTarget();
    renderer.getClearColor(clearCol);
    const prevAlpha = renderer.getClearAlpha();
    const prevBg = scene.background;
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.clippingPlanes = clip;
    renderer.setRenderTarget(reflRT);
    renderer.clear();
    renderer.render(scene, vcam);
    renderer.setRenderTarget(prevRT);
    renderer.clippingPlanes = noClip;
    renderer.setClearColor(clearCol, prevAlpha);
    scene.background = prevBg;
  }

  function update(time, camera) {
    uniforms.uTime.value = time;
    uniforms.uCenter.value.set(camera.position.x, 0, camera.position.z);
    uniforms.uCam.value.copy(camera.position);
  }

  return { mesh, uniforms, update, renderReflection, setSize, boats, ripple, foam };
}
