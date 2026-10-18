import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { z } from "zod";
import { buildBoxGlb, FileAssetRegistry, FileGlbStore, retrieveAsset } from "@house/asset-service";
import { AssetRequest, AssetSpec } from "@house/contracts";
import { runBuilderAgent } from "./agent";
import { BlenderPool } from "./blender";
import { checkBpyCode } from "./bpyGuard";
import { describeCandidates } from "./retrievalAgent";
import { requestForObject, toReplaceAssetOps } from "./sceneOps";
import { RenderService, requestKey } from "./service";
import { FakeBlender, lastToolOutput, scriptedModel, type Turn } from "./testing";
import { FatalToolError, runToolLoop, type AgentTool } from "./toolLoop";

const webPublic = fileURLToPath(new URL("../../../apps/web/public", import.meta.url));
const bundled = (JSON.parse(readFileSync(new URL("../../../apps/web/src/fixtures/assetCatalog.json", import.meta.url), "utf8")) as unknown[]).map((r) => AssetSpec.parse(r));
const idOf = (category: string) => bundled.find((a) => a.category === category)!.id;
const req = (r: Partial<AssetRequest> & { category: string; targetDimensionsM: [number, number, number] }) => AssetRequest.parse({ schemaVersion: 1, description: "", ...r });
const bed = req({ category: "bed", description: "queen bed", targetDimensionsM: [1.6, 0.9, 2.1] }); // nothing of its kind: "needs_generation"
const looseTable = req({ category: "table", targetDimensionsM: [1.2, 0.45, 1.2] }); // coffee table only loosely: "ambiguous"
const sofaReq = req({ category: "sofa", description: "sofa", targetDimensionsM: [2.2, 0.9, 0.95] }); // confident: "matched"
const neverCalled = () => scriptedModel(() => { throw new Error("model must not be called"); });
const call = (name: string, args: unknown = {}) => ({ name, args });
const BUILDER_TOOLS = ["import_asset_to_blender", "measure_model", "run_blender_python", "score_asset", "search_assets", "submit_asset", "use_placeholder", "view_model"];

