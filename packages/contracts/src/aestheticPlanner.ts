import { z } from "zod";
import { UUIDSchema, Vec3Schema } from "./schemas";

export const DesignBriefSchema = z
  .object({
    schemaVersion: z.literal(1),
    roomId: UUIDSchema,
    styleTags: z.array(z.string()).min(1),
    palette: z.array(z.string()),
    preferredMaterials: z.array(z.string()),
    forms: z.array(z.string()),
    avoid: z.array(z.string()),
    priorities: z.array(z.string()),
    mustKeepObjectIds: z.array(UUIDSchema),
    lightingMood: z.array(z.string()),
    householdNeeds: z.array(z.string()),
    freeText: z.string(),
  })
  .strict();
export type DesignBrief = z.infer<typeof DesignBriefSchema>;

export const PlacementIntentSchema = z
  .object({
    zone: z.enum(["original", "center", "wall", "near", "on"]),
    wallId: UUIDSchema.optional(),
    anchorKey: z.string().optional(),
    relation: z
      .enum(["beside", "in_front_of", "faces", "near", "on"])
      .optional(),
  })
  .strict();
export type PlacementIntent = z.infer<typeof PlacementIntentSchema>;

export const SemanticDesignItemSchema = z
  .object({
    key: z.string().min(1).max(80),
    action: z.enum(["keep", "remove", "move", "replace", "add"]),
    objectId: UUIDSchema.optional(),
    desiredCategory: z.string().min(1).optional(),
    description: z.string().min(1).default("Existing item"),
    desiredStyleTags: z.array(z.string()).default([]),
    colors: z.array(z.string()).default([]),
    materials: z.array(z.string()).default([]),
    maxDimensionsM: Vec3Schema.refine((v) =>
      v.every((n) => n > 0 && n <= 12),
    ).optional(),
    placementIntent: PlacementIntentSchema.default({ zone: "original" }),
  })
  .strict();
export const SemanticDesignPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    roomId: UUIDSchema,
    rationale: z.string().min(1),
    items: z.array(SemanticDesignItemSchema).max(40),
  })
  .strict();
export type SemanticDesignItem = z.infer<typeof SemanticDesignItemSchema>;
export type SemanticDesignPlan = z.infer<typeof SemanticDesignPlanSchema>;

export const ReviewSchema = z
  .object({
    verdict: z.enum(["ready", "repair"]),
    scores: z
      .object({
        style: z.number().int().min(0).max(5),
        composition: z.number().int().min(0).max(5),
        usability: z.number().int().min(0).max(5),
      })
      .strict(),
    findings: z
      .array(
        z
          .object({
            objectKey: z.string(),
            issue: z.string(),
            repair: z.string(),
          })
          .strict(),
      )
      .max(5),
    revisedPlan: SemanticDesignPlanSchema.optional(),
  })
  .strict();
export type DesignReview = z.infer<typeof ReviewSchema>;

export const PriceRecordSchema = z
  .object({
    estimatedUnitCost: z
      .object({
        currency: z.literal("USD"),
        minor: z.number().int().nonnegative(),
      })
      .nullable(),
    priceStatus: z.enum(["estimated", "unknown"]),
    priceSource: z.string().optional(),
  })
  .refine(
    (p) =>
      p.priceStatus === "unknown"
        ? p.estimatedUnitCost === null
        : p.estimatedUnitCost !== null,
    "Unknown prices must be null; estimated prices need an amount",
  );
export type PriceRecord = z.infer<typeof PriceRecordSchema>;

export const ViewSchema = z
  .object({
    name: z.enum(["top", "angle-a", "angle-b"]),
    image: z
      .string()
      .max(1_500_000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
    unavailableObjectIds: z.array(UUIDSchema).default([]),
  })
  .strict();
export type RoomView = z.infer<typeof ViewSchema>;
export const ViewsSchema = z
  .array(ViewSchema)
  .length(3)
  .refine(
    (views) => new Set(views.map((v) => v.name)).size === 3,
    "Provide all three distinct camera views",
  );
