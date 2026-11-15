// Procedural surroundings for the mannequin testing site. 3D Tiles 1.1, REPLACE.
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../tiles/site/v1/', import.meta.url));
const width = 2048;
const maxDepth = 4;
const cells = 64;
const io = new NodeIO();

function elevation(x, y) {
  const edge = Math.min(1, Math.max(0, (Math.hypot(x, y) - 24) / 120));
  return -0.4 + edge * (9 * Math.sin(x / 95) * Math.cos(y / 130)
    + 4 * Math.sin((x + y) / 48) + 0.8 * Math.sin(y / 9) * Math.cos(x / 12));
}

async function build(level, column, row) {
  const size = width / 2 ** level;
  const x0 = -width / 2 + column * size;
  const y0 = -width / 2 + row * size;
  const stride = cells + 1;
  const positions = new Float32Array(stride ** 2 * 3);
  const colors = new Uint8Array(stride ** 2 * 3);
  const indices = new Uint16Array(cells ** 2 * 6);
  let min = Infinity;
  let max = -Infinity;

  for (let j = 0; j < stride; j++) {
    for (let i = 0; i < stride; i++) {
      const x = x0 + i * size / cells;
      const y = y0 + j * size / cells;
      const z = elevation(x, y);
      const offset = (j * stride + i) * 3;
      positions.set([x, z, -y], offset);
      const t = Math.max(0, Math.min(1, (z + 12) / 27));
      colors.set([73 + 38 * t, 99 + 40 * t, 85 + 30 * t], offset);
      min = Math.min(min, z);
      max = Math.max(max, z);
      if (i < cells && j < cells) {
        const a = j * stride + i;
        const b = a + stride;
        indices.set([a, a + 1, b, b, a + 1, b + 1], (j * cells + i) * 6);
      }
    }
  }

  const document = new Document();
  const buffer = document.createBuffer();
  const accessor = (type, array) => document.createAccessor(type)
    .setType(type).setArray(array).setBuffer(buffer);
  const material = document.createMaterial('Рельєф').setMetallicFactor(0).setRoughnessFactor(1);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', positions))
    .setAttribute('COLOR_0', accessor('VEC3', colors).setNormalized(true))
    .setIndices(accessor('SCALAR', indices))
    .setMaterial(material);
  document.createScene().addChild(document.createNode()
    .setMesh(document.createMesh().addPrimitive(primitive)));

  const uri = `${level}/${column}_${row}.glb`;
  await writeFile(join(output, uri), await io.writeBinary(document));
  const tile = {
    boundingVolume: {
      box: [x0 + size / 2, y0 + size / 2, (min + max) / 2,
        size / 2, 0, 0, 0, size / 2, 0, 0, 0, Math.max((max - min) / 2, 0.25)],
    },
    geometricError: level === maxDepth ? 0 : size / cells,
    content: { uri },
  };
  if (level < maxDepth) {
    tile.children = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      tile.children.push(await build(level + 1, 2 * column + dx, 2 * row + dy));
    }
  }
  return tile;
}

for (let level = 0; level <= maxDepth; level++) {
  await mkdir(join(output, String(level)), { recursive: true });
}
const root = await build(0, 0, 0);
root.refine = 'REPLACE';
const tileset = {
  asset: { version: '1.1', tilesetVersion: 'v1' },
  geometricError: 2 * width / cells,
  root,
};
await writeFile(join(output, 'tileset.json'), JSON.stringify(tileset));
console.log('Готово: tiles/site/v1/tileset.json (341 тайл)');
