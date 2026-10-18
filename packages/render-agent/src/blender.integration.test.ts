import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { checkRequestedColors, FileAssetRegistry, inspectGlb, parseGlb, validateGlb } from "@house/asset-service";
import { AssetRequest, AssetSpec } from "@house/contracts";
import { BlenderMcpClient, MEASURE_SCRIPT, MESH_NAMES_SCRIPT } from "./blender";

/**
 * Real-Blender tests of BlenderMcpClient. Where the endpoint comes from:
 *  - BLENDER_MCP_PORT set: use that already-running server (GUI Blender with the MCP addon, or a headless server).
 *  - else, if Blender is installed (BLENDER_BIN or the macOS app): spawn the headless server on a free port.
 *  - else: skip.
 * BLENDER_EXPECT_GUI=1 also asserts viewport screenshots work (GUI only).
 */
const BLENDER_BIN = process.env.BLENDER_BIN ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const serverScript = fileURLToPath(new URL("../blender/blender_server.py", import.meta.url));
const webPublic = fileURLToPath(new URL("../../../apps/web/public", import.meta.url));
const catalog = (JSON.parse(readFileSync(new URL("../../../apps/web/src/fixtures/assetCatalog.json", import.meta.url), "utf8")) as unknown[]).map((r) => AssetSpec.parse(r));

let child: ChildProcess | null = null;
let client: BlenderMcpClient | null = null;
let skipReason: string | null = null;

