import { z } from "zod";
import { UUID, Vec3, Transform, ISODateTime } from "./primitives";

/** See CONTRACTS.md §2-4. */
export const MaterialOverride = z.object({
  colorHex: z.string().optional(),
  roughness: z.number().min(0).max(1).optional(),
});

export const SceneObject = z.object({
  id: UUID,
  assetId: UUID.nullable(),
  category: z.string(),
  transform: Transform,
  dimensionsM: Vec3,
  locked: z.boolean(),
  source: z.enum(["roomplan_approximation", "catalog", "user", "agent"]),
  displayName: z.string(),
  ownership: z.enum(["existing", "planned_new"]).optional(),
  replacesObjectId: UUID.optional(),
  renovationDecision: z.enum(["keep", "replace", "remove"]).optional(),
  materialOverrides: z.record(z.string(), MaterialOverride).optional(),
  placement: z
    .object({
      support: z.enum(["floor", "wall", "object"]),
      parentId: UUID.optional(),
    })
    .optional(),
});
export type SceneObject = z.infer<typeof SceneObject>;

export const SceneSpec = z.object({
  schemaVersion: z.literal(1),
  id: UUID,
  roomId: UUID,
  shellId: UUID,
  revision: z.number().int().nonnegative(), // optimistic concurrency
  objects: z.array(SceneObject),
  lightingPreset: z.string(),
  updatedAt: ISODateTime,
});
export type SceneSpec = z.infer<typeof SceneSpec>;

/** Every mutating edit (user or agent) is expressed as one of these. */
export const SceneOp = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), object: SceneObject }),
  z.object({ type: z.literal("delete"), objectId: UUID }),
  z.object({ type: z.literal("move"), objectId: UUID, transform: Transform }),
  z.object({
    type: z.literal("replaceAsset"),
    objectId: UUID,
    assetId: UUID,
    dimensionsM: Vec3,
  }),
  z.object({
    type: z.literal("replacePhysicalItem"),
    oldObjectId: UUID,
    newObject: SceneObject,
  }),
  z.object({
    type: z.literal("changeMaterial"),
    objectId: UUID,
    overrides: z.record(z.string(), MaterialOverride),
  }),
  z.object({ type: z.literal("setLock"), objectId: UUID, locked: z.boolean() }),
]);
export type SceneOp = z.infer<typeof SceneOp>;

export const ScenePatch = z.object({
  schemaVersion: z.literal(1),
  id: UUID,
  roomId: UUID,
  baseSceneVersionId: UUID,
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(SceneOp),
});
export type ScenePatch = z.infer<typeof ScenePatch>;

export const SceneVersion = z.object({
  id: UUID,
  roomId: UUID,
  parentVersionId: UUID.optional(),
  snapshot: SceneSpec,
  createdAt: ISODateTime,
  source: z.enum(["import", "user", "accepted_proposal", "milestone_edit"]),
});
export type SceneVersion = z.infer<typeof SceneVersion>;
