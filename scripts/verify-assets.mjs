import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(
  await fs.readFile(
    path.join(root, "packages/contracts/src/catalog.json"),
    "utf8",
  ),
);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
await MeshoptDecoder.ready;
let total = 0;
for (const asset of catalog) {
  const file = path.join(root, "apps/web/public", asset.glbStorageKey);
  const data = await fs.readFile(file),
    doc = await io.read(file);
  assert.equal(
    createHash("sha256").update(data).digest("hex"),
    asset.contentHash,
    asset.title + " hash",
  );
  const b = getBounds(doc.getRoot().listScenes()[0]);
  for (let i = 0; i < 3; i++)
    assert.ok(
      Math.abs(b.max[i] - b.min[i] - asset.dimensionsM[i]) < 0.001,
      asset.title + " bounds",
    );
  assert.ok(Math.abs(b.min[1]) < 0.001, asset.title + " floor contact");
  assert.ok(
    Math.abs((b.max[0] + b.min[0]) / 2) < 0.001 &&
      Math.abs((b.max[2] + b.min[2]) / 2) < 0.001,
    asset.title + " centered origin",
  );
  const triangles = doc
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
                p.getAttribute("POSITION").getCount()) /
                3,
            0,
          ),
      0,
    );
  assert.equal(
    triangles,
    asset.triangleCount,
    asset.title + " triangle metadata",
  );
  total += triangles;
  for (const t of doc.getRoot().listTextures()) {
    const metadata = await sharp(t.getImage()).metadata();
    assert.ok(
      metadata.width <= 2048 && metadata.height <= 2048,
      asset.title + " texture budget",
    );
  }
  console.log(
    `${asset.title}: ${triangles.toLocaleString()} triangles, ${Math.round(data.length / 1024)} KB, normalized bounds verified`,
  );
}
console.log(
  `Verified ${catalog.length} GLBs, ${total.toLocaleString()} catalog triangles.`,
);