async function harness(opts: { model?: ReturnType<typeof scriptedModel> | null; blender?: FakeBlender | null; extra?: object } = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-"));
  const registry = new FileAssetRegistry({ publicRoot: root });
  const store = new FileGlbStore([root, webPublic]);
  const blender = opts.blender === undefined ? new FakeBlender() : opts.blender;
  const service = new RenderService({
    catalog: async () => [...bundled, ...(await registry.list())],
    registry, store,
    model: opts.model === undefined ? null : opts.model,
    blender: blender ? new BlenderPool([blender]) : null,
    ...opts.extra,
  });
  return { service, registry, store, blender, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// ---- guard and loop ------------------------------------------------------------------------
test("bpy guard allows modeling code and blocks system access", () => {
  assert.ok(checkBpyCode("import bpy\nimport math\nfrom mathutils import Vector\nbpy.ops.mesh.primitive_cube_add(size=1)").ok);
  for (const bad of ["import os\nos.system('x')", "from subprocess import run", "open('/etc/passwd')", "__import__('os')", "bpy.ops.wm.quit_blender()",
    "exec('1')", "import bpy\nbpy.app.handlers.load_post.append(f)", "import socket", "bpy.ops.export_scene.gltf(filepath='x')", "bpy.context.object.filepath = 'x'", ""]) {
    assert.equal(checkBpyCode(bad).ok, false, bad);
  }
  assert.equal(checkBpyCode("x".repeat(30_000)).ok, false);
});

const echo: AgentTool<string> = {
  name: "echo", description: "", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, schema: z.object({ text: z.string() }),
  async run(a: { text: string }) { return { output: { ok: true, said: a.text }, done: a.text === "finish" ? "finished" : undefined }; },
};
test("loop validates arguments, reports unknown tools, and ends on done", async () => {
  const model = scriptedModel([[call("echo", { text: 5 })], [call("nope")], [call("echo", { text: "finish" })]]);
  const r = await runToolLoop({ model, instructions: "", input: [], tools: [echo], options: { maxRounds: 5, maxToolCalls: 5 } });
  assert.equal(r.done, "finished");
  assert.deepEqual(r.trace.map((t) => t.ok), [false, false, true]);
  assert.match(r.trace[0].summary, /Invalid arguments/);
});
test("loop enforces round and call limits, stops when the model stops, and honors abort", async () => {
  const forever = scriptedModel(() => [call("echo", { text: "x" })]);
  assert.equal((await runToolLoop({ model: forever, instructions: "", input: [], tools: [echo], options: { maxRounds: 3, maxToolCalls: 99 } })).endedBecause, "round_limit");
  assert.equal((await runToolLoop({ model: forever, instructions: "", input: [], tools: [echo], options: { maxRounds: 99, maxToolCalls: 2 } })).endedBecause, "call_limit");
  assert.equal((await runToolLoop({ model: scriptedModel(["all done"]), instructions: "", input: [], tools: [echo], options: { maxRounds: 3, maxToolCalls: 3 } })).endedBecause, "model_finished");
  const boom: AgentTool<string> = { ...echo, async run() { throw new FatalToolError("blender gone"); } };
  await assert.rejects(runToolLoop({ model: scriptedModel([[call("echo", { text: "x" })]]), instructions: "", input: [], tools: [boom], options: { maxRounds: 3, maxToolCalls: 3 } }), /blender gone/);
  const ac = new AbortController(); ac.abort();
  assert.equal((await runToolLoop({ model: scriptedModel([]), instructions: "", input: [], tools: [echo], options: { maxRounds: 3, maxToolCalls: 3 }, signal: ac.signal })).endedBecause, "aborted");
});

// ---- router: confident matches never reach a model ---------------------------------------------
test("fast path: a confident match never calls the model or Blender", async () => {
  const h = await harness({ model: neverCalled() });
  try {
    const out = await h.service.resolve(sofaReq);
    assert.equal(out.source, "retrieved"); assert.equal(out.asset?.category, "sofa"); assert.equal(h.blender!.resets, 0);
  } finally { await h.cleanup(); }
});
test("descriptions of things already in the library are found by retrieval, whatever the wording", async () => {
  const cases: [string, [number, number, number], string][] = [
    ["cream sofa", [2.5, 1.0, 1.0], "sofa"], ["round coffee table", [1.2, 0.45, 1.2], "coffee_table"], ["tall wooden display shelves", [1.0, 1.5, 0.35], "bookshelf"],
    ["potted plant", [0.6, 0.8, 0.6], "plant"], ["accent armchair", [0.85, 1.0, 0.95], "armchair"],
  ];
  const h = await harness({ model: null });
  try {
    for (const [description, dims, category] of cases) {
      const out = await h.service.resolve(req({ category, description, targetDimensionsM: dims }));
      assert.equal(out.asset?.category, category, description); assert.equal(out.source, "retrieved");
    }
  } finally { await h.cleanup(); }
});

// ---- router -> retrieval agent (uncertain band) ----------------------------------------------------
test("uncertain: the retrieval agent sees the score breakdown and may choose a candidate; Blender is never touched", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [call("choose_asset", { assetId: "00000000-0000-4000-8000-000000000999", reason: "x" })];
    if (i === 1) { assert.match(lastToolOutput(input).error, /not in the candidate list/); return [call("choose_asset", { assetId: idOf("coffee_table"), reason: "a coffee table is what this scan is" })]; }
    return "done";
  });
  const h = await harness({ model });
  try {
    const out = await h.service.resolve(looseTable);
    assert.equal(out.retrieval, "ambiguous"); assert.equal(out.source, "reused"); assert.equal(out.asset?.category, "coffee_table");
    assert.equal(h.blender!.resets, 0);
    assert.deepEqual(model.toolNames[0].sort(), ["choose_asset", "send_to_builder"]);
    const prompt = (model.inputs[0][0] as { content: string }).content;
    assert.match(prompt, /"breakdown": \{/); assert.match(prompt, /"category": 0\.6/);
  } finally { await h.cleanup(); }
});
test("uncertain: the retrieval agent hands off to the builder with a base asset and the change needed", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [call("send_to_builder", { reason: "needs a different top", baseAssetId: "nope", change: "make it a dining table" })];
    if (i === 1) { assert.match(lastToolOutput(input).error, /one of the listed candidates/); return [call("send_to_builder", { reason: "a coffee table is too low for a table", baseAssetId: idOf("coffee_table"), change: "raise it to table height and square the top" })]; }
    if (i === 2) return [call("import_asset_to_blender", { assetId: idOf("coffee_table") })];
    if (i === 3) return [call("run_blender_python", { code: "SCALE 1 1.5 1" })];
    if (i === 4) return [call("submit_asset", { title: "Square table", derivedFromAssetId: idOf("coffee_table") })];
    return "done";
  });
  const blender = new FakeBlender();
  const h = await harness({ model, blender });
  try {
    const out = await h.service.resolve(looseTable);
    assert.equal(out.source, "modified"); assert.equal(out.derivedFromAssetId, idOf("coffee_table")); assert.equal(out.asset?.derivedFromAssetId, idOf("coffee_table"));
    assert.equal(blender.imported.length, 1);
    // The hand-off reaches the builder's prompt: why, the base asset, the change, and the candidates with scores.
    const builderPrompt = model.instructions[2];
    assert.match(builderPrompt, /too low for a table/); assert.match(builderPrompt, new RegExp(idOf("coffee_table"))); assert.match(builderPrompt, /raise it to table height/); assert.match(builderPrompt, /"breakdown"/);
    assert.deepEqual([...model.toolNames[2]].sort(), BUILDER_TOOLS);
  } finally { await h.cleanup(); }
});
test("uncertain with a confident match and the fast path off: the retrieval agent still reviews it", async () => {
  const model = scriptedModel([[call("choose_asset", { assetId: idOf("sofa"), reason: "exact kind and size" })]]);
  const h = await harness({ model, extra: { fastPath: false } });
  try { const out = await h.service.resolve(sofaReq); assert.equal(out.source, "reused"); assert.equal(model.requests, 1); } finally { await h.cleanup(); }
});
test("uncertain with generation forbidden or no Blender: reuse or placeholder only (reject_all, no builder hand-off)", async () => {
  for (const setup of [{ blender: null as FakeBlender | null, request: looseTable }, { blender: new FakeBlender() as FakeBlender | null, request: { ...looseTable, allowGeneration: false } }]) {
    const model = scriptedModel([[call("reject_all", { reason: "not a table" })]]);
    const h = await harness({ model, blender: setup.blender });
    try {
      const out = await h.service.resolve(setup.request);
      assert.deepEqual([...model.toolNames[0]].sort(), ["choose_asset", "reject_all"]);
      assert.equal(out.source, "placeholder"); assert.equal(out.assetId, null);
    } finally { await h.cleanup(); }
  }
});

