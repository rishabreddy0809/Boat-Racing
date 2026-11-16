import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import ROCK_URL from '../tex/rock.jpg';
import { waterHeight } from './waves.js';
import { createSky, SUN_DIR, SUN_COLOR, HORIZON } from './sky.js';
import { createWater, FOG_DENSITY, REFLECT_LAYER, MAX_BOATS } from './water.js';
import { createCourse, createRocks, createSurf, createMountains, createGates, reflect, GATE_COUNT } from './world.js';
import { createBoat, loadBoatAsset, TURRET_POS } from './boat.js';
import { Particles, Wake, Tracers } from './fx.js';
import { createAudio } from './audio.js';
import { clamp, lerp, smooth, damp, angDiff } from './util.js';

const LAPS = 3;
const NAMES = ['YOU', 'ORCA', 'BRINE', 'TALON', 'MISTRAL', 'COBALT'];
const ACCENTS = [0xff4a12, 0x2f8fd0, 0xd8c020, 0x35b06a, 0xb04ad0, 0xd03048];
const $ = (id) => document.getElementById(id);
const rnd = Math.random;
const rs = () => Math.random() * 2 - 1;

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(HORIZON, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(64, 1, 0.6, 14000);
camera.position.set(0, 5, -20);

const sun = new THREE.DirectionalLight(SUN_COLOR, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 600;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.06;
sun.layers.enable(REFLECT_LAYER);
scene.add(sun, sun.target);
const flashLight = new THREE.PointLight(0xffa860, 0, 160, 1.6);
const muzzleLight = new THREE.PointLight(0xffb060, 0, 30, 1.8);
flashLight.layers.enable(REFLECT_LAYER);
scene.add(flashLight, muzzleLight);

const sky = createSky(renderer, scene);
const water = createWater(renderer, scene, sky.cube);
const course = createCourse();
const rockTex = new THREE.TextureLoader().load(ROCK_URL);
rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;
rockTex.colorSpace = THREE.SRGBColorSpace;
rockTex.anisotropy = 8;
const rocks = createRocks(scene, course, rockTex);
const surfMat = createSurf(scene, rocks, water.foam);
createMountains(scene);
const gates = createGates(scene, course);

const spray = new Particles(scene, 5000, false);
const fire = new Particles(scene, 2500, true);
const wake = new Wake(scene, 1600, water.foam);
const tracers = new Tracers(scene, 320);
const audio = createAudio();

// ------------------------------------------------------------------ post
const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.65, 1.5);
composer.addPass(bloom);
const speedPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uStrength, uHit, uTime; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - vec2(0.5, 0.46);
      float r2 = dot(c, c);
      vec2 dir = c * r2 * uStrength * 0.3;
      float j = hash(vUv * 913.0 + uTime) - 0.5;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 10; i++) col += texture2D(tDiffuse, vUv - dir * (float(i) + j) / 10.0).rgb;
      col /= 10.0;
      // slight chromatic fringe at the edges
      float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.15)));
      col *= mix(0.62, 1.0, vig);
      col = mix(col, col * vec3(1.25, 0.6, 0.5), uHit * (1.0 - vig * 0.75));
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(speedPass);
composer.addPass(new OutputPass());

let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  water.setSize(w * pixelRatio, h * pixelRatio);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ boats
loadBoatAsset();
const boats = [];
function makeBoat(i) {
  const model = createBoat(ACCENTS[i]);
  scene.add(model.group);
  model.group.rotation.order = 'YXZ';
  return {
    i, name: NAMES[i], isPlayer: i === 0, model,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, speed: 0, y: 0, vy: 0, pitch: 0, roll: 0, hPrev: 0, air: 0,
    steer: 0, steerIn: 0, throttle: 0, boosting: false, boost: 100,
    hp: 100, alive: true, respawnT: 0, invuln: 0, lastHit: -99,
    heat: 0, overheated: false, gunT: 0, barrel: 0, firing: false,
    rockets: 4, rocketT: 0, mines: 3, mineT: 0, rocketCd: 0, mineCd: 0,
    aimYaw: 0, aimPitch: 0, recoil: 0, shotN: 0, onTarget: false, assist: null,
    wantDir: new THREE.Vector3(0, 0, 1), gunDir: new THREE.Vector3(0, 0, 1), turretPos: new THREE.Vector3(),
    target: null, idx: 0, lap: -1, prog: 0, finished: false, finishTime: 0, wrecks: 0, rank: i + 1,
    baseSpeed: 44, maxSpeed: 44, wakeA: 0, wakeB: 0,
    ai: { errX: 0, errY: 0, errT: 0, offset: rs() * 6, offT: 0, burst: 0, rocketCd: 6 + rnd() * 8, mineCd: 8 + rnd() * 12 },
  };
}
for (let i = 0; i < 6; i++) boats.push(makeBoat(i));
const player = boats[0];
const aiSpeeds = [0, 43.2, 42.4, 41.8, 41.2, 40.6];

function placeOnCourse(b, idx, lateral, speed) {
  const n = course.n;
  idx = ((idx % n) + n) % n;
  b.pos.set(course.px[idx] - course.tz[idx] * lateral, 0, course.pz[idx] + course.tx[idx] * lateral);
  b.heading = Math.atan2(course.tx[idx], course.tz[idx]);
  b.speed = speed;
  b.vel.set(Math.sin(b.heading) * speed, 0, Math.cos(b.heading) * speed);
  b.idx = idx;
  b.y = waterHeight(b.pos.x, b.pos.z, time);
  b.hPrev = b.y;
  b.vy = 0;
  b.steer = 0;
}

const dbg = { auto: false, drive: false, scale: 1 };
let time = 0, raceTime = 0, state = 'title', countdown = 0, paused = false, shake = 0, hitFx = 0, camHeading = 0, titleAng = 0;
let lastCount = 9;

function resetRace() {
  const order = [1, 2, 3, 4, 5, 0];
  order.forEach((bi, slot) => {
    const b = boats[bi];
    placeOnCourse(b, course.n - 5 - slot * 4, slot % 2 ? 6 : -6, 0);
    Object.assign(b, {
      lap: -1, hp: 100, alive: true, invuln: 0, heat: 0, overheated: false, rockets: 4, mines: 3, rocketT: 0, mineT: 0,
      finished: false, wrecks: 0, boost: 100, target: null, throttle: 0, steerIn: 0, lastHit: -99, air: 0,
    });
    b.baseSpeed = b.isPlayer ? 44 : aiSpeeds[bi];
    b.model.group.visible = true;
  });
  for (const r of rocketPool) r.active = false, (r.mesh.visible = false);
  for (const m of minePool) m.active = false, (m.mesh.visible = false);
  raceTime = 0;
  camHeading = player.heading;
  feed.length = 0;
}

// ------------------------------------------------------------------ rockets & mines
const rocketPool = [], minePool = [];
{
  const body = new THREE.CylinderGeometry(0.09, 0.09, 1.0, 8);
  body.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.4, metalness: 0.8 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4, 1.2) });
  const gg = new THREE.SphereGeometry(0.16, 8, 6);
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(body, mat));
    const g = new THREE.Mesh(gg, glow);
    g.position.z = -0.6;
    mesh.add(g);
    mesh.visible = false;
    scene.add(reflect(mesh));
    rocketPool.push({ mesh, pos: mesh.position, dir: new THREE.Vector3(), speed: 0, life: 0, owner: null, target: null, active: false });
  }
  const mg = new THREE.SphereGeometry(0.5, 14, 10);
  const sg = new THREE.CylinderGeometry(0.05, 0.08, 0.3, 6);
  const mm = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.55, metalness: 0.7 });
  for (let i = 0; i < 16; i++) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(mg, mm));
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]]) {
      const s = new THREE.Mesh(sg, mm);
      const d = new THREE.Vector3(x, y, z).normalize();
      s.position.copy(d).multiplyScalar(0.6);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      mesh.add(s);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2010 }));
    lamp.position.y = 0.82;
    mesh.add(lamp);
    mesh.visible = false;
    scene.add(reflect(mesh));
    minePool.push({ mesh, lamp, x: 0, z: 0, age: 0, owner: null, active: false });
  }
}

