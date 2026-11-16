import * as THREE from 'three';
import { WAVES_GLSL } from './waves.js';
import { FOG_DENSITY } from './water.js';
import { HORIZON } from './sky.js';

const FOG = FOG_DENSITY.toFixed(6);

// ---------------------------------------------------------------- particles
export class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.next = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 4);
    this.s = new Float32Array(max);
    // life, maxLife, size0, size1, alpha, gravity, drag
    this.d = new Float32Array(max * 7);
    this.base = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uPx: { value: 800 }, uFogColor: { value: HORIZON } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; uniform float uPx;
        varying vec4 vC; varying float vDist;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_PointSize = min(aSize * uPx / max(-mv.z, 0.5), 700.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uFogColor;
        varying vec4 vC; varying float vDist;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d);
          if (vC.a * a < 0.004) discard;
          float fog = 1.0 - exp(-${FOG} * ${FOG} * vDist * vDist);
          vec3 col = ${additive ? 'vC.rgb * (1.0 - fog)' : 'mix(vC.rgb, uFogColor, fog)'};
          gl_FragColor = vec4(col, vC.a * a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 9.8, drag = 0.5) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    const o = i * 7;
    this.d[o] = 0; this.d[o + 1] = life; this.d[o + 2] = s0; this.d[o + 3] = s1; this.d[o + 4] = a; this.d[o + 5] = grav; this.d[o + 6] = drag;
  }
  update(dt) {
    const { p, v, c, s, d, base, max } = this;
    for (let i = 0; i < max; i++) {
      const o = i * 7;
      const ml = d[o + 1];
      if (ml <= 0) continue;
      const life = (d[o] += dt);
      if (life >= ml) {
        d[o + 1] = 0;
        s[i] = 0;
        c[i * 4 + 3] = 0;
        continue;
      }
      const t = life / ml;
      const dr = Math.max(0, 1 - d[o + 6] * dt);
      const j = i * 3;
      v[j] *= dr; v[j + 2] *= dr;
      v[j + 1] = v[j + 1] * dr - d[o + 5] * dt;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      s[i] = d[o + 2] + (d[o + 3] - d[o + 2]) * t;
      c[i * 4] = base[j]; c[i * 4 + 1] = base[j + 1]; c[i * 4 + 2] = base[j + 2];
      c[i * 4 + 3] = d[o + 4] * Math.min(1, t * 10) * (1 - t) * (1 - t * 0.3);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true;
    g.aColor.needsUpdate = true;
    g.aSize.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- wake foam
export class Wake {
  constructor(scene, max, foamTex) {
    this.max = max;
    this.next = 0;
    const base = new THREE.PlaneGeometry(1, 1, 3, 3);
    base.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    this.inst = new Float32Array(max * 4);
    this.fxa = new Float32Array(max * 2);
    // life, maxLife, size0, size1, alpha, vx, vz
    this.d = new Float32Array(max * 7);
    geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(this.inst, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFx', new THREE.InstancedBufferAttribute(this.fxa, 2).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFoam: { value: foamTex }, uFogColor: { value: HORIZON } },
      vertexShader: /* glsl */ `
        attribute vec4 aInst; attribute vec2 aFx;
        uniform vec3 uCam;
        varying vec2 vUv; varying vec2 vW; varying vec2 vFx; varying float vDist;
        ${WAVES_GLSL}
        void main() {
          float cr = cos(aInst.w), sr = sin(aInst.w);
          vec2 l = position.xz * aInst.z;
          vec2 p = aInst.xy + vec2(l.x * cr - l.y * sr, l.x * sr + l.y * cr);
          float dist = length(vec3(p.x, 0.0, p.y) - uCam);
          vec3 d = waveDisplace(p, dist);
          vec3 wp = vec3(p.x, 0.06 + dist * 0.0015, p.y) + d;
          vUv = position.xz + 0.5; vW = p; vFx = aFx; vDist = dist;
          gl_Position = aFx.x <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uFoam; uniform vec3 uFogColor;
        varying vec2 vUv; varying vec2 vW; varying vec2 vFx; varying float vDist;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float a = vFx.x * smoothstep(1.0, 0.2, r);
          vec4 f1 = texture2D(uFoam, vW * 0.11 + vFx.y);
          vec4 f2 = texture2D(uFoam, vW * 0.33 + vFx.y * 1.7);
          float pat = max(f1.r, f2.r * 0.9) * 0.6 + f1.g * 0.5;
          float alpha = clamp(a * 1.5, 0.0, 1.0) * smoothstep(0.78 - a * 0.95, 1.08 - a * 0.95, pat);
          if (alpha < 0.004) discard;
          float fog = 1.0 - exp(-${FOG} * ${FOG} * vDist * vDist);
          gl_FragColor = vec4(mix(vec3(0.8, 0.86, 0.92), uFogColor, fog), alpha * 0.95);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -3;
    scene.add(this.mesh);
  }
  spawn(x, z, size0, size1, life, alpha, vx = 0, vz = 0) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    this.inst[i * 4] = x; this.inst[i * 4 + 1] = z; this.inst[i * 4 + 2] = size0; this.inst[i * 4 + 3] = Math.random() * 6.283;
    this.fxa[i * 2] = alpha; this.fxa[i * 2 + 1] = Math.random();
    const o = i * 7;
    this.d[o] = 0; this.d[o + 1] = life; this.d[o + 2] = size0; this.d[o + 3] = size1; this.d[o + 4] = alpha; this.d[o + 5] = vx; this.d[o + 6] = vz;
  }
  update(dt, time, cam) {
    const { d, inst, fxa, max } = this;
    for (let i = 0; i < max; i++) {
      const o = i * 7, ml = d[o + 1];
      if (ml <= 0) continue;
      const life = (d[o] += dt);
      if (life >= ml) {
        d[o + 1] = 0;
        fxa[i * 2] = 0;
        continue;
      }
      const t = life / ml;
      inst[i * 4] += d[o + 5] * dt;
      inst[i * 4 + 1] += d[o + 6] * dt;
      inst[i * 4 + 2] = d[o + 2] + (d[o + 3] - d[o + 2]) * Math.sqrt(t);
      fxa[i * 2] = d[o + 4] * Math.pow(1 - t, 1.4);
    }
    const a = this.mesh.geometry.attributes;
    a.aInst.needsUpdate = true;
    a.aFx.needsUpdate = true;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uCam.value.copy(cam.position);
  }
}

// ---------------------------------------------------------------- rounds
// Every round is simulated; one in three is a tracer and glows, the rest are faint streaks.
export class Tracers {
  constructor(scene, max) {
    this.max = max;
    this.next = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.dmg = new Float32Array(max);
    this.bright = new Uint8Array(max);
    this.rico = new Uint8Array(max);
    this.owner = new Array(max).fill(null);
    const geo = new THREE.BoxGeometry(0.055, 0.055, 1);
    geo.translate(0, 0, -0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.z = new THREE.Vector3(0, 0, 1);
    this.dir = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.scl = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.cTracer = new THREE.Color(6.5, 1.7, 0.45);
    this.cBall = new THREE.Color(0.55, 0.48, 0.36);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.cBall);
    }
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }
  fire(owner, x, y, z, vx, vy, vz, dmg, bright) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = 1.25;
    this.age[i] = 0;
    this.dmg[i] = dmg;
    this.bright[i] = bright ? 1 : 0;
    this.rico[i] = 0;
    this.owner[i] = owner;
    this.mesh.setColorAt(i, bright ? this.cTracer : this.cBall);
    this.mesh.instanceColor.needsUpdate = true;
  }
  kill(i) {
    this.life[i] = 0;
  }
  sync(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      const j = i * 3;
      this.age[i] += dt;
      this.dir.set(this.v[j], this.v[j + 1], this.v[j + 2]);
      const sp = this.dir.length();
      this.dir.divideScalar(sp);
      this.q.setFromUnitVectors(this.z, this.dir);
      this.pos.set(this.p[j], this.p[j + 1], this.p[j + 2]);
      // streak = distance covered during a ~1/50 s exposure, never longer than the flight so far
      const len = Math.min(sp * (this.bright[i] ? 0.02 : 0.009), sp * this.age[i] + 0.5);
      const w = this.bright[i] ? 1 : 0.5;
      this.scl.set(w, w, len);
      this.m.compose(this.pos, this.q, this.scl);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