// ---- router -> builder directly (nothing acceptable) --------------------------------------------------
const createScript = (dims: [number, number, number]) => (i: number): Turn =>
  i === 0 ? [call("search_assets")] : i === 1 ? [call("run_blender_python", { code: `BOX ${dims.join(" ")}` })] : i === 2 ? [call("measure_model")] : i === 3 ? [call("submit_asset", { title: "Queen bed" })] : "done";

test("nothing fits: straight to the builder (no retrieval agent), which creates; the next identical request is plain retrieval", async () => {
  const model = scriptedModel(createScript([1.6, 0.9, 2.1]));
  const h = await harness({ model });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.retrieval, "needs_generation"); assert.equal(out.source, "generated");
    assert.equal(out.asset?.category, "bed"); assert.equal(out.asset?.source, "generated"); assert.equal(out.asset?.derivedFromAssetId, undefined);
    assert.ok(!model.toolNames[0].includes("choose_asset"), "the router skipped the retrieval agent");
    assert.match(model.instructions[0], /no library asset of a compatible kind fits/);
    assert.equal(out.usage.modelRequests, 4, "search, build, measure, submit; the loop ends on success");
    assert.ok(h.blender!.resets >= 2, "scene reset on lease and again on release");
    const before = model.requests;
    const again = await h.service.resolve(bed);
    assert.equal(again.source, "retrieved"); assert.equal(again.assetId, out.assetId); assert.equal(model.requests, before);
  } finally { await h.cleanup(); }
});
test("a rejected submission is fed back to the builder, which fixes it", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [call("run_blender_python", { code: "BOX 1.6 0.9 0.05" })];
    if (i === 1) return [call("submit_asset", { title: "Bed" })];
    if (i === 2) { assert.match(JSON.stringify(lastToolOutput(input)), /Proportions/); return [call("run_blender_python", { code: "BOX 1.6 0.9 2.1" })]; }
    if (i === 3) return [call("submit_asset", { title: "Bed" })];
    return "done";
  });
  const h = await harness({ model });
  try { const out = await h.service.resolve(bed); assert.equal(out.source, "generated"); assert.match(out.notes.join(" "), /after 2 submission/); } finally { await h.cleanup(); }
});
test("a wall-clock budget ends a slow builder job, and the service falls back instead of hanging", async () => {
  const slow = { ...scriptedModel([]), respond: async () => { await new Promise((r) => setTimeout(r, 25)); return scriptedModel([[call("run_blender_python", { code: "BOX 1 1 1" })]]).respond([], "", []); } };
  const h = await harness({ model: slow, extra: { limits: { maxRounds: 50, maxToolCalls: 100, maxSubmissions: 3, maxCodeRuns: 50, maxMs: 60 } } });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.source, "placeholder"); assert.match(out.notes.join(" "), /timeout/);
  } finally { await h.cleanup(); }
});
test("a builder that never produces an acceptable model ends as a bounded placeholder; nothing invalid is stored", async () => {
  const model = scriptedModel((i) => i % 2 === 0 ? [call("run_blender_python", { code: "BOX 1.6 0.9 0.05" })] : [call("submit_asset", { title: "Bed" })]);
  const h = await harness({ model, extra: { limits: { maxRounds: 20, maxToolCalls: 40, maxSubmissions: 2, maxCodeRuns: 10 } } });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.source, "placeholder"); assert.equal(out.assetId, null);
    assert.equal((await h.registry.list()).length, 0); assert.ok(model.requests <= 20);
  } finally { await h.cleanup(); }
});
test("the builder can choose a placeholder itself; blocked code never reaches Blender", async () => {
  const h = await harness({ model: scriptedModel([[call("use_placeholder", { reason: "cannot represent a hologram" })]]) });
  try {
    const out = await h.service.resolve(req({ category: "hologram", targetDimensionsM: [0.5, 1, 0.5] }));
    assert.equal(out.source, "placeholder"); assert.match(out.notes.join(" "), /cannot represent/);
  } finally { await h.cleanup(); }
  const model = scriptedModel((i, input) => i === 0 ? [call("run_blender_python", { code: "import os\nos.system('rm -rf ~')" })] : (assert.equal(lastToolOutput(input).rejected, true), "giving up"));
  const blender = new FakeBlender();
  const g = await harness({ model, blender });
  try { await g.service.resolve(bed); assert.equal(blender.executed.length, 0); } finally { await g.cleanup(); }
});
test("an unreachable Blender fails fast to a placeholder instead of looping", async () => {
  const blender = new FakeBlender(); blender.unreachable = true;
  const model = scriptedModel(() => [call("run_blender_python", { code: "BOX 1 1 1" })]);
  const h = await harness({ model, blender });
  try {
    const out = await h.service.resolve(bed);
    assert.equal(out.source, "placeholder"); assert.match(out.notes.join(" "), /Cannot reach Blender/); assert.ok(model.requests <= 1);
  } finally { await h.cleanup(); }
});

