import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { reflect } from './world.js';
// "Patrol Boat PBR MK2" by SavyTheCreator (Sketchfab, CC BY 4.0). The forward twin-gun
// mount was split into its own node ("Turret") so it can traverse and elevate.
import BOAT_GLB from '../models/patrol_boat.glb';

// Mount geometry, in boat space (x = port, y = up, z = bow), taken from the model.
export const TURRET_POS = new THREE.Vector3(-0.01, 1.35, 3.06);
const TRUNNION_Y = 0.2;
const MUZZLE = [new THREE.Vector3(0.33, 0.01, 1.55), new THREE.Vector3(-0.33, 0.01, 1.55)];

let asset = null;
const waiting = [];

export function loadBoatAsset() {
  const buf = BOAT_GLB.buffer.slice(BOAT_GLB.byteOffset, BOAT_GLB.byteOffset + BOAT_GLB.byteLength);
  new GLTFLoader().parse(
    buf,
    '',
    (gltf) => {
      let hull = null, turret = null;
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (/turret/i.test(o.name) || /turret/i.test(o.parent?.name || '')) turret = o;
        else hull = o;
      });
      asset = { hull, turret };
      for (const fn of waiting) fn();
      waiting.length = 0;
    },
    (err) => console.error('boat model failed to load', err)
  );
}

export function createBoat(accent) {
  const g = new THREE.Group();
  const turret = new THREE.Group();
  turret.position.copy(TURRET_POS);
  g.add(turret);
  const gun = new THREE.Group();
  gun.position.y = TRUNNION_Y;
  turret.add(gun);
  const muzzles = MUZZLE.map((p) => {
    const o = new THREE.Object3D();
    o.position.copy(p);
    gun.add(o);
    return o;
  });

  // team pennant on a stern staff
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.7, emissive: accent, emissiveIntensity: 0.25, side: THREE.DoubleSide,
  });
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 6), new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.5, metalness: 0.8 }));
  staff.position.set(1.75, 2.35, -5.0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.55, 6, 1), accentMat);
  flag.geometry.translate(-0.5, 0, 0);
  flag.rotation.y = Math.PI / 2;
  flag.position.set(1.75, 3.05, -5.0);
  g.add(staff, flag);

  const attach = () => {
    const mat = asset.hull.material.clone();
    mat.color.set(accent).lerp(new THREE.Color(0xffffff), 0.82).multiplyScalar(1.25);
    mat.envMapIntensity = 1.0;
    const hull = new THREE.Mesh(asset.hull.geometry, mat);
    g.add(hull);
    const tm = new THREE.Mesh(asset.turret.geometry, mat);
    tm.position.y = -TRUNNION_Y;
    gun.add(tm);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    reflect(g);
  };
  if (asset) attach();
  else waiting.push(attach);
  reflect(g);
  return { group: g, turret, gun, muzzles, flag, props: [], accentMat };
}
