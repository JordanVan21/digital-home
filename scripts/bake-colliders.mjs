/** Bake deterministic normalized compound colliders from the shipped opaque GLBs. */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
} from "../apps/web/node_modules/three/build/three.module.js";
import {
  bakeGeometry,
  buildProfile,
} from "../apps/web/src/geometry-lab/queries.ts";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(
  await fs.readFile(
    path.join(root, "packages/contracts/src/catalog.json"),
    "utf8",
  ),
);
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const models = {};
for (const asset of catalog) {
  const doc = await io.read(
    path.join(root, "apps/web/public", asset.glbStorageKey),
  );
  await doc.transform(dequantize());
  if (
    doc
      .getRoot()
      .listMaterials()
      .some((m) => m.getAlphaMode() !== "OPAQUE")
  )
    continue;
  const group = new Group();
  doc
    .getRoot()
    .listScenes()[0]
    .traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      for (const primitive of mesh.listPrimitives()) {
        const geometry = new BufferGeometry().setAttribute(
          "position",
          new Float32BufferAttribute(
            primitive.getAttribute("POSITION").getArray(),
            3,
          ),
        );
        if (primitive.getIndices())
          geometry.setIndex(Array.from(primitive.getIndices().getArray()));
        const child = new Mesh(geometry);
        child.matrixAutoUpdate = false;
        child.matrix.fromArray(node.getWorldMatrix());
        group.add(child);
      }
    });
  const profile = buildProfile(bakeGeometry(group), 0.02, {
    closeBase: true,
    closeGapsM: 0.04,
  });
  const bounds = profile.bounds;
  const lo = bounds.min.toArray(),
    hi = bounds.max.toArray();
  // Six decimals of the unit box is a couple of micrometres: far below the
  // engine's 0.1 mm collision and 10 µm contact tolerances.
  const unit = (v, i) => Number(((v - lo[i]) / (hi[i] - lo[i])).toFixed(6));
  models[asset.id] = {
    contentHash: asset.contentHash,
    boxes: profile.boxes.map((box) => [
      box.min.toArray().map((v, i) => Math.max(0, unit(v, i))),
      box.max.toArray().map((v, i) => Math.min(1, unit(v, i))),
    ]),
  };
  console.log(`${asset.title}: ${profile.boxes.length} collision blocks`);
}
await fs.writeFile(
  path.join(root, "packages/scene-engine/src/colliderProfiles.json"),
  JSON.stringify(models) + "\n",
);
