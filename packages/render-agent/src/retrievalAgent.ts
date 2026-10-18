import type { ResponseInputItem } from "openai/resources/responses/responses";
import { z } from "zod";
import type { AssetCandidate, AssetRequest, AssetSpec } from "@house/contracts";
import type { AgentModel } from "./model";
import { runToolLoop, type AgentTool, type LoopResult } from "./toolLoop";

const dimsText = (d: readonly number[]) => d.map((n) => n.toFixed(2)).join(" x ");

/** What the retrieval agent passes to the builder, so it does not start from scratch. */
export type Handoff = {
  /** Why reuse was ruled out. */
  reason: string;
  /** The library asset the retrieval agent thinks is closest, if any. Always one of the candidates. */
  baseAssetId?: string;
  /** What must change to match the request exactly, e.g. "make it L-shaped with a chaise". */
  change?: string;
  candidates: HandoffCandidate[];
};
export type HandoffCandidate = { assetId: string; title: string; category: string; sizeMeters: string; score: number; breakdown: AssetCandidate["breakdown"] };

export type RetrievalPick =
  | { kind: "choose"; assetId: string; reason: string }
  | { kind: "build"; handoff: Handoff }
  | { kind: "reject"; reason: string };

export function describeCandidates(candidates: AssetCandidate[], byId: Map<string, AssetSpec>): HandoffCandidate[] {
  return candidates.flatMap((c) => {
    const a = byId.get(c.assetId);
    return a ? [{ assetId: a.id, title: a.title, category: a.category, sizeMeters: dimsText(a.dimensionsM), score: Number(c.score.toFixed(2)), breakdown: c.breakdown }] : [];
  });
}

const INSTRUCTIONS = `You are the retrieval agent of a room-design app. A library search found candidates for one item, but none scored as a confident match. Decide: use a candidate as-is, or send the item to the 3D builder.

The user's description is the exact request, so fit it exactly. Choose a candidate only if it satisfies everything the request specifies: the kind of item, its form and proportions, and any style, color or material it names. If the request names something the candidate does not confirm or contradicts, or the candidate is only a substitute of another kind, send it to the builder, which can modify the closest asset or create a new model in Blender. Building is cheap enough here; a near-miss is not.
Scores are 0-1 (category affinity x weighted size/style/color/material/text fit). The breakdown shows why a candidate is uncertain: category<1 means a substitute kind, size is how well it fills the required envelope, style/color/material of 0 mean a stated conflict and ~0.6 means the library has no information, text is wording overlap.
When you send to the builder, name the closest candidate as baseAssetId when one is worth modifying, and say in "change" what must differ from it. Call exactly one tool.`;

/**
 * The router's retrieval agent: a short, one-shot judgment over pre-scored candidates.
 * Code has already filtered for kind and size; this decides reuse vs build.
 */
export async function runRetrievalAgent(params: {
  model: AgentModel;
  request: AssetRequest;
  candidates: HandoffCandidate[];
  /** False when the builder is unavailable or generation is forbidden: reuse or placeholder only. */
  canBuild: boolean;
  signal?: AbortSignal;
}): Promise<{ pick: RetrievalPick | null; loop: LoopResult<RetrievalPick> }> {
  const { model, request, candidates, canBuild, signal } = params;
  const known = new Map(candidates.map((c) => [c.assetId, c]));
  const tools: AgentTool<RetrievalPick>[] = [
    {
      name: "choose_asset",
      description: "Use one of the listed assets as-is for this item.",
      parameters: { type: "object", properties: { assetId: { type: "string" }, reason: { type: "string" } }, required: ["assetId", "reason"], additionalProperties: false },
      schema: z.object({ assetId: z.string(), reason: z.string().max(500) }),
      async run(args: { assetId: string; reason: string }) {
        if (!known.has(args.assetId)) return { output: { ok: false, error: "assetId is not in the candidate list." } };
        return { output: { ok: true }, done: { kind: "choose", assetId: args.assetId, reason: args.reason } };
      },
    },
    canBuild
      ? {
          name: "send_to_builder",
          description: "No candidate fits exactly. Hand the item to the 3D builder (modify a close asset or create a new model), with a hand-off note.",
          parameters: {
            type: "object", additionalProperties: false, required: ["reason", "change"],
            properties: { reason: { type: "string" }, baseAssetId: { type: "string", description: "Closest candidate worth modifying, if any" }, change: { type: "string", description: "What must differ from the base (or what to build)" } },
          },
          schema: z.object({ reason: z.string().max(500), baseAssetId: z.string().optional(), change: z.string().max(500) }),
          async run(args: { reason: string; baseAssetId?: string; change: string }) {
            if (args.baseAssetId && !known.has(args.baseAssetId)) return { output: { ok: false, error: "baseAssetId must be one of the listed candidates." } };
            return { output: { ok: true }, done: { kind: "build", handoff: { reason: args.reason, baseAssetId: args.baseAssetId, change: args.change, candidates } } };
          },
        }
      : {
          name: "reject_all",
          description: "No candidate fits and nothing can be built; the editor will show a simple placeholder.",
          parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
          schema: z.object({ reason: z.string().max(500) }),
          async run(args: { reason: string }) { return { output: { ok: true }, done: { kind: "reject", reason: args.reason } }; },
        },
  ];
  const input: ResponseInputItem[] = [{
    role: "user",
    content: `Item: ${JSON.stringify({ category: request.category, description: request.description, styles: request.styles, colors: request.colors, materials: request.materials, mustFitMeters: dimsText(request.targetDimensionsM) + " (width x height x depth)" })}\n\nCandidates (best first):\n${JSON.stringify(candidates, null, 2)}`,
  }];
  const loop = await runToolLoop<RetrievalPick>({ model, instructions: INSTRUCTIONS, tools, input, signal, options: { maxRounds: 3, maxToolCalls: 4 } });
  return { pick: loop.done, loop };
}
