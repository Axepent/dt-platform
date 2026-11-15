import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SLOTS = Array.from({ length: 8 }, (_, i) => [
  (i % 4 - 1.5) * 2.8, 0.08, i < 4 ? 1.7 : -1.7,
]);

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
};

function addStage(scene) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xbacbd0, roughness: 0.95 }));
  floor.position.y = -0.1;
  scene.add(floor);

  const grid = new THREE.GridHelper(12, 24, 0x617f85, 0x849ea3);
  grid.scale.z = 0.65;
  grid.position.y = 0.002;
  scene.add(grid);

  const padGeometry = new THREE.CylinderGeometry(0.65, 0.7, 0.08, 48);
  const livePad = new THREE.MeshStandardMaterial({ color: 0x168d7b });
  const otherPad = new THREE.MeshStandardMaterial({ color: 0x536970 });
  SLOTS.forEach(([x, y, z], i) => {
    const pad = new THREE.Mesh(padGeometry, i === 0 ? livePad : otherPad);
    pad.position.set(x, y - 0.04, z);
    scene.add(pad);
  });
}

function telemetryJoints(model) {
  const joints = new Map();
  model.traverse(node => {
    const id = node.userData.element;
    if (id) joints.set(id, { node, rest: node.quaternion.clone(), materials: [] });
  });
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    let owner = mesh;
    while (owner && !owner.userData.element) owner = owner.parent;
    const joint = joints.get(owner?.userData.element);
    if (!joint) return;

    // GLTFLoader і clone() залишають спільні матеріали. Копіюємо лише в активного манекена.
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(material => material.clone())
      : mesh.material.clone();
    joint.materials.push(...[mesh.material].flat());
  });
  return joints;
}

export async function loadStation(scene) {
  const loader = new GLTFLoader();
  const [detail, simplified] = await Promise.all([
    loader.loadAsync('models/mannequin.glb'),
    loader.loadAsync('models/mannequin-lod1.glb'),
  ]);
  for (const model of [detail.scene, simplified.scene]) {
    model.traverse(node => {
      if (!node.isMesh) return;
      for (const material of [node.material].flat()) material.side = THREE.FrontSide;
    });
  }
  addStage(scene);
  const group = new THREE.Group();
  const activeJoints = [];
  const bounds = new THREE.Box3().setFromObject(detail.scene);
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(...bounds.getSize(new THREE.Vector3()))
      .translate(...bounds.getCenter(new THREE.Vector3())),
    new THREE.MeshStandardMaterial({ color: 0x798c91 }),
  );
  SLOTS.forEach((position, i) => {
    const unit = new THREE.LOD();
    unit.name = `mannequin-${String(i + 1).padStart(2, '0')}`;
    const lod0 = detail.scene.clone();
    const lod1 = simplified.scene.clone();
    unit.addLevel(lod0, 0);
    unit.addLevel(lod1, 15, 0.1);
    unit.addLevel(proxy.clone(), 60, 0.1);
    unit.addLevel(new THREE.Object3D(), 250);
    unit.position.set(...position);
    group.add(unit);
    if (i === 0) activeJoints.push(telemetryJoints(lod0), telemetryJoints(lod1));
  });
  scene.add(group);

  const rotation = new THREE.Quaternion();
  const color = new THREE.Color();
  function apply(unit, binding, degrees) {
    if (unit !== 'mannequin-01') return false;
    const joints = activeJoints.map(level => level.get(binding.node));
    if (joints.some(joint => !joint || joint.materials.length === 0)) return false;

    const angle = THREE.MathUtils.clamp(degrees, binding.min, binding.max);
    const fraction = (angle - binding.min) / (binding.max - binding.min);
    color.setHSL(0.33 * (1 - fraction), 0.74, 0.46);
    rotation.setFromAxisAngle(AXES[binding.axis], THREE.MathUtils.degToRad(angle * binding.direction));
    for (const { node, rest, materials } of joints) {
      node.quaternion.copy(rest).multiply(rotation);
      for (const material of materials) material.color.copy(color);
    }
    return true;
  }
  return { group, apply };
}