// ---- real-world failure modes found testing against Blender ---------------------------------------------------
test("a 'modification' that deleted the imported asset and rebuilt is refused as a modification; submitted as a new model it is accepted", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [call("send_to_builder", { reason: "r", baseAssetId: idOf("coffee_table"), change: "square top" })];
    if (i === 1) return [call("import_asset_to_blender", { assetId: idOf("coffee_table") })];
    if (i === 2) return [call("run_blender_python", { code: "BOX 1.2 0.45 1.2" })]; // rebuilds from scratch: imported mesh is gone
    if (i === 3) return [call("submit_asset", { title: "Square table", derivedFromAssetId: idOf("coffee_table") })];
    if (i === 4) { assert.match(lastToolOutput(input).error, /rebuild, not a modification/); return [call("submit_asset", { title: "Square table" })]; }
    return "done";
  });
  const h = await harness({ model });
  try {
    const out = await h.service.resolve(looseTable);
    assert.equal(out.source, "generated"); assert.equal(out.derivedFromAssetId, undefined); assert.equal(out.asset?.derivedFromAssetId, undefined);
    assert.deepEqual(out.asset?.tags, ["generated"]);
  } finally { await h.cleanup(); }
});
test("an edit that keeps the imported asset is a real modification", async () => {
  const model = scriptedModel((i) => i === 0 ? [call("send_to_builder", { reason: "r", baseAssetId: idOf("coffee_table"), change: "wider" })]
    : i === 1 ? [call("import_asset_to_blender", { assetId: idOf("coffee_table") })] : i === 2 ? [call("run_blender_python", { code: "SCALE 0.9 1 1" })]
    : i === 3 ? [call("submit_asset", { title: "Narrower table", derivedFromAssetId: idOf("coffee_table") })] : "done");
  const h = await harness({ model });
  try { const out = await h.service.resolve(looseTable); assert.equal(out.source, "modified"); assert.equal(out.derivedFromAssetId, idOf("coffee_table")); } finally { await h.cleanup(); }
});
test("a requested color that is not in the exported model is rejected with a fix hint; painting it passes", async () => {
  const redBed = req({ category: "bed", description: "red bed", colors: ["red"], targetDimensionsM: [1.6, 0.9, 2.1] });
  const model = scriptedModel((i, input) => {
    if (i === 0) return [call("run_blender_python", { code: "BOX 1.6 0.9 2.1" })];
    if (i === 1) return [call("submit_asset", { title: "Bed" })];
    if (i === 2) { assert.match(JSON.stringify(lastToolOutput(input)), /Requested color \\"red\\" is not in the model/); return [call("run_blender_python", { code: "PAINT 0.8 0.02 0.02" })]; }
    if (i === 3) return [call("submit_asset", { title: "Bed" })];
    return "done";
  });
  const h = await harness({ model });
  try { const out = await h.service.resolve(redBed); assert.equal(out.source, "generated"); assert.match(out.notes.join(" "), /after 2 submission/); } finally { await h.cleanup(); }
});

