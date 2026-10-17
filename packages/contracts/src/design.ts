import { z } from "zod";
import { UUID, Vec3, Money } from "./primitives";
import { ScenePatch } from "./scene";

/** Style intake and AI proposal contracts. See CONTRACTS.md §2, §9. */
export const DesignBrief = z.object({
  schemaVersion: z.literal(1),
  roomId: UUID,
  styleTags: z.array(z.string()),
  palette: z.array(z.string()),
  preferredMaterials: z.array(z.string()),
  forms: z.array(z.string()),
  avoid: z.array(z.string()),
  priorities: z.array(z.string()),
  mustKeepObjectIds: z.array(UUID),
  freeText: z.string().optional(),
  monthlyBudget: Money.optional(), // explicit monthly savings contribution only
  monthlySpendingCap: Money.optional(),
  totalSpendingCap: Money.optional(),
  startingCash: Money.optional(),
  startDate: z.string().optional(),
  inspirationImageIds: z.array(UUID).optional(),
  questionnaireAnswers: z.record(z.string(), z.unknown()).optional(),
});
export type DesignBrief = z.infer<typeof DesignBrief>;

export const StyleTrait = z.object({
  value: z.string(),
  origin: z.enum(["questionnaire", "free_text", "inspiration_image", "inferred_default"]),
  sourceImageId: UUID.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type StyleTrait = z.infer<typeof StyleTrait>;

export const DesignInput = z.object({
  roomId: UUID,
  questionnaire: z.record(z.string(), z.unknown()).optional(),
  freeText: z.string().optional(),
  inspirationImageIds: z.array(UUID),
});
export type DesignInput = z.infer<typeof DesignInput>;

export const SemanticDesignItem = z.object({
  action: z.enum(["keep", "remove", "move", "replace", "add"]),
  objectId: UUID.optional(),
  desiredCategory: z.string().optional(),
  desiredStyleTags: z.array(z.string()).optional(),
  placementIntent: z.string().optional(),
  maxDimensionsM: Vec3.optional(),
});
export type SemanticDesignItem = z.infer<typeof SemanticDesignItem>;

export const SemanticDesignPlan = z.object({
  schemaVersion: z.literal(1),
  roomId: UUID,
  baseSceneVersionId: UUID,
  designBrief: DesignBrief,
  items: z.array(SemanticDesignItem),
  rationale: z.string(),
});
export type SemanticDesignPlan = z.infer<typeof SemanticDesignPlan>;

export const DesignProposal = z.object({
  schemaVersion: z.literal(1),
  id: UUID,
  roomId: UUID,
  baseSceneVersionId: UUID,
  patch: ScenePatch,
  status: z.enum(["planning", "ready", "failed", "accepted", "rejected", "stale"]),
  explanation: z.string(),
  estimatedAddedCost: Money,
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});
export type DesignProposal = z.infer<typeof DesignProposal>;
