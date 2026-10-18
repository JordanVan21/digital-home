import { createHash } from "node:crypto";
import { retrieveAsset, type AssetRegistry, type GlbStore, type RetrieveOptions } from "@house/asset-service";
import { AssetRequest, type AssetSpec } from "@house/contracts";
import { DEFAULT_AGENT_LIMITS, runBuilderAgent, type AgentLimits } from "./agent";
import type { BlenderPool } from "./blender";
import type { AgentModel } from "./model";
import { describeCandidates, runRetrievalAgent, type Handoff } from "./retrievalAgent";

export type OutcomeSource =
  | "retrieved"   // confident match, no model involved
  | "reused"      // the retrieval agent chose a library asset as-is
  | "modified"    // the builder edited a library asset into a new derived asset
  | "generated"   // the builder created a new asset from scratch
  | "best_effort" // no model, or the agents failed: best uncertain candidate
  | "placeholder";

export type RenderOutcome = {
  /** Stable key of the request; identical requests share one job. */
  key: string;
  request: AssetRequest;
  /** null = no asset: the frontend keeps showing its approximate placeholder. */
  assetId: string | null;
  asset: AssetSpec | null;
  source: OutcomeSource;
  derivedFromAssetId?: string;
  /** Human-readable account of what happened, in order. */
  notes: string[];
  retrieval: "matched" | "ambiguous" | "needs_generation";
  usage: { modelRequests: number; inputTokens: number; outputTokens: number };
};

