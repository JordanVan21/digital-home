/**
 * FurniMesh batch import straight into the Supabase asset library (no repo files).
 *
 *   node scripts/import-furnimesh-batch.mjs [perSubcategory=3]
 *   (env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — e.g. via
 *    node --env-file=<room-scanner>/.env scripts/import-furnimesh-batch.mjs)
 *
 * Crawls the public FurniMesh library subcategories below, downloads each model's
 * public "Free download" GLB (FurniMesh: free commercial use, no attribution
 * required), and processes it like normalize-assets.mjs: simplify toward 27k
 * triangles, 1K webp textures, bottom-centred, meshopt. FurniMesh does not publish
 * physical sizes, so each model keeps its own proportions and is uniformly scaled to
 * a typical height for its category (the render agent fits it to the scanned size
 * anyway). GLB + thumbnail go to the public glbs bucket under furnimesh/, and an
 * AssetSpec row is upserted. IDs derive from the model URL, so re-runs are no-ops.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, getBounds, meshopt, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import draco from "draco3dgltf";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const perSub = Number(process.argv[2]) || 3;
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
const work = path.join(os.tmpdir(), "house-furnimesh-batch");
await fs.mkdir(work, { recursive: true });
const ua = { "User-Agent": "Mozilla/5.0 (HouseAssetImporter)" };

// subcategory path -> [catalog category, typical height (m), rough USD price]
const SUBCATEGORIES = {
  "sofas/sofa": ["sofa", 0.85, 129900], "sofas/loveseat": ["sofa", 0.85, 99900], "sofas/sectional": ["sofa", 0.85, 189900],
  "seating/armchair": ["armchair", 0.85, 49900], "seating/dining-chair": ["chair", 0.88, 19900], "seating/chair": ["chair", 0.85, 17900],
  "seating/office-chair": ["chair", 1.0, 29900], "seating/bar-stool": ["stool", 0.95, 14900], "seating/ottoman": ["ottoman", 0.42, 19900],
  "seating/bench": ["bench", 0.46, 24900],
  "tables/dining-table": ["table", 0.76, 79900], "tables/coffee-table": ["coffee-table", 0.42, 39900], "tables/side-table": ["side-table", 0.55, 14900],
  "tables/nightstand": ["side-table", 0.6, 19900], "tables/desk": ["desk", 0.76, 44900], "tables/console-table": ["sideboard", 0.8, 39900],
  "storage/sideboard": ["sideboard", 0.8, 79900], "storage/cabinet": ["cabinet", 0.9, 59900], "storage/dresser": ["dresser", 0.85, 69900],
  "storage/bookshelf": ["bookshelf", 1.8, 34900], "storage/wardrobe": ["wardrobe", 2.0, 99900], "storage/tv-stand": ["tv-stand", 0.55, 39900],
  "beds/bed": ["bed", 1.05, 149900],
  "kitchen/kitchen-cabinet": ["cabinet", 0.9, 49900], "kitchen/kitchen-island": ["kitchen-island", 0.92, 149900],
  "appliances/refrigerator": ["refrigerator", 1.8, 159900],
  "bathroom/bathtub": ["bathtub", 0.58, 129900], "bathroom/toilet": ["toilet", 0.78, 39900], "bathroom/sink": ["sink", 0.85, 29900],
  "bathroom/vanity": ["vanity", 0.85, 89900],
  "lighting/floor-lamp": ["lamp", 1.6, 17900], "lighting/table-lamp": ["lamp", 0.5, 8900],
  "decor/plant": ["plant", 1.2, 8900],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder,
  "draco3d.decoder": await draco.createDecoderModule(), "draco3d.encoder": await draco.createEncoderModule(),
});
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);

const text = async (u) => { const r = await fetch(u, { headers: ua }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.text(); };
const bytes = async (u) => { const r = await fetch(u, { headers: ua }); if (!r.ok) throw new Error(`${r.status} ${u}`); return Buffer.from(await r.arrayBuffer()); };
const uuidFrom = (s) => { const h = createHash("sha256").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const triangles = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce(
  (s, p) => s + (p.getIndices()?.getCount() || p.getAttribute("POSITION")?.getCount() || 0) / 3, 0), 0);

/**
 * curl uploads reliably where Node fetch can hit closed keep-alive sockets. Headers
 * (including the key) go in on stdin, so they never appear in argv or error output.
 */
function upload(objectPath, file, contentType) {
  const config = [
    `header = "apikey: ${key}"`,
    `header = "Authorization: Bearer ${key}"`,
    `header = "Content-Type: ${contentType}"`,
    `header = "x-upsert: true"`,
    `header = "Cache-Control: 31536000"`,
  ].join("\n");
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-K", "-", "-X", "POST",
        `${url}/storage/v1/object/glbs/${objectPath}`, "--data-binary", `@${file}`],
        { input: config, stdio: ["pipe", "pipe", "ignore"] }).toString();
      if (code === "200") return;
      last = `HTTP ${code}`;
    } catch (e) {
      last = `curl exit ${e.status}`;
    }
  }
  throw new Error(`upload ${objectPath} failed (${last})`);
}

