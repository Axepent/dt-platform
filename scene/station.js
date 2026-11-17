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

function instanceLevel(model, capacity, parent) {
  const root = new THREE.Group();
  const parts = [];
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if (!node.isMesh) return;
    const mesh = new THREE.InstancedMesh(node.geometry, node.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false; // Members are culled individually, before being batched.
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);
    parts.push({ mesh, local: node.matrixWorld.clone() });
  });
  parent.add(root);
  return { root, parts, previousMask: -1 };
}

function staticInstances(scene, units, models, bounds, cullingEnabled) {
  const root = new THREE.Group();
  scene.add(root);
  const levels = models.map(model => instanceLevel(model, units.length, root));
  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const worldBounds = units.map(unit => bounds.clone().translate(unit.position));
  const masks = [0, 0, 0];

  function update(camera) {
    if (cullingEnabled) {
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem);
    }
    masks.fill(0);
    units.forEach((unit, index) => {
      unit.update(camera);
      const level = unit.getCurrentLevel();
      if (level < levels.length && (!cullingEnabled || frustum.intersectsBox(worldBounds[index]))) {
        masks[level] |= 1 << index;
      }
    });
    levels.forEach(({ parts, previousMask }, level) => {
      const mask = masks[level];
      if (mask === previousMask) return;
      levels[level].previousMask = mask;
      for (const { mesh, local } of parts) {
        let count = 0;
        units.forEach((unit, index) => {
          if (!(mask & (1 << index))) return;
          instance.multiplyMatrices(unit.matrixWorld, local);
          mesh.setMatrixAt(count++, instance);
        });
        mesh.count = count;
        mesh.visible = count > 0;
        if (count) mesh.instanceMatrix.needsUpdate = true;
      }
    });
  }

  function setDetail(model) {
    const old = levels[0];
    root.remove(old.root);
    for (const { mesh } of old.parts) mesh.dispose();
    levels[0] = instanceLevel(model, units.length, root);
  }

  return { update, setDetail };
}

export async function loadStation(scene, opt = new Set(), cullingEnabled = true) {
  const loader = new GLTFLoader();
  const detailUrl = opt.has('simp') ? 'models/mannequin-s.glb' : 'models/mannequin.glb';
  const deferred = opt.has('defer');
  const instanced = opt.has('inst');

  async function loadModel(url) {
    const { scene: model } = await loader.loadAsync(url);
    model.traverse(node => {
      if (!node.isMesh) return;
      node.frustumCulled = cullingEnabled;
      for (const material of [node.material].flat()) material.side = THREE.FrontSide;
    });
    return model;
  }

  const [simplified, detail] = await Promise.all([
    loadModel('models/mannequin-lod1.glb'),
    deferred ? null : loadModel(detailUrl),
  ]);
  const firstDetail = detail ?? simplified;
  addStage(scene);
  const group = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(firstDetail);
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(...bounds.getSize(new THREE.Vector3()))
      .translate(...bounds.getCenter(new THREE.Vector3())),
    new THREE.MeshStandardMaterial({ color: 0x798c91 }),
  );
  proxy.frustumCulled = cullingEnabled;
  const activeJoints = [];
  const latest = new Map();
  let awaitingDetail = deferred;
  SLOTS.forEach((position, i) => {
    const unit = new THREE.LOD();
    unit.name = `mannequin-${String(i + 1).padStart(2, '0')}`;
    const batch = instanced && i > 0;
    const lod0 = batch ? new THREE.Object3D() : firstDetail.clone();
    const lod1 = batch ? new THREE.Object3D() : simplified.clone();
    unit.autoUpdate = !batch;
    unit.addLevel(lod0, 0);
    unit.addLevel(lod1, 15, 0.1);
    unit.addLevel(batch ? new THREE.Object3D() : proxy.clone(), 60, 0.1);
    unit.addLevel(new THREE.Object3D(), 250);
    unit.position.set(...position);
    group.add(unit);
    if (i === 0) activeJoints.push(telemetryJoints(lod0), telemetryJoints(lod1));
  });
  scene.add(group);
  let batches;
  if (instanced) {
    group.updateWorldMatrix(true, true);
    const instanceBounds = bounds.clone().union(new THREE.Box3().setFromObject(simplified));
    batches = staticInstances(scene, group.children.slice(1), [firstDetail, simplified, proxy],
      instanceBounds, cullingEnabled);
  }

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
    if (awaitingDetail) latest.set(binding.node, { binding, degrees });
    return true;
  }

  async function loadDetail() {
    if (!awaitingDetail) return;
    const model = await loadModel(detailUrl);
    for (const unit of group.children) {
      if (!unit.autoUpdate) continue;
      const level = unit.levels[0];
      const replacement = model.clone();
      replacement.visible = level.object.visible;
      unit.remove(level.object);
      unit.add(replacement);
      level.object = replacement;
    }
    for (const { materials } of activeJoints[0].values()) {
      for (const material of materials) material.dispose();
    }
    awaitingDetail = false;
    activeJoints[0] = telemetryJoints(group.children[0].levels[0].object);
    for (const { binding, degrees } of latest.values()) apply('mannequin-01', binding, degrees);
    latest.clear();
    batches?.setDetail(model);
  }

  return { group, apply, updateInstances: batches?.update, loadDetail };
}