// ------------------------------------------------------------------ input
const keys = new Set();
const touch = { on: false, steer: 0, fire: false, boost: false };
let mouseFire = false, mouseMoved = false, gunView = false, gunViewHeld = false;
const mouseNDC = new THREE.Vector2(0, 0.1);
const mousePx = { x: 0, y: 0 };
window.addEventListener('keydown', (e) => {
  if (!e.metaKey && !e.ctrlKey && /^(Key|Arrow|Space|Shift|Enter)/.test(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Enter') startOrRestart();
  if (e.code === 'KeyP' && (state === 'race' || state === 'countdown')) {
    paused = !paused;
    $('pause').style.display = paused ? 'flex' : 'none';
  }
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'KeyV') gunView = !gunView;
  if (state === 'race' && !paused) {
    if (e.code === 'KeyE' || e.code === 'KeyF') fireRocket(player);
    if (e.code === 'KeyQ') dropMine(player);
    if (e.code === 'KeyR') recover(player);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseFire = true;
  if (e.button === 2) gunViewHeld = true;
});
window.addEventListener('mousemove', (e) => {
  mousePx.x = e.clientX;
  mousePx.y = e.clientY;
  mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (!touch.on) mouseMoved = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseFire = false;
  if (e.button === 2) gunViewHeld = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
$('start').addEventListener('click', startOrRestart);
$('again').addEventListener('click', startOrRestart);

// touch controls
if ('ontouchstart' in window) {
  touch.on = true;
  document.body.classList.add('touch');
  const pad = $('pad');
  let padId = null, padX = 0;
  pad.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; padId = t.identifier; padX = t.clientX; e.preventDefault(); }, { passive: false });
  pad.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === padId) touch.steer = clamp(-(t.clientX - padX) / 70, -1, 1);
    e.preventDefault();
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) if (t.identifier === padId) { padId = null; touch.steer = 0; } };
  pad.addEventListener('touchend', end);
  pad.addEventListener('touchcancel', end);
  const hold = (id, on, off) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    if (off) { el.addEventListener('touchend', off); el.addEventListener('touchcancel', off); }
  };
  hold('tFire', () => (touch.fire = true), () => (touch.fire = false));
  hold('tBoost', () => (touch.boost = true), () => (touch.boost = false));
  hold('tRocket', () => state === 'race' && fireRocket(player));
  hold('tMine', () => state === 'race' && dropMine(player));
}

function startOrRestart() {
  audio.init();
  if (state === 'title' || state === 'finished') {
    resetRace();
    state = 'countdown';
    countdown = 3.6;
    lastCount = 9;
    $('title').style.display = 'none';
    $('credit').style.display = 'none';
    $('results').style.display = 'none';
    $('hud').style.display = 'block';
  }
}

// ------------------------------------------------------------------ fx helpers
const feed = [];
function say(text) {
  feed.unshift({ text, t: time });
  if (feed.length > 4) feed.pop();
}
let banner = { text: '', until: 0 };
function showBanner(text, dur = 1.6) {
  banner = { text, until: time + dur };
}
const camDist = (x, z) => Math.hypot(x - camera.position.x, z - camera.position.z);

function explosion(x, y, z, big = 1) {
  const d = camDist(x, z);
  for (let i = 0; i < 26 * big; i++)
    fire.spawn(x + rs() * big, y + 0.6 + rnd() * big, z + rs() * big, rs() * 9, 2 + rnd() * 10, rs() * 9, 0.35 + rnd() * 0.5, 1.5 * big, 6.5 * big, 3.4, 1.5, 0.35, 0.8, -2, 2.5);
  for (let i = 0; i < 18 * big; i++)
    spray.spawn(x + rs() * 1.5, y + 1 + rnd() * 2, z + rs() * 1.5, rs() * 5, 3 + rnd() * 6, rs() * 5, 1.6 + rnd() * 1.6, 3, 11 * big, 0.06, 0.06, 0.065, 0.6, -1.4, 1.1);
  for (let i = 0; i < 40; i++)
    fire.spawn(x, y + 0.8, z, rs() * 26, 4 + rnd() * 22, rs() * 26, 0.6 + rnd() * 0.9, 0.24, 0.07, 4.5, 2.2, 0.5, 1, 15, 0.3);
  for (let i = 0; i < 40; i++) {
    const a = rnd() * 6.28, s = 3 + rnd() * 8;
    spray.spawn(x, y + 0.2, z, Math.cos(a) * s, 7 + rnd() * 13, Math.sin(a) * s, 0.9 + rnd() * 0.8, 1, 4.2, 0.9, 0.94, 0.98, 0.45, 15, 0.5);
  }
  wake.spawn(x, z, 5, 17 * big, 5.5, 1);
  flashLight.position.set(x, y + 3, z);
  flashLight.intensity = 9000 * big;
  audio.explosion(d, big);
  shake = Math.max(shake, (1.3 * big) / (1 + d / 28));
}
function sparks(x, y, z, n = 8) {
  for (let i = 0; i < n; i++)
    fire.spawn(x, y, z, rs() * 12, rnd() * 10, rs() * 12, 0.25 + rnd() * 0.5, 0.2, 0.05, 4.5, 2.3, 0.5, 1, 16, 0.4);
}
function splash(x, z, y, n = 6, s = 1) {
  for (let i = 0; i < n; i++)
    spray.spawn(x + rs() * 0.4 * s, y + 0.1, z + rs() * 0.4 * s, rs() * 2.5 * s, (3 + rnd() * 5) * s, rs() * 2.5 * s, 0.5 + rnd() * 0.5, 0.5 * s, 2 * s, 0.9, 0.94, 0.98, 0.4, 14, 0.6);
}

