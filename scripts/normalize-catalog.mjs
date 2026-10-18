// Normalize imported source axes/origins without changing the artists' meshes.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Box3, Vector3, Matrix4, Quaternion } from '../apps/web/node_modules/three/build/three.module.js';

const root = new URL('../apps/web/public/models/polyhaven/', import.meta.url);
const records = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
const catalog = [];
for (const record of records) {
  const bytes = fs.readFileSync(new URL(record.filename, root));
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binary = bytes.subarray(28 + jsonLength);
  const box = new Box3();
  const normalized = doc.nodes.some((node) => node.name === 'House_floor_origin');
  // The display shelf's long horizontal axis is Z in its source export.
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), !normalized && record.category === 'bookshelf' ? Math.PI / 2 : 0);
  const axis = new Matrix4().makeRotationFromQuaternion(rotation);
  function visit(i, parent) {
    const n = doc.nodes[i];
    const matrix = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(
      new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
    matrix.premultiply(parent);
    if (n.mesh !== undefined) for (const primitive of doc.meshes[n.mesh].primitives) {
      const accessor = doc.accessors[primitive.attributes.POSITION];
      box.union(new Box3(new Vector3(...accessor.min), new Vector3(...accessor.max)).applyMatrix4(matrix));
    }
    for (const child of n.children ?? []) visit(child, matrix);
  }
  const scene = doc.scenes[doc.scene ?? 0];
  for (const node of scene.nodes) visit(node, axis);
  const size = box.getSize(new Vector3()).toArray();
  const center = box.getCenter(new Vector3());
  if (!normalized) {
    const wrapper = doc.nodes.length;
    doc.nodes.push({ name: 'House_floor_origin', children: scene.nodes, rotation: rotation.toArray(), translation: [-center.x, -box.min.y, -center.z] });
    scene.nodes = [wrapper];
  }
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.concat([json, Buffer.alloc((-json.length >>> 0) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, padded, binHeader, binary]);
  const hash = crypto.createHash('sha256').update(glb).digest('hex');
  const filename = `${record.name}-${hash.slice(0, 12)}.glb`;
  fs.writeFileSync(new URL(filename, root), glb);
  if (filename !== record.filename) fs.unlinkSync(new URL(record.filename, root));
  const title = record.name.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const triangleCount = doc.meshes.reduce((total, mesh) => total + mesh.primitives.reduce((sum, p) =>
    sum + ((p.mode ?? 4) === 4 ? doc.accessors[p.indices ?? p.attributes.POSITION].count / 3 : 0), 0), 0);
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  catalog.push({ schemaVersion: 1, id, category: record.category,
    title, tags: ['fixture', 'CC0'], styles: ['contemporary'], colors: [], materials: [], dimensionsM: size,
    glbStorageKey: `models/polyhaven/${filename}`, source: 'other', sourceUrl: `https://polyhaven.com/a/${record.name}`,
    licenseStatus: 'verified', attribution: `${title} · Poly Haven · CC0`, textureBytes: record.textureBytes, triangleCount,
    contentHash: hash, searchableDescription: `${title}, CC0 Poly Haven furniture fixture` });
  record.filename = filename; record.contentHash = hash;
}
fs.writeFileSync(new URL('manifest.json', root), JSON.stringify(records, null, 2) + '\n');
fs.writeFileSync(new URL('../apps/web/src/fixtures/assetCatalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
