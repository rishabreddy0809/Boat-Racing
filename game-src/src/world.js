import * as THREE from 'three';
import { mulberry, fbm3, ridged3, smooth, clamp, lerp } from './util.js';
import { WAVES_GLSL, waterHeight } from './waves.js';
import { REFLECT_LAYER, FOG_DENSITY } from './water.js';
import { HORIZON } from './sky.js';

export const COURSE_SAMPLES = 640;
export const GATE_COUNT = 14;
export const GATE_HALF = 15;

export function reflect(obj) {
  obj.traverse((o) => o.layers.enable(REFLECT_LAYER));
  return obj;
}

// ---------------------------------------------------------------- course
export function createCourse() {
  const pts = [];
  for (let i = 0; i < GATE_COUNT; i++) {
    const th = (i / GATE_COUNT) * Math.PI * 2;
    const r = 520 + 150 * Math.sin(3 * th + 1.0) + 85 * Math.sin(5 * th + 0.4);
    pts.push(new THREE.Vector3(Math.sin(th) * r, 0, Math.cos(th) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const sp = curve.getSpacedPoints(COURSE_SAMPLES);
  const px = new Float32Array(COURSE_SAMPLES), pz = new Float32Array(COURSE_SAMPLES);
  const tx = new Float32Array(COURSE_SAMPLES), tz = new Float32Array(COURSE_SAMPLES);
  for (let i = 0; i < COURSE_SAMPLES; i++) {
    px[i] = sp[i].x;
    pz[i] = sp[i].z;
  }
  for (let i = 0; i < COURSE_SAMPLES; i++) {
    const a = (i + COURSE_SAMPLES - 1) % COURSE_SAMPLES, b = (i + 1) % COURSE_SAMPLES;
    const dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz);
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  const length = curve.getLength();
  const gates = [];
  for (let g = 0; g < GATE_COUNT; g++) {
    const i = Math.round((g / GATE_COUNT) * COURSE_SAMPLES) % COURSE_SAMPLES;
    gates.push({ i, x: px[i], z: pz[i], tx: tx[i], tz: tz[i] });
  }
  return { px, pz, tx, tz, n: COURSE_SAMPLES, length, step: length / COURSE_SAMPLES, gates };
}

// ---------------------------------------------------------------- rocks
function rockMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uRockTex = { value: tex };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);'
      );
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRockTex;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec3 tw = pow(abs(normalize(vWNrm)), vec3(4.0));
        tw /= (tw.x + tw.y + tw.z);
        vec3 tp = vWPos * 0.085;
        vec3 tcol = texture2D(uRockTex, tp.zy).rgb * tw.x + texture2D(uRockTex, tp.xz).rgb * tw.y + texture2D(uRockTex, tp.xy).rgb * tw.z;
        vec3 tq = vWPos * 0.019 + 3.7;
        vec3 tmac = texture2D(uRockTex, tq.zy).rgb * tw.x + texture2D(uRockTex, tq.xz).rgb * tw.y + texture2D(uRockTex, tq.xy).rgb * tw.z;
        float rockH = dot(tcol, vec3(0.3333));
        float macH = dot(tmac, vec3(0.3333));
        tcol = mix(vec3(rockH), tcol, 0.5) * 1.9 * (0.45 + macH * 4.6);
        diffuseColor.rgb *= tcol;
        `
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        {
          vec3 bsx = dFdx(-vViewPosition), bsy = dFdy(-vViewPosition);
          vec3 br1 = cross(bsy, normal), br2 = cross(normal, bsx);
          float bdet = dot(bsx, br1);
          float bh = rockH * 2.2 + macH * 1.2;
          vec3 bg = sign(bdet) * (dFdx(bh) * br1 + dFdy(bh) * br2);
          normal = normalize(abs(bdet) * normal - bg);
        }
        `
      );
  };
  return m;
}

