import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AssetRequest } from "@house/contracts";
import { GlbError, inspectGlb, normalizeGlb, parseGlb } from "./glb";
import { FileAssetRegistry } from "./registry";
import { retrieveAsset } from "./retrieve";
import { buildBoxGlb } from "./testing";
import { validateGlb } from "./validate";

const req = (r: Partial<AssetRequest> & { targetDimensionsM: [number, number, number] }) =>
  AssetRequest.parse({ schemaVersion: 1, category: "credenza", description: "walnut credenza", ...r });
const near = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("inspect measures bounds, triangles and node transforms", () => {
  const i = inspectGlb(buildBoxGlb({ size: [2, 1, 0.5], center: [3, 4, 5], nodeScale: 2, nodeTranslation: [1, 0, 0] }));
  assert.equal(i.triangleCount, 12);
  [i.size[0], i.size[1], i.size[2]].forEach((v, k) => near(v, [4, 2, 1][k]));
  near(i.boundsMin[0], 2 * (3 - 1) + 1); // (cx - w) scaled then translated
  assert.deepEqual(i.externalResources, []);
});

test("rejects non-GLB and truncated input", () => {
  assert.throws(() => parseGlb(new Uint8Array(40)), GlbError);
  const good = buildBoxGlb({ size: [1, 1, 1] });
  assert.throws(() => parseGlb(good.subarray(0, good.length - 4)), GlbError);
});

test("normalize fits the envelope uniformly and puts the origin at base-center", () => {
  const out = inspectGlb(normalizeGlb(buildBoxGlb({ size: [4, 2, 1], center: [10, 7, -3] }), [2, 2, 2]));
  // Uniform scale 0.5 (limited by width): 2 x 1 x 0.5, base on y=0, centered in x/z.
  [out.size[0], out.size[1], out.size[2]].forEach((v, k) => near(v, [2, 1, 0.5][k]));
  near(out.boundsMin[1], 0); near((out.boundsMin[0] + out.boundsMax[0]) / 2, 0); near((out.boundsMin[2] + out.boundsMax[2]) / 2, 0);
});

test("validation errors are specific and actionable", () => {
  const target = req({ targetDimensionsM: [2, 1, 1] });
  const fine = validateGlb(inspectGlb(buildBoxGlb({ size: [2, 1, 1] })), target);
  assert.ok(fine.ok, fine.errors.join());
  const flat = validateGlb(inspectGlb(buildBoxGlb({ size: [2, 1, 0.1] })), target);
  assert.ok(!flat.ok && /Proportions/.test(flat.errors[0]));
  const draco = validateGlb(inspectGlb(buildBoxGlb({ size: [2, 1, 1], extra: { extensionsRequired: ["KHR_draco_mesh_compression"] } })), target);
  assert.ok(!draco.ok && /KHR_draco/.test(draco.errors[0]));
  const external = validateGlb(inspectGlb(buildBoxGlb({ size: [2, 1, 1], extra: { images: [{ uri: "tex.png" }] } })), target);
  assert.ok(!external.ok && /external/.test(external.errors[0]));
  const heavy = validateGlb(inspectGlb(buildBoxGlb({ size: [2, 1, 1] })), target, { maxTriangles: 5, maxTextureBytes: 1e9, maxFileBytes: 1e9, minAxisFill: 0.5, forbiddenExtensions: [] });
  assert.ok(!heavy.ok && /triangles/.test(heavy.errors[0]));
});