const freePort = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
const measure = async () => JSON.parse((await client!.runPython(MEASURE_SCRIPT)).output.trim().split("\n").pop()!);
const near = (a: number, b: number, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

before(async () => {
  if (process.env.BLENDER_MCP_PORT) {
    client = new BlenderMcpClient({ port: Number(process.env.BLENDER_MCP_PORT), timeoutMs: 60_000 });
  } else if (existsSync(BLENDER_BIN)) {
    const port = await freePort();
    child = spawn(BLENDER_BIN, ["-b", "--factory-startup", "-P", serverScript, "--", "--port", String(port)], { stdio: "ignore" });
    client = new BlenderMcpClient({ port, timeoutMs: 60_000 });
  } else { skipReason = "Blender is not installed"; return; }
  for (let i = 0; i < 60; i++) { if (await client.ping()) return; await new Promise((r) => setTimeout(r, 500)); }
  skipReason = "Blender did not answer on its MCP port";
});
after(async () => { child?.kill("SIGKILL"); });

const t = (name: string, fn: () => Promise<void>) => test(name, async (ctx) => { if (skipReason) return ctx.skip(skipReason); await fn(); });

t("reset empties the scene", async () => {
  await client!.reset();
  assert.equal((await measure()).mesh_objects, 0);
});

t("measure maps Blender X/Y/Z to glTF width/height/depth", async () => {
  await client!.reset();
  const r = await client!.runPython("import bpy\nbpy.ops.mesh.primitive_cube_add(size=1)\no = bpy.context.object\no.scale = (2.0, 0.5, 1.0)\nbpy.context.view_layer.update()");
  assert.ok(r.ok, r.output);
  const m = await measure();
  assert.deepEqual(m.gltf_dims_width_height_depth.map((n: number) => Math.round(n * 100) / 100), [2, 1, 0.5]); // width=X, height=Z, depth=Y
  assert.equal(m.triangles, 12);
});

t("each execute_code call has a fresh namespace; errors come back readable", async () => {
  await client!.reset();
  assert.ok((await client!.runPython("keep_me = 41")).ok);
  const r = await client!.runPython("print(keep_me + 1)");
  assert.equal(r.ok, false);
  assert.match(r.output, /NameError/);
  assert.match(r.output, /keep_me/);
  assert.ok((await client!.runPython("import bpy\nprint('hello', len(bpy.data.objects))")).output.includes("hello"));
});

t("export is a valid GLB: Y-up, right size, only meshes (no cameras/lights), passes the validator", async () => {
  await client!.reset();
  const r = await client!.runPython([
    "import bpy",
    "bpy.ops.mesh.primitive_cube_add(size=1)", "o = bpy.context.object", "o.name = 'body'", "o.scale = (2.2, 0.5, 0.7)",
    "bpy.ops.object.camera_add(location=(5, 5, 5))", "bpy.ops.object.light_add(type='POINT', location=(0, 0, 4))",
    "bpy.context.view_layer.update()",
  ].join("\n"));
  assert.ok(r.ok, r.output);
  const glb = await client!.exportGlb();
  const info = inspectGlb(glb);
  [info.size[0], info.size[1], info.size[2]].forEach((v, i) => near(v, [2.2, 0.7, 0.5][i], 0.01));
  const { json } = parseGlb(glb);
  assert.ok(!(json as { cameras?: unknown[] }).cameras?.length, "no cameras exported");
  assert.ok(!(json as { extensions?: { KHR_lights_punctual?: unknown } }).extensions?.KHR_lights_punctual, "no lights exported");
  const request = AssetRequest.parse({ schemaVersion: 1, category: "credenza", targetDimensionsM: [2.2, 0.7, 0.5] });
  assert.ok(validateGlb(info, request).ok);
});

t("materials survive export (named, with base color)", async () => {
  await client!.reset();
  const r = await client!.runPython([
    "import bpy", "bpy.ops.mesh.primitive_cube_add(size=1)", "o = bpy.context.object",
    "m = bpy.data.materials.new('walnut')", "m.use_nodes = True",
    "m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.25, 0.12, 0.05, 1)",
    "o.data.materials.append(m)",
  ].join("\n"));
  assert.ok(r.ok, r.output);
  assert.deepEqual(inspectGlb(await client!.exportGlb()).materialNames, ["walnut"]);
});

t("modifiers are applied on export (a beveled box has more triangles than 12)", async () => {
  await client!.reset();
  const r = await client!.runPython("import bpy\nbpy.ops.mesh.primitive_cube_add(size=1)\no = bpy.context.object\nm = o.modifiers.new('b', 'BEVEL')\nm.width = 0.1\nm.segments = 3");
  assert.ok(r.ok, r.output);
  assert.ok(inspectGlb(await client!.exportGlb()).triangleCount > 12);
});

t("a real library GLB round-trips: import, measure, modify, export, register", async () => {
  const sofa = catalog.find((a) => a.category === "sofa")!;
  const original = new Uint8Array(readFileSync(join(webPublic, sofa.glbStorageKey)));
  await client!.reset();
  await client!.importGlb(original);
  const m = await measure();
  assert.ok(m.mesh_objects >= 1);
  sofa.dimensionsM.forEach((d, i) => near(m.gltf_dims_width_height_depth[i], d, 0.02)); // import keeps the real dimensions
  // Modify: make it narrower.
  const edit = await client!.runPython("import bpy\nfor o in bpy.data.objects:\n    if o.parent is None:\n        o.scale[0] *= 0.7\nbpy.context.view_layer.update()");
  assert.ok(edit.ok, edit.output);
  const out = await client!.exportGlb();
  const info = inspectGlb(out);
  near(info.size[0], sofa.dimensionsM[0] * 0.7, 0.05);
  near(info.size[1], sofa.dimensionsM[1], 0.03);
  const root = await mkdtemp(join(tmpdir(), "bl-reg-"));
  try {
    const request = AssetRequest.parse({ schemaVersion: 1, category: "sofa", description: "compact sofa", targetDimensionsM: [1.9, 1.0, 0.95] });
    const registry = new FileAssetRegistry({ publicRoot: root });
    const registered = await registry.registerGenerated({ glb: out, request, title: "Compact sofa", derivedFromAssetId: sofa.id });
    assert.ok(registered.ok, registered.ok ? "" : registered.errors.join("; "));
    if (registered.ok) { assert.equal(registered.asset.derivedFromAssetId, sofa.id); assert.ok((registered.asset.triangleCount ?? 0) > 1000); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

t("export with nothing in the scene fails clearly", async () => {
  await client!.reset();
  await assert.rejects(client!.exportGlb(), /No mesh|export failed/i);
});

t("viewport screenshot: unavailable headless, a PNG in a GUI session", async () => {
  await client!.reset();
  await client!.runPython("import bpy\nbpy.ops.mesh.primitive_cube_add(size=1)");
  const png = await client!.screenshot();
  if (process.env.BLENDER_EXPECT_GUI) { assert.ok(png && png.length > 100 && png[0] === 0x89 && png[1] === 0x50, "expected a PNG"); }
  else assert.equal(png, null);
});

// The recolor recipe from the builder prompt, verbatim in spirit: unlink the Base Color texture, set a flat color.
const RECOLOR = (rgb: string) => `
import bpy
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    for l in list(m.node_tree.links):
        if l.to_socket.name == 'Base Color':
            m.node_tree.links.remove(l)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf is not None:
        bsdf.inputs['Base Color'].default_value = (${rgb}, 1)
`;
const sofaGlb = () => new Uint8Array(readFileSync(join(webPublic, catalog.find((a) => a.category === "sofa")!.glbStorageKey)));

t("measure_model reports each material's base color and whether a texture drives it; names list the imported meshes", async () => {
  await client!.reset();
  await client!.importGlb(sofaGlb());
  const m = await measure();
  assert.ok(m.materials.length >= 1);
  assert.ok(m.materials.some((x: { texture_driven: boolean }) => x.texture_driven), "library sofa colors come from textures");
  const names = JSON.parse((await client!.runPython(MESH_NAMES_SCRIPT)).output.trim().split("\n").pop()!);
  assert.ok(Array.isArray(names) && names.length >= 1);
});

t("the prompt's recolor recipe turns a textured library sofa red, and the color check sees it (and rejects the un-recolored one)", async () => {
  await client!.reset();
  await client!.importGlb(sofaGlb());
  const before = inspectGlb(await client!.exportGlb());
  assert.equal(checkRequestedColors(before.materials, ["red"]).length, 1, "the original sofa is not red");
  const r = await client!.runPython(RECOLOR("0.8, 0.02, 0.02"));
  assert.ok(r.ok, r.output);
  const after = inspectGlb(await client!.exportGlb());
  assert.deepEqual(checkRequestedColors(after.materials, ["red"]), [], JSON.stringify(after.materials));
  assert.ok(after.materials.every((x) => x.baseColor && x.baseColor[0] > 0.5 && x.baseColor[1] < 0.1), "every material now carries the red factor");
  assert.ok(after.materials.some((x) => !x.textured), "and the main material is a flat, untextured red");
  const request = AssetRequest.parse({ schemaVersion: 1, category: "sofa", colors: ["red"], targetDimensionsM: [2.8, 1.2, 1.0] });
  assert.ok(validateGlb(after, request).ok);
  assert.ok(!validateGlb(before, request).ok);
});

t("viewport screenshots are framed on the model (GUI only): the model fills a visible part of the image", async () => {
  if (!process.env.BLENDER_EXPECT_GUI) return;
  await client!.reset();
  await client!.runPython("import bpy\nbpy.ops.mesh.primitive_cube_add(size=1)\no = bpy.context.object\no.scale = (2.2, 0.5, 0.7)");
  const png = await client!.screenshot();
  assert.ok(png && png.length > 100);
  const { writeFileSync } = await import("node:fs");
  if (process.env.BLENDER_SHOT_OUT) writeFileSync(process.env.BLENDER_SHOT_OUT, png);
});

t("import flattens the glTF hierarchy: no parents, identity transforms, same dimensions, names kept", async () => {
  for (const category of ["credenza", "sofa"]) {
    const asset = catalog.find((a) => a.category === category)!;
    await client!.reset();
    await client!.importGlb(new Uint8Array(readFileSync(join(webPublic, asset.glbStorageKey))));
    const r = await client!.runPython(`
import bpy, json
objs = list(bpy.data.objects)
def identity(o):
    return all(abs(a - b) < 1e-4 for a, b in zip([v for row in o.matrix_world for v in row], [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]))
print(json.dumps({"n": len(objs), "types": sorted(set(o.type for o in objs)), "parented": sum(1 for o in objs if o.parent is not None), "non_identity": sum(1 for o in objs if not identity(o)), "names": [o.name for o in objs][:6]}))
`);
    assert.ok(r.ok, r.output);
    const info = JSON.parse(r.output.trim().split("\n").pop()!);
    assert.deepEqual(info.types, ["MESH"], category);
    assert.equal(info.parented, 0, category);
    assert.equal(info.non_identity, 0, `${category}: transforms were not baked`);
    const m = await measure();
    asset.dimensionsM.forEach((d, i) => near(m.gltf_dims_width_height_depth[i], d, 0.02));
    near(m.lowest_z, 0, 0.05); // still resting on the floor
  }
});
