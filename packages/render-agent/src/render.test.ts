import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileAssetRegistry } from "@house/asset-service";
import { AssetRequest, AssetSpec } from "@house/contracts";
import { BlenderPool } from "./blender";
import { checkBpyCode } from "./bpyGuard";
import { FatalToolError, runToolLoop, type AgentTool } from "./toolLoop";
import { requestForObject, toReplaceAssetOps } from "./sceneOps";
import { RenderService, requestKey } from "./service";
import { FakeBlender, lastToolOutput, scriptedModel } from "./testing";
import { z } from "zod";

const bundled = (JSON.parse(readFileSync(new URL("../../../apps/web/src/fixtures/assetCatalog.json", import.meta.url), "utf8")) as unknown[]).map((r) => AssetSpec.parse(r));
const req = (r: Partial<AssetRequest> & { category: string; targetDimensionsM: [number, number, number] }) => AssetRequest.parse({ schemaVersion: 1, description: "", ...r });
const bed = req({ category: "bed", description: "queen bed", targetDimensionsM: [1.6, 0.9, 2.1] });
const neverCalled = () => scriptedModel(() => { throw new Error("model must not be called"); });

async function harness(opts: { model?: ReturnType<typeof scriptedModel> | null; blender?: FakeBlender | null; extra?: object } = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-"));
  const registry = new FileAssetRegistry({ publicRoot: root });
  const blender = opts.blender === undefined ? new FakeBlender() : opts.blender;
  const service = new RenderService({
    catalog: async () => [...bundled, ...(await registry.list())],
    registry,
    model: opts.model === undefined ? null : opts.model,
    blender: blender ? new BlenderPool([blender]) : null,
    ...opts.extra,
  });
  return { service, registry, blender, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// ---- guard ---------------------------------------------------------------------
test("bpy guard allows modeling code and blocks system access", () => {
  assert.ok(checkBpyCode("import bpy\nimport math\nfrom mathutils import Vector\nbpy.ops.mesh.primitive_cube_add(size=1)").ok);
  for (const bad of ["import os\nos.system('x')", "from subprocess import run", "open('/etc/passwd')", "__import__('os')", "bpy.ops.wm.quit_blender()",
    "exec('1')", "import bpy\nbpy.app.handlers.load_post.append(f)", "import socket", "bpy.ops.export_scene.gltf(filepath='x')", "bpy.context.object.filepath = 'x'", ""]) {
    assert.equal(checkBpyCode(bad).ok, false, bad);
  }
  assert.equal(checkBpyCode("x".repeat(30_000)).ok, false);
});

// ---- tool loop -----------------------------------------------------------------
const echo: AgentTool<string> = {
  name: "echo", description: "", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, schema: z.object({ text: z.string() }),
  async run(a: { text: string }) { return { output: { ok: true, said: a.text }, done: a.text === "finish" ? "finished" : undefined }; },
};
test("loop validates arguments, reports unknown tools, and ends on done", async () => {
  const model = scriptedModel([[{ name: "echo", args: { text: 5 } }], [{ name: "nope" }], [{ name: "echo", args: { text: "finish" } }]]);
  const r = await runToolLoop({ model, instructions: "", input: [], tools: [echo], options: { maxRounds: 5, maxToolCalls: 5 } });
  assert.equal(r.done, "finished");
  assert.deepEqual(r.trace.map((t) => t.ok), [false, false, true]);
  assert.match(r.trace[0].summary, /Invalid arguments/);
  assert.equal(r.usage.requests, 3);
});
test("loop enforces round and call limits and stops when the model stops", async () => {
  const forever = scriptedModel(() => [{ name: "echo", args: { text: "x" } }]);
  assert.equal((await runToolLoop({ model: forever, instructions: "", input: [], tools: [echo], options: { maxRounds: 3, maxToolCalls: 99 } })).endedBecause, "round_limit");
  assert.equal((await runToolLoop({ model: forever, instructions: "", input: [], tools: [echo], options: { maxRounds: 99, maxToolCalls: 2 } })).endedBecause, "call_limit");
  const quiet = await runToolLoop({ model: scriptedModel(["all done"]), instructions: "", input: [], tools: [echo], options: { maxRounds: 3, maxToolCalls: 3 } });
  assert.equal(quiet.endedBecause, "model_finished"); assert.equal(quiet.finalText, "all done");
});
test("a fatal tool error aborts the loop; abort signals are honored", async () => {
  const boom: AgentTool<string> = { ...echo, async run() { throw new FatalToolError("blender gone"); } };
  await assert.rejects(runToolLoop({ model: scriptedModel([[{ name: "echo", args: { text: "x" } }]]), instructions: "", input: [], tools: [boom], options: { maxRounds: 3, maxToolCalls: 3 } }), /blender gone/);
  const ac = new AbortController(); ac.abort();
  assert.equal((await runToolLoop({ model: scriptedModel([]), instructions: "", input: [], tools: [echo], options: { maxRounds: 3, maxToolCalls: 3 }, signal: ac.signal })).endedBecause, "aborted");
});

// ---- service: retrieval paths ----------------------------------------------------
test("a confident match never calls the model or Blender", async () => {
  const h = await harness({ model: neverCalled() });
  try {
    const out = await h.service.resolve(req({ category: "sofa", description: "sofa", targetDimensionsM: [2.2, 0.9, 0.95] }));
    assert.equal(out.source, "retrieved"); assert.equal(out.asset?.category, "sofa");
    assert.equal(h.blender!.resets, 0);
  } finally { await h.cleanup(); }
});

const ambiguousReq = req({ category: "table", targetDimensionsM: [1.2, 0.45, 1.2] }); // coffee table only loosely
test("ambiguous: the model's choice is honored, and an id outside the list is refused", async () => {
  const model = scriptedModel((i) => i === 0 ? [{ name: "choose_asset", args: { assetId: "00000000-0000-4000-8000-000000000999", reason: "x" } }]
    : [{ name: "choose_asset", args: { assetId: bundled.find((a) => a.category === "coffee_table")!.id, reason: "round table works as a table" } }]);
  const h = await harness({ model });
  try {
    const out = await h.service.resolve(ambiguousReq);
    assert.equal(out.retrieval, "ambiguous"); assert.equal(out.source, "model_selected"); assert.equal(out.asset?.category, "coffee_table");
    assert.match(JSON.stringify(lastToolOutput(model.inputs[1])), /not in the candidate list/);
    assert.equal(model.requests, 2);
  } finally { await h.cleanup(); }
});
test("ambiguous: the model can reject and trigger generation", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [{ name: "request_generation", args: { reason: "not a table for eating" } }];
    return generationScript(i - 1, input, [1.2, 0.45, 1.2]);
  });
  const h = await harness({ model });
  try {
    const out = await h.service.resolve(ambiguousReq);
    assert.equal(out.source, "generated"); assert.equal(out.asset?.source, "generated");
  } finally { await h.cleanup(); }
});
test("ambiguous without a model: best candidate, or placeholder by policy", async () => {
  const a = await harness({ model: null });
  const b = await harness({ model: null, extra: { ambiguousWithoutModel: "placeholder" } });
  try {
    assert.equal((await a.service.resolve(ambiguousReq)).source, "best_effort");
    const out = await b.service.resolve(ambiguousReq);
    assert.equal(out.source, "placeholder"); assert.equal(out.assetId, null);
  } finally { await a.cleanup(); await b.cleanup(); }
});
test("ambiguous with generation forbidden: reject_all yields a placeholder", async () => {
  const h = await harness({ model: scriptedModel([[{ name: "reject_all", args: { reason: "wrong kind of table" } }]]) });
  try {
    const out = await h.service.resolve({ ...ambiguousReq, allowGeneration: false });
    assert.equal(out.source, "placeholder"); assert.match(out.notes.join(" "), /generation is not allowed/);
  } finally { await h.cleanup(); }
});

