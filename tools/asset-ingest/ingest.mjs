// Catalog ingest: downloads CC0 sources (or generates self-authored assets), normalizes them
// (footprint centered at origin, base at y = 0, meters, front +Z), compresses (WebP textures,
// Meshopt geometry), and writes apps/web/public/catalog/{models,thumbs,catalog.json}.
//
// Usage: pnpm --filter @house/asset-ingest ingest [--force]
// To add a FurniMesh (or other) GLB: add an entry with "localGlb": "<path>" plus "source"/"license"
// fields, and only set "licenseStatus": "verified" once redistribution rights are confirmed.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { bakedGeometry, builders } from './procedural.mjs';
import { center, dedup, getBounds, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { AssetCatalogFileSchema } from '@house/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const staging = join(root, 'asset-staging');
const outDir = join(root, 'apps/web/public/catalog');
const hdrDir = join(root, 'apps/web/public/hdr');
const force = process.argv.includes('--force');

const config = JSON.parse(await readFile(join(here, 'assets.config.json'), 'utf8'));

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function download(url, file) {
  if (existsSync(file) && !force) return;
  await mkdir(dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function fetchPolyHaven(id) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const g = files.gltf['1k'].gltf;
  const dir = join(staging, id);
  await download(g.url, join(dir, `${id}.gltf`));
  for (const [rel, f] of Object.entries(g.include)) await download(f.url, join(dir, rel));
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  return { gltfPath: join(dir, `${id}.gltf`), authors: Object.keys(info.authors ?? {}) };
}

// ---------------------------------------------------------------- self-authored rug
function juteSvg(w, d, p) {
  const W = 1024;
  const H = Math.round((W * d) / w);
  const b = Math.round(W * 0.035);
  const cells = [];
  // Chunky basket weave: alternating horizontal / vertical braided cells.
  for (let y = b; y < H - b; y += 22) {
    for (let x = b; x < W - b; x += 22) {
      const horiz = ((x / 22) + (y / 22)) % 2 < 1;
      cells.push(horiz
        ? `<rect x="${x + 1}" y="${y + 4}" width="20" height="14" rx="6" fill="${p.stripe}" fill-opacity="0.55"/><path d="M${x + 3} ${y + 11} h16" stroke="#000" stroke-opacity="0.18" stroke-width="2"/>`
        : `<rect x="${x + 4}" y="${y + 1}" width="14" height="20" rx="6" fill="${p.field}" fill-opacity="0.9"/><path d="M${x + 11} ${y + 3} v16" stroke="#000" stroke-opacity="0.2" stroke-width="2"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${p.border}"/><rect x="${b}" y="${b}" width="${W - 2 * b}" height="${H - 2 * b}" fill="${p.field}"/>${cells.join('')}</svg>`;
}

function rugSvg(w, d, p) {
  const W = 1024;
  const H = Math.round((W * d) / w);
  const b = Math.round(W * 0.05);
  const lines = [];
  for (let y = 0; y < H; y += 6) lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#000" stroke-opacity="0.06" stroke-width="2"/>`);
  for (let x = 0; x < W; x += 6) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#fff" stroke-opacity="0.05" stroke-width="2"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${p.border}"/>
  <rect x="${b}" y="${b}" width="${W - 2 * b}" height="${H - 2 * b}" fill="${p.field}"/>
  <rect x="${b * 1.6}" y="${b * 1.6}" width="${W - 3.2 * b}" height="${H - 3.2 * b}" fill="none" stroke="${p.stripe}" stroke-width="${b * 0.25}"/>
  <rect x="${b * 2.4}" y="${b * 2.4}" width="${W - 4.8 * b}" height="${H - 4.8 * b}" fill="none" stroke="${p.border}" stroke-width="${b * 0.12}"/>
  ${lines.join('')}
</svg>`;
}

/** Box with a full-texture top face; other faces sample the border corner. */
function boxGeometry(w, h, d) {
  const x = w / 2, z = d / 2;
  const faces = [
    // normal, 4 corners (CCW seen from outside), uv mode
    [[0, 1, 0], [[-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z]], 'top'],
    [[0, -1, 0], [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]], 'edge'],
    [[0, 0, 1], [[-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]], 'edge'],
    [[0, 0, -1], [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]], 'edge'],
    [[1, 0, 0], [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z]], 'edge'],
    [[-1, 0, 0], [[-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z]], 'edge'],
  ];
  const pos = [], nor = [], uv = [], idx = [];
  for (const [n, corners, mode] of faces) {
    const base = pos.length / 3;
    const uvs = mode === 'top' ? [[0, 1], [1, 1], [1, 0], [0, 0]] : [[0.005, 0.005], [0.02, 0.005], [0.02, 0.02], [0.005, 0.02]];
    corners.forEach((c, i) => { pos.push(...c); nor.push(...n); uv.push(...uvs[i]); });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

async function generateRug(entry) {
  const [w, h, d] = entry.size;
  const png = await sharp(Buffer.from((entry.weave ? juteSvg : rugSvg)(w, d, entry.palette))).png().toBuffer();
  const doc = new Document();
  const buffer = doc.createBuffer();
  const g = boxGeometry(w, h, d);
  const tex = doc.createTexture('rug').setImage(png).setMimeType('image/png');
  const mat = doc.createMaterial('rug').setBaseColorTexture(tex).setRoughnessFactor(0.95).setMetallicFactor(0);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(g.nor).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(g.uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(g.idx).setBuffer(buffer))
    .setMaterial(mat);
  const node = doc.createNode(entry.slug).setMesh(doc.createMesh(entry.slug).addPrimitive(prim));
  doc.createScene('scene').addChild(node);
  return { doc, thumb: png };
}

// ---------------------------------------------------------------- procedural (self-authored)
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
}

async function generateProcedural(entry) {
  const build = builders[entry.procedural];
  if (!build) throw new Error(`Unknown procedural builder ${entry.procedural}`);
  const { parts, materials } = build(entry.params ?? {});
  const doc = new Document();
  const buffer = doc.createBuffer();
  const emissiveExt = doc.createExtension(KHRMaterialsEmissiveStrength);
  const mats = {};
  for (const [name, m] of Object.entries(materials)) {
    const mat = doc.createMaterial(name)
      .setBaseColorFactor([...hexLinear(m.color ?? '#ffffff'), m.opacity ?? 1])
      .setRoughnessFactor(m.roughness ?? 0.8)
      .setMetallicFactor(m.metalness ?? 0)
      .setDoubleSided(!!m.doubleSided);
    if (m.opacity !== undefined && m.opacity < 1) mat.setAlphaMode('BLEND');
    if (m.emissive) {
      mat.setEmissiveFactor(hexLinear(m.emissive));
      if (m.emissiveStrength && m.emissiveStrength !== 1) mat.setExtension('KHR_materials_emissive_strength', emissiveExt.createEmissiveStrength().setEmissiveStrength(m.emissiveStrength));
    }
    if (m.texture) {
      const png = await sharp(Buffer.from(m.texture)).png().toBuffer();
      mat.setBaseColorTexture(doc.createTexture(name).setImage(png).setMimeType('image/png'));
    }
    mats[name] = mat;
  }
  const mesh = doc.createMesh(entry.slug);
  for (const p of parts) {
    const g = bakedGeometry(p);
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    const uv = g.attributes.uv ? g.attributes.uv.array : new Float32Array((pos.length / 3) * 2);
    const count = pos.length / 3;
    const idx = g.index ? g.index.array : Uint32Array.from({ length: count }, (_, i) => i);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(count > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)).setBuffer(buffer))
      .setMaterial(mats[p.material]);
    mesh.addPrimitive(prim);
  }
  doc.createScene('scene').addChild(doc.createNode(entry.slug).setMesh(mesh));
  // Thumbnail: a flat swatch of the main material colour (real previews come from the gallery).
  const main = Object.values(materials)[0];
  const thumb = await sharp({ create: { width: 256, height: 256, channels: 4, background: main?.color ?? '#cccccc' } }).png().toBuffer();
  return { doc, thumb };
}

// ---------------------------------------------------------------- processing
function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const count = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
      if (p.getMode() === 4) n += count / 3;
    }
  }
  return Math.round(n);
}

/** Re-parent the scene under a root rotated about +Y so the model's front faces +Z. */
function bakeFrontToPlusZ(doc, frontAxis) {
  const yaw = { '+X': -Math.PI / 2, '-X': Math.PI / 2, '-Z': Math.PI }[frontAxis];
  for (const scene of doc.getRoot().listScenes()) {
    const pivot = doc.createNode('front-to-plus-z').setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
    for (const child of scene.listChildren()) { scene.removeChild(child); pivot.addChild(child); }
    scene.addChild(pivot);
  }
}

const round = (v) => Math.round(v * 1000) / 1000;

async function processEntry(entry) {
  let doc, thumb, sourceUrl, attribution, source, license;
  if (entry.generator === 'rug') {
    ({ doc, thumb } = await generateRug(entry));
    source = 'self_authored';
    license = 'CC0-1.0';
    attribution = 'House project (self-authored, CC0)';
  } else if (entry.procedural) {
    ({ doc, thumb } = await generateProcedural(entry));
    source = 'self_authored';
    license = 'CC0-1.0';
    attribution = 'House project (self-authored procedural, CC0)';
  } else if (entry.polyhaven) {
    const { gltfPath, authors } = await fetchPolyHaven(entry.polyhaven);
    doc = await io.read(gltfPath);
    const r = await fetch(`https://cdn.polyhaven.com/asset_img/thumbs/${entry.polyhaven}.png?width=256&height=256`);
    thumb = Buffer.from(await r.arrayBuffer());
    source = 'other';
    license = 'CC0-1.0';
    sourceUrl = `https://polyhaven.com/a/${entry.polyhaven}`;
    attribution = `${entry.polyhaven} by ${authors.join(', ') || 'unknown'} — Poly Haven (CC0)`;
  } else if (entry.localGlb) {
    doc = await io.read(resolve(root, entry.localGlb));
    source = entry.source ?? 'other';
    license = entry.license;
    sourceUrl = entry.sourceUrl;
    attribution = entry.attribution;
  } else throw new Error(`No source for ${entry.slug}`);

  if (entry.frontAxis && entry.frontAxis !== '+Z') bakeFrontToPlusZ(doc, entry.frontAxis);
  // Optional decimation for heavy sources (triangle budget); error is relative to mesh size.
  if (entry.simplify) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: entry.simplify, error: 0.004 }));
  await doc.transform(
    dedup(),
    prune(),
    center({ pivot: 'below' }), // footprint centered on origin, base at y = 0
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const dims = [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])];
  const textureBytes = doc.getRoot().listTextures().reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0);
  const glb = Buffer.from(await io.writeBinary(doc));

  await mkdir(join(outDir, 'models'), { recursive: true });
  await mkdir(join(outDir, 'thumbs'), { recursive: true });
  await writeFile(join(outDir, 'models', `${entry.slug}.glb`), glb);
  if (thumb) await writeFile(join(outDir, 'thumbs', `${entry.slug}.webp`), await sharp(thumb).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer());

  const spec = {
    schemaVersion: 1,
    id: entry.id,
    category: entry.category,
    title: entry.title,
    tags: entry.tags ?? [],
    styles: entry.styles ?? [],
    colors: entry.colors ?? [],
    materials: entry.materials ?? [],
    dimensionsM: dims,
    glbStorageKey: `models/${entry.slug}.glb`,
    ...(thumb ? { thumbnailStorageKey: `thumbs/${entry.slug}.webp` } : {}),
    source,
    ...(sourceUrl ? { sourceUrl } : {}),
    licenseStatus: entry.licenseStatus ?? 'verified',
    ...(attribution ? { attribution } : {}),
    ...(license ? { license } : {}),
    ...(entry.priceMinor !== undefined ? { estimatedPrice: { currency: 'USD', minor: entry.priceMinor } } : {}),
    triangleCount: triangleCount(doc),
    textureBytes,
    contentHash: `sha256:${createHash('sha256').update(glb).digest('hex')}`,
    searchableDescription: [entry.title, entry.category.replace(/_/g, ' '), ...(entry.tags ?? []), ...(entry.styles ?? []), ...(entry.materials ?? [])].join(', '),
    ...(entry.placementClass ? { placementClass: entry.placementClass } : {}),
    frontAxis: '+Z', // baked at ingest (see bakeFrontToPlusZ)
    ...(entry.collision ? { collision: entry.collision } : {}),
    ...(entry.supports ? { supports: entry.supports } : {}),
    ...(entry.light ? { light: entry.light } : {}),
    ...(entry.variants ? { variants: entry.variants } : {}),
    ...(entry.castShadow !== undefined ? { castShadow: entry.castShadow } : {}),
    ...(entry.tiltable !== undefined ? { tiltable: entry.tiltable } : {}),
  };
  console.log(`${entry.slug.padEnd(28)} ${dims.join(' × ').padEnd(22)} ${String(spec.triangleCount).padStart(7)} tris  ${(glb.byteLength / 1024).toFixed(0).padStart(6)} KB`);
  return spec;
}

