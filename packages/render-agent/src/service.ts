import { createHash } from "node:crypto";
import { retrieveAsset, type AssetRegistry, type RetrieveOptions } from "@house/asset-service";
import { AssetRequest, type AssetResolution, type AssetSpec } from "@house/contracts";
import { generateAsset, selectCandidate, DEFAULT_GENERATION_LIMITS, type GenerationLimits } from "./agents";
import type { BlenderPool } from "./blender";
import type { AgentModel } from "./model";

export type OutcomeSource = "retrieved" | "model_selected" | "best_effort" | "generated" | "placeholder";

export type RenderOutcome = {
  /** Stable key of the request; identical requests share one outcome. */
  key: string;
  request: AssetRequest;
  /** null = no asset: the frontend keeps showing its approximate placeholder. */
  assetId: string | null;
  asset: AssetSpec | null;
  source: OutcomeSource;
  /** Human-readable account of what happened, in order. */
  notes: string[];
  retrieval: AssetResolution["status"];
  usage: { modelRequests: number; inputTokens: number; outputTokens: number };
};

export type RenderServiceDeps = {
  /** Bundled catalog plus generated assets; called per request so new assets are visible immediately. */
  catalog: () => Promise<AssetSpec[]>;
  registry: AssetRegistry;
  /** null = deterministic only: no selection judgment, no generation. */
  model: AgentModel | null;
  /** null = generation unavailable. */
  blender: BlenderPool | null;
  retrieve?: Partial<RetrieveOptions>;
  limits?: GenerationLimits;
  /** What to do with an "ambiguous" retrieval when no model can judge it. */
  ambiguousWithoutModel?: "accept_best" | "placeholder";
  /** Max requests resolved at once (retrieval and selection are cheap; Blender jobs queue in the pool). */
  concurrency?: number;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sorted = (xs: string[]) => xs.map(norm).filter(Boolean).sort();

export function requestKey(request: AssetRequest): string {
  const canonical = JSON.stringify([
    norm(request.category).replace(/[\s-]+/g, "_"), norm(request.description), sorted(request.styles), sorted(request.colors),
    sorted(request.materials), request.targetDimensionsM.map((n) => Math.round(n * 100)),
  ]);
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}

/**
 * The 3D render agent's entry point. Cheap deterministic retrieval first; a
 * model only judges uncertain matches and builds models when nothing fits, and
 * every generated model must pass the registry's validation before it can be used.
 * Expected failures (no model, no Blender, rejected model, aborted job) come back
 * as a placeholder outcome, never as a thrown error.
 */
export class RenderService {
  private inFlight = new Map<string, Promise<RenderOutcome>>();

  constructor(private readonly deps: RenderServiceDeps) {}

  resolve(input: AssetRequest, signal?: AbortSignal): Promise<RenderOutcome> {
    const request = AssetRequest.parse(input);
    const key = requestKey(request);
    // Identical concurrent requests (e.g. three matching chairs) share one job, so we never generate twice.
    const running = this.inFlight.get(key);
    if (running) return running;
    const job = this.run(request, key, signal).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  /** Resolves in parallel up to `concurrency`; `onOutcome` fires as each finishes, in completion order. */
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
    const { model, blender, registry } = this.deps;
    const notes: string[] = [];
    const usage = { modelRequests: 0, inputTokens: 0, outputTokens: 0 };
    const addUsage = (u: { requests: number; inputTokens: number; outputTokens: number }) => {
      usage.modelRequests += u.requests; usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens;
    };
    const catalog = await this.deps.catalog();
    const { resolution } = retrieveAsset(request, catalog, this.deps.retrieve);
    const byId = new Map(catalog.map((a) => [a.id, a]));
    const done = (source: OutcomeSource, asset: AssetSpec | null): RenderOutcome =>
      ({ key, request, assetId: asset?.id ?? null, asset, source, notes, retrieval: resolution.status, usage });
    const pick = (id: string) => byId.get(id) ?? null;

    let wantGeneration = false;
    if (resolution.status === "matched") {
      notes.push(`Retrieved a confident match (score ${resolution.score.toFixed(2)}).`);
      return done("retrieved", pick(resolution.assetId));
    }
    if (resolution.status === "ambiguous") {
      if (!model) {
        if (this.deps.ambiguousWithoutModel === "placeholder") {
          notes.push("Match was uncertain and no model is available to judge it; using a placeholder.");
          return done("placeholder", null);
        }
        notes.push(`Match was uncertain (score ${resolution.score.toFixed(2)}); no model available, using the best candidate.`);
        return done("best_effort", pick(resolution.assetId));
      }
      try {
        const { selection, loop } = await selectCandidate({ model, request, candidates: resolution.candidates, catalog, signal });
        addUsage(loop.usage);
        if (selection?.kind === "chosen") {
          notes.push(`Model chose "${pick(selection.assetId)?.title}": ${selection.reason}`);
          return done("model_selected", pick(selection.assetId));
        }
        if (selection?.kind === "generate") { notes.push(`Model rejected the candidates: ${selection.reason}`); wantGeneration = true; }
        else if (selection?.kind === "reject") { notes.push(`Model rejected the candidates and generation is not allowed: ${selection.reason}`); return done("placeholder", null); }
        else { notes.push("Model gave no decision; using the best candidate."); return done("best_effort", pick(resolution.assetId)); }
      } catch (error) {
        if (signal?.aborted) { notes.push("Aborted."); return done("placeholder", null); }
        notes.push(`Selection failed (${errorText(error)}); using the best candidate.`);
        return done("best_effort", pick(resolution.assetId));
      }
    } else {
      notes.push(resolution.reason === "no_eligible_asset" ? "No library asset fits this category and size." : `Best library match was weak (score ${resolution.bestScore?.toFixed(2)}).`);
      wantGeneration = true;
    }

    if (wantGeneration) {
      if (!request.allowGeneration) { notes.push("Generation is not allowed for this request; using a placeholder."); return done("placeholder", null); }
      if (!model || !blender) { notes.push("Generation is unavailable (no model or Blender configured); using a placeholder."); return done("placeholder", null); }
      try {
        const outcome = await blender.use((port) =>
          generateAsset({ model, request, blender: port, registry, limits: this.deps.limits ?? DEFAULT_GENERATION_LIMITS, signal }));
        if (outcome.loop) addUsage(outcome.loop.usage);
        if (outcome.generated) {
          notes.push(`Generated "${outcome.generated.asset.title}" after ${outcome.generated.submissions} submission(s).`);
          for (const w of outcome.generated.warnings) notes.push(`Warning: ${w}`);
          return done("generated", outcome.generated.asset);
        }
        notes.push(outcome.failure ?? "Generation failed.");
      } catch (error) {
        notes.push(signal?.aborted ? "Aborted." : `Generation failed (${errorText(error)}).`);
      }
      return done("placeholder", null);
    }
    return done("placeholder", null);
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "unknown error");