// ---- service: generation -----------------------------------------------------------
/** A model that writes toy code, measures, then submits. */
function generationScript(turn: number, input: unknown[], dims: [number, number, number]) {
  const d = dims.join(" ");
  if (turn === 0) return [{ name: "run_blender_python", args: { code: `BOX ${d}` } }];
  if (turn === 1) return [{ name: "measure_model" }];
  if (turn === 2) return [{ name: "submit_asset" }];
  return "finished";
}

test("no fitting asset: generates, validates, registers, and the next request is plain retrieval", async () => {
  const model = scriptedModel((i, input) => generationScript(i, input, [1.6, 0.9, 2.1]));
  const h = await harness({ model });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.retrieval, "needs_generation"); assert.equal(out.source, "generated");
    assert.equal(out.asset?.category, "bed"); assert.equal(out.asset?.source, "generated"); assert.equal(out.asset?.licenseStatus, "verified");
    assert.equal(model.requests, 3);
    assert.equal(out.usage.modelRequests, 3);
    assert.ok(h.blender!.resets >= 2, "scene reset before and after the job");
    const requestsBefore = model.requests;
    const again = await h.service.resolve(bed);
    assert.equal(again.source, "retrieved"); assert.equal(again.assetId, out.assetId);
    assert.equal(model.requests, requestsBefore, "library grew; no new model calls");
  } finally { await h.cleanup(); }
});
test("a rejected first submission is fed back to the model, which fixes it", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [{ name: "run_blender_python", args: { code: "BOX 1.6 0.9 0.05" } }]; // paper-thin bed
    if (i === 1) return [{ name: "submit_asset" }];
    if (i === 2) { assert.match(JSON.stringify(lastToolOutput(input)), /Proportions/); return [{ name: "run_blender_python", args: { code: "BOX 1.6 0.9 2.1" } }]; }
    if (i === 3) return [{ name: "submit_asset" }];
    return "done";
  });
  const h = await harness({ model });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.source, "generated"); assert.match(out.notes.join(" "), /after 2 submission/);
    assert.equal((await h.registry.list()).length, 1);
  } finally { await h.cleanup(); }
});
test("a model that never produces an acceptable model ends as a placeholder, bounded", async () => {
  const model = scriptedModel((i) => i % 2 === 0 ? [{ name: "run_blender_python", args: { code: "BOX 1.6 0.9 0.05" } }] : [{ name: "submit_asset" }]);
  const h = await harness({ model, extra: { limits: { maxRounds: 20, maxToolCalls: 40, maxSubmissions: 2 } } });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.source, "placeholder"); assert.equal(out.assetId, null);
    assert.equal((await h.registry.list()).length, 0, "nothing invalid is ever stored");
    assert.ok(model.requests <= 20);
  } finally { await h.cleanup(); }
});
test("blocked code never reaches Blender", async () => {
  const model = scriptedModel((i, input) => i === 0 ? [{ name: "run_blender_python", args: { code: "import os\nos.system('rm -rf ~')" } }]
    : i === 1 ? (assert.equal(lastToolOutput(input).rejected, true), "giving up") : "x");
  const blender = new FakeBlender();
  const h = await harness({ model, blender });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(blender.executed.length, 0); assert.equal(out.source, "placeholder");
  } finally { await h.cleanup(); }
});
test("an unreachable Blender fails fast to a placeholder instead of looping", async () => {
  const blender = new FakeBlender(); blender.unreachable = true;
  const model = scriptedModel(() => [{ name: "measure_model" }]);
  const h = await harness({ model, blender });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.source, "placeholder"); assert.match(out.notes.join(" "), /Cannot reach Blender/);
    assert.ok(model.requests <= 1);
  } finally { await h.cleanup(); }
});
test("no model or no Blender or generation forbidden: placeholder with the reason", async () => {
  const cases = [
    await harness({ model: null }), await harness({ model: scriptedModel([]), blender: null }),
  ];
  try {
    for (const h of cases) {
      const out = await h.service.resolve(bed);
      assert.equal(out.source, "placeholder"); assert.match(out.notes.join(" "), /unavailable/);
    }
    const forbidden = await harness({ model: neverCalled() });
    cases.push(forbidden);
    assert.match((await forbidden.service.resolve({ ...bed, allowGeneration: false })).notes.join(" "), /not allowed/);
  } finally { for (const h of cases) await h.cleanup(); }
});
test("identical concurrent requests share one generation; Blender jobs never overlap", async () => {
  const model = scriptedModel((i, input) => {
    // Interleaving-proof: derive the next step from how many tool results this conversation has.
    const results = input.filter((x) => (x as { type?: string }).type === "function_call_output").length;
    return generationScript(results, input, [1.6, 0.9, 2.1]);
  });
  const blender = new FakeBlender(); blender.delayMs = 15;
  const h = await harness({ model, blender });
  try {
    const outs = await Promise.all([h.service.resolve(bed), h.service.resolve({ ...bed }), h.service.resolve(bed)]);
    assert.ok(outs.every((o) => o.source === "generated" && o.assetId === outs[0].assetId));
    assert.equal((await h.registry.list()).length, 1);
    const other = req({ category: "floor_lamp", description: "arc lamp", targetDimensionsM: [0.45, 1.6, 0.45] });
    await Promise.all([h.service.resolve(other), h.service.resolve(req({ category: "desk", description: "desk", targetDimensionsM: [1.4, 0.75, 0.7] }))]);
    assert.equal(blender.maxActive, 1);
  } finally { await h.cleanup(); }
});
test("resolveMany reports each outcome as it completes and keeps input order", async () => {
  const h = await harness({ model: null });
  try {
    const reqs = [req({ category: "sofa", targetDimensionsM: [2.2, 0.9, 0.95] }), bed, req({ category: "plant", targetDimensionsM: [0.6, 0.8, 0.6] })];
    const seen: number[] = [];
    const outs = await h.service.resolveMany(reqs, (_o, i) => seen.push(i));
    assert.deepEqual(outs.map((o) => o.source), ["retrieved", "placeholder", "retrieved"]);
    assert.deepEqual([...seen].sort(), [0, 1, 2]);
  } finally { await h.cleanup(); }
});
test("an aborted job returns a placeholder instead of throwing", async () => {
  const ac = new AbortController(); ac.abort();
  const h = await harness({ model: scriptedModel([]) });
  try { const out = await h.service.resolve(bed, ac.signal); assert.equal(out.source, "placeholder"); } finally { await h.cleanup(); }
});