const known = new Set((await (await fetch(`${url}/rest/v1/assets?select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json()).map((r) => r.id));

const jobs = [];
for (const [sub, spec] of Object.entries(SUBCATEGORIES)) {
  try {
    const html = await text(`https://furnimesh.com/library/${sub}/`);
    const links = [...new Set(html.match(new RegExp(`/library/${sub}/[a-z0-9-]+/`, "g")) ?? [])].slice(0, perSub);
    for (const link of links) jobs.push({ sub, link, spec });
  } catch (e) { console.error(`skip ${sub}: ${e.message}`); }
}
console.log(`${jobs.length} models to check`);

let added = 0;
async function run({ sub, link, spec: [category, height, price] }) {
  const sourceUrl = `https://furnimesh.com${link}`;
  const id = uuidFrom(sourceUrl);
  if (known.has(id)) return;
  const html = await text(sourceUrl);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => { try { return JSON.parse(m[1]); } catch { return {}; } });
  const model = ld.find((x) => x["@type"] === "3DModel") ?? {};
  const glbUrl = html.match(/https:\/\/storage\.googleapis\.com\/[^\s<>"\\]+\.glb/)?.[0];
  if (!glbUrl) throw new Error("no public GLB");
  const slug = link.split("/").filter(Boolean).at(-1).slice(-40);
  const title = (model.name ?? slug).replace(/\s*3D Model$/i, "").slice(0, 60);
  const raw = path.join(work, `${slug}.raw.glb`);
  await fs.writeFile(raw, await bytes(glbUrl));

  const doc = await io.read(raw);
  await doc.transform(dedup(), flatten(), weld());
  const before = triangles(doc);
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, 27000 / Math.max(before, 1)), error: 0.01 }),
    prune(),
    textureCompress({ encoder: sharp, resize: [1024, 1024], targetFormat: "webp", quality: 86 }),
  );
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const pivot = doc.createNode(`${slug}-normalized`);
  for (const child of scene.listChildren()) pivot.addChild(child);
  scene.addChild(pivot);
  const b = getBounds(scene), size = b.max.map((v, k) => v - b.min[k]);
  if (size.some((n) => !(n > 0))) throw new Error("degenerate bounds");
  const s = height / size[1];
  pivot.setScale([s, s, s]);
  pivot.setTranslation([(-(b.min[0] + b.max[0]) / 2) * s, -b.min[1] * s, (-(b.min[2] + b.max[2]) / 2) * s]);
  for (const m of doc.getRoot().listMaterials()) {
    m.setMetallicFactor(0);
    m.setRoughnessFactor(category === "plant" ? 0.8 : 0.88);
    if (category === "plant" && m.getBaseColorTexture()) { m.setAlphaMode("MASK"); m.setAlphaCutoff(0.4); m.setDoubleSided(true); }
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  const glbFile = path.join(work, `${slug}.glb`);
  await io.write(glbFile, doc);
  const out = getBounds(scene), dims = out.max.map((v, k) => +(v - out.min[k]).toFixed(5));
  if (Math.max(...dims) > 4) throw new Error(`implausible size ${dims}`);
  const glb = await fs.readFile(glbFile);
  const glbPath = `furnimesh/${slug}.glb`, thumbPath = `furnimesh/thumbs/${slug}.webp`;
  upload(glbPath, glbFile, "model/gltf-binary");
  let thumbnailStorageKey;
  if (model.thumbnailUrl) {
    const thumbFile = path.join(work, `${slug}.webp`);
    await sharp(await bytes(model.thumbnailUrl)).resize(320, 240, { fit: "contain", background: "#f4f1eb" }).webp({ quality: 82 }).toFile(thumbFile);
    upload(thumbPath, thumbFile, "image/webp");
    thumbnailStorageKey = thumbPath;
  }
  const description = (model.description ?? title).slice(0, 400);
  const words = description.toLowerCase().match(/[a-z]+/g) ?? [];
  const pick = (vocab) => [...new Set(words.filter((w) => vocab.includes(w)))].slice(0, 4);
  const asset = {
    schemaVersion: 1, id, category, title,
    tags: ["furnimesh", category, sub.split("/")[1]],
    styles: pick(["modern", "contemporary", "minimalist", "scandinavian", "rustic", "industrial", "vintage", "classic", "traditional", "mid", "luxury", "bohemian"]),
    colors: pick(["white", "black", "grey", "gray", "beige", "cream", "brown", "walnut", "oak", "natural", "blue", "green", "navy", "pink", "red", "yellow", "orange", "gold", "brass", "silver", "charcoal", "taupe", "ivory", "tan"]),
    materials: pick(["wood", "wooden", "oak", "walnut", "fabric", "linen", "velvet", "leather", "boucle", "metal", "steel", "brass", "marble", "glass", "rattan", "cane", "wicker", "ceramic", "stone", "upholstered"]),
    dimensionsM: dims, glbStorageKey: glbPath, ...(thumbnailStorageKey ? { thumbnailStorageKey } : {}),
    source: "furnimesh", sourceUrl, licenseStatus: "verified",
    attribution: "FurniMesh / UAB FURNISYSTEMS (free commercial use, no attribution required)",
    estimatedPrice: { currency: "USD", minor: price },
    triangleCount: Math.round(triangles(doc)),
    textureBytes: doc.getRoot().listTextures().reduce((n, t) => n + (t.getImage()?.byteLength || 0), 0),
    contentHash: createHash("sha256").update(glb).digest("hex"),
    searchableDescription: `${title}. ${description}`,
  };
  const row = {
    id, spec: asset, category, title, width_m: dims[0], height_m: dims[1], depth_m: dims[2],
    tags: asset.tags, styles: asset.styles, glb_path: glbPath, thumbnail_path: thumbnailStorageKey ?? null,
    price_minor: price, currency: "USD",
  };
  const res = await fetch(`${url}/rest/v1/assets`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`asset row: ${res.status} ${await res.text()}`);
  added++;
  console.log(`${category.padEnd(14)} ${title.slice(0, 44).padEnd(44)} ${dims.map((n) => n.toFixed(2)).join("×")} m ${Math.round(glb.length / 1024)} KB`);
}

let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    try { await run(job); } catch (e) { console.error(`skipped ${job.link}: ${e.message}`); }
  }
}));
console.log(`\nAdded ${added} FurniMesh models to the Supabase library.`);
