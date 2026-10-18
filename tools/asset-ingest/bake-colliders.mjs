// Bake compound collision boxes from each catalog GLB's actual mesh (the codex sandbox's
// collider bake): voxelize the normalized model at 4 cm, flood-fill the outside (the floor plane
// closes the base, so skirted bodies like a sofa are solid while side-reachable gaps under desks
// and chairs stay open), and greedily merge the solid cells into a few boxes. Boxes are written
// to catalog.json as `collision.boxes` in NormBox coordinates (x, z ∈ [−0.5, 0.5], y ∈ [0, 1]),
// keeping each asset's collision `kind`.
//
// Skipped: models with alpha materials (leaves, glass — the mesh isn't the silhouette), and
// shelving (`open`), whose board surfaces must stay exact for items resting on them.
//
// Usage: pnpm --filter @house/asset-ingest bake:colliders
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Box3, Matrix4, Triangle, Vector3 } from 'three';
import { AssetCatalogFileSchema } from '@house/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const catalogPath = join(root, 'apps/web/public/catalog/catalog.json');
const CELL = 0.04;
const SKIP_KINDS = new Set(['open', 'flat', 'none']);
const FRONT_YAW = { '+Z': 0, '+X': -Math.PI / 2, '-X': Math.PI / 2, '-Z': Math.PI };
// Category → default collision kind, for assets without a profile (mirrors scene-engine config).
const { categoryRule } = await import('../../packages/scene-engine/src/config.ts').catch(() => ({ categoryRule: null }));

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

/** World-space triangles of the model, rotated so its front faces +Z (as prepareModel does). */
async function trianglesOf(file, frontAxis) {
  const doc = await io.read(file);
  await doc.transform(dequantize());
  if (doc.getRoot().listMaterials().some((m) => m.getAlphaMode() !== 'OPAQUE')) return null;
  const yaw = new Matrix4().makeRotationY(FRONT_YAW[frontAxis ?? '+Z'] ?? 0);
  const out = [];
  const p = new Vector3();
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = new Matrix4().fromArray(node.getWorldMatrix()).premultiply(yaw);
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const idx = prim.getIndices();
        const n = idx ? idx.getCount() : pos.getCount();
        const v = (i) => p.fromArray(pos.getElement(idx ? idx.getScalar(i) : i, [0, 0, 0])).applyMatrix4(m).toArray();
        for (let i = 0; i + 2 < n; i += 3) out.push([v(i), v(i + 1), v(i + 2)]);
      }
    });
  }
  return out;
}