// ---- builder policy: thresholds enforced in code ------------------------------------------------------------
const handoffFor = (request: AssetRequest, reason = "test") => ({ reason, candidates: describeCandidates(retrieveAsset(request, bundled).resolution.candidates, new Map(bundled.map((a) => [a.id, a]))) });
async function runBuilder(request: AssetRequest, model: ReturnType<typeof scriptedModel>, opts: { blender?: FakeBlender; retrieve?: object } = {}) {
  const h = await harness({ model, blender: opts.blender });
  try {
    return await runBuilderAgent({ model, request, catalog: bundled, registry: h.registry, store: h.store, blender: new BlenderPool([h.blender!]), handoff: handoffFor(request), retrieve: opts.retrieve });
  } finally { await h.cleanup(); }
}

test("creating from scratch is blocked while a confident match exists, however the builder searched; modifying stays allowed from the same kind only", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [call("search_assets", { category: "bed", description: "unrelated" })]; // rewording the search must not move the gate
    if (i === 1) return [call("run_blender_python", { code: "BOX 2.2 0.9 0.95" })];
    if (i === 2) { assert.match(lastToolOutput(input).error, /Creating from scratch is blocked.*confident match/); return [call("submit_asset", { title: "Another sofa" })]; }
    if (i === 3) { assert.match(lastToolOutput(input).error, /blocked/); return [call("import_asset_to_blender", { assetId: idOf("bookshelf") })]; }
    if (i === 4) { assert.match(lastToolOutput(input).error, /cannot be modified into a sofa/); return [call("import_asset_to_blender", { assetId: idOf("sofa") })]; }
    return lastToolOutput(input).ok ? [call("use_placeholder", { reason: "enough" })] : "stop";
  });
  const blender = new FakeBlender();
  const result = await runBuilder(sofaReq, model, { blender });
  assert.equal(blender.executed.length, 0); assert.equal(blender.imported.length, 1); assert.equal(result.result?.kind, "placeholder");
});
test("score_asset gives the original-item score and breakdown, or why an asset cannot be used", async () => {
  const model = scriptedModel((i, input) => {
    if (i === 0) return [call("score_asset", { assetId: idOf("coffee_table") })];
    if (i === 1) {
      const out = lastToolOutput(input);
      assert.ok(out.usable && out.score > 0.5 && out.score < 0.75 && out.band === "uncertain" && out.breakdown.category < 1);
      return [call("score_asset", { assetId: idOf("sofa") })];
    }
    if (i === 2) { assert.deepEqual(lastToolOutput(input), { ok: true, usable: false, rejection: "category_mismatch", kindMatches: false }); return [call("score_asset", { assetId: "nope" })]; }
    if (i === 3) assert.equal(lastToolOutput(input).ok, false);
    return [call("use_placeholder", { reason: "x" })];
  });
  await runBuilder(looseTable, model);
  assert.ok(model.requests >= 4);
});
test("search_assets returns the top K by similarity score, best first", async () => {
  const h = await harness({ model: null });
  try {
    for (const n of [1, 2, 3]) assert.ok((await h.registry.registerGenerated({ glb: buildBoxGlb({ size: [1.9 + n * 0.1, 0.9, 0.95 + n * 0.01] }), request: sofaReq, title: `Sofa variant ${n}` })).ok);
    const catalog = [...bundled, ...(await h.registry.list())];
    const model = scriptedModel((i, input) => {
      if (i === 0) return [call("search_assets", { topK: 2 })];
      if (i === 1) { const r = lastToolOutput(input); assert.equal(r.candidates.length, 2); assert.ok(r.candidates[0].score >= r.candidates[1].score); return [call("search_assets", { topK: 10 })]; }
      if (i === 2) { assert.ok(lastToolOutput(input).candidates.length >= 4); return [call("use_placeholder", { reason: "x" })]; }
      return "done";
    });
    await runBuilderAgent({ model, request: sofaReq, catalog, registry: h.registry, store: h.store, blender: new BlenderPool([new FakeBlender()]), handoff: handoffFor(sofaReq) });
    assert.ok(model.requests >= 3);
  } finally { await h.cleanup(); }
});