// ------------------------------------------------------------------ combat
function damage(b, amount, by, x, y, z) {
  if (!b.alive || b.invuln > 0 || b.finished || state !== 'race') return;
  b.hp -= amount;
  b.lastHit = time;
  if (b.isPlayer) {
    hitFx = Math.min(1, hitFx + amount / 28);
    shake = Math.max(shake, Math.min(0.6, amount / 40));
  }
  if (b.hp <= 0) {
    b.hp = 0;
    b.alive = false;
    b.respawnT = 2.8;
    b.model.group.visible = false;
    explosion(b.pos.x, b.y, b.pos.z, 1.5);
    if (by && by !== b) {
      by.wrecks++;
      say(`${by.name} wrecked ${b.name}`);
      if (by.isPlayer) showBanner(`${b.name} WRECKED`, 1.8);
    } else say(`${b.name} wrecked`);
    if (b.isPlayer) showBanner('HULL LOST', 2.2);
  }
}
function recover(b) {
  if (!b.alive) return;
  placeOnCourse(b, b.idx, 0, 8);
  b.invuln = 2;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();
const BULLET_V = 620;
const _q = new THREE.Quaternion(), _l = new THREE.Vector3(), _aim = new THREE.Vector3();
const aimRay = new THREE.Raycaster();
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
const mouseAim = () => mouseMoved && !touch.on && !dbg.auto;

// Point to aim at so a round fired now meets a moving boat, including bullet drop.
function leadPoint(from, t, out) {
  const tt = from.distanceTo(t.pos) / BULLET_V;
  return out.set(t.pos.x + t.vel.x * tt, t.y + 1.2 + 4.9 * tt * tt, t.pos.z + t.vel.z * tt);
}

// Where the player wants the guns: along the cursor ray, snapping to a boat very near it.
function playerWantDir(b, out) {
  aimRay.setFromCamera(mouseNDC, camera);
  const o = aimRay.ray.origin, d = aimRay.ray.direction;
  let best = null, bestAng = 0.04, near = null, nearAng = 0.16;
  for (const e of boats) {
    if (e === b || !e.alive) continue;
    _v.set(e.pos.x - o.x, e.y + 1.2 - o.y, e.pos.z - o.z);
    const dist = _v.length();
    if (dist > 520) continue;
    const ang = Math.acos(clamp(_v.dot(d) / dist, -1, 1));
    if (ang < bestAng) { bestAng = ang; best = e; }
    if (ang < nearAng && e.invuln <= 0) { nearAng = ang; near = e; }
  }
  b.assist = best;
  b.target = near;
  if (best) leadPoint(b.turretPos, best, _aim);
  else {
    let t = 450;
    if (d.y < -0.003) t = Math.min(450, (0.5 - o.y) / d.y);
    _aim.copy(o).addScaledVector(d, Math.max(t, 12));
    const tt = b.turretPos.distanceTo(_aim) / BULLET_V;
    _aim.y += 4.9 * tt * tt;
  }
  return out.copy(_aim).sub(b.turretPos).normalize();
}

// Slew the mount toward the wanted direction at a limited rate, in the boat's own frame,
// so the guns lag the cursor and have to fight the hull's pitch and roll.
function updateTurret(b, dt) {
  const m = b.model, g = m.group;
  b.turretPos.copy(TURRET_POS).applyQuaternion(g.quaternion).add(g.position);
  b.turretPos.y += 0.2;
  const live = state === 'race' && !b.finished;
  if (b.isPlayer && live && mouseAim()) playerWantDir(b, b.wantDir);
  else if (live && b.target && b.target.alive) {
    leadPoint(b.turretPos, b.target, _aim);
    b.wantDir.copy(_aim).sub(b.turretPos).normalize();
    if (!b.isPlayer) {
      const a = b.ai;
      if ((a.errT -= dt) <= 0) { a.errT = 0.5 + rnd() * 0.8; a.wantEX = gauss() * 0.022; a.wantEY = gauss() * 0.012; }
      a.errX = damp(a.errX, a.wantEX || 0, 3, dt);
      a.errY = damp(a.errY, a.wantEY || 0, 3, dt);
      b.wantDir.x += a.errX * Math.cos(b.heading); b.wantDir.z -= a.errX * Math.sin(b.heading); b.wantDir.y += a.errY;
      b.wantDir.normalize();
    }
  } else b.wantDir.set(Math.sin(b.heading), 0.01, Math.cos(b.heading)).normalize();

  _l.copy(b.wantDir).applyQuaternion(_q.copy(g.quaternion).invert());
  const yaw = clamp(Math.atan2(_l.x, _l.z), -2.5, 2.5);
  const pitch = clamp(Math.asin(clamp(_l.y, -1, 1)), -0.22, 0.75);
  const dy = yaw - b.aimYaw, dp = pitch - b.aimPitch;
  b.aimYaw += clamp(dy, -3.3 * dt, 3.3 * dt);
  b.aimPitch += clamp(dp, -2.4 * dt, 2.4 * dt);
  b.onTarget = Math.abs(dy) < 0.03 && Math.abs(dp) < 0.03;
  b.recoil = Math.max(0, b.recoil - dt * 11);
  m.turret.rotation.y = b.aimYaw;
  m.gun.rotation.x = -b.aimPitch - b.recoil * 0.012;
  m.gun.position.z = -b.recoil * 0.06;
  m.flag.rotation.y = Math.PI / 2 + Math.sin(time * 9 + b.i) * 0.25 * clamp(Math.abs(b.speed) / 20, 0.2, 1);
}

function fireCannon(b) {
  if (b.gunT > 0 || b.overheated) return;
  const k = (b.barrel ^= 1);
  b.model.muzzles[k].getWorldPosition(_v);
  _d.copy(b.gunDir);
  // dispersion: gaussian cone, wider for AI gunners
  const spread = b.isPlayer ? 0.0042 : 0.012;
  _v2.set(gauss(), gauss(), gauss()).multiplyScalar(spread);
  _d.add(_v2).normalize();
  const tracer = b.shotN++ % 3 === 0;
  tracers.fire(b, _v.x, _v.y, _v.z, _d.x * BULLET_V + b.vel.x, _d.y * BULLET_V, _d.z * BULLET_V + b.vel.z, b.isPlayer ? 5 : 2.6, tracer);
  b.recoil = 1;
  const cd = camDist(_v.x, _v.z);
  if (cd < 400) {
    // flash: bright core + forward tongue + sideways gas, then a drifting smoke puff
    fire.spawn(_v.x + _d.x * 0.25, _v.y + _d.y * 0.25, _v.z + _d.z * 0.25, b.vel.x, 0, b.vel.z, 0.045, 1.3, 0.5, 6, 3.4, 1.1, 1, 0, 0);
    fire.spawn(_v.x + _d.x * 0.9, _v.y + _d.y * 0.9, _v.z + _d.z * 0.9, b.vel.x + _d.x * 20, _d.y * 20, b.vel.z + _d.z * 20, 0.05, 0.8, 0.25, 5, 2.4, 0.6, 0.9, 0, 0);
    for (let n = 0; n < 3; n++)
      fire.spawn(_v.x, _v.y, _v.z, b.vel.x + _d.x * 30 + rs() * 12, _d.y * 30 + rs() * 12, b.vel.z + _d.z * 30 + rs() * 12, 0.07 + rnd() * 0.08, 0.14, 0.04, 5, 2.6, 0.6, 1, 6, 2);
    spray.spawn(_v.x + _d.x * 0.6, _v.y + _d.y * 0.6, _v.z + _d.z * 0.6, b.vel.x * 0.8 + _d.x * 4, 0.8, b.vel.z * 0.8 + _d.z * 4, 0.5 + rnd() * 0.4, 0.35, 1.6, 0.5, 0.5, 0.5, 0.2, -0.6, 1.5);
    // spent brass kicked out to the side of the mount
    const sgn = k ? -1 : 1, yw = b.heading + b.aimYaw;
    const lx = Math.cos(yw) * sgn, lz = -Math.sin(yw) * sgn;
    spray.spawn(_v.x - _d.x * 1.4 + lx * 0.15, _v.y - _d.y * 1.4 + 0.05, _v.z - _d.z * 1.4 + lz * 0.15,
      b.vel.x + lx * (2 + rnd() * 2), 2 + rnd() * 2, b.vel.z + lz * (2 + rnd() * 2), 0.7, 0.055, 0.05, 0.95, 0.72, 0.28, 1.6, 13, 0.1);
  }
  b.gunT = (b.gunT < -0.05 ? 0 : b.gunT) + (b.isPlayer ? 1 / 11 : 1 / 6.5);
  b.heat += b.isPlayer ? 0.052 : 0.06;
  if (b.heat >= 1) b.overheated = true;
  audio.gun(b.isPlayer ? 0 : cd);
  if (b.isPlayer) {
    muzzleLight.position.copy(_v);
    muzzleLight.intensity = 320;
    shake = Math.max(shake, gunCam > 0.5 ? 0.16 : 0.09);
  }
}
function fireRocket(b) {
  if (!b.alive || b.rockets <= 0 || b.rocketCd > 0) return;
  const r = rocketPool.find((r) => !r.active);
  if (!r) return;
  b.rockets--;
  b.rocketCd = 0.45;
  const side = b.rockets % 2 ? 1 : -1;
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
  r.pos.set(b.pos.x + fz * side * 1.9 + fx * -2.5, b.y + 2.1, b.pos.z - fx * side * 1.9 + fz * -2.5);
  r.dir.set(fx, 0.05, fz).normalize();
  r.speed = Math.max(55, b.speed + 30);
  r.life = 4.5;
  r.owner = b;
  r.target = b.target && b.target.alive ? b.target : null;
  r.active = true;
  r.mesh.visible = true;
  audio.rocket(b.isPlayer ? 0 : camDist(b.pos.x, b.pos.z));
  if (r.target && r.target.isPlayer) showBanner('MISSILE INBOUND', 1.4), audio.beep(1250, 0.12, 0.12);
}
function dropMine(b) {
  if (!b.alive || b.mines <= 0 || b.mineCd > 0) return;
  const m = minePool.find((m) => !m.active);
  if (!m) return;
  b.mines--;
  b.mineCd = 0.6;
  m.x = b.pos.x - Math.sin(b.heading) * 8.5;
  m.z = b.pos.z - Math.cos(b.heading) * 8.5;
  m.age = 0;
  m.owner = b;
  m.active = true;
  m.mesh.visible = true;
  splash(m.x, m.z, waterHeight(m.x, m.z, time), 8, 1);
  if (b.isPlayer) audio.mine();
}
function blast(x, y, z, radius, dmg, owner, big) {
  explosion(x, y, z, big);
  for (const b of boats) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - x, b.pos.z - z);
    if (d < radius) damage(b, dmg * (1 - (d / radius) * 0.6) * (b.isPlayer ? 0.6 : 1), owner);
  }
}

