import type { ResponseInputItem } from "openai/resources/responses/responses";
import { z } from "zod";
import { DEFAULT_OPTIONS, categoryAffinity, retrieveAsset, scoreAsset, type AssetRegistry, type GlbStore, type RetrieveOptions } from "@house/asset-service";
import { AssetRequest, type AssetSpec } from "@house/contracts";
import { checkBpyCode } from "./bpyGuard";
import { BlenderError, MEASURE_SCRIPT, type BlenderPort } from "./blender";
import type { AgentModel } from "./model";
import type { Handoff } from "./retrievalAgent";
import { FatalToolError, runToolLoop, type AgentTool, type LoopResult } from "./toolLoop";

/** How the builder finished. */
export type BuilderResult =
  | { kind: "created"; asset: AssetSpec; derivedFromAssetId?: string; warnings: string[]; submissions: number }
  | { kind: "placeholder"; reason: string };

export type AgentLimits = { maxRounds: number; maxToolCalls: number; maxSubmissions: number; maxCodeRuns: number };
export const DEFAULT_AGENT_LIMITS: AgentLimits = { maxRounds: 24, maxToolCalls: 48, maxSubmissions: 3, maxCodeRuns: 24 };

/** Blender access, acquired only when the builder actually needs it. */
export interface BlenderAccess {
  lease(): Promise<{ port: BlenderPort; release: () => void }>;
}

const dimsText = (d: readonly number[]) => d.map((n) => n.toFixed(2)).join(" x ");
const user = (content: string): ResponseInputItem => ({ role: "user", content });

const instructions = (request: AssetRequest, t: { accept: number; generateBelow: number }, handoff: Handoff) => `You are the 3D builder of a room-design app. You are given a description of one item and must end up with a real 3D model (GLB) for it that fits the request exactly. The library was already searched and no asset is acceptable as-is.

Why reuse was ruled out: ${handoff.reason}
${handoff.baseAssetId ? `Suggested base asset to modify: ${handoff.baseAssetId}${handoff.change ? ` — change needed: ${handoff.change}` : ""}` : `No base asset was suggested${handoff.change ? `; what to build: ${handoff.change}` : ""}.`}
Library candidates (best first, with similarity scores): ${JSON.stringify(handoff.candidates)}

Either MODIFY a library asset of the same kind (start with import_asset_to_blender, edit with run_blender_python, measure_model, then submit_asset with derivedFromAssetId) when a structural change gets you there, or CREATE a model from scratch (run_blender_python, measure_model, submit_asset) when nothing is close. You may search_assets / score_asset to look at other candidates. If neither is possible, call use_placeholder.
Similarity scores are 0-1; thresholds (${t.generateBelow} reuse floor, ${t.accept} confident) are enforced by code against the original item: creating from scratch is blocked while a confident library match exists, and a modification must start from an asset of the same kind.
Blender: units are meters, Z is up. Width is Blender X, depth is Blender Y, height is Blender Z. The front faces -Y. One standing item resting on the floor; no floor, walls, lights or cameras. Use primitives, bmesh and light modifiers; stay under ~30,000 triangles; give parts Principled BSDF materials (base color, roughness) matching the request; no image textures or external files. Only import bpy, bmesh, mathutils, math, random. File, OS, preferences and render access is rejected. If submit_asset reports problems, fix them and submit again.
Be brief. Reply with tool calls, not explanations.

The item: ${JSON.stringify({ category: request.category, description: request.description, styles: request.styles, colors: request.colors, materials: request.materials, mustFitMeters: dimsText(request.targetDimensionsM) + " (width x height x depth)" })}`;