// ---- fallbacks and concurrency ------------------------------------------------------------------------------
test("no model: ambiguous uses the best candidate or a placeholder by policy; no fit is a placeholder", async () => {
  const a = await harness({ model: null }), b = await harness({ model: null, extra: { ambiguousWithoutModel: "placeholder" } });
  try {
    assert.equal((await a.service.resolve(looseTable)).source, "best_effort");
    assert.equal((await b.service.resolve(looseTable)).source, "placeholder");
    const none = await a.service.resolve(bed);
    assert.equal(none.source, "placeholder"); assert.match(none.notes.join(" "), /no model is available/);
  } finally { await a.cleanup(); await b.cleanup(); }
});
test("a model failure on an uncertain item falls back to the best candidate; with nothing close, a placeholder", async () => {
  const failing = () => ({ ...scriptedModel([]), respond: async () => { throw new Error("provider down"); } });
  const h = await harness({ model: failing() });
  try {
    const amb = await h.service.resolve(looseTable);
    assert.equal(amb.source, "best_effort"); assert.match(amb.notes.join(" "), /provider down/);
    assert.equal((await h.service.resolve(bed)).source, "placeholder");
  } finally { await h.cleanup(); }
});
test("a builder that gives up on an uncertain item falls back to the best candidate", async () => {
  const model = scriptedModel((i) => i === 0 ? [call("send_to_builder", { reason: "r", change: "c" })] : [call("use_placeholder", { reason: "cannot" })]);
  const h = await harness({ model });
  try { const out = await h.service.resolve(looseTable); assert.equal(out.source, "best_effort"); assert.match(out.notes.join(" "), /Builder chose a placeholder/); } finally { await h.cleanup(); }
});
test("identical concurrent requests share one job; Blender jobs never overlap", async () => {
  const model = scriptedModel((_i, input) => {
    const results = input.filter((x) => (x as { type?: string }).type === "function_call_output").length;
    return createScript([1.6, 0.9, 2.1])(results);
  });
  const blender = new FakeBlender(); blender.delayMs = 15;
  const h = await harness({ model, blender });
  try {
    const outs = await Promise.all([h.service.resolve(bed), h.service.resolve({ ...bed }), h.service.resolve(bed)]);
    assert.ok(outs.every((o) => o.source === "generated" && o.assetId === outs[0].assetId));
    assert.equal((await h.registry.list()).length, 1);
    await Promise.all([h.service.resolve(req({ category: "floor_lamp", description: "arc lamp", targetDimensionsM: [0.45, 1.6, 0.45] })), h.service.resolve(req({ category: "desk", description: "desk", targetDimensionsM: [1.4, 0.75, 0.7] }))]);
    assert.equal(blender.maxActive, 1);
  } finally { await h.cleanup(); }
});
test("resolveMany reports outcomes as they complete and keeps input order; an aborted job returns a placeholder", async () => {
  const h = await harness({ model: null });
  try {
    const seen: number[] = [];
    const outs = await h.service.resolveMany([sofaReq, bed, req({ category: "plant", targetDimensionsM: [0.6, 0.8, 0.6] })], (_o, i) => seen.push(i));
    assert.deepEqual(outs.map((o) => o.source), ["retrieved", "placeholder", "retrieved"]); assert.deepEqual([...seen].sort(), [0, 1, 2]);
    const ac = new AbortController(); ac.abort();
    const g = await harness({ model: scriptedModel([]) });
    try { assert.equal((await g.service.resolve(bed, ac.signal)).source, "placeholder"); } finally { await g.cleanup(); }
  } finally { await h.cleanup(); }
});