const assets = [];
for (const entry of config.assets) assets.push(await processEntry(entry));
const catalog = AssetCatalogFileSchema.parse({ schemaVersion: 1, assets });
await writeFile(join(outDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

const hdrs = config.hdrs ?? (config.hdr ? [config.hdr] : []);
if (hdrs.length) {
  await mkdir(hdrDir, { recursive: true });
  const notes = ['# HDR environments', ''];
  for (const h of hdrs) {
    const files = await (await fetch(`https://api.polyhaven.com/files/${h.polyhaven}`)).json();
    await download(files.hdri[h.resolution].hdr.url, join(hdrDir, h.out));
    notes.push(`- \`${h.out}\`: "${h.polyhaven}" (${h.resolution}) from https://polyhaven.com/a/${h.polyhaven} — CC0 1.0.`);
    console.log(`hdr → ${h.out}`);
  }
  await writeFile(join(hdrDir, 'SOURCE.md'), `${notes.join('\n')}\n`);
}
if (config.textures) {
  const texDir = join(root, 'apps/web/public/textures');
  const notes = ['# Surface textures', ''];
  for (const t of config.textures) {
    const files = await (await fetch(`https://api.polyhaven.com/files/${t.polyhaven}`)).json();
    const info = await (await fetch(`https://api.polyhaven.com/info/${t.polyhaven}`)).json();
    await mkdir(join(texDir, t.out), { recursive: true });
    for (const [map, key] of [['diff', 'Diffuse'], ['rough', 'Rough'], ['nor', 'nor_gl']]) {
      const tmp = join(staging, 'textures', t.polyhaven, `${map}.jpg`);
      await download(files[key]['1k'].jpg.url, tmp);
      await writeFile(join(texDir, t.out, `${map}.webp`), await sharp(tmp).webp({ quality: 85 }).toBuffer());
    }
    const tileSizeM = (info.dimensions?.[0] ?? 2000) / 1000;
    await writeFile(join(texDir, t.out, 'meta.json'), `${JSON.stringify({ source: `https://polyhaven.com/a/${t.polyhaven}`, license: 'CC0-1.0', tileSizeM }, null, 2)}\n`);
    notes.push(`- \`${t.out}/\`: "${t.polyhaven}" from https://polyhaven.com/a/${t.polyhaven} — CC0 1.0 (tile ${tileSizeM} m).`);
    console.log(`texture → ${t.out} (tile ${tileSizeM} m)`);
  }
  await writeFile(join(texDir, 'SOURCE.md'), `${notes.join('\n')}\n`);
}
console.log(`catalog.json: ${assets.length} assets`);
