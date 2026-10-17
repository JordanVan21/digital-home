import { z } from "zod";

export const UUIDSchema = z.string().uuid();
const finite = z.number().finite();
const positive = finite.positive();
const point = z.tuple([finite, finite]);
export const Vec3Schema = z.tuple([finite, finite, finite]);
export const QuatSchema = z
  .tuple([finite, finite, finite, finite])
  .refine(
    (q) => Math.abs(q.reduce((s, v) => s + v * v, 0) - 1) < 0.001,
    "Quaternion must be normalized",
  );
const dimensions = z.tuple([positive, positive, positive]);
export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: QuatSchema,
  scale: dimensions,
});
export const MoneySchema = z.object({
  currency: z.literal("USD"),
  minor: z.number().int().nonnegative(),
});
// Boundary-inclusive predicates used here are independent of the scene engine.
const cross = (a: number[], b: number[], c: number[]) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export const FloorPlanSchema = z
  .object({ polygonXZ: z.array(point).min(3), elevationY: finite })
  .superRefine(({ polygonXZ: p }, ctx) => {
    const area = p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    let invalid = Math.abs(area) < 1e-8;
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8) invalid = true;
      for (let j = i + 1; j < p.length; j++) {
        if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
        const c = p[j],
          d = p[(j + 1) % p.length];
        if (
          cross(a, b, c) * cross(a, b, d) <= 0 &&
          cross(c, d, a) * cross(c, d, b) <= 0 &&
          Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
            Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
          Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
            Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
        )
          invalid = true;
      }
    }
    if (invalid)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Floor must be a simple, nondegenerate polygon",
      });
  });
export const WallSchema = z
  .object({
    id: UUIDSchema,
    fromXZ: point,
    toXZ: point,
    heightM: positive,
    thicknessM: positive,
  })
  .refine(
    (w) => Math.hypot(w.toXZ[0] - w.fromXZ[0], w.toXZ[1] - w.fromXZ[1]) > 0,
    "Wall must have length",
  );
export const OpeningSchema = z.object({
  id: UUIDSchema,
  wallId: UUIDSchema,
  kind: z.enum(["door", "window"]),
  offsetM: finite.nonnegative(),
  widthM: positive,
  bottomM: finite.nonnegative(),
  heightM: positive,
});
export const RoomShellSchema = z
  .object({
    id: UUIDSchema,
    sourceScanId: UUIDSchema,
    coordinateVersion: z.literal(1),
    floor: FloorPlanSchema,
    walls: z.array(WallSchema),
    openings: z.array(OpeningSchema),
    ceilingHeightM: positive.optional(),
  })
  .superRefine((r, ctx) => {
    if (
      new Set(r.walls.map((w) => w.id)).size !== r.walls.length ||
      new Set(r.openings.map((o) => o.id)).size !== r.openings.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate structural IDs" });
    for (const o of r.openings) {
      const w = r.walls.find((w) => w.id === o.wallId);
      if (
        !w ||
        o.offsetM + o.widthM >
          Math.hypot(w.toXZ[0] - w.fromXZ[0], w.toXZ[1] - w.fromXZ[1]) + 1e-6 ||
        o.bottomM + o.heightM > w.heightM + 1e-6
      )
        ctx.addIssue({
          code: "custom",
          message: "Opening must fit its parent wall",
        });
    }
  });
export const MaterialOverridesSchema = z.record(
  z.object({
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    roughness: finite.min(0).max(1).optional(),
  }),
);
export const SceneObjectSchema = z.object({
  id: UUIDSchema,
  assetId: UUIDSchema.nullable(),
  category: z.string().min(1),
  transform: TransformSchema,
  dimensionsM: dimensions,
  locked: z.boolean(),
  source: z.enum(["roomplan_approximation", "catalog", "user", "agent"]),
  displayName: z.string().min(1),
  ownership: z.enum(["existing", "planned_new"]).optional(),
  replacesObjectId: UUIDSchema.optional(),
  renovationDecision: z.enum(["keep", "replace", "remove"]).optional(),
  materialOverrides: MaterialOverridesSchema.optional(),
  placement: z
    .object({
      support: z.enum(["floor", "wall", "object"]),
      parentId: UUIDSchema.optional(),
    })
    .optional(),
});
export const SceneSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: UUIDSchema,
    roomId: UUIDSchema,
    shellId: UUIDSchema,
    revision: z.number().int().nonnegative(),
    objects: z.array(SceneObjectSchema),
    lightingPreset: z.string(),
    updatedAt: z.string().datetime(),
  })
  .refine(
    (s) => new Set(s.objects.map((o) => o.id)).size === s.objects.length,
    "Duplicate object IDs",
  );
export const AssetSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id: UUIDSchema,
  category: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  styles: z.array(z.string()),
  colors: z.array(z.string()),
  materials: z.array(z.string()),
  dimensionsM: dimensions,
  glbStorageKey: z.string(),
  thumbnailStorageKey: z.string().optional(),
  source: z.enum(["furnimesh", "self_authored", "other", "generated"]),
  sourceUrl: z.string().url().optional(),
  licenseStatus: z.enum(["verified", "pending", "restricted"]),
  attribution: z.string().optional(),
  estimatedPrice: MoneySchema.optional(),
  triangleCount: z.number().int().nonnegative().optional(),
  textureBytes: z.number().int().nonnegative().optional(),
  contentHash: z.string(),
  searchableDescription: z.string(),
  embeddingVersion: z.string().optional(),
});
export const SceneOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), object: SceneObjectSchema }),
  z.object({ type: z.literal("delete"), objectId: UUIDSchema }),
  z.object({
    type: z.literal("move"),
    objectId: UUIDSchema,
    transform: TransformSchema,
  }),
  z.object({
    type: z.literal("replaceAsset"),
    objectId: UUIDSchema,
    assetId: UUIDSchema,
    dimensionsM: dimensions,
  }),
  z.object({
    type: z.literal("replacePhysicalItem"),
    oldObjectId: UUIDSchema,
    newObject: SceneObjectSchema,
  }),
  z.object({
    type: z.literal("changeMaterial"),
    objectId: UUIDSchema,
    overrides: MaterialOverridesSchema.optional(),
  }),
  z.object({
    type: z.literal("setLock"),
    objectId: UUIDSchema,
    locked: z.boolean(),
  }),
]);
export type Vec3 = z.infer<typeof Vec3Schema>;
export type Quat = z.infer<typeof QuatSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type Money = z.infer<typeof MoneySchema>;
export type FloorPlan = z.infer<typeof FloorPlanSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type RoomShell = z.infer<typeof RoomShellSchema>;
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type SceneSpec = z.infer<typeof SceneSpecSchema>;
export type AssetSpec = z.infer<typeof AssetSpecSchema>;
export type SceneOp = z.infer<typeof SceneOpSchema>;