export type RenderServiceDeps = {
  /** Bundled catalog plus generated assets; called per job so new assets are visible immediately. */
  catalog: () => Promise<AssetSpec[]>;
  registry: AssetRegistry;
  store: GlbStore;
  /** null = deterministic only: no judgment, no modifying, no building. */
  model: AgentModel | null;
  /** null = modifying and building unavailable. */
  blender: BlenderPool | null;
  retrieve?: Partial<RetrieveOptions>;
  limits?: AgentLimits;
  /** Skip the model when retrieval is already confident. Off = the retrieval agent also reviews confident matches. */
  fastPath?: boolean;
  /** What to do with an "ambiguous" retrieval when no model is available. */
  ambiguousWithoutModel?: "accept_best" | "placeholder";
  /** Max items resolved at once; Blender use is serialized by the pool. */
  concurrency?: number;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sorted = (xs: string[]) => xs.map(norm).filter(Boolean).sort();

export function requestKey(request: AssetRequest): string {
  const canonical = JSON.stringify([
    norm(request.category).replace(/[\s-]+/g, "_"), norm(request.description), sorted(request.styles), sorted(request.colors),
    sorted(request.materials), request.targetDimensionsM.map((n) => Math.round(n * 100)), request.allowGeneration,
  ]);
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Bridges descriptions to renderable GLBs. A code router splits by similarity band:
 *   confident match            -> reuse (no model)
 *   uncertain                  -> retrieval agent: use a candidate as-is, or hand off to the builder
 *   nothing acceptable         -> builder agent (modify a close asset, or create) in Blender
 * Code enforces what is allowed (library membership, hard fit filters, thresholds, GLB
 * validation). Expected failures return a placeholder or best-effort outcome, never throw.
 */
export class RenderService {
  private inFlight = new Map<string, Promise<RenderOutcome>>();

  constructor(private readonly deps: RenderServiceDeps) {}

  resolve(input: AssetRequest, signal?: AbortSignal): Promise<RenderOutcome> {
    const request = AssetRequest.parse(input);
    const key = requestKey(request);
    // Identical concurrent requests (e.g. three matching chairs) share one job, so nothing is built twice.
    const running = this.inFlight.get(key);
    if (running) return running;
    const job = this.run(request, key, signal).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  /** Resolves in parallel up to `concurrency`; `onOutcome` fires as each finishes. Results keep input order. */
  async resolveMany(
    requests: AssetRequest[],
    onOutcome?: (outcome: RenderOutcome, index: number) => void,
    signal?: AbortSignal
  ): Promise<RenderOutcome[]> {
    const results = new Array<RenderOutcome>(requests.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(this.deps.concurrency ?? 4, requests.length) }, async () => {
      while (next < requests.length) {
        const index = next++;
        results[index] = await this.resolve(requests[index], signal);
        onOutcome?.(results[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private async run(request: AssetRequest, key: string, signal?: AbortSignal): Promise<RenderOutcome> {
    const { model, blender, registry, store } = this.deps;
    const notes: string[] = [];
    const usage = { modelRequests: 0, inputTokens: 0, outputTokens: 0 };
    const addUsage = (u?: { requests: number; inputTokens: number; outputTokens: number }) => {
      if (u) { usage.modelRequests += u.requests; usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; }
    };
    const catalog = await this.deps.catalog();
    const { resolution } = retrieveAsset(request, catalog, this.deps.retrieve);
    const byId = new Map(catalog.map((a) => [a.id, a]));
    const pick = (id: string) => byId.get(id) ?? null;
    const outcome = (source: OutcomeSource, asset: AssetSpec | null, extra: Partial<RenderOutcome> = {}): RenderOutcome =>
      ({ key, request, assetId: asset?.id ?? null, asset, source, notes, retrieval: resolution.status, usage, ...extra });
    const bestEffortOrPlaceholder = (why: string): RenderOutcome => {
      if (resolution.status !== "needs_generation" && this.deps.ambiguousWithoutModel !== "placeholder" && !signal?.aborted) {
        notes.push(`${why} Using the best retrieval candidate instead.`);
        return outcome("best_effort", pick(resolution.assetId));
      }
      notes.push(why);
      return outcome("placeholder", null);
    };

    // 1. Router: confident match, no model.
    if (resolution.status === "matched" && (this.deps.fastPath ?? true)) {
      notes.push(`Retrieved a confident match (score ${resolution.score.toFixed(2)}).`);
      return outcome("retrieved", pick(resolution.assetId));
    }
    const canBuild = !!model && !!blender && request.allowGeneration;

    // No model at all: deterministic fallbacks only.
    if (!model) {
      if (resolution.status === "matched") return outcome("retrieved", pick(resolution.assetId));
      if (resolution.status === "ambiguous") {
        return bestEffortOrPlaceholder(this.deps.ambiguousWithoutModel === "placeholder"
          ? "Match was uncertain and no model is available to judge it; using a placeholder."
          : `Match was uncertain (score ${resolution.score.toFixed(2)}) and no model is available to judge it.`);
      }
      notes.push("No library asset fits and no model is available to modify or create one; using a placeholder.");
      return outcome("placeholder", null);
    }

    // 2. Uncertain (or confident with the fast path off): the retrieval agent decides.
    let handoff: Handoff;
    if (resolution.status === "needs_generation") {
      notes.push(resolution.reason === "no_eligible_asset" ? "No library asset fits this category and size." : `Best library match was weak (score ${resolution.bestScore?.toFixed(2)}).`);
      handoff = { reason: resolution.reason === "no_eligible_asset" ? "no library asset of a compatible kind fits the required size" : "the best library match scored below the reuse threshold", candidates: describeCandidates(resolution.candidates, byId) };
    } else {
      try {
        const { pick: decision, loop } = await runRetrievalAgent({ model, request, candidates: describeCandidates(resolution.candidates, byId), canBuild, signal });
        addUsage(loop.usage);
        if (decision?.kind === "choose") {
          notes.push(`Retrieval agent chose "${pick(decision.assetId)?.title}": ${decision.reason}`);
          return outcome("reused", pick(decision.assetId));
        }
        if (decision?.kind === "reject") { notes.push(`Retrieval agent rejected every candidate and nothing can be built: ${decision.reason}`); return outcome("placeholder", null); }
        if (decision?.kind !== "build") return bestEffortOrPlaceholder("The retrieval agent gave no decision.");
        notes.push(`Retrieval agent sent the item to the builder: ${decision.handoff.reason}`);
        handoff = decision.handoff;
      } catch (error) {
        if (signal?.aborted) { notes.push("Aborted."); return outcome("placeholder", null); }
        return bestEffortOrPlaceholder(`Retrieval agent failed (${errorText(error)}).`);
      }
    }

    // 3. Builder: modify a close asset or create one.
    if (!request.allowGeneration) return bestEffortOrPlaceholder("Generation is not allowed for this request.");
    if (!canBuild) return bestEffortOrPlaceholder("Building is unavailable (no Blender configured).");
    try {
      // The pool is leased lazily by the builder, only when it first reaches for Blender.
      const built = await runBuilderAgent({
        model, request, catalog, registry, store, signal, handoff, blender: blender!,
        limits: this.deps.limits ?? DEFAULT_AGENT_LIMITS, retrieve: this.deps.retrieve,
      });
      addUsage(built.loop?.usage);
      if (built.result?.kind === "created") {
        const r = built.result;
        notes.push(`${r.derivedFromAssetId ? "Modified" : "Created"} "${r.asset.title}" after ${r.submissions} submission(s).`);
        for (const w of r.warnings) notes.push(`Warning: ${w}`);
        return outcome(r.derivedFromAssetId ? "modified" : "generated", r.asset, r.derivedFromAssetId ? { derivedFromAssetId: r.derivedFromAssetId } : {});
      }
      return bestEffortOrPlaceholder(built.result?.kind === "placeholder" ? `Builder chose a placeholder: ${built.result.reason}` : built.failure ?? "The builder produced no result.");
    } catch (error) {
      if (signal?.aborted) { notes.push("Aborted."); return outcome("placeholder", null); }
      return bestEffortOrPlaceholder(`Builder failed (${errorText(error)}).`);
    }
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "unknown error");