function pickTarget(b, cone, range) {
  let best = null, bs = 1e9;
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
  for (const o of boats) {
    if (o === b || !o.alive || o.invuln > 0) continue;
    const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d < 4) continue;
    const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
    if (ang > cone) continue;
    const s = ang * 220 + d + (o === b.target ? -40 : 0);
    if (s < bs) { bs = s; best = o; }
  }
  b.target = best;
}

// ------------------------------------------------------------------ simulation
function controlPlayer(b, dt) {
  if (state !== 'race' || b.finished || dbg.auto) return controlAI(b, dt, state === 'race');
  let s = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  let th = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : keys.has('KeyS') || keys.has('ArrowDown') ? -0.4 : 0;
  if (touch.on) { s = touch.steer; th = 1; }
  b.steerIn = s;
  b.throttle = th;
  b.boosting = (keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.boost) && b.boost > 1 && th > 0;
  if (dbg.drive) controlAI(b, dt, false); // test aid: auto-steer, manual gunnery
  b.firing = keys.has('Space') || mouseFire || touch.fire;
  if (!mouseAim()) pickTarget(b, 0.62, 320);
}

function controlAI(b, dt, armed) {
  const n = course.n;
  const look = 7 + Math.floor((Math.abs(b.speed) * 0.85) / course.step);
  const ti = (b.idx + look) % n;
  const a = b.ai;
  a.offT -= dt;
  if (a.offT <= 0) { a.offT = 3 + rnd() * 5; a.want = rs() * 8; }
  a.offset = damp(a.offset, a.want || 0, 0.6, dt);
  const tx = course.px[ti] - course.tz[ti] * a.offset, tz = course.pz[ti] + course.tx[ti] * a.offset;
  const want = Math.atan2(tx - b.pos.x, tz - b.pos.z);
  const err = angDiff(b.heading, want);
  let s = clamp(err * 2.4, -1, 1);
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
  const reach = 45 + Math.abs(b.speed) * 1.2;
  for (const r of rocks) {
    const dx = r.x - b.pos.x, dz = r.z - b.pos.z;
    const al = dx * fx + dz * fz;
    if (al < -r.r || al > reach + r.r) continue;
    const lat = dx * fz - dz * fx; // + = rock to the left
    if (Math.abs(lat) < r.r + 7) s += (lat > 0 ? -1 : 1) * (1 - Math.max(al, 0) / (reach + r.r)) * 2.2;
  }
  b.steerIn = clamp(s, -1, 1);
  b.throttle = state === 'countdown' || state === 'title' ? 0 : 1 - clamp(Math.abs(err) - 0.5, 0, 0.55);
  b.boosting = false;
  b.firing = false;
  if (!armed || b.finished || b.isPlayer) return;
  // rubber band against the player
  const gap = (player.prog - b.prog) * course.step;
  b.maxSpeed = b.baseSpeed * clamp(1 + gap / 1100, 0.9, 1.09);
  pickTarget(b, 0.9, 240);
  const t = b.target;
  a.burst -= dt;
  if (t) {
    const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z, d = Math.hypot(dx, dz);
    const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
    if (a.burst < -1.4) a.burst = 0.9 + rnd() * 0.8;
    if (d < 230 && a.burst > 0 && b.onTarget) b.firing = true;
    a.rocketCd -= dt;
    if (a.rocketCd <= 0 && d > 35 && d < 210 && ang < 0.22) {
      fireRocket(b);
      a.rocketCd = 9 + rnd() * 9;
    }
  }
  a.mineCd -= dt;
  if (a.mineCd <= 0) {
    for (const o of boats) {
      if (o === b || !o.alive) continue;
      const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d < 55 && d > 8 && (dx * fx + dz * fz) / d < -0.85) {
        dropMine(b);
        a.mineCd = 14 + rnd() * 12;
        break;
      }
    }
    if (a.mineCd <= 0) a.mineCd = 1;
  }
}