function makeRockGeometry(seed, R, H) {
  const rnd = mulberry(seed);
  const ox = rnd() * 200, oy = rnd() * 200, oz = rnd() * 200;
  const NV = 72, NS = 104, y0 = -8;
  const count = (NV + 1) * (NS + 1);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i <= NV; i++) {
    const v = i / NV;
    let y = y0 + (H - y0) * Math.pow(v, 0.9);
    const tv = clamp(y / H, -1, 1);
    let prof = 1;
    if (tv > 0.78) prof = Math.sqrt(Math.max(0, 1 - Math.pow((tv - 0.78) / 0.22, 2)));
    prof *= 0.84 + 0.16 * (1 - Math.max(tv, 0));
    prof *= 1 - 0.17 * Math.exp(-Math.pow((y - 1.2) / 1.9, 2));
    if (y < 0) prof *= 1 + 0.35 * smooth(0, -8, y);
    const detail = Math.min(1, prof * 3);
    const cx = (fbm3(ox, y * 0.028, 1.5, 2) - 0.5) * R * 0.9;
    const cz = (fbm3(7.5, y * 0.028, oz, 2) - 0.5) * R * 0.9;
    for (let j = 0; j <= NS; j++) {
      const th = ((j % NS) / NS) * Math.PI * 2;
      const dx = Math.cos(th), dz = Math.sin(th);
      const qx = dx * R, qz = dz * R;
      let r = R * prof * (0.66 + 0.68 * fbm3(qx * 0.05 + ox, y * 0.03 + oy, qz * 0.05 + oz, 3));
      r += (ridged3(qx * 0.13 + ox, y * 0.09 + oy, qz * 0.13 + oz, 4) - 0.42) * R * 0.26 * detail;
      const s = y / 2.7 + fbm3(qx * 0.05 + oy, y * 0.02, qz * 0.05 + ox, 2) * 1.6;
      const fr = s - Math.floor(s);
      r += (smooth(0.0, 0.1, fr) - smooth(0.5, 0.68, fr)) * 0.5 * detail;
      r += (fbm3(qx * 0.55, y * 0.55 + ox, qz * 0.55, 3) - 0.5) * 0.7 * detail;
      r = Math.max(r, 0.03);
      const yy = y + (fbm3(qx * 0.09 + oz, 3.3, qz * 0.09 + oy, 3) - 0.5) * H * 0.14 * smooth(0.55, 1, tv);
      const o = (i * (NS + 1) + j) * 3;
      pos[o] = cx + dx * r;
      pos[o + 1] = yy;
      pos[o + 2] = cz + dz * r;
    }
  }
  const idx = [];
  for (let i = 0; i < NV; i++) {
    for (let j = 0; j < NS; j++) {
      const a = i * (NS + 1) + j, b = a + 1, c = a + NS + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  // close the seam
  for (let i = 0; i <= NV; i++) {
    const a = (i * (NS + 1)) * 3, b = (i * (NS + 1) + NS) * 3;
    for (let k = 0; k < 3; k++) {
      const m = nrm[a + k] + nrm[b + k];
      nrm[a + k] = m;
      nrm[b + k] = m;
    }
    const l = Math.hypot(nrm[a], nrm[a + 1], nrm[a + 2]) || 1;
    for (let k = 0; k < 3; k++) {
      nrm[a + k] /= l;
      nrm[b + k] /= l;
    }
  }
  // colours + collision radius + bush sites
  let rad = 0;
  const sites = [];
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const ny = nrm[v * 3 + 1];
    if (y > -1 && y < 3.5) rad = Math.max(rad, Math.hypot(x, z));
    const n1 = fbm3(x * 0.07 + ox, y * 0.07, z * 0.07 + oz, 3);
    const band = 0.82 + 0.36 * fbm3(ox, y * 0.33 + n1 * 2.0, oz, 2);
    let r = 0.86 * band * lerp(0.7, 1.08, n1), g = 0.82 * band * lerp(0.7, 1.08, n1), b = 0.76 * band * lerp(0.72, 1.05, n1);
    // crevice darkening on overhangs
    const occ = lerp(0.62, 1, smooth(-0.5, 0.25, ny));
    r *= occ; g *= occ; b *= occ;
    // vegetation on ledges and tops
    const veg = smooth(0.45, 0.8, ny) * smooth(H * 0.22, H * 0.5, y) * smooth(0.3, 0.55, fbm3(x * 0.12, y * 0.1, z * 0.12 + ox, 3) + ny * 0.25);
    r = lerp(r, 0.2, veg); g = lerp(g, 0.3, veg); b = lerp(b, 0.1, veg);
    // tide line
    const wet = smooth(2.6 + n1 * 1.5, 0.2, y);
    r *= lerp(1, 0.3, wet); g *= lerp(1, 0.33, wet); b *= lerp(1, 0.32, wet);
    col[v * 3] = r; col[v * 3 + 1] = g; col[v * 3 + 2] = b;
    if (ny > 0.72 && y > H * 0.45 && veg > 0.4) sites.push(v);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const bushes = [];
  const nb = Math.min(sites.length, 8 + Math.floor(rnd() * 12));
  for (let i = 0; i < nb; i++) {
    const v = sites[Math.floor(rnd() * sites.length)];
    bushes.push([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], 1.1 + rnd() * 2.4]);
  }
  return { geo, rad: rad * 0.9, bushes };
}

