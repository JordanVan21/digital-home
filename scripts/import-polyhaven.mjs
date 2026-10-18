/** Curated offline Poly Haven import. Models are CC0; no website renders used. */
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
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const sources = JSON.parse(
  await fs.readFile(path.join(root, "scripts/polyhaven-sources.json"), "utf8"),
);
const headers = {
  "User-Agent": "HouseSandboxAssetImporter/1.0 (curated offline CC0 models)",
};
const date = new Date().toISOString().slice(0, 10);
const getJSON = async (url) => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
};
const allAssets = await getJSON("https://api.polyhaven.com/assets?t=models");
await Promise.all([
  MeshoptEncoder.ready,
  MeshoptDecoder.ready,
  MeshoptSimplifier.ready,
]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
const catalogPath = path.join(root, "packages/contracts/src/catalog.json");
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const reportPath = path.join(root, "scripts/asset-report.json");
const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
const provenance = [];
const triangleCount = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .reduce(
      (total, mesh) =>
        total +
        mesh
          .listPrimitives()
          .reduce(
            (n, p) =>
              n +
              (p.getIndices()?.getCount() ??
                p.getAttribute("POSITION").getCount()) /
                3,
            0,
          ),
      0,
    );
for (const source of sources) {
  const manifest = await getJSON(
    `https://api.polyhaven.com/files/${source.assetId}`,
  );
  const gltf = manifest.gltf?.["1k"]?.gltf;
  if (!gltf) throw new Error(`Missing 1K glTF for ${source.assetId}`);
  const raw = path.join("/tmp/house-polyhaven-source", source.assetId);
  await fs.mkdir(raw, { recursive: true });
  const downloads = [];
  for (const [relative, file] of [
    [`${source.assetId}.gltf`, gltf],
    ...Object.entries(gltf.include ?? {}),
  ]) {
    const dest = path.resolve(raw, relative);
    if (!dest.startsWith(raw + path.sep))
      throw new Error("Unsafe download path");
    const url = new URL(file.url);
    if (url.protocol !== "https:" || url.hostname !== "dl.polyhaven.org")
      throw new Error("Unexpected model host");
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("md5").update(bytes).digest("hex") !== file.md5)
      throw new Error(`Source checksum mismatch: ${relative}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes);
    downloads.push({
      file: relative,
      url: file.url,
      bytes: bytes.length,
      md5: file.md5,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const doc = await io.read(path.join(raw, `${source.assetId}.gltf`));
  const beforeTriangles = triangleCount(doc);
  await doc.transform(
    dedup(),
    flatten(),
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, 25000 / beforeTriangles),
      error: 0.001,
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
    doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const pivot = doc.createNode(`${source.slug}-normalized`);
  for (const child of scene.listChildren()) pivot.addChild(child);
  scene.addChild(pivot);
  pivot.setRotation([0, Math.sin(source.yaw / 2), 0, Math.cos(source.yaw / 2)]);
  const bounds = getBounds(scene);
  pivot.setTranslation([
    -(bounds.min[0] + bounds.max[0]) / 2,
    -bounds.min[1],
    -(bounds.min[2] + bounds.max[2]) / 2,
  ]);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  const measured = getBounds(scene);
  const dimensionsM = measured.max.map(
    (n, i) => +(n - measured.min[i]).toFixed(5),
  );
  if (dimensionsM.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error("Invalid model dimensions");
  const bytes = Buffer.from(await io.writeBinary(doc));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const prior = catalog.find((a) => a.id === source.catalogId);
  if (prior && prior.contentHash !== hash)
    throw new Error(
      `Immutable asset changed: ${source.slug}; assign a new version ID and filename before reimporting.`,
    );
  await fs.writeFile(
    path.join(root, "apps/web/public/models", source.slug + ".glb"),
    bytes,
  );
  const author = Object.keys(allAssets[source.assetId].authors).join(", ");
  const asset = {
    schemaVersion: 1,
    id: source.catalogId,
    category: source.category,
    title: source.title,
    tags: ["polyhaven", "poly haven", "CC0", source.category],
    styles: source.styles,
    colors: ["natural"],
    materials: source.materials,
    dimensionsM,
    glbStorageKey: `/models/${source.slug}.glb`,
    thumbnailStorageKey: `/thumbnails/${source.slug}.webp`,
    source: "other",
    sourceUrl: `https://polyhaven.com/a/${source.assetId}`,
    licenseStatus: "verified",
    attribution: `${author} / Poly Haven (CC0)`,
    estimatedPrice: { currency: "USD", minor: source.price },
    triangleCount: triangleCount(doc),
    textureBytes: doc
      .getRoot()
      .listTextures()
      .reduce((n, t) => n + (t.getImage()?.byteLength ?? 0), 0),
    contentHash: hash,
    searchableDescription: `${source.title}, ${source.styles.join(", ")}, CC0 model by ${author} from Poly Haven`,
  };
  if (!prior) catalog.push(asset);
  else Object.assign(prior, asset);
  const entry = {
    file: source.slug + ".glb",
    beforeTriangles,
    triangles: asset.triangleCount,
    dimensionsM,
    bytes: bytes.length,
    textureBytes: asset.textureBytes,
  };
  const index = report.findIndex((r) => r.file === entry.file);
  if (index < 0) report.push(entry);
  else report[index] = entry;
  provenance.push({
    assetId: source.assetId,
    catalogId: source.catalogId,
    sourceUrl: asset.sourceUrl,
    author,
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    downloadDate: date,
    downloads,
    normalizedSha256: hash,
    dimensionsM,
    priceNote:
      "Curated physical-item estimate in USD cents, not a source or retailer quotation.",
  });
  console.log(
    `${source.slug}: ${dimensionsM.join(" × ")} m, ${asset.triangleCount} triangles, ${Math.round(bytes.length / 1024)} KB`,
  );
}
await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
await fs.writeFile(
  path.join(root, "scripts/polyhaven-provenance.json"),
  JSON.stringify(provenance, null, 2) + "\n",
);
const licensePath = path.join(root, "apps/web/public/models/LICENSES.md");
const license = (await fs.readFile(licensePath, "utf8")).split(
  "\n## Poly Haven",
)[0];
const section =
  "\n## Poly Haven\n\nThese models are CC0-1.0 from [Poly Haven](https://polyhaven.com/license), imported as local GLBs with original PBR materials and meter scale, bottom-centered origins, embedded 1K textures and meshopt compression. House generates the thumbnails from the model geometry; Poly Haven website renders are not redistributed. Import requests identify HouseSandboxAssetImporter; the app does not call the live API.\n\n| File | Source | Author | License | Downloaded |\n|---|---|---|---|---|\n" +
  sources
    .map(
      (s, i) =>
        `| ${s.slug}.glb | [Model page](${provenance[i].sourceUrl}) | ${provenance[i].author} | CC0-1.0 | ${date} |`,
    )
    .join("\n") +
  "\n";
await fs.writeFile(licensePath, license + section);
execFileSync(
  process.execPath,
  [path.join(root, "scripts/preview-assets.mjs")],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      HOUSE_PREVIEW_PREFIX: "polyhaven-",
      HOUSE_WRITE_THUMBNAILS: "1",
    },
  },
);