function updateBoat(b, dt) {
  if (!b.alive) {
    b.respawnT -= dt;
    if (b.respawnT <= 0) {
      b.alive = true;
      b.hp = 100;
      b.invuln = 3;
      b.heat = 0;
      b.overheated = false;
      placeOnCourse(b, b.idx, 0, 10);
      b.model.group.visible = true;
    }
    return;
  }
  if (b.isPlayer) controlPlayer(b, dt);
  else controlAI(b, dt, state === 'race');
  if (b.isPlayer && !b.finished) b.maxSpeed = b.baseSpeed;

  const airborne = b.air > 0.05;
  b.steer = damp(b.steer, b.steerIn, 7, dt);
  if (b.boosting) b.boost = Math.max(0, b.boost - 30 * dt);
  else b.boost = Math.min(100, b.boost + 9 * dt);
  const maxS = b.maxSpeed * (b.boosting ? 1.25 : 1);
  const target = b.throttle >= 0 ? b.throttle * maxS : b.throttle * 22;
  if (!airborne) {
    if (b.speed < target) {
      const acc = 16 * (1.15 - 0.8 * clamp(b.speed / maxS, 0, 1)) + (b.boosting ? 9 : 0);
      b.speed = Math.min(target, b.speed + acc * dt);
    } else b.speed = Math.max(target, b.speed - (b.throttle < 0 ? 17 : 6.5) * dt);
    b.speed -= Math.abs(b.steer) * b.speed * 0.11 * dt;
  }
  const sf = clamp(Math.abs(b.speed) / b.baseSpeed, 0, 1.3);
  let turn = b.steer * 1.3 * smooth(0.5, 9, Math.abs(b.speed)) * (1 - 0.45 * Math.min(sf, 1));
  if (b.speed < 0) turn = -turn;
  if (airborne) turn *= 0.3;
  b.heading += turn * dt;
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
  const lx = fz, lz = -fx;
  const grip = 1 - Math.exp(-(airborne ? 0.3 : 3.6) * dt);
  b.vel.x += (fx * b.speed - b.vel.x) * grip;
  b.vel.z += (fz * b.speed - b.vel.z) * grip;
  b.pos.x += b.vel.x * dt;
  b.pos.z += b.vel.z * dt;

  // rocks
  for (const r of rocks) {
    const dx = b.pos.x - r.x, dz = b.pos.z - r.z;
    const rr = r.r + 2.1;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 1, nx = dx / d, nz = dz / d;
      b.pos.x = r.x + nx * rr;
      b.pos.z = r.z + nz * rr;
      const vn = b.vel.x * nx + b.vel.z * nz;
      if (vn < 0) {
        b.vel.x -= 1.5 * vn * nx;
        b.vel.z -= 1.5 * vn * nz;
        b.speed *= 0.5;
        if (-vn > 5) {
          damage(b, (-vn - 5) * 1.6, null);
          sparks(b.pos.x - nx * 1.6, b.y + 0.6, b.pos.z - nz * 1.6, 14);
          if (b.isPlayer) { audio.thud(); shake = Math.max(shake, 0.8); }
        }
      }
    }
  }

  // buoyancy
  const h = waterHeight(b.pos.x, b.pos.z, time);
  const w = clamp((h - b.hPrev) / dt, -12, 12);
  b.hPrev = h;
  if (b.y > h + 0.18) {
    b.vy -= 17 * dt;
    b.y += b.vy * dt;
    b.air += dt;
    if (b.y <= h) {
      if (b.vy < -3.5 && b.air > 0.2) {
        splash(b.pos.x + fx * 2, b.pos.z + fz * 2, h, 26, 1.7);
        wake.spawn(b.pos.x + fx, b.pos.z + fz, 4, 11, 3.5, 1);
        if (b.isPlayer) { audio.splash(0); shake = Math.max(shake, 0.45); }
      }
      b.y = h;
      b.vy = w;
      b.air = 0;
    }
  } else {
    b.vy = w * 0.9;
    b.y += (h - b.y) * Math.min(1, 16 * dt);
    b.air = 0;
  }
  const hF = waterHeight(b.pos.x + fx * 4, b.pos.z + fz * 4, time), hB = waterHeight(b.pos.x - fx * 4, b.pos.z - fz * 4, time);
  const hL = waterHeight(b.pos.x + lx * 1.4, b.pos.z + lz * 1.4, time), hR = waterHeight(b.pos.x - lx * 1.4, b.pos.z - lz * 1.4, time);
  let pT = Math.atan2(hF - hB, 8) * 0.9 + Math.min(sf, 1) * 0.075, rT = Math.atan2(hL - hR, 2.8) * 0.8 - b.steer * Math.min(sf, 1) * 0.3;
  if (b.air > 0.05) { pT = b.pitch - 0.5 * dt; rT = b.roll * 0.98; }
  b.pitch = damp(b.pitch, pT, 9, dt);
  b.roll = damp(b.roll, rT, 7, dt);

  // weapons
  b.gunT -= dt;
  b.rocketCd -= dt;
  b.mineCd -= dt;
  if (b.gunT < -0.15) b.heat = Math.max(0, b.heat - (b.overheated ? 0.5 : 0.4) * dt);
  if (b.overheated && b.heat < 0.25) b.overheated = false;
  if (b.rockets < 4 && (b.rocketT += dt) > 6) { b.rockets++; b.rocketT = 0; }
  if (b.mines < 3 && (b.mineT += dt) > 9) { b.mines++; b.mineT = 0; }
  if (b.isPlayer && time - b.lastHit > 6) b.hp = Math.min(100, b.hp + 3 * dt);
  if (b.invuln > 0) b.invuln -= dt;

  // transform
  const g = b.model.group;
  g.position.set(b.pos.x, b.y + 0.1 + Math.min(sf, 1) * 0.3, b.pos.z);
  g.rotation.set(-b.pitch, b.heading, b.roll);
  g.visible = b.invuln > 0 ? Math.floor(time * 12) % 2 === 0 : true;
  updateTurret(b, dt);
  g.updateMatrixWorld(true);
  b.model.gun.getWorldDirection(b.gunDir);
  if (b.firing && state === 'race') fireCannon(b);

  // wake + spray
  const cd = camDist(b.pos.x, b.pos.z);
  if (cd < 700 && b.speed > 2) {
    const s1 = Math.min(sf, 1);
    const step = Math.abs(b.speed) * dt;
    b.wakeA += step;
    b.wakeB += step;
    if (b.wakeA > 2.2) {
      b.wakeA = 0;
      wake.spawn(b.pos.x - fx * 6.4 + rs() * 0.5, b.pos.z - fz * 6.4 + rs() * 0.5, 4 + s1 * 1.5, 9 + s1 * 6, 4.6, 0.3 + 0.5 * s1);
    }
    if (b.wakeB > 3.6) {
      b.wakeB = 0;
      for (const sd of [-1, 1])
        wake.spawn(b.pos.x - fx * 1.0 + lx * sd * 2.1, b.pos.z - fz * 1.0 + lz * sd * 2.1, 2.2, 6.5, 2.6, 0.75 * s1, lx * sd * 2.4, lz * sd * 2.4);
    }
    if (cd < 260 && b.air < 0.05) {
      const k = s1 * s1 * dt * 60;
      let nb = Math.floor(k * 1.6 + rnd());
      while (nb-- > 0) {
        const sd = rnd() < 0.5 ? -1 : 1, al = 1.5 + rnd() * 2.2;
        spray.spawn(b.pos.x + fx * (al + 0.6) + lx * sd * 1.75, b.y + 0.15, b.pos.z + fz * (al + 0.6) + lz * sd * 1.75,
          b.vel.x * 0.5 + lx * sd * (3 + rnd() * 5), 1.5 + rnd() * 4 * s1, b.vel.z * 0.5 + lz * sd * (3 + rnd() * 5),
          0.45 + rnd() * 0.5, 0.5, 2.4, 0.9, 0.94, 0.98, 0.3, 11, 0.8);
      }
      let ns = Math.floor(k * 2.2 + rnd());
      while (ns-- > 0) {
        spray.spawn(b.pos.x - fx * (5.6 + rnd()) + lx * rs() * 1.8, b.y + 0.2, b.pos.z - fz * (6 + rnd()) + lz * rs() * 1.4,
          b.vel.x * 0.3 + rs() * 1.5, (2.5 + rnd() * 5.5) * s1, b.vel.z * 0.3 + rs() * 1.5,
          0.5 + rnd() * 0.6, 0.5, 2.3, 0.93, 0.96, 1.0, 0.36, 10, 0.7);
      }
    }
  }

  // course progress
  const n = course.n;
  let bi = b.idx, bd = 1e12;
  for (let k = -4; k <= 14; k++) {
    const j = (b.idx + k + n) % n;
    const dx = course.px[j] - b.pos.x, dz = course.pz[j] - b.pos.z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; bi = j; }
  }
  b.offCourse = bd > 150 * 150;
  if (!b.offCourse && bi !== b.idx) {
    if (bi < b.idx - n / 2) {
      b.lap++;
      if (state === 'race' && !b.finished) {
        if (b.lap >= LAPS) {
          b.finished = true;
          b.finishTime = raceTime;
          if (b.isPlayer) finishRace();
          else say(`${b.name} finished`);
        } else if (b.isPlayer && b.lap > 0) {
          showBanner(b.lap === LAPS - 1 ? 'FINAL LAP' : `LAP ${b.lap + 1}`, 1.8);
          audio.beep(990, 0.15, 0.1);
        }
      }
    } else if (bi > b.idx + n / 2) b.lap--;
    b.idx = bi;
  }
  b.prog = b.lap * n + b.idx;
}

