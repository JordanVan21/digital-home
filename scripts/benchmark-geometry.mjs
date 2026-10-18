/** Reproducible CPU-only experiment against the five normalized model files. */
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
  benchmarkProfile,
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
const models = [];
for (const slug of [
  "coffee-table",
  "desk-chair",
  "sofa",
  "olive-tree",
  "polyhaven-ceramic-vase",
]) {
  const asset = catalog.find((a) => a.glbStorageKey === `/models/${slug}.glb`);
  const doc = await io.read(
    path.join(root, "apps/web/public", asset.glbStorageKey),
  );
  await doc.transform(dequantize());
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
  const profile = buildProfile(bakeGeometry(group));
  const result = benchmarkProfile(profile);
  const item = {
    assetId: asset.id,
    contentHash: asset.contentHash,
    title: asset.title,
    triangles: profile.triangles,
    compoundBoxes: profile.boxes.length,
    cellSizeM: profile.cellSize,
    surfaceCells: profile.surfaceCells,
    interiorCells: profile.interiorCells,
    alphaMaskedMaterials: doc
      .getRoot()
      .listMaterials()
      .filter((m) => m.getAlphaMode() !== "OPAQUE").length,
    buildMs: profile.buildMs,
    bvhBuildMs: profile.bvhMs,
    compoundBuildMs: profile.compoundMs,
    ...result,
  };
  models.push(item);
  console.log(
    `${asset.title}: ${profile.triangles} triangles → ${profile.boxes.length} boxes; mesh probe p95 ${result.methods.surface.p95Ms.toFixed(4)} ms; pair queries ${result.meshPairSurfaceIntersections.map((p) => p.ms.toFixed(3)).join(" / ")} ms`,
  );
  group.traverse((node) => {
    if (node instanceof Mesh) node.geometry.dispose();
  });
  profile.geometry.dispose();
}
await fs.mkdir(path.join(root, "docs/geometry-experiment"), {
  recursive: true,
});
await fs.writeFile(
  path.join(root, "docs/geometry-experiment/results.json"),
  JSON.stringify(
    {
      baselineCommit: "e5140ce",
      branch: "experiment/shape-aware-geometry",
      runtime: process.version,
      note: "CPU query microbenchmarks, not FPS measurements. Mesh-surface contact and triangle intersection do not establish solid containment or stable support. Compound voxels can fill small holes or leak through open meshes. No editor geometry behavior is changed.",
      models,
    },
    null,
    2,
  ) + "\n",
);
