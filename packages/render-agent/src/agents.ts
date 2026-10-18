import type { ResponseInputItem } from "openai/resources/responses/responses";
import { z } from "zod";
import type { AssetRegistry } from "@house/asset-service";
import type { AssetCandidate, AssetRequest, AssetSpec } from "@house/contracts";
import { checkBpyCode } from "./bpyGuard";
import { BlenderError, MEASURE_SCRIPT, type BlenderPort } from "./blender";
import type { AgentModel } from "./model";
import { FatalToolError, runToolLoop, type AgentTool, type LoopResult } from "./toolLoop";

const dimsText = (d: readonly number[]) => d.map((n) => n.toFixed(2)).join(" x ");
const user = (content: string): ResponseInputItem => ({ role: "user", content });

// =============================================================================
// Selection agent: judgment on the "ambiguous" retrieval band
// =============================================================================

export type Selection =
  | { kind: "chosen"; assetId: string; reason: string }
  | { kind: "generate"; reason: string }
  | { kind: "reject"; reason: string };

const SELECT_INSTRUCTIONS = `You pick a 3D asset for a room-design request from a short list of existing library assets.
The list was pre-filtered for category and size, and scored by deterministic code; scores in the 0.5-0.75 range mean "uncertain", which is why you are asked.
Choose an asset only if a person would accept it as the requested item: same kind of object, plausible style/materials, sensible proportions. A weak substitute is worse than building a new one.
Call exactly one tool. Use only asset ids from the list.`;

export async function selectCandidate(params: {
  model: AgentModel;
  request: AssetRequest;
  candidates: AssetCandidate[];
  catalog: AssetSpec[];
  signal?: AbortSignal;
}): Promise<{ selection: Selection | null; loop: LoopResult<Selection> }> {
  const { model, request, candidates, catalog, signal } = params;
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const listed = candidates.map((c) => {
    const a = byId.get(c.assetId);
    return {
      assetId: c.assetId, title: a?.title, category: a?.category, sizeMeters: a ? dimsText(a.dimensionsM) : undefined,
      styles: a?.styles, colors: a?.colors, materials: a?.materials, description: a?.searchableDescription,
      source: a?.source, score: Number(c.score.toFixed(2)), scoreBreakdown: c.breakdown,
    };
  });
  const knownIds = new Set(candidates.map((c) => c.assetId));
  const tools: AgentTool<Selection>[] = [
    {
      name: "choose_asset",
      description: "Use one of the listed assets for this request.",
      parameters: { type: "object", properties: { assetId: { type: "string" }, reason: { type: "string" } }, required: ["assetId", "reason"], additionalProperties: false },
      schema: z.object({ assetId: z.string(), reason: z.string().max(500) }),
      async run(args: { assetId: string; reason: string }) {
        if (!knownIds.has(args.assetId)) return { output: { ok: false, error: "assetId is not in the candidate list." } };
        return { output: { ok: true }, done: { kind: "chosen", assetId: args.assetId, reason: args.reason } };
      },
    },
    request.allowGeneration
      ? {
          name: "request_generation",
          description: "None of the listed assets is acceptable; build a new model instead.",
          parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
          schema: z.object({ reason: z.string().max(500) }),
          async run(args: { reason: string }) { return { output: { ok: true }, done: { kind: "generate", reason: args.reason } }; },
        }
      : {
          name: "reject_all",
          description: "None of the listed assets is acceptable and nothing can be generated; show a simple placeholder.",
          parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
          schema: z.object({ reason: z.string().max(500) }),
          async run(args: { reason: string }) { return { output: { ok: true }, done: { kind: "reject", reason: args.reason } }; },
        },
  ];
  const loop = await runToolLoop<Selection>({
    model, instructions: SELECT_INSTRUCTIONS, tools, signal, options: { maxRounds: 3, maxToolCalls: 4 },
    input: [user(`Request:\n${JSON.stringify({ category: request.category, description: request.description, styles: request.styles, colors: request.colors, materials: request.materials, targetSizeMeters: dimsText(request.targetDimensionsM) + " (width x height x depth)" }, null, 2)}\n\nCandidates:\n${JSON.stringify(listed, null, 2)}`)],
  });
  return { selection: loop.done, loop };
}

// =============================================================================
// Generation agent: builds a model in Blender, submits it through the gate
// =============================================================================

export type Generated = { asset: AssetSpec; warnings: string[]; submissions: number };
export type GenerationLimits = { maxRounds: number; maxToolCalls: number; maxSubmissions: number };
export const DEFAULT_GENERATION_LIMITS: GenerationLimits = { maxRounds: 16, maxToolCalls: 32, maxSubmissions: 3 };

