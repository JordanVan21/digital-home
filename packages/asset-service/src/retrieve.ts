import type {
  AssetCandidate,
  AssetRequest,
  AssetResolution,
  AssetSpec,
  RejectionReason,
  ScoreBreakdown,
} from "@house/contracts";
import { categoryAffinity } from "./categories";
import { requestTokens, tokenCoverage, tokens } from "./text";

export type RetrieveOptions = {
  topK: number;
  /** score >= accept => "matched". */
  acceptThreshold: number;
  /** score < generateBelow => "needs_generation"; in between => "ambiguous". */
  generateBelow: number;
  /** The renderer scales uniformly; reject models needing more shrink/stretch than this. */
  scaleRange: [number, number];
  /** Reject if any axis of the uniformly-scaled model fills < this share of the target. */
  minAxisFill: number;
  /** Component weights; unspecified components are dropped and the rest renormalized. */
  weights: { size: number; style: number; color: number; material: number; text: number };
  /** Score for an asset with no labels for a field the request specifies (unknown, not mismatch). */
  unknownLabelScore: number;
};

/** Starting values only: tune against src/eval/requests.json, do not trust blindly. */
export const DEFAULT_OPTIONS: RetrieveOptions = {
  topK: 5,
  acceptThreshold: 0.75,
  generateBelow: 0.5,
  scaleRange: [0.5, 2],
  minAxisFill: 0.55,
  weights: { size: 0.3, style: 0.25, color: 0.1, material: 0.1, text: 0.25 },
  unknownLabelScore: 0.6,
};

export type Rejection = { assetId: string; reason: RejectionReason };

const lower = (xs: string[]) => xs.map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Share of the requested labels the asset carries; unknown if the asset is unlabeled. */
function labelScore(requested: string[], have: string[], unknown: number): number | null {
  const want = lower(requested);
  if (want.length === 0) return null;
  const owned = new Set(lower(have));
  if (owned.size === 0) return unknown;
  return want.filter((w) => owned.has(w)).length / want.length;
}

/**
 * True when the asset carries descriptive text beyond its own title/category
 * (e.g. an LLM-written description). Sparse assets can't confirm or contradict
 * descriptive words, so a text miss is "unknown", not a mismatch.
 */
function hasDescriptiveText(asset: AssetSpec): boolean {
  const known = new Set([...tokens(asset.title), ...tokens(asset.category.replace(/_/g, " "))]);
  return [...tokens(`${asset.searchableDescription} ${asset.tags.join(" ")}`)].some((t) => !known.has(t));
}

/** Uniform fit exactly as the renderer does it (AssetVisual: min of target/asset per axis). */
function fit(asset: AssetSpec, target: AssetRequest["targetDimensionsM"]) {
  const scale = Math.min(...target.map((t, i) => t / asset.dimensionsM[i]));
  const fills = asset.dimensionsM.map((a, i) => (a * scale) / target[i]);
  return { scale, minFill: Math.min(...fills), meanFill: fills.reduce((a, b) => a + b, 0) / 3 };
}

export function scoreAsset(
  request: AssetRequest,
  asset: AssetSpec,
  options: RetrieveOptions = DEFAULT_OPTIONS
): { candidate: AssetCandidate } | { rejection: Rejection } {
  const reject = (reason: RejectionReason) => ({ rejection: { assetId: asset.id, reason } });
  if (asset.licenseStatus !== "verified") return reject("not_verified");
  const affinity = categoryAffinity(request.category, asset.category);
  if (affinity === 0) return reject("category_mismatch");

  const { scale, minFill, meanFill } = fit(asset, request.targetDimensionsM);
  if (!(scale >= options.scaleRange[0] && scale <= options.scaleRange[1])) return reject("scale_out_of_range");
  if (minFill < options.minAxisFill) return reject("proportions_mismatch");

  const assetText = `${asset.title} ${asset.tags.join(" ")} ${asset.searchableDescription}`;
  const wanted = requestTokens(request.description, request.category);
  const coverage = wanted.size ? tokenCoverage(wanted, assetText) : null;
  const breakdown: ScoreBreakdown = {
    category: affinity,
    size: meanFill,
    style: labelScore(request.styles, asset.styles, options.unknownLabelScore),
    color: labelScore(request.colors, asset.colors, options.unknownLabelScore),
    material: labelScore(request.materials, asset.materials, options.unknownLabelScore),
    text: coverage === null ? null : hasDescriptiveText(asset) ? coverage : Math.max(coverage, options.unknownLabelScore),
  };
  const parts: [number | null, number][] = [
    [breakdown.size, options.weights.size],
    [breakdown.style, options.weights.style],
    [breakdown.color, options.weights.color],
    [breakdown.material, options.weights.material],
    [breakdown.text, options.weights.text],
  ];
  let sum = 0, weight = 0;
  for (const [value, w] of parts) if (value !== null) { sum += value * w; weight += w; }
  const score = affinity * (sum / weight);
  return { candidate: { assetId: asset.id, score, breakdown, fitScale: scale } };
}

export type RetrievalResult = { resolution: AssetResolution; rejections: Rejection[] };

/**
 * Hard filters (verified, category compatibility, scale/proportions) then a
 * weighted soft score, then a three-way decision. Pure and deterministic; the
 * catalog is passed in so the same code runs in worker, API and tests.
 */
export function retrieveAsset(
  request: AssetRequest,
  catalog: AssetSpec[],
  overrides: Partial<RetrieveOptions> = {}
): RetrievalResult {
  const options: RetrieveOptions = { ...DEFAULT_OPTIONS, ...overrides, weights: { ...DEFAULT_OPTIONS.weights, ...overrides.weights } };
  const candidates: AssetCandidate[] = [];
  const rejections: Rejection[] = [];
  for (const asset of catalog) {
    const r = scoreAsset(request, asset, options);
    if ("candidate" in r) candidates.push(r.candidate); else rejections.push(r.rejection);
  }
  // Ties broken by id so results are stable across catalog ordering.
  candidates.sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId));
  const top = candidates.slice(0, options.topK);
  const best = top[0];
  if (!best) {
    return { resolution: { status: "needs_generation", reason: "no_eligible_asset", bestScore: null, candidates: [], generationAllowed: request.allowGeneration }, rejections };
  }
  if (best.score >= options.acceptThreshold) {
    return { resolution: { status: "matched", assetId: best.assetId, score: best.score, candidates: top }, rejections };
  }
  if (best.score >= options.generateBelow) {
    return { resolution: { status: "ambiguous", assetId: best.assetId, score: best.score, candidates: top }, rejections };
  }
  return { resolution: { status: "needs_generation", reason: "low_score", bestScore: best.score, candidates: top, generationAllowed: request.allowGeneration }, rejections };
}