function collideBoats() {
  for (let i = 0; i < boats.length; i++) {
    for (let j = i + 1; j < boats.length; j++) {
      const a = boats[i], b = boats[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 5 && d > 0.01) {
        const nx = dx / d, nz = dz / d, push = (5 - d) * 0.5;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
        const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
        if (rv < 0) {
          a.vel.x += nx * rv * 0.5; a.vel.z += nz * rv * 0.5;
          b.vel.x -= nx * rv * 0.5; b.vel.z -= nz * rv * 0.5;
          if (rv < -4 && (a.isPlayer || b.isPlayer)) { audio.thud(); shake = Math.max(shake, 0.4); }
        }
      }
    }
  }
}

function updateProjectiles(dt) {
  // tracers
  const T = tracers;
  for (let i = 0; i < T.max; i++) {
    if (T.life[i] <= 0) continue;
    const j = i * 3;
    const x0 = T.p[j], y0 = T.p[j + 1], z0 = T.p[j + 2];
    const drag = 1 - 0.28 * dt;
    T.v[j] *= drag; T.v[j + 2] *= drag;
    T.v[j + 1] = T.v[j + 1] * drag - 9.81 * dt;
    const x1 = x0 + T.v[j] * dt, y1 = y0 + T.v[j + 1] * dt, z1 = z0 + T.v[j + 2] * dt;
    T.p[j] = x1; T.p[j + 1] = y1; T.p[j + 2] = z1;
    T.life[i] -= dt;
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0, sl = sx * sx + sy * sy + sz * sz;
    const mine = T.owner[i] === player;
    let dead = false;
    for (const b of boats) {
      if (b === T.owner[i] || !b.alive) continue;
      const cx = b.pos.x - x0, cy = b.y + 1.1 - y0, cz = b.pos.z - z0;
      const t = clamp((cx * sx + cy * sy + cz * sz) / sl, 0, 1);
      const ex = cx - sx * t, ey = cy - sy * t, ez = cz - sz * t;
      if (ex * ex + ey * ey * 1.4 + ez * ez < 9.5) {
        const hx = x0 + sx * t, hy = y0 + sy * t, hz = z0 + sz * t;
        sparks(hx, hy, hz, 6);
        spray.spawn(hx, hy, hz, b.vel.x * 0.6 + rs() * 2, 1.5 + rnd() * 2, b.vel.z * 0.6 + rs() * 2, 0.7 + rnd() * 0.5, 0.5, 2.6, 0.12, 0.12, 0.12, 0.45, -1, 1.2);
        audio.hit(camDist(hx, hz) * (mine ? 0.3 : 1));
        if (mine) hitMark = 1;
        damage(b, T.dmg[i] * (b.isPlayer || mine ? 1 : 0.5), T.owner[i]);
        dead = true;
        break;
      }
    }
    if (!dead) {
      for (const r of rocks) {
        const dx = x1 - r.x, dz = z1 - r.z;
        if (dx * dx + dz * dz < r.r * r.r * 0.85 && y1 < r.H * 0.8) {
          sparks(x1, y1, z1, 4);
          for (let k = 0; k < 4; k++) spray.spawn(x1, y1, z1, rs() * 3, 1 + rnd() * 3, rs() * 3, 0.7 + rnd() * 0.6, 0.6, 3, 0.4, 0.38, 0.34, 0.42, 2, 1);
          if (!T.rico[i] && rnd() < 0.3) {
            // glance off the rock face
            const d = Math.hypot(dx, dz) || 1, sp = Math.hypot(T.v[j], T.v[j + 1], T.v[j + 2]) * 0.4;
            T.v[j] = (dx / d + rs() * 0.7) * sp * 0.6; T.v[j + 2] = (dz / d + rs() * 0.7) * sp * 0.6; T.v[j + 1] = (0.2 + rnd() * 0.7) * sp;
            T.p[j] = x0; T.p[j + 1] = y0; T.p[j + 2] = z0;
            T.rico[i] = 1; T.dmg[i] *= 0.3; T.life[i] = Math.min(T.life[i], 0.45); T.age[i] = 0;
            audio.ricochet(camDist(x1, z1));
          } else dead = true;
          break;
        }
      }
    }
    if (!dead && y1 < 1.6) {
      const h = waterHeight(x1, z1, time);
      if (y1 < h) {
        const sp = Math.hypot(T.v[j], T.v[j + 1], T.v[j + 2]);
        const graze = -T.v[j + 1] / sp;
        if (camDist(x1, z1) < 500) {
          // thin plume plus a ring of disturbed water
          for (let k = 0; k < 5; k++) spray.spawn(x1 + rs() * 0.15, h + 0.1, z1 + rs() * 0.15, rs() * 1.2 + T.v[j] * 0.004, 4 + rnd() * 7, rs() * 1.2 + T.v[j + 2] * 0.004, 0.45 + rnd() * 0.45, 0.35, 1.5, 0.92, 0.95, 0.98, 0.5, 15, 0.5);
          wake.spawn(x1, z1, 0.7, 2.6, 1.3, 0.85);
        }
        if (!T.rico[i] && graze < 0.13 && rnd() < 0.4) {
          // shallow hits skip off the surface
          const k = 0.38 + rnd() * 0.2;
          T.v[j] = T.v[j] * k + rs() * sp * 0.05; T.v[j + 2] = T.v[j + 2] * k + rs() * sp * 0.05; T.v[j + 1] = sp * (0.03 + rnd() * 0.12);
          T.p[j + 1] = h + 0.05;
          T.rico[i] = 1; T.dmg[i] *= 0.3; T.life[i] = Math.min(T.life[i], 0.55); T.age[i] = 0;
          if (rnd() < 0.5) audio.ricochet(camDist(x1, z1));
        } else dead = true;
      }
    }
    if (dead) T.kill(i);
  }
  T.sync(dt);

  // rockets
  for (const r of rocketPool) {
    if (!r.active) continue;
    r.life -= dt;
    r.speed = Math.min(120, r.speed + 70 * dt);
    const t = r.target;
    if (t && t.alive) {
      _v.set(t.pos.x - r.pos.x, t.y + 0.8 - r.pos.y, t.pos.z - r.pos.z);
      const dist = _v.length();
      _v.divideScalar(dist);
      const ang = Math.acos(clamp(_v.dot(r.dir), -1, 1));
      const rate = (r.owner.isPlayer ? 2.3 : 1.25) * dt;
      if (ang > 1e-4) r.dir.lerp(_v, Math.min(1, rate / ang)).normalize();
    } else {
      r.dir.y = damp(r.dir.y, -0.01, 2, dt);
      r.dir.normalize();
    }
    r.pos.addScaledVector(r.dir, r.speed * dt);
    _v2.copy(r.pos).add(r.dir);
    r.mesh.lookAt(_v2);
    for (let k = 0; k < 2; k++) {
      const f = rnd();
      const px = r.pos.x - r.dir.x * (0.7 + f * r.speed * dt), py = r.pos.y - r.dir.y * (0.7 + f * r.speed * dt), pz = r.pos.z - r.dir.z * (0.7 + f * r.speed * dt);
      spray.spawn(px, py, pz, rs() * 0.6, 0.4 + rnd() * 0.5, rs() * 0.6, 1.1 + rnd() * 0.7, 0.5, 2.6, 0.75, 0.75, 0.76, 0.42, -0.4, 0.6);
      fire.spawn(px, py, pz, 0, 0, 0, 0.09, 0.9, 0.3, 4, 1.9, 0.5, 0.9, 0, 0);
    }
    let boom = r.life <= 0;
    for (const b of boats) {
      if (b === r.owner || !b.alive) continue;
      if (Math.hypot(b.pos.x - r.pos.x, b.y + 0.8 - r.pos.y, b.pos.z - r.pos.z) < 3.2) boom = true;
    }
    if (!boom) for (const k of rocks) if (Math.hypot(k.x - r.pos.x, k.z - r.pos.z) < k.r * 0.95 && r.pos.y < k.H * 0.8) { boom = true; break; }
    if (!boom && r.pos.y < waterHeight(r.pos.x, r.pos.z, time)) boom = true;
    if (boom) {
      r.active = false;
      r.mesh.visible = false;
      blast(r.pos.x, Math.max(r.pos.y, 0.3), r.pos.z, 10, 65, r.owner, 1);
    }
  }

  // mines
  for (const m of minePool) {
    if (!m.active) continue;
    m.age += dt;
    const h = waterHeight(m.x, m.z, time);
    m.mesh.position.set(m.x, h - 0.05, m.z);
    m.mesh.rotation.z = Math.sin(time * 1.4 + m.x) * 0.12;
    m.lamp.visible = m.age > 1 && Math.floor(time * 3) % 2 === 0;
    let boom = m.age > 45;
    if (m.age > 1) {
      for (const b of boats) {
        if (!b.alive || (b === m.owner && m.age < 4)) continue;
        if (Math.hypot(b.pos.x - m.x, b.pos.z - m.z) < 4.6) boom = true;
      }
    }
    if (boom) {
      m.active = false;
      m.mesh.visible = false;
      blast(m.x, h + 0.3, m.z, 9, 62, m.owner, 1.15);
    }
  }
}

