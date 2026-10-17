import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  flatten,
  getBounds,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from "meshoptimizer";
import draco from "draco3dgltf";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const raw = process.env.HOUSE_RAW_MODELS || "/tmp/house-raw-models";
const sources = JSON.parse(
  await fs.readFile(path.join(root, "scripts/asset-sources.json"), "utf8"),
);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
    "draco3d.decoder": await draco.createDecoderModule(),
    "draco3d.encoder": await draco.createEncoderModule(),
  });
await Promise.all([
  MeshoptEncoder.ready,
  MeshoptDecoder.ready,
  MeshoptSimplifier.ready,
]);
const catalog = [];
const report = [];
for (const [i, source] of sources.entries()) {
  const doc = await io.read(path.join(raw, source.slug + ".glb"));
  await doc.transform(dedup(), flatten(), weld());
  const triangles = () =>
    doc
      .getRoot()
      .listMeshes()
      .reduce(
        (n, m) =>
          n +
          m
            .listPrimitives()
            .reduce(
              (s, p) =>
                s +
                (p.getIndices()?.getCount() ||
                  p.getAttribute("POSITION")?.getCount() ||
                  0) /
                  3,
              0,
            ),
        0,
      );
  const beforeTriangles = triangles();
  await doc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, 27000 / beforeTriangles),
      error: 0.01,
    }),
    prune(),
    textureCompress({
      encoder: sharp,
      resize: [1024, 1024],
      targetFormat: "webp",
      quality: 86,
    }),
  );
  const scene =
    doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const pivot = doc.createNode(source.slug + "-normalized");
  for (const child of scene.listChildren()) pivot.addChild(child);
  scene.addChild(pivot);
  pivot.setRotation([0, Math.sin(source.yaw / 2), 0, Math.cos(source.yaw / 2)]);
  const bounds = getBounds(scene),
    size = bounds.max.map((v, k) => v - bounds.min[k]);
  const scale = size.map((s, k) => source.dimensionsM[k] / s);
  pivot.setScale(scale);
  pivot.setTranslation([
    (-(bounds.min[0] + bounds.max[0]) / 2) * scale[0],
    -bounds.min[1] * scale[1],
    (-(bounds.min[2] + bounds.max[2]) / 2) * scale[2],
  ]);
  // Bound material response: original photo textures already contain some baked shading.
  for (const m of doc.getRoot().listMaterials()) {
    m.setMetallicFactor(source.slug === "side-table" ? 0.45 : 0);
    m.setRoughnessFactor(source.category === "plant" ? 0.8 : 0.88);
    if (source.category === "plant" && m.getBaseColorTexture()) {
      m.setAlphaMode("MASK");
      m.setAlphaCutoff(0.4);
      m.setDoubleSided(true);
    }
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  const dest = path.join(root, "apps/web/public/models", source.slug + ".glb");
  await io.write(dest, doc);
  const measured = getBounds(scene).max.map(
    (v, k) => +(v - getBounds(scene).min[k]).toFixed(5),
  );
  const bytes = await fs.readFile(dest);
  await sharp(path.join(raw, source.slug + ".png"))
    .resize(320, 240, { fit: "contain", background: "#f4f1eb" })
    .webp({ quality: 82 })
    .toFile(
      path.join(root, "apps/web/public/thumbnails", source.slug + ".webp"),
    );
  const textureBytes = doc
    .getRoot()
    .listTextures()
    .reduce((n, t) => n + (t.getImage()?.byteLength || 0), 0);
  catalog.push({
    schemaVersion: 1,
    id: `00000000-0000-4000-8000-${(1000 + i).toString().padStart(12, "0")}`,
    category: source.category,
    title: source.title,
    tags: ["warm", "minimal", source.category],
    styles: ["warm minimal", "scandinavian"],
    colors: ["natural"],
    materials: [source.category === "plant" ? "foliage" : "wood and fabric"],
    dimensionsM: measured,
    glbStorageKey: `/models/${source.slug}.glb`,
    thumbnailStorageKey: `/thumbnails/${source.slug}.webp`,
    source: "furnimesh",
    sourceUrl: source.sourceUrl,
    licenseStatus: "verified",
    attribution: source.author,
    estimatedPrice: { currency: "USD", minor: source.price },
    triangleCount: triangles(),
    textureBytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    searchableDescription: source.title + " in a warm minimal living room",
  });
  report.push({
    file: source.slug + ".glb",
    beforeTriangles,
    triangles: triangles(),
    dimensionsM: measured,
    bytes: bytes.length,
    textureBytes,
  });
  console.log(
    source.slug,
    Math.round(triangles()),
    "triangles",
    Math.round(bytes.length / 1024),
    "KB",
  );
}
await fs.writeFile(
  path.join(root, "packages/contracts/src/catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
await fs.writeFile(
  path.join(root, "scripts/asset-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
const license =
  `# Furniture model licenses\n\nDownloaded and terms checked 2026-10-17. Author: FurniMesh / UAB FURNISYSTEMS.\n\nThe [public library](https://furnimesh.com/library/) explicitly permits free commercial use without attribution, including games, AR, product pages, and client renders. Each model page exposes a public **Free download** GLB link and references [FurniMesh terms](https://furnimesh.com/terms/). The library license statement was checked at download time. FurniMesh describes its public models as photograph-derived models created with its generation engine.\n\nFiles below are downloaded source assets, then normalized, simplified, and meshopt compressed by House. Thumbnails use the licensed model page images. No user uploads or private assets are included.\n\n| File | Source | Author | License | Downloaded |\n|---|---|---|---|---|\n` +
  sources
    .map(
      (s) =>
        `| ${s.slug}.glb | [Model page](${s.sourceUrl}) | ${s.author} | Free commercial use, no attribution required | ${s.downloadDate} |`,
    )
    .join("\n") +
  "\n\nThe neutral scanned-object proxy and structural geometry are original code in this repository; they are not downloaded model files.\n";
await fs.writeFile(
  path.join(root, "apps/web/public/models/LICENSES.md"),
  license,
);
