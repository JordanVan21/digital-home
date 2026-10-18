// Bake normalized compound shape profiles from the catalog GLBs (from the codex sandbox's
// bake-colliders). In the merged sandbox these shapes are used for drawing outlines and finding real
// top faces (seats, shelves) — never for collision, which stays on jordan's category profiles.
//
// Usage: pnpm bake:shapes   (writes packages/scene-engine/src/shapeProfiles.json)
// Profiles are keyed by asset id and carry the GLB content hash; a stale or missing profile makes the
// engine fall back to category behaviour. Alpha-tested models (plants, sheer fabric) are skipped.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import { bakeGeometry, buildProfile } from '../src/geometry-lab/queries.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const catalogDir = path.join(webRoot, 'public/catalog');
const catalog = JSON.parse(await fs.readFile(path.join(catalogDir, 'catalog.json'), 'utf8'));
const out = path.join(repoRoot, 'packages/scene-engine/src/shapeProfiles.json');
const CELL_M = 0.04;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const profiles = {};
for (const asset of catalog.assets) {
  const doc = await io.read(path.join(catalogDir, asset.glbStorageKey));
  await doc.transform(dequantize());
  if (doc.getRoot().listMaterials().some((m) => m.getAlphaMode() !== 'OPAQUE')) {
    console.log(`${asset.title}: skipped (alpha-tested materials)`);
    continue;
  }
  const group = new Group();
  doc.getRoot().listScenes()[0].traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const primitive of mesh.listPrimitives()) {
      const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(primitive.getAttribute('POSITION').getArray(), 3));
      if (primitive.getIndices()) geometry.setIndex(Array.from(primitive.getIndices().getArray()));
      const child = new Mesh(geometry);
      child.matrixAutoUpdate = false;
      child.matrix.fromArray(node.getWorldMatrix());
      group.add(child);
    }
  });
  const profile = buildProfile(bakeGeometry(group), CELL_M, { closeBase: true });
  const lo = profile.bounds.min.toArray();
  const hi = profile.bounds.max.toArray();
  const norm = (v, i) => Math.round(((v - lo[i]) / (hi[i] - lo[i])) * 1e5) / 1e5;
  profiles[asset.id] = {
    contentHash: asset.contentHash,
    boxes: profile.boxes.map((b) => [b.min.toArray().map((v, i) => Math.max(0, norm(v, i))), b.max.toArray().map((v, i) => Math.min(1, norm(v, i)))]),
  };
  console.log(`${asset.title}: ${profile.boxes.length} blocks`);
}
await fs.writeFile(out, `${JSON.stringify(profiles)}\n`);
console.log(`wrote ${path.relative(repoRoot, out)} (${Object.keys(profiles).length} profiles)`);
