import { z } from "zod";
import { UUIDSchema as UUID, Vec3Schema as Vec3 } from "./schemas";

/**
 * What the aesthetic planner or room scanner asks the asset builder for, and
 * what comes back. The builder's only job is to turn a request into an
 * `assetId` that resolves to a verified AssetSpec (and its stored GLB).
 */
export const AssetRequest = z.object({
  schemaVersion: z.literal(1),
  category: z.string().min(1),
  /** Free text, e.g. "walnut mid-century credenza with sliding doors". */
  description: z.string().default(""),
  styles: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  materials: z.array(z.string()).default([]),
  /** Envelope the item must fit: x width, y height, z depth, meters. */
  targetDimensionsM: Vec3,
  /** False = never trigger Blender generation; retrieval only. */
  allowGeneration: z.boolean().default(true),
});
export type AssetRequest = z.infer<typeof AssetRequest>;

export const ScoreBreakdown = z.object({
  /** Affinity of the asset's category to the requested one, 1 = exact. */
  category: z.number().min(0).max(1),
  size: z.number().min(0).max(1),
  /** Components the request did not specify are null (excluded from the mix). */
  style: z.number().min(0).max(1).nullable(),
  color: z.number().min(0).max(1).nullable(),
  material: z.number().min(0).max(1).nullable(),
  text: z.number().min(0).max(1).nullable(),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

export const AssetCandidate = z.object({
  assetId: UUID,
  /** Final score in [0,1]: category affinity x weighted soft score. */
  score: z.number().min(0).max(1),
  breakdown: ScoreBreakdown,
  /** Uniform scale the renderer would apply to fit the target envelope. */
  fitScale: z.number().positive(),
});
export type AssetCandidate = z.infer<typeof AssetCandidate>;

export const RejectionReason = z.enum([
  "not_verified",
  "category_mismatch",
  "scale_out_of_range",
  "proportions_mismatch",
]);
export type RejectionReason = z.infer<typeof RejectionReason>;

export const AssetResolution = z.discriminatedUnion("status", [
  /** Confident match: use `assetId`. */
  z.object({
    status: z.literal("matched"),
    assetId: UUID,
    score: z.number(),
    candidates: z.array(AssetCandidate),
  }),
  /**
   * Plausible but not convincing. Callers may rerank `candidates`, accept the
   * best, or (if allowed) request generation. `assetId` is the best candidate.
   */
  z.object({
    status: z.literal("ambiguous"),
    assetId: UUID,
    score: z.number(),
    candidates: z.array(AssetCandidate),
  }),
  /** Nothing good enough. Build one, or fall back to a placeholder. */
  z.object({
    status: z.literal("needs_generation"),
    reason: z.enum(["no_eligible_asset", "low_score"]),
    bestScore: z.number().nullable(),
    candidates: z.array(AssetCandidate),
    /** False when the request forbids generation: caller should show a placeholder. */
    generationAllowed: z.boolean(),
  }),
]);
export type AssetResolution = z.infer<typeof AssetResolution>;