const generationInstructions = (request: AssetRequest) => `You are a 3D modeler building ONE furniture/decor model in Blender (Python API, bpy) for a room-design app. Tools run your Python inside a live Blender session.

Target: ${request.category}${request.description ? ` - ${request.description}` : ""}
Styles: ${request.styles.join(", ") || "unspecified"}; colors: ${request.colors.join(", ") || "unspecified"}; materials: ${request.materials.join(", ") || "unspecified"}.
Size the model should fill: width ${request.targetDimensionsM[0].toFixed(2)} m (Blender X), height ${request.targetDimensionsM[1].toFixed(2)} m (Blender Z, up), depth ${request.targetDimensionsM[2].toFixed(2)} m (Blender Y). The front of the object faces -Y.

Rules:
- Units are meters. Build a single standing object resting on the floor; no floor, walls, lights or cameras.
- Model it like the real object: legs, drawers/doors, cushions, handles, shelves, etc. Use primitives (bpy.ops.mesh.primitive_*), bmesh, and light modifiers (bevel, mirror). Keep it under ~30,000 triangles; avoid heavy subdivision.
- Give parts Principled BSDF materials with a base color and roughness that match the request. No image textures, no external files.
- Only 'import bpy', 'bmesh', 'mathutils', 'math', 'random' are allowed. Don't touch files, the OS, preferences or rendering; such code is rejected.
- Workflow: write code in a few steps, call measure_model to check the real size against the target, fix proportions, optionally view_model, then call submit_asset. If submit_asset reports problems, fix them and submit again.
- Reply with tool calls only; don't explain at length.`;

export async function generateAsset(params: {
  model: AgentModel;
  request: AssetRequest;
  blender: BlenderPort;
  registry: AssetRegistry;
  title?: string;
  limits?: GenerationLimits;
  signal?: AbortSignal;
}): Promise<{ generated: Generated | null; loop: LoopResult<Generated> | null; failure?: string }> {
  const { model, request, blender, registry, signal } = params;
  const limits = params.limits ?? DEFAULT_GENERATION_LIMITS;
  const title = params.title ?? (request.description.trim().slice(0, 60) || request.category);
  let submissions = 0;
  let executions = 0;
  const MAX_EXECUTIONS = 24;

  const blenderCall = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (error) {
      // An unreachable Blender can't be fixed by the model retrying; fail the job.
      if (error instanceof BlenderError && /Cannot reach|closed the connection|did not respond/.test(error.message)) throw new FatalToolError(error.message);
      throw error;
    }
  };

  const tools: AgentTool<Generated>[] = [
    {
      name: "run_blender_python",
      description: "Run Python (bpy) in the Blender session. Returns printed output or the error. State persists between calls.",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
      schema: z.object({ code: z.string() }),
      async run(args: { code: string }) {
        const guard = checkBpyCode(args.code);
        if (!guard.ok) return { output: { ok: false, rejected: true, error: guard.reason } };
        if (++executions > MAX_EXECUTIONS) return { output: { ok: false, error: "Code-execution budget used up. Call submit_asset with what you have, or stop." } };
        const result = await blenderCall(() => blender.runPython(args.code, signal));
        return { output: { ok: result.ok, output: result.output.slice(0, 2000) } };
      },
    },
    {
      name: "measure_model",
      description: "Measure all mesh objects in the scene: size as [width, height, depth] in meters, triangle count, and the lowest point.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      schema: z.object({}),
      async run() {
        const result = await blenderCall(() => blender.runPython(MEASURE_SCRIPT, signal));
        if (!result.ok) return { output: { ok: false, error: result.output.slice(0, 1000) } };
        try {
          const measured = JSON.parse(result.output.trim().split("\n").pop() ?? "{}");
          return { output: { ok: true, target_width_height_depth: request.targetDimensionsM, ...measured } };
        } catch { return { output: { ok: false, error: "Could not read measurements." } }; }
      },
    },
    {
      name: "view_model",
      description: "Get a screenshot of the Blender viewport to check how the model looks (only when the model supports images).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      schema: z.object({}),
      async run() {
        if (!model.supportsImages) return { output: { ok: false, error: "Image viewing is unavailable with this model; rely on measure_model." } };
        const png = await blenderCall(() => blender.screenshot(signal));
        return png ? { output: { ok: true }, imagePng: png } : { output: { ok: false, error: "Viewport screenshot is not available in this Blender session." } };
      },
    },
    {
      name: "submit_asset",
      description: "Export the current scene as GLB and submit it to the asset library. The library validates size, proportions, triangle and texture budgets. On success you are done; on failure fix the listed problems and submit again.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      schema: z.object({}),
      async run() {
        if (submissions >= limits.maxSubmissions) return { output: { ok: false, error: "No submissions left." } };
        submissions++;
        const glb = await blenderCall(() => blender.exportGlb(signal));
        const registered = await registry.registerGenerated({ glb, request, title });
        if (!registered.ok) return { output: { ok: false, problems: registered.errors, submissionsLeft: limits.maxSubmissions - submissions } };
        return { output: { ok: true, assetId: registered.asset.id }, done: { asset: registered.asset, warnings: registered.warnings, submissions } };
      },
    },
  ];

  try {
    await blenderCall(() => blender.reset(signal));
    const loop = await runToolLoop<Generated>({
      model, instructions: generationInstructions(request), tools, signal,
      options: { maxRounds: limits.maxRounds, maxToolCalls: limits.maxToolCalls },
      input: [user("Build the model now.")],
    });
    return loop.done
      ? { generated: loop.done, loop }
      : { generated: null, loop, failure: `Generation ended without an accepted model (${loop.endedBecause}).` };
  } catch (error) {
    if (error instanceof FatalToolError) return { generated: null, loop: null, failure: error.message };
    throw error;
  } finally {
    await blender.reset().catch(() => undefined);
  }
}
