import { DEFAULT_OPTIONS, categoryAffinity, retrieveAsset, scoreAsset, type RetrieveOptions } from "@house/asset-service";
import type { AssetRequest, AssetSpec } from "@house/contracts";
import type { BlenderAccess } from "../src/agent";
import type { BlenderPort } from "../src/blender";
import { MEASURE_SCRIPT } from "../src/blender";
import type { AgentModel } from "../src/model";
import type { Path } from "./cases";

export type Decision = { path: Path | "none"; assetId?: string; usedOverrides?: boolean; firstCode?: string };
export type ProbeStats = { requests: number; inputTokens: number; outputTokens: number; calls: string[]; refused: number; decision: Decision | null };

class StopProbe extends Error {}
export const isStopProbe = (e: unknown) => e instanceof StopProbe;

/**
 * Wraps a real model and stops the run at its first COMMITMENT tool call: an accepted
 * use_asset, a Blender modify/create intent the code would allow, or a placeholder.
 * Calls the real code would refuse (wrong kind, weak score, blocked create) are not
 * commitments: they execute normally so the model sees the refusal, as in production.
 * Blender is never touched, so this measures decisions, not modeling.
 */
export function probeModel(model: AgentModel, request: AssetRequest, catalog: AssetSpec[], canBuild: boolean, retrieve: Partial<RetrieveOptions> = {}): AgentModel & { stats: ProbeStats } {
  const opts = { ...DEFAULT_OPTIONS, ...retrieve };
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const baseline = retrieveAsset(request, catalog, retrieve).resolution;
  const createAllowed = canBuild && baseline.status !== "matched";
  const stats: ProbeStats = { requests: 0, inputTokens: 0, outputTokens: 0, calls: [], refused: 0, decision: null };
  let imported = false;

  const evaluate = (name: string, args: any): Decision | "refused" | null => {
    switch (name) {
      case "use_asset": {
        const a = byId.get(args?.assetId);
        if (!a) return "refused";
        const scored = scoreAsset(request, a, opts);
        if ("rejection" in scored || scored.candidate.score < opts.generateBelow) return "refused";
        return { path: "reuse", assetId: a.id, usedOverrides: !!args.materialOverrides };
      }
      case "import_asset_to_blender": {
        const a = byId.get(args?.assetId);
        if (!canBuild || !a || a.licenseStatus !== "verified" || categoryAffinity(request.category, a.category) === 0) return "refused";
        imported = true;
        return { path: "modify", assetId: a.id };
      }
      case "run_blender_python":
      case "submit_asset":
        if (imported) return null;
        if (!createAllowed) return "refused";
        return { path: "create", firstCode: typeof args?.code === "string" ? args.code : undefined };
      case "use_placeholder":
        return { path: "placeholder" };
      default:
        return null;
    }
  };

  return {
    provider: model.provider, model: model.model, supportsImages: false, stats,
    async respond(input, instructions, tools, signal) {
      const reply = await model.respond(input, instructions, tools, signal);
      stats.requests++;
      stats.inputTokens += reply.usage.inputTokens;
      stats.outputTokens += reply.usage.outputTokens;
      for (const item of reply.output) {
        if (item.type !== "function_call") continue;
        stats.calls.push(item.name);
        let args: unknown = null;
        try { args = JSON.parse(item.arguments); } catch { /* the tool reports invalid arguments itself */ }
        const verdict = evaluate(item.name, args);
        if (verdict === "refused") { stats.refused++; continue; }
        if (verdict) { stats.decision = verdict; throw new StopProbe(); }
      }
      return reply;
    },
  };
}

/** Blender stand-in for probing: an empty scene. Any attempt to build is stopped by the probe before it runs. */
export const emptyBlender: BlenderAccess = {
  async lease() {
    const port: BlenderPort = {
      async runPython(code) { return { ok: true, output: code === MEASURE_SCRIPT ? JSON.stringify({ mesh_objects: 0 }) : "" }; },
      async screenshot() { return null; },
      async exportGlb() { throw new Error("probe: Blender export must not be reached"); },
      async importGlb() { throw new Error("probe: Blender import must not be reached"); },
      async reset() {},
    };
    return { port, release() {} };
  },
};