/** Voxelize, flood the outside (closed base), greedy-merge solid cells into boxes. */
function compoundBoxes(tris, bounds, cell) {
  const origin = bounds.min.clone().divideScalar(cell).floor().multiplyScalar(cell).addScalar(-cell);
  const size = bounds.max.clone().sub(origin).divideScalar(cell).ceil().addScalar(2);
  const [nx, ny, nz] = size.toArray();
  const total = nx * ny * nz;
  if (total > 400000) throw new Error(`grid too large (${total} cells)`);
  const cells = new Uint8Array(total);
  const at = (x, y, z) => x + nx * (y + ny * z);
  const tri = new Triangle();
  const tb = new Box3();
  const voxel = new Box3();
  const s = new Vector3();
  const e = new Vector3();
  for (const [a, b, c] of tris) {
    tri.a.fromArray(a); tri.b.fromArray(b); tri.c.fromArray(c);
    tb.setFromPoints([tri.a, tri.b, tri.c]);
    s.copy(tb.min).sub(origin).divideScalar(cell).floor();
    e.copy(tb.max).sub(origin).divideScalar(cell).floor();
    for (let z = s.z; z <= e.z; z++) for (let y = s.y; y <= e.y; y++) for (let x = s.x; x <= e.x; x++) {
      const i = at(x, y, z);
      if (cells[i] === 1) continue;
      voxel.min.set(x, y, z).multiplyScalar(cell).add(origin);
      voxel.max.copy(voxel.min).addScalar(cell);
      if (voxel.intersectsTriangle(tri)) cells[i] = 1;
    }
  }
  // The supporting plane at the model's bottom closes the base.
  const baseY = Math.floor((bounds.min.y - origin.y) / cell);
  for (let z = 0; z < nz; z++) for (let y = 0; y < baseY; y++) for (let x = 0; x < nx; x++) cells[at(x, y, z)] = 2;
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 1;
  queue[0] = at(0, ny - 1, 0);
  cells[queue[0]] = 2;
  const push = (i) => { if (cells[i] === 0) { cells[i] = 2; queue[tail++] = i; } };
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));
    if (x > 0) push(i - 1);
    if (x < nx - 1) push(i + 1);
    if (y > 0) push(i - nx);
    if (y < ny - 1) push(i + nx);
    if (z > 0) push(i - nx * ny);
    if (z < nz - 1) push(i + nx * ny);
  }
  const used = new Uint8Array(total);
  const solid = (x, y, z) => cells[at(x, y, z)] !== 2 && !used[at(x, y, z)];
  const boxes = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!solid(x, y, z)) continue;
    let dx = 1;
    let dy = 1;
    let dz = 1;
    while (x + dx < nx && solid(x + dx, y, z)) dx++;
    const row = (yy, zz) => { for (let xx = x; xx < x + dx; xx++) if (!solid(xx, yy, zz)) return false; return true; };
    while (y + dy < ny && row(y + dy, z)) dy++;
    const layer = (zz) => { for (let yy = y; yy < y + dy; yy++) if (!row(yy, zz)) return false; return true; };
    while (z + dz < nz && layer(z + dz)) dz++;
    for (let zz = z; zz < z + dz; zz++) for (let yy = y; yy < y + dy; yy++) for (let xx = x; xx < x + dx; xx++) used[at(xx, yy, zz)] = 1;
    boxes.push(new Box3(new Vector3(x, y, z).multiplyScalar(cell).add(origin), new Vector3(x + dx, y + dy, z + dz).multiplyScalar(cell).add(origin)));
  }
  return boxes;
}

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const raw = JSON.parse(await readFile(catalogPath, 'utf8'));
const catalog = AssetCatalogFileSchema.parse(raw);
let baked = 0;
for (const asset of raw.assets) {
  const kind = asset.collision?.kind ?? categoryRule?.(asset.category)?.collision ?? 'solid';
  if (SKIP_KINDS.has(kind)) continue;
  const tris = await trianglesOf(join(root, 'apps/web/public/catalog', asset.glbStorageKey), asset.frontAxis);
  if (!tris) { console.log(`skip  ${asset.title} (alpha materials)`); continue; }
  const bounds = new Box3();
  for (const t of tris) for (const v of t) bounds.expandByPoint(new Vector3().fromArray(v));
  const lo = bounds.min.toArray();
  const span = bounds.getSize(new Vector3()).toArray();
  // NormBox: x, z centred on the footprint, y from the base, each divided by the model's size.
  const norm = (v, i) => {
    const t = Math.min(1, Math.max(0, (v - lo[i]) / span[i]));
    return r4(i === 1 ? t : t - 0.5);
  };
  const boxes = compoundBoxes(tris, bounds, CELL)
    .map((b) => ({ min: b.min.toArray().map(norm), max: b.max.toArray().map(norm) }))
    .filter((b) => b.max.every((v, i) => v > b.min[i])); // clamping to the bounds can collapse edge boxes
  asset.collision = { ...(asset.collision ?? {}), kind, boxes };
  baked++;
  console.log(`baked ${asset.title}: ${boxes.length} boxes`);
}
AssetCatalogFileSchema.parse(raw);
void catalog;
await writeFile(catalogPath, JSON.stringify(raw, null, 2) + '\n');
console.log(`${baked} assets baked → ${catalogPath}`);