export function createRocks(scene, course, rockTex) {
  const rnd = mulberry(20261116);
  const rocks = [];
  const mat = rockMaterial(rockTex);
  const clearOf = (x, z, margin) => {
    for (let i = 0; i < course.n; i += 2) {
      const dx = course.px[i] - x, dz = course.pz[i] - z;
      if (dx * dx + dz * dz < margin * margin) return false;
    }
    for (const r of rocks) if (Math.hypot(r.x - x, r.z - z) < r.R + margin * 0.6) return false;
    return true;
  };
  const specs = [];
  // stacks hugging the racing line
  for (let k = 0; k < 22; k++) {
    const i = Math.floor(((k + 0.5) / 22) * course.n + (rnd() - 0.5) * 12 + course.n) % course.n;
    if (i < 26 || i > course.n - 14) continue; // keep the start straight open
    const side = rnd() < 0.5 ? -1 : 1;
    const R = 9 + rnd() * 13;
    const off = R + 30 + rnd() * 26;
    specs.push([course.px[i] + -course.tz[i] * side * off, course.pz[i] + course.tx[i] * side * off, R, 30 + rnd() * 38, R + 26]);
  }
  // scattered field
  for (let k = 0; k < 60; k++) {
    const a = rnd() * Math.PI * 2, d = 120 + Math.pow(rnd(), 0.7) * 1250;
    const R = 10 + rnd() * 26;
    specs.push([Math.sin(a) * d, Math.cos(a) * d, R, 26 + rnd() * 60 + R * 0.6, R + 34]);
  }
  const bushList = [];
  for (const [x, z, R, H, margin] of specs) {
    if (rocks.length >= 46) break;
    if (!clearOf(x, z, margin)) continue;
    const { geo, rad, bushes } = makeRockGeometry(Math.floor(rnd() * 1e9), R, H);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(reflect(mesh));
    rocks.push({ x, z, R, r: rad, H });
    for (const b of bushes) bushList.push([x + b[0], b[1], z + b[2], b[3]]);
  }

  // shrubs
  const bg = new THREE.IcosahedronGeometry(1, 2);
  const bp = bg.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const s = 0.7 + 0.6 * fbm3(x * 1.7 + 5, y * 1.7, z * 1.7, 3);
    bp.setXYZ(i, x * s, y * s * 0.8 + 0.3, z * s);
  }
  bg.computeVertexNormals();
  const bm = new THREE.MeshStandardMaterial({ color: 0x2c3d17, roughness: 0.95 });
  const bushes = new THREE.InstancedMesh(bg, bm, bushList.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const c = new THREE.Color();
  bushList.forEach((b, i) => {
    e.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.3);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(b[0], b[1] - 0.2, b[2]), q, new THREE.Vector3(b[3], b[3] * (0.7 + rnd() * 0.6), b[3]));
    bushes.setMatrixAt(i, m4);
    c.setRGB(0.75 + rnd() * 0.5, 0.8 + rnd() * 0.4, 0.7 + rnd() * 0.4);
    bushes.setColorAt(i, c);
  });
  bushes.castShadow = true;
  scene.add(reflect(bushes));

  // surf rings
  return rocks;
}