// ---- scene integration -----------------------------------------------------------------
test("request keys ignore case, spacing and label order; scene helpers produce replaceAsset ops", async () => {
  const a = req({ category: "Dining Table", description: "Oak  table", styles: ["Rustic", "farmhouse"], targetDimensionsM: [1.8, 0.75, 0.9] });
  const b = req({ category: "dining_table", description: "oak table", styles: ["farmhouse", "rustic"], targetDimensionsM: [1.801, 0.749, 0.9] });
  assert.equal(requestKey(a), requestKey(b));
  assert.notEqual(requestKey(a), requestKey(req({ ...a, description: "walnut table" })));

  const object = { id: "00000000-0000-4000-8000-000000000001", category: "sofa", displayName: "Sofa", dimensionsM: [2.2, 0.85, 0.95] as [number, number, number] };
  const h = await harness({ model: null });
  try {
    const out = await h.service.resolve(requestForObject(object));
    const ops = toReplaceAssetOps([object], [out]);
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.ok(op.type === "replaceAsset" && op.objectId === object.id && op.assetId === out.assetId);
    if (op.type === "replaceAsset") assert.ok(op.dimensionsM.every((n, i) => n <= object.dimensionsM[i] + 1e-9));
    assert.equal(toReplaceAssetOps([object], [{ asset: null }]).length, 0);
  } finally { await h.cleanup(); }
});