function finishRace() {
  state = 'finished';
  rankBoats();
  const p = player.rank;
  const ord = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][p - 1];
  $('resPlace').textContent = ord;
  $('resTime').textContent = fmtTime(raceTime);
  $('resWrecks').textContent = String(player.wrecks);
  $('results').style.display = 'flex';
  $('hud').style.display = 'none';
  audio.beep(660, 0.2, 0.1);
  setTimeout(() => audio.beep(990, 0.35, 0.1), 180);
}

function rankBoats() {
  const sorted = boats.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.prog - a.prog;
  });
  sorted.forEach((b, i) => (b.rank = i + 1));
  return sorted;
}

// ------------------------------------------------------------------ camera
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let gunCam = 0, gunYaw = 0, gvOff = 0, hitMark = 0;
function updateCamera(dt) {
  const b = player;
  const sf = clamp(Math.abs(b.speed) / b.baseSpeed, 0, 1.3);
  if (state === 'title') {
    titleAng += dt * 0.12;
    const r = 15;
    camPos.set(b.pos.x + Math.sin(titleAng + b.heading + 0.6) * r * 1.25, 3.6, b.pos.z + Math.cos(titleAng + b.heading + 2.5) * r);
    camLook.set(b.pos.x, b.y + 1.4, b.pos.z);
    camera.fov = 42;
  } else {
    camHeading += angDiff(camHeading, b.heading) * (1 - Math.exp(-5.2 * dt));
    const fx = Math.sin(camHeading), fz = Math.cos(camHeading);
    const back = 18 - sf * 1.5 + (b.boosting ? -0.8 : 0);
    camPos.set(b.pos.x - fx * back, b.y * 0.5 + 5.4 - sf * 0.4, b.pos.z - fz * back);
    camLook.set(b.pos.x + fx * 22, b.y * 0.4 + 2.6, b.pos.z + fz * 22);
    let fov = 62 + sf * 14 + (b.boosting ? 7 : 0);
    // gunner view: ride just behind the twin mount and turn with it
    const wantGV = (gunView || gunViewHeld) && state === 'race' && b.alive;
    if (wantGV && gunCam < 0.05) gvOff = clamp(b.aimYaw, -1.9, 1.9); // start looking where the guns point
    gunCam = damp(gunCam, wantGV ? 1 : 0, 9, dt);
    if (gunCam > 0.002) {
      if (wantGV) {
        if (mouseAim()) {
          // the view only pans when the cursor is pushed toward a screen edge
          const nx = mouseNDC.x, ax = Math.abs(nx);
          if (ax > 0.55) gvOff -= Math.sign(nx) * ((ax - 0.55) / 0.45) * 2.0 * dt;
        } else gvOff = damp(gvOff, b.aimYaw, 5, dt);
        gvOff = clamp(gvOff, -1.9, 1.9);
      }
      gunYaw = b.heading + gvOff;
      const gx = Math.sin(gunYaw), gz = Math.cos(gunYaw);
      _v.set(b.turretPos.x - gx * 2.7, b.turretPos.y + 1.15, b.turretPos.z - gz * 2.7);
      _v2.set(b.turretPos.x + gx * 60, b.turretPos.y - 1.5, b.turretPos.z + gz * 60);
      camPos.lerp(_v, gunCam);
      camLook.lerp(_v2, gunCam);
      fov = lerp(fov, 50, gunCam);
    }
    camera.fov = damp(camera.fov, fov, 5, dt);
  }
  const minY = waterHeight(camPos.x, camPos.z, time) + 1.3;
  if (camPos.y < minY) camPos.y = minY;
  if (state === 'title') camera.position.copy(camPos);
  else {
    camera.position.x = camPos.x;
    camera.position.z = camPos.z;
    camera.position.y = damp(camera.position.y, camPos.y, 7 + gunCam * 30, dt);
    if (camera.position.y < minY) camera.position.y = minY;
  }
  camera.lookAt(camLook);
  const sh = shake + sf * sf * 0.035;
  camera.position.x += rs() * sh * 0.35;
  camera.position.y += rs() * sh * 0.35;
  camera.rotation.z += rs() * sh * 0.012 - b.steer * sf * 0.045 * (1 - gunCam);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  shake = Math.max(0, shake - dt * 2.4);
}