export async function runBuilderAgent(params: {
  model: AgentModel;
  request: AssetRequest;
  /** Library snapshot at the start of the job. */
  catalog: AssetSpec[];
  registry: AssetRegistry;
  store: GlbStore;
  blender: BlenderAccess;
  handoff: Handoff;
  limits?: AgentLimits;
  /** Retrieval options (thresholds, weights, tolerances); the same ones the service uses. */
  retrieve?: Partial<RetrieveOptions>;
  signal?: AbortSignal;
}): Promise<{ result: BuilderResult | null; loop: LoopResult<BuilderResult> | null; failure?: string }> {
  const { model, request, catalog, registry, store, signal, handoff } = params;
  const limits = params.limits ?? DEFAULT_AGENT_LIMITS;
  const byId = new Map(catalog.map((a) => [a.id, a]));

  // Thresholds are judged against the ORIGINAL request, so rewording a search cannot unlock creation.
  const opts: RetrieveOptions = { ...DEFAULT_OPTIONS, ...params.retrieve, weights: { ...DEFAULT_OPTIONS.weights, ...params.retrieve?.weights } };
  const baseline = retrieveAsset(request, catalog, params.retrieve).resolution;
  const baselineBest = baseline.status === "needs_generation" ? baseline.bestScore : baseline.score;
  const round2 = (n: number) => Number(n.toFixed(2));
  const createAllowed = baseline.status !== "matched";
  const createBlocked = () => `Creating from scratch is blocked: the library already has a confident match (best score ${baselineBest === null ? "n/a" : round2(baselineBest)} >= ${opts.acceptThreshold}). Modify it with import_asset_to_blender instead.`;

  // Blender is leased on first use and held until the job ends, so searching never blocks other jobs.
  const held: { lease: Awaited<ReturnType<BlenderAccess["lease"]>> | null } = { lease: null };
  const imported = new Set<string>();
  let submissions = 0;
  let codeRuns = 0;

  const blender = async (): Promise<BlenderPort> => {
    if (held.lease) return held.lease.port;
    try {
      held.lease = await params.blender.lease();
      await held.lease.port.reset(signal);
      return held.lease.port;
    } catch (error) { throw asFatal(error); }
  };
  const call = async <T,>(fn: (port: BlenderPort) => Promise<T>): Promise<T> => {
    const port = await blender();
    try { return await fn(port); } catch (error) { throw asFatal(error); }
  };

  const describe = (a: AssetSpec) => ({
    assetId: a.id, title: a.title, category: a.category, sizeMeters: dimsText(a.dimensionsM), styles: a.styles, colors: a.colors,
    materials: a.materials, description: a.searchableDescription, source: a.source, ...(a.derivedFromAssetId ? { derivedFromAssetId: a.derivedFromAssetId } : {}),
  });

  const searchSchema = z.object({
    category: z.string().optional(), description: z.string().optional(),
    styles: z.array(z.string()).optional(), colors: z.array(z.string()).optional(), materials: z.array(z.string()).optional(),
    mustFitMeters: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
    topK: z.number().int().min(1).max(10).optional(),
  });

  const tools: AgentTool<BuilderResult>[] = [
    {
      name: "search_assets",
      description: "Search the verified asset library for the top-K most similar assets (default 5, max 10). Defaults to the item you were given; override fields to look for other bases. Returns candidates with similarity scores (0-1, with a breakdown).",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          category: { type: "string" }, description: { type: "string" },
          styles: { type: "array", items: { type: "string" } }, colors: { type: "array", items: { type: "string" } }, materials: { type: "array", items: { type: "string" } },
          mustFitMeters: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[width, height, depth]" },
          topK: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
      schema: searchSchema,
      async run(args: z.infer<typeof searchSchema>) {
        const query = AssetRequest.parse({
          ...request, category: args.category ?? request.category, description: args.description ?? request.description,
          styles: args.styles ?? request.styles, colors: args.colors ?? request.colors, materials: args.materials ?? request.materials,
          targetDimensionsM: args.mustFitMeters ?? request.targetDimensionsM,
        });
        const { resolution, rejections } = retrieveAsset(query, catalog, { ...params.retrieve, topK: args.topK ?? 5 });
        const rejected: Record<string, number> = {};
        for (const r of rejections) rejected[r.reason] = (rejected[r.reason] ?? 0) + 1;
        const candidates = resolution.candidates.map((c) => {
          const a = byId.get(c.assetId)!;
          return { ...describe(a), score: round2(c.score), fitScale: round2(c.fitScale), breakdown: c.breakdown };
        });
        return { output: { ok: true, decision: resolution.status, candidates, rejectedCounts: rejected, searched: catalog.length } };
      },
    },
    {
      name: "score_asset",
      description: "Similarity score (0-1, with breakdown) of one library asset against the ORIGINAL item, or why it cannot be used (wrong kind, unverified, scale or proportions out of range).",
      parameters: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"], additionalProperties: false },
      schema: z.object({ assetId: z.string() }),
      async run(args: { assetId: string }) {
        const asset = byId.get(args.assetId);
        if (!asset) return { output: { ok: false, error: "Unknown assetId." } };
        const scored = scoreAsset(request, asset, opts);
        if ("rejection" in scored) return { output: { ok: true, usable: false, rejection: scored.rejection.reason, kindMatches: categoryAffinity(request.category, asset.category) > 0 } };
        const { score, breakdown, fitScale } = scored.candidate;
        return { output: { ok: true, usable: true, score: round2(score), band: score >= opts.acceptThreshold ? "confident" : score >= opts.generateBelow ? "uncertain" : "weak", breakdown, fitScale: round2(fitScale) } };
      },
    },
    {
      name: "import_asset_to_blender",
      description: "Load a library asset into the Blender scene so you can modify it; submit_asset then records the result as derived from it. Replaces whatever is in the scene.",
      parameters: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"], additionalProperties: false },
      schema: z.object({ assetId: z.string() }),
      async run(args: { assetId: string }) {
        const asset = byId.get(args.assetId);
        if (!asset || asset.licenseStatus !== "verified") return { output: { ok: false, error: "Unknown or unavailable assetId." } };
        if (categoryAffinity(request.category, asset.category) === 0) return { output: { ok: false, error: `A ${asset.category} cannot be modified into a ${request.category}. Pick an asset of the same kind, or create a new model.` } };
        const glb = await store.readGlb(asset.glbStorageKey);
        await call(async (port) => { await port.reset(signal); await port.importGlb(glb, signal); });
        imported.add(asset.id);
        return { output: { ok: true, imported: asset.title, note: "Imported. Blender is Z-up: width=X, depth=Y, height=Z. Call measure_model." } };
      },
    },
    {
      name: "run_blender_python",
      description: "Run Python (bpy) in the Blender session. Returns printed output or the error. Scene state persists between calls.",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
      schema: z.object({ code: z.string() }),
      async run(args: { code: string }) {
        if (imported.size === 0 && !createAllowed) return { output: { ok: false, error: createBlocked() } };
        const guard = checkBpyCode(args.code);
        if (!guard.ok) return { output: { ok: false, rejected: true, error: guard.reason } };
        if (++codeRuns > limits.maxCodeRuns) return { output: { ok: false, error: "Code-execution budget used up. Submit what you have, or stop." } };
        const result = await call((port) => port.runPython(args.code, signal));
        return { output: { ok: result.ok, output: result.output.slice(0, 2000) } };
      },
    },
    {
      name: "measure_model",
      description: "Measure all mesh objects in the Blender scene: size as [width, height, depth] in meters, triangle count, lowest point.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      schema: z.object({}),
      async run() {
        const result = await call((port) => port.runPython(MEASURE_SCRIPT, signal));
        if (!result.ok) return { output: { ok: false, error: result.output.slice(0, 1000) } };
        try {
          const measured = JSON.parse(result.output.trim().split("\n").pop() ?? "{}");
          return { output: { ok: true, must_fit_width_height_depth: request.targetDimensionsM, ...measured } };
        } catch { return { output: { ok: false, error: "Could not read measurements." } }; }
      },
    },
    {
      name: "view_model",
      description: "Screenshot of the Blender viewport (only with image-capable models and a GUI Blender).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      schema: z.object({}),
      async run() {
        if (!model.supportsImages) return { output: { ok: false, error: "Image viewing is unavailable with this model; rely on measure_model." } };
        const png = await call((port) => port.screenshot(signal));
        return png ? { output: { ok: true }, imagePng: png } : { output: { ok: false, error: "Screenshot is not available in this Blender session." } };
      },
    },
    {
      name: "submit_asset",
      description: "Export the Blender scene as GLB and submit it to the library. The library validates size, proportions, triangle and texture budgets. Success finishes the job; on failure fix the listed problems and submit again. If you started from import_asset_to_blender, pass that asset's id as derivedFromAssetId.",
      parameters: { type: "object", properties: { title: { type: "string" }, derivedFromAssetId: { type: "string" } }, required: ["title"], additionalProperties: false },
      schema: z.object({ title: z.string().min(1).max(80), derivedFromAssetId: z.string().optional() }),
      async run(args: { title: string; derivedFromAssetId?: string }) {
        if (!args.derivedFromAssetId && !createAllowed) return { output: { ok: false, error: createBlocked() } };
        if (args.derivedFromAssetId && !imported.has(args.derivedFromAssetId)) return { output: { ok: false, error: "derivedFromAssetId must be an asset you imported with import_asset_to_blender." } };
        if (submissions >= limits.maxSubmissions) return { output: { ok: false, error: "No submissions left." } };
        submissions++;
        const glb = await call((port) => port.exportGlb(signal));
        const registered = await registry.registerGenerated({ glb, request, title: args.title, derivedFromAssetId: args.derivedFromAssetId });
        if (!registered.ok) return { output: { ok: false, problems: registered.errors, submissionsLeft: limits.maxSubmissions - submissions } };
        return {
          output: { ok: true, assetId: registered.asset.id },
          done: { kind: "created", asset: registered.asset, ...(args.derivedFromAssetId ? { derivedFromAssetId: args.derivedFromAssetId } : {}), warnings: registered.warnings, submissions },
        };
      },
    },
    {
      name: "use_placeholder",
      description: "Finish without a model when the item can neither be modified nor created. The editor will show a simple approximate box.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
      schema: z.object({ reason: z.string().max(500) }),
      async run(args: { reason: string }) { return { output: { ok: true }, done: { kind: "placeholder", reason: args.reason } }; },
    },
  ];

  try {
    const loop = await runToolLoop<BuilderResult>({
      model, instructions: instructions(request, { accept: opts.acceptThreshold, generateBelow: opts.generateBelow }, handoff), tools, signal,
      options: { maxRounds: limits.maxRounds, maxToolCalls: limits.maxToolCalls },
      input: [user("Build this item now.")],
    });
    return loop.done
      ? { result: loop.done, loop }
      : { result: null, loop, failure: `The builder ended without a result (${loop.endedBecause}).` };
  } catch (error) {
    if (error instanceof FatalToolError) return { result: null, loop: null, failure: error.message };
    throw error;
  } finally {
    if (held.lease) {
      await held.lease.port.reset().catch(() => undefined);
      held.lease.release();
    }
  }
}

/** An unreachable Blender can't be fixed by the model retrying, so it ends the job. */
function asFatal(error: unknown): unknown {
  if (error instanceof BlenderError && /Cannot reach|closed the connection|did not respond/.test(error.message)) return new FatalToolError(error.message);
  return error;
}