export function createSurf(scene, rocks, foamTex) {
  const base = new THREE.PlaneGeometry(2, 2, 20, 20);
  base.rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  const inst = new Float32Array(rocks.length * 3);
  rocks.forEach((r, i) => {
    inst[i * 3] = r.x;
    inst[i * 3 + 1] = r.z;
    inst[i * 3 + 2] = r.r;
  });
  geo.setAttribute('aRock', new THREE.InstancedBufferAttribute(inst, 3));
  geo.instanceCount = rocks.length;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uFoam: { value: foamTex },
      uFogColor: { value: HORIZON },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aRock;
      uniform vec3 uCam;
      varying vec2 vL; varying vec2 vW; varying float vR; varying float vDist;
      ${WAVES_GLSL}
      void main() {
        float ext = aRock.z + 9.0;
        vec2 p = aRock.xy + position.xz * ext;
        float dist = length(vec3(p.x, 0.0, p.y) - uCam);
        vec3 d = waveDisplace(p, dist);
        vec3 wp = vec3(p.x, 0.07 + dist * 0.0012, p.y) + d;
        vL = position.xz * ext; vW = wp.xz; vR = aRock.z; vDist = dist;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime; uniform sampler2D uFoam; uniform vec3 uFogColor;
      varying vec2 vL; varying vec2 vW; varying float vR; varying float vDist;
      void main() {
        float d = length(vL);
        float ang = atan(vL.y, vL.x);
        float surge = 0.5 + 0.5 * sin(uTime * 0.7 + ang * 3.0 + vR);
        float a = smoothstep(vR + 2.5 + surge * 3.5, vR - 2.0, d) * 0.85;
        vec4 f1 = texture2D(uFoam, vW * 0.09 + uTime * 0.01);
        vec4 f2 = texture2D(uFoam, vW * 0.27 - uTime * 0.013);
        float pat = max(f1.r, f2.r * 0.9) * 0.6 + f1.g * 0.5;
        float alpha = clamp(a * 1.3, 0.0, 1.0) * smoothstep(0.8 - a * 0.9, 1.1 - a * 0.9, pat);
        vec3 col = vec3(0.8, 0.85, 0.9);
        float fog = 1.0 - exp(-${FOG_DENSITY.toFixed(6)} * ${FOG_DENSITY.toFixed(6)} * vDist * vDist);
        gl_FragColor = vec4(mix(col, uFogColor, fog), alpha * 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -4;
  scene.add(mesh);
  return mat;
}

// ---------------------------------------------------------------- mountains
export function createMountains(scene) {
  const arcs = [
    [-0.5, 1.5, 5200, 620, 11],
    [2.0, 3.3, 6000, 820, 23],
    [3.9, 5.3, 4700, 480, 37],
  ];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  for (const [a0, a1, rad, h, seed] of arcs) {
    const NA = 260, NR = 14, depth = 2400;
    const pos = [], col = [], idx = [];
    for (let i = 0; i <= NA; i++) {
      const u = i / NA, ang = lerp(a0, a1, u);
      const cx = Math.cos(ang) * 3, cz = Math.sin(ang) * 3;
      const endT = Math.pow(Math.sin(Math.PI * u), 0.45);
      for (let j = 0; j <= NR; j++) {
        const t = j / NR;
        const rr = rad + t * depth;
        const ridge = 0.25 + 0.75 * ridged3(cx * 1.4 + seed, t * 1.3, cz * 1.4, 5);
        const bulk = 0.35 + 0.65 * fbm3(cx * 0.7 + seed, 2.2, cz * 0.7, 3);
        const y = h * endT * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.8) * ridge * bulk * 1.6 - 6;
        pos.push(Math.sin(ang) * rr, y, Math.cos(ang) * rr);
        const k = clamp(y / h, 0, 1);
        const n = fbm3(cx * 6 + seed, t * 5, cz * 6, 3);
        col.push(lerp(0.13, 0.36, k) * (0.8 + n * 0.4), lerp(0.19, 0.33, k) * (0.8 + n * 0.4), lerp(0.1, 0.27, k) * (0.8 + n * 0.4));
      }
    }
    for (let i = 0; i < NA; i++) {
      for (let j = 0; j < NR; j++) {
        const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(reflect(mesh));
  }
}

// ---------------------------------------------------------------- gates
export function createGates(scene, course) {
  const hullGeo = new THREE.CylinderGeometry(0.95, 0.8, 1.0, 20);
  const coneGeo = new THREE.CylinderGeometry(0.22, 0.8, 2.3, 16);
  const bandGeo = new THREE.CylinderGeometry(0.52, 0.62, 0.42, 16);
  const lampGeo = new THREE.SphereGeometry(0.2, 12, 8);
  const red = new THREE.MeshStandardMaterial({ color: 0xc2341c, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.55 });
  const lampOff = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff5522, emissiveIntensity: 0.6 });
  const buoys = [];
  for (const g of course.gates) {
    for (const side of [-1, 1]) {
      const grp = new THREE.Group();
      const a = new THREE.Mesh(hullGeo, red); a.position.y = 0.2;
      const b = new THREE.Mesh(coneGeo, red); b.position.y = 1.8;
      const c = new THREE.Mesh(bandGeo, white); c.position.y = 1.55;
      const d = new THREE.Mesh(lampGeo, lampOff); d.position.y = 3.05;
      grp.add(a, b, c, d);
      grp.traverse((o) => (o.castShadow = true));
      const x = g.x + -g.tz * side * GATE_HALF, z = g.z + g.tx * side * GATE_HALF;
      grp.position.set(x, 0, z);
      grp.userData = { x, z, ph: Math.random() * 6 };
      scene.add(reflect(grp));
      buoys.push(grp);
    }
  }
  // beacons marking the next gate
  const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 14, 8, 1, true);
  beamGeo.translate(0, 10, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.2, 1.5, 0.6), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const lampOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 1.2) });
  const beacons = [0, 1].map(() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(beamGeo, beamMat));
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), lampOn);
    l.position.y = 3.05;
    g.add(l);
    scene.add(g);
    return g;
  });

  function update(t, nextGate) {
    for (const b of buoys) {
      const u = b.userData;
      b.position.y = waterHeight(u.x, u.z, t) - 0.1;
      b.rotation.x = Math.sin(t * 1.3 + u.ph) * 0.08;
      b.rotation.z = Math.cos(t * 1.1 + u.ph) * 0.08;
    }
    for (let s = 0; s < 2; s++) {
      const b = buoys[nextGate * 2 + s];
      beacons[s].position.copy(b.position);
    }
    beamMat.opacity = 0.22 + 0.1 * Math.sin(t * 5);
  }
  return { update };
}
