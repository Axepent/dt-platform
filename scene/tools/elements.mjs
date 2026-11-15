// Run from scene/: node tools/elements.mjs models/mannequin.glb models/mannequin-lod1.glb
import { readFile } from 'node:fs/promises';

const [firstFile, ...otherFiles] = process.argv.slice(2);
if (!firstFile) {
  console.error('Usage: node tools/elements.mjs models/mannequin.glb [other.glb ...]');
  process.exit(1);
}

const expectedParents = new Map([
  ['torso', 'pelvis'],
  ['head', 'torso'],
  ['shoulder.L', 'torso'],
  ['elbow.L', 'shoulder.L'],
  ['hip.L', 'pelvis'],
  ['knee.L', 'hip.L'],
]);

for (const file of [firstFile, ...otherFiles]) {
  const bytes = await readFile(file);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF'
      || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
      || bytes.toString('ascii', 16, 20) !== 'JSON') {
    throw new Error(`${file}: expected GLB 2.0 with a JSON chunk`);
  }
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const { nodes, meshes, accessors } = document;
  const parentNames = new Map(nodes.flatMap(node =>
    (node.children ?? []).map(child => [child, node.name])));
  const identifiers = [];

  nodes.forEach((node, index) => {
    const id = node.extras?.element;
    if (!id) return;
    if (!expectedParents.has(id) || node.name !== id
        || parentNames.get(index) !== expectedParents.get(id)) {
      throw new Error(`${file}: unexpected name or parent for ${id}`);
    }
    identifiers.push(id);
  });
  if (identifiers.length !== expectedParents.size
      || new Set(identifiers).size !== expectedParents.size) {
    throw new Error(`${file}: missing or repeated joint identifiers`);
  }

  const triangles = meshes.flatMap(mesh => mesh.primitives).reduce((total, primitive) => {
    const mode = primitive.mode ?? 4;
    if (mode !== 4) throw new Error(`${file}: expected triangle primitives`);
    return total + accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }, 0);
  console.log(`${file}: ${identifiers.length} — ${identifiers.join(', ')}`);
  console.log(`  ${triangles} triangles, ${bytes.length} bytes`);
}
