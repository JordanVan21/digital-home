// Asset verification (from the codex sandbox's verify-assets.mjs): decode every catalog GLB and check
// its SHA-256, normalized bounds (= catalog dimensions), floor contact, centred footprint, triangle
// metadata and texture budget. Usage: pnpm assets:verify
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = resolve(here, '../../apps/web/public/catalog');
const { assets } = JSON.parse(await readFile(join(catalogDir, 'catalog.json'), 'utf8'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const TOL = 0.0015; // catalog dimensions are rounded to millimetres
let total = 0;
let failures = 0;
for (const a of assets) {
  try {
    const file = join(catalogDir, a.glbStorageKey);
    const data = await readFile(file);
    const doc = await io.read(file);
    assert.equal(`sha256:${createHash('sha256').update(data).digest('hex')}`, a.contentHash, 'content hash');
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    const b = getBounds(scene);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(b.max[i] - b.min[i] - a.dimensionsM[i]) < TOL, `bounds axis ${i}`);
    assert.ok(Math.abs(b.min[1]) < TOL, 'floor contact (base at y = 0)');
    assert.ok(Math.abs((b.max[0] + b.min[0]) / 2) < TOL && Math.abs((b.max[2] + b.min[2]) / 2) < TOL, 'centred footprint');
    const tris = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3, 0), 0);
    if (a.triangleCount !== undefined) assert.equal(tris, a.triangleCount, 'triangle metadata');
    for (const t of doc.getRoot().listTextures()) {
      const m = await sharp(t.getImage()).metadata();
      assert.ok(m.width <= 2048 && m.height <= 2048, 'texture budget (≤ 2048²)');
    }
    total += tris;
    console.log(`✓ ${a.title}: ${tris.toLocaleString()} tris, ${Math.round(data.length / 1024)} KB${a.licenseStatus !== 'verified' ? ` (${a.licenseStatus})` : ''}`);
  } catch (e) {
    failures++;
    console.error(`✗ ${a.title}: ${e.message}`);
  }
}
console.log(`\nVerified ${assets.length - failures}/${assets.length} GLBs, ${total.toLocaleString()} triangles.`);
if (failures) process.exit(1);