test("registry stores a normalized asset the retriever can then find; re-registering is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "registry-"));
  try {
    const registry = new FileAssetRegistry({ publicRoot: root });
    const request = req({ targetDimensionsM: [2.2, 0.7, 0.5], styles: ["mid-century"], colors: ["walnut"] });
    const glb = buildBoxGlb({ size: [220, 70, 50], center: [5, 5, 5], baseColor: [0.32, 0.18, 0.09, 1] }); // wrong scale/offset on purpose; walnut-brown
    const first = await registry.registerGenerated({ glb, request, title: "Walnut credenza" });
    assert.ok(first.ok && first.created);
    if (!first.ok) return;
    assert.equal(first.asset.source, "generated");
    assert.equal(first.asset.licenseStatus, "verified");
    assert.match(first.asset.glbStorageKey, /^models\/generated\/walnut-credenza-[0-9a-f]{12}\.glb$/);
    const stored = inspectGlb(new Uint8Array(await readFile(join(root, first.asset.glbStorageKey))));
    near(stored.size[0], 2.2); near(stored.boundsMin[1], 0);
    assert.equal(stored.contentHash, first.asset.contentHash);

    const again = await registry.registerGenerated({ glb, request, title: "Walnut credenza" });
    assert.ok(again.ok && !again.created && again.asset.id === first.asset.id);
    assert.equal((await registry.list()).length, 1);

    const found = retrieveAsset(request, await registry.list());
    assert.equal(found.resolution.status, "matched");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("registry refuses invalid models and stores nothing; pending mode keeps assets unrenderable", async () => {
  const root = await mkdtemp(join(tmpdir(), "registry-"));
  try {
    const registry = new FileAssetRegistry({ publicRoot: root });
    const bad = await registry.registerGenerated({ glb: buildBoxGlb({ size: [2, 1, 0.05] }), request: req({ targetDimensionsM: [2, 1, 1] }), title: "Flat" });
    assert.ok(!bad.ok);
    assert.equal((await registry.list()).length, 0);
    const junk = await registry.registerGenerated({ glb: new Uint8Array(64), request: req({ targetDimensionsM: [1, 1, 1] }), title: "x" });
    assert.ok(!junk.ok);

    const manual = new FileAssetRegistry({ publicRoot: root, status: "pending" });
    const r = await manual.registerGenerated({ glb: buildBoxGlb({ size: [2, 1, 1] }), request: req({ targetDimensionsM: [2, 1, 1] }), title: "Pending one" });
    assert.ok(r.ok && r.asset.licenseStatus === "pending");
    assert.equal(retrieveAsset(req({ targetDimensionsM: [2, 1, 1] }), await manual.list()).resolution.status, "needs_generation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent registrations all land in the catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "registry-"));
  try {
    const registry = new FileAssetRegistry({ publicRoot: root });
    await Promise.all([1, 2, 3, 4, 5].map((i) =>
      registry.registerGenerated({ glb: buildBoxGlb({ size: [2, 1, 1 + i * 0.02] }), request: req({ targetDimensionsM: [2, 1, 1.2] }), title: `Item ${i}` })));
    assert.equal((await registry.list()).length, 5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("requested colors must actually be in the model: flat matching base color, not just a name or a texture", async () => {
  const { inspectGlb: inspect } = await import("./glb");
  const { colorMatches, checkRequestedColors } = await import("./colors");
  const red = inspect(buildBoxGlb({ size: [1, 1, 1], baseColor: [0.8, 0.02, 0.02, 1] }));
  const brown = inspect(buildBoxGlb({ size: [1, 1, 1], baseColor: [0.32, 0.18, 0.09, 1] }));
  const none = inspect(buildBoxGlb({ size: [1, 1, 1] }));
  assert.deepEqual(checkRequestedColors(red.materials, ["red"]), []);
  assert.equal(checkRequestedColors(brown.materials, ["red"]).length, 1);
  assert.deepEqual(checkRequestedColors(brown.materials, ["walnut", "Brown"]), []);
  assert.equal(checkRequestedColors(none.materials, ["red"]).length, 1, "no material at all cannot confirm red");
  assert.deepEqual(checkRequestedColors(none.materials, ["mid-century", "sparkly"]), [], "unknown color names are not checked");
  assert.equal(colorMatches("navy", [0.0, 0.0, 0.2]), true); assert.equal(colorMatches("white", [0.9, 0.9, 0.9]), true); assert.equal(colorMatches("white", [0.8, 0.02, 0.02]), false);
  // A textured material with no flat factor cannot confirm a color, and the message says how to fix it.
  const textured = [{ name: "sofa_03", baseColor: null, textured: true }];
  assert.match(checkRequestedColors(textured, ["red"])[0], /sofa_03 use a texture; unlink/);
  // A matching factor that is still multiplied by a texture does not count either.
  assert.equal(checkRequestedColors([{ name: "sofa_03", baseColor: [0.8, 0.02, 0.02, 1] as [number, number, number, number], textured: true }], ["red"]).length, 1);
  const target = req({ targetDimensionsM: [1, 1, 1], colors: ["red"] });
  assert.ok(!validateGlb(brown, target).ok && /Requested color "red"/.test(validateGlb(brown, target).errors.join()));
  assert.ok(validateGlb(red, target).ok);
});