// ------------------------------------------------------------------ HUD
const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const el = {
  pos: $('pos'), lap: $('lap'), time: $('time'), list: $('list'), speed: $('speed'), boost: $('boostFill'), hull: $('hullFill'),
  heat: $('heatFill'), heatRow: $('heatRow'), rk: $('rockets'), mn: $('mines'), ret: $('reticle'), retTxt: $('retTxt'), gate: $('gate'), gateTxt: $('gateTxt'),
  banner: $('banner'), pip: $('pip'), xhair: $('xhair'), feed: $('feed'), count: $('count'), off: $('off'),
};
let hudT = 0;
const pv = new THREE.Vector3();
function project(x, y, z) {
  pv.set(x, y, z).project(camera);
  const behind = pv.z > 1;
  return { x: (pv.x * 0.5 + 0.5) * window.innerWidth, y: (-pv.y * 0.5 + 0.5) * window.innerHeight, behind };
}
function nextGateIndex() {
  for (let g = 0; g < GATE_COUNT; g++) if (course.gates[g].i > player.idx) return g;
  return 0;
}
function updateHUD(dt) {
  if (state === 'title' || state === 'finished') return;
  const b = player;
  el.speed.textContent = Math.round(Math.abs(b.speed) * 3.6);
  el.boost.style.transform = `scaleX(${b.boost / 100})`;
  el.hull.style.transform = `scaleX(${b.hp / 100})`;
  el.hull.style.background = b.hp < 30 ? '#e2553a' : '#f1efe9';
  el.heat.style.transform = `scaleX(${Math.min(1, b.heat)})`;
  el.heatRow.classList.toggle('hot', b.overheated);

  // target reticle
  const t = b.target;
  if (t && t.alive && state === 'race') {
    const p = project(t.pos.x, t.y + 1.3, t.pos.z);
    if (!p.behind) {
      const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
      const s = clamp(3400 / d, 34, 170);
      el.ret.style.display = 'block';
      el.ret.style.transform = `translate(${p.x - s / 2}px, ${p.y - s / 2}px)`;
      el.ret.style.width = el.ret.style.height = s + 'px';
      el.retTxt.textContent = `${t.name}  ${Math.round(d)} M`;
      el.retTxt.nextElementSibling.firstElementChild.style.transform = `scaleX(${t.hp / 100})`;
    } else el.ret.style.display = 'none';
  } else el.ret.style.display = 'none';

  // gate marker
  const gi = nextGateIndex(), g = course.gates[gi];
  const gp = project(g.x, 9, g.z);
  const gd = Math.hypot(g.x - b.pos.x, g.z - b.pos.z);
  let gx = gp.x;
  if (gp.behind) gx = window.innerWidth - gx;
  gx = clamp(gx, 250, window.innerWidth - 250);
  el.gate.style.transform = `translate(${gx}px, ${gp.behind ? window.innerHeight * 0.3 : clamp(gp.y, 110, window.innerHeight * 0.6)}px)`;
  el.gateTxt.textContent = `${Math.round(gd)} M`;
  el.gate.style.opacity = gd < 40 ? 0.2 : 1;

  // crosshair (where you want the guns) and pip (where they actually point)
  const aiming = state === 'race' && b.alive && !b.finished;
  document.body.classList.toggle('aim', aiming && mouseAim());
  if (aiming) {
    const tt = 220;
    const pp = project(b.turretPos.x + b.gunDir.x * tt, b.turretPos.y + b.gunDir.y * tt - 0.6, b.turretPos.z + b.gunDir.z * tt);
    el.pip.style.display = pp.behind ? 'none' : 'block';
    el.pip.style.transform = `translate(${pp.x}px, ${pp.y}px)`;
    el.pip.classList.toggle('lock', !!(mouseAim() ? b.assist : b.target));
    hitMark = Math.max(0, hitMark - dt * 5);
    el.pip.classList.toggle('hit', hitMark > 0.3);
    if (mouseAim()) {
      el.xhair.style.display = 'block';
      el.xhair.style.transform = `translate(${mousePx.x}px, ${mousePx.y}px)`;
    } else el.xhair.style.display = 'none';
  } else {
    el.pip.style.display = 'none';
    el.xhair.style.display = 'none';
  }

  el.banner.textContent = time < banner.until ? banner.text : '';
  el.off.style.display = b.offCourse && state === 'race' ? 'block' : 'none';

  if (state === 'countdown') {
    const c = Math.ceil(countdown - 0.6);
    el.count.textContent = c > 0 ? c : '';
    if (c !== lastCount && c > 0 && c <= 3) audio.beep(520, 0.14, 0.12);
    lastCount = c;
  } else el.count.textContent = time < goUntil ? 'GO' : '';

  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.12;
  const sorted = rankBoats();
  el.pos.textContent = b.rank;
  el.lap.textContent = `${clamp(b.lap + 1, 1, LAPS)}/${LAPS}`;
  el.time.textContent = fmtTime(raceTime);
  let html = '';
  for (const o of sorted) {
    const gap = ((o.prog - b.prog) * course.step) / 40;
    html += `<div class="row${o.isPlayer ? ' me' : ''}${o.alive ? '' : ' out'}"><i style="background:#${ACCENTS[o.i].toString(16).padStart(6, '0')}"></i><span>${o.name}</span><b>${o.isPlayer ? '' : (gap > 0 ? '+' : '−') + Math.abs(gap).toFixed(1)}</b></div>`;
  }
  el.list.innerHTML = html;
  el.rk.innerHTML = '<s class="on"></s>'.repeat(b.rockets) + '<s></s>'.repeat(4 - b.rockets);
  el.mn.innerHTML = '<s class="on"></s>'.repeat(b.mines) + '<s></s>'.repeat(3 - b.mines);
  el.feed.innerHTML = feed.filter((f) => time - f.t < 5).map((f) => `<div>${f.text}</div>`).join('');
}
let goUntil = 0;

// ------------------------------------------------------------------ loop
resetRace();
state = 'title';
let last = performance.now(), frames = 0, acc = 0, warm = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) return;
  for (let step = 0; step < (dbg.scale || 1); step++) {
  time += dt;

  if (state === 'countdown') {
    countdown -= dt;
    if (countdown <= 0.6) {
      state = 'race';
      goUntil = time + 1.1;
      audio.beep(1040, 0.4, 0.14);
    }
  } else if (state === 'race') raceTime += dt;

  for (const b of boats) updateBoat(b, dt);
  collideBoats();
  updateProjectiles(dt);
  }
  spray.update(dt);
  fire.update(dt);
  updateCamera(dt);
  wake.update(dt, time, camera);
  gates.update(time, nextGateIndex());

  const sf = clamp(Math.abs(player.speed) / player.baseSpeed, 0, 1.3);
  audio.engine(Math.min(sf, 1.25), Math.max(0, player.throttle), player.boosting, player.alive && state !== 'title');
  flashLight.intensity *= Math.exp(-9 * dt);
  muzzleLight.intensity *= Math.exp(-40 * dt);
  hitFx = Math.max(0, hitFx - dt * 1.3);

  // uniforms
  water.update(time, camera);
  surfMat.uniforms.uTime.value = time;
  surfMat.uniforms.uCam.value.copy(camera.position);
  for (let i = 0; i < MAX_BOATS; i++) {
    const b = boats[i];
    if (b && b.alive) water.boats[i].set(b.pos.x, b.pos.z, b.heading, b.air > 0.05 ? 0.4 : 1);
    else water.boats[i].set(0, 0, 0, 0);
  }
  const px = (window.innerHeight * pixelRatio) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  spray.mat.uniforms.uPx.value = px;
  fire.mat.uniforms.uPx.value = px;
  speedPass.uniforms.uStrength.value = state === 'title' ? 0 : (clamp(sf - 0.3, 0, 1) * 1.1 + (player.boosting ? 0.5 : 0)) * (1 - gunCam * 0.75);
  speedPass.uniforms.uHit.value = hitFx * 0.55 + (player.hp < 30 && player.alive ? 0.12 : 0);
  speedPass.uniforms.uTime.value = time;
  sky.dome.position.copy(camera.position);

  sun.target.position.set(player.pos.x, 0, player.pos.z);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 260);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;

  water.renderReflection(camera);
  composer.render();
  updateHUD(dt);

  // adaptive resolution
  warm += dt;
  if (warm > 3) {
    acc += dt;
    if (++frames >= 90) {
      const avg = acc / frames;
      frames = 0;
      acc = 0;
      if (avg > 0.04 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); resize(); }
    }
  }
}
requestAnimationFrame(frame);
window.__game = { dbg, boats, player, course, rocks, camera, renderer, get state() { return state; }, start: startOrRestart };
