import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { loadStation, SLOTS } from './station.js';
import { bindTwin } from './twin.js';

export const params = new URLSearchParams(location.search);
const benchmarkEnabled = params.has('bench');
if (benchmarkEnabled) performance.setResourceTimingBufferSize(10000);
export const opt = new Set((params.get('opt') ?? '').split(',').filter(Boolean));
export const hooks = [];
const cullingEnabled = params.get('cull') !== '0';
const tileErrorTarget = params.get('errorTarget') === '32' ? 32 : 16;
const tileCount = 341;
const mebibyte = 2 ** 20;
const loadedTileUrls = new Set();
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd6e2e4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x758286, 2.1));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.25);
sun.position.set(-6, 10, 8);
scene.add(sun);

const status = document.getElementById('status');
const stats = document.getElementById('stats');
const lodSummary = document.createElement('div');
lodSummary.style.cssText = 'font-size:12px;color:#53656a';
lodSummary.title = 'Обрані рівні для восьми манекенів: LOD0, LOD1, LOD2, порожній рівень.';
const tileSummary = document.createElement('div');
tileSummary.style.cssText = lodSummary.style.cssText;
tileSummary.textContent = 'Завантаження рельєфу…';
stats.after(lodSummary, tileSummary);
for (const link of document.querySelectorAll('nav a')) {
  const url = new URL(link.href);
  if (!cullingEnabled) url.searchParams.set('cull', '0');
  if (tileErrorTarget === 32) url.searchParams.set('errorTarget', '32');
  link.href = url.href;
}

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const [x, , z] = SLOTS[0];
const views = {
  near: [[x + 3.5, 1.58, z + 0.75], [x, 1.03, z]],
  hall: [[15, 10, 19], [0, 0.65, 0]],
  far: [[400, 220, 400], [0, 0, 0]],
};
const [eye, look] = views[params.get('view')] ?? views.hall;
export const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.05, 4000);
camera.position.set(...eye);
export const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...look);
controls.update();

export let tiles;
async function loadTiles() {
  const url = 'tiles/site/v1/tileset.json';
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      tileSummary.textContent = 'Рельєф відсутній. Запустіть node tools/make-tiles.mjs.';
      return;
    }
    tiles = new TilesRenderer(url);
    tiles.errorTarget = tileErrorTarget;
    tiles.lruCache.minBytesSize = 24 * mebibyte;
    tiles.lruCache.maxBytesSize = 32 * mebibyte;
    tiles.addEventListener('load-model', ({ url }) => {
      loadedTileUrls.add(url);
    });
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.group.rotation.x = -Math.PI / 2;
    scene.add(tiles.group);
  } catch (error) {
    tileSummary.textContent = 'Рельєф недоступний';
    console.warn('Рельєф недоступний:', error);
  }
}

export let station;
let frames = 0;
export function frame(time) {
  camera.updateMatrixWorld();
  tiles?.update();
  station.updateInstances?.(camera);
  for (const hook of hooks) hook(time);
  renderer.render(scene, camera);
  if (frames++ === 0) {
    performance.mark('first-frame');
    if (opt.has('defer')) {
      setTimeout(() => {
        void loadTiles();
        void station.loadDetail().catch(error => console.error('Детальна модель недоступна:', error));
      }, 0);
    }
  }
  const { calls, triangles } = renderer.info.render;
  if (tiles) {
    const { queued, downloading, parsing, inCache } = tiles.stats;
    const bytes = (tiles.lruCache.cachedBytes / mebibyte).toFixed(1);
    tileSummary.textContent = `Рельєф ${tileErrorTarget} px · видно ${tiles.visibleTiles.size}`
      + ` · завантажено ${loadedTileUrls.size}/${tileCount}`
      + ` · у кеші ${inCache} (${bytes}/32 MiB)`
      + ` · у роботі ${queued + downloading + parsing}`;
  }
  const levels = [0, 0, 0, 0];
  for (const unit of station.group.children) levels[unit.getCurrentLevel()]++;
  stats.textContent = `Викликів ${calls} · трикутників ${triangles}`;
  lodSummary.textContent = `LOD: ${levels[0]} / ${levels[1]} / ${levels[2]} / ${levels[3]}`
    + ` · frustum ${cullingEnabled ? 'увімкнено' : 'вимкнено'}`;
}

addEventListener('resize', () => {
  if (benchmarkEnabled) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  tiles?.setResolutionFromRenderer(camera, renderer);
});

try {
  station = await loadStation(scene, opt, cullingEnabled);
  if (benchmarkEnabled) {
    const { startBenchmark } = await import('./bench.js');
    startBenchmark({ renderer, scene, camera, controls, frame, opt, params });
  } else {
    renderer.setAnimationLoop(frame);
  }
  if (!opt.has('defer')) void loadTiles();
  status.textContent = 'Підключення до Ditto…';
  await bindTwin(station);
} catch (error) {
  console.error(error);
  status.textContent = `Помилка: ${error.message}`;
  status.classList.add('error');
}
