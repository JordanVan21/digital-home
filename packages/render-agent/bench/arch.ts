import { retrieveAsset, type AssetRegistry, type GlbStore } from "@house/asset-service";
import type { AssetRequest, AssetSpec } from "@house/contracts";
import { runBuilderAgent } from "../src/agent";
import type { AgentModel } from "../src/model";
import { describeCandidates, runRetrievalAgent, type Handoff } from "../src/retrievalAgent";
import { emptyBlender, isStopProbe, probeModel, type Decision } from "./probe";

/**
 * Architectures that remain after the first benchmark (docs: bench/RESULTS.md):
 *  - B (production): code router -> retrieval agent (uncertain band) -> builder agent.
 *  - C: same router, but a rule accepts the best candidate in the uncertain band (no retrieval agent).
 * The unified-agent variants (A, A0) were retired and are not runnable from this code.
 */
export type ArchName = "B_router_plus_retrieval_agent" | "C_router_plus_rule";
export const ARCHS: ArchName[] = ["B_router_plus_retrieval_agent", "C_router_plus_rule"];

export type RunResult = { decision: Decision; requests: number; inputTokens: number; outputTokens: number; ms: number; stages: string[]; calls: string[]; refused: number };
type Ctx = { model: AgentModel; request: AssetRequest; catalog: AssetSpec[]; store: GlbStore; registry: AssetRegistry };

export async function runArch(arch: ArchName, ctx: Ctx): Promise<RunResult> {
  const started = Date.now();
  const { request, catalog } = ctx;
  const canBuild = request.allowGeneration;
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const { resolution } = retrieveAsset(request, catalog);
  const res: RunResult = { decision: { path: "none" }, requests: 0, inputTokens: 0, outputTokens: 0, ms: 0, stages: [], calls: [], refused: 0 };
  const best = resolution.status === "needs_generation" ? undefined : resolution.assetId;
  const finish = (decision: Decision): RunResult => { res.decision = decision; res.ms = Date.now() - started; return res; };

  /** One probed builder run; its first commitment (modify / create / placeholder) becomes the decision. */
  const builder = async (handoff: Handoff): Promise<Decision> => {
    res.stages.push("builder-agent");
    const model = probeModel(ctx.model, request, catalog, canBuild);
    try {
      await runBuilderAgent({ model, request, catalog, registry: ctx.registry, store: ctx.store, blender: emptyBlender, handoff });
    } catch (error) {
      if (!isStopProbe(error)) throw error;
    }
    res.requests += model.stats.requests; res.inputTokens += model.stats.inputTokens; res.outputTokens += model.stats.outputTokens;
    res.calls.push(...model.stats.calls); res.refused += model.stats.refused;
    return model.stats.decision ?? { path: "none" };
  };

  if (resolution.status === "matched") { res.stages.push("fast-path"); return finish({ path: "reuse", assetId: best }); }
  if (resolution.status === "needs_generation") {
    if (!canBuild) { res.stages.push("rule:no-generation"); return finish({ path: "placeholder" }); }
    return finish(await builder({ reason: "no library asset passed the similarity threshold", candidates: describeCandidates(resolution.candidates, byId) }));
  }
  // ambiguous
  if (arch === "C_router_plus_rule") { res.stages.push("rule:accept-best"); return finish({ path: "reuse", assetId: best }); }
  res.stages.push("retrieval-agent");
  const { pick, loop } = await runRetrievalAgent({ model: ctx.model, request, candidates: describeCandidates(resolution.candidates, byId), canBuild });
  res.requests += loop.usage.requests; res.inputTokens += loop.usage.inputTokens; res.outputTokens += loop.usage.outputTokens;
  if (pick?.kind === "choose") return finish({ path: "reuse", assetId: pick.assetId });
  if (pick?.kind === "build" && canBuild) return finish(await builder(pick.handoff));
  return finish({ path: pick?.kind === "reject" ? "placeholder" : "none" });
}