// ---- scene integration -----------------------------------------------------------------------------------------------
test("request keys ignore case, spacing and label order; locked objects are never replaced", async () => {
  const a = req({ category: "Dining Table", description: "Oak  table", styles: ["Rustic", "farmhouse"], targetDimensionsM: [1.8, 0.75, 0.9] });
  const b = req({ category: "dining_table", description: "oak table", styles: ["farmhouse", "rustic"], targetDimensionsM: [1.801, 0.749, 0.9] });
  assert.equal(requestKey(a), requestKey(b)); assert.notEqual(requestKey(a), requestKey(req({ ...a, description: "walnut table" })));

  const object = { id: "00000000-0000-4000-8000-000000000001", category: "sofa", displayName: "Sofa", dimensionsM: [2.2, 0.85, 0.95] as [number, number, number], locked: false };
  const h = await harness({ model: null });
  try {
    const out = await h.service.resolve(requestForObject(object));
    const ops = toReplaceAssetOps([object], [out]);
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.ok(op.type === "replaceAsset" && op.objectId === object.id && op.assetId === out.assetId);
    if (op.type === "replaceAsset") assert.ok(op.dimensionsM.every((n, i) => n <= object.dimensionsM[i] + 1e-9));
    assert.equal(toReplaceAssetOps([{ ...object, locked: true }], [out]).length, 0, "locked objects are skipped");
    assert.equal(toReplaceAssetOps([object], [{ asset: null }]).length, 0);
  } finally { await h.cleanup(); }
});
