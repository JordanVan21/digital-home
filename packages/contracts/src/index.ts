/**
 * House shared contracts (CONTRACTS.md v1.1). Zod schemas are the executable authority;
 * TypeScript types are inferred from them. Additive extensions not yet in CONTRACTS.md
 * are marked `CONTRACT-TBD` (see agent_docs/SANDBOX_NOTES.md).
 *
 * Conventions: meters; right-handed, Y up, X right, Z forward; floor at y = 0.
 * Vec3 dimension order is [x = width, y = height, z = depth].
 * Stored rotations are quaternions [x, y, z, w]; MVP objects rotate about +Y only.
 */
import { z } from 'zod';

const finite = z.number().finite();

export const UUIDSchema = z.string().uuid();
export const Vec2Schema = z.tuple([finite, finite]);
export const Vec3Schema = z.tuple([finite, finite, finite]);
export const QuatSchema = z.tuple([finite, finite, finite, finite]);
export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: QuatSchema,
  scale: Vec3Schema,
});
export const MoneySchema = z.object({
  currency: z.literal('USD'),
  minor: z.number().int().nonnegative(),
});

export type UUID = string;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Transform = z.infer<typeof TransformSchema>;
export type Money = z.infer<typeof MoneySchema>;

// ---------------------------------------------------------------- Room shell
export const FloorPlanSchema = z.object({
  /** Closed implicitly; >= 3 vertices, no self-intersections. */
  polygonXZ: z.array(Vec2Schema).min(3),
  elevationY: finite,
});
export const WallSchema = z.object({
  id: UUIDSchema,
  fromXZ: Vec2Schema,
  toXZ: Vec2Schema,
  heightM: finite.positive(),
  thicknessM: finite.nonnegative(),
});
export const OpeningSchema = z.object({
  id: UUIDSchema,
  wallId: UUIDSchema,
  /** CONTRACT-TBD: 'opening' (doorless passage, RoomPlan's third kind) is an approved additive extension. */
  kind: z.enum(['door', 'window', 'opening']),
  /** CONTRACT-TBD semantics: distance along the wall from `fromXZ` to the opening's near edge. */
  offsetM: finite.nonnegative(),
  widthM: finite.positive(),
  bottomM: finite.nonnegative(),
  heightM: finite.positive(),
  /** CONTRACT-TBD: door swing side when known. */
  swing: z.enum(['left', 'right', 'none']).optional(),
  /** CONTRACT-TBD: glazed doors/windows — number of glass panels and frame colour (rendering only). */
  glazing: z.object({ panels: z.number().int().min(1).max(8), frameColor: z.string().optional() }).optional(),
});
export const RoomShellSchema = z.object({
  id: UUIDSchema,
  sourceScanId: UUIDSchema,
  coordinateVersion: z.literal(1),
  floor: FloorPlanSchema,
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  ceilingHeightM: finite.positive().optional(),
});
export type FloorPlan = z.infer<typeof FloorPlanSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type RoomShell = z.infer<typeof RoomShellSchema>;

// ---------------------------------------------------------------- Scene
export const ObjectSourceSchema = z.enum(['roomplan_approximation', 'catalog', 'user', 'agent']);
export const RenovationDecisionSchema = z.enum(['keep', 'replace', 'remove']);
/** CONTRACT-TBD: 'ceiling' added for pendants / hanging plants. */
export const SupportSchema = z.enum(['floor', 'wall', 'object', 'ceiling']);
/** CONTRACT-TBD: quarter turns about local X then Z, applied before yaw. Small decor only (books, frames, pillows). */
export const TiltSchema = z.object({ x: z.number().int().min(0).max(3), z: z.number().int().min(0).max(3) });
export const PlacementSchema = z.object({
  support: SupportSchema,
  parentId: UUIDSchema.optional(),
  /** CONTRACT-TBD: true = intentionally floating; gravity settling is skipped. */
  float: z.boolean().optional(),
});

/** RoomPlan CapturedRoom.Object.Category values. */
export const RoomPlanCategorySchema = z.enum([
  'storage', 'refrigerator', 'stove', 'bed', 'sink', 'washerDryer', 'toilet', 'bathtub',
  'oven', 'dishwasher', 'table', 'sofa', 'chair', 'fireplace', 'television', 'stairs',
]);
export type RoomPlanCategory = z.infer<typeof RoomPlanCategorySchema>;

/** CONTRACT-TBD: provenance of a scan-reproduced object. */
export const ScanMatchSchema = z.object({
  roomPlanCategory: RoomPlanCategorySchema,
  scanDimensionsM: Vec3Schema,
  /** Relative-error fit score in [0, 1]; 1 = exact. Not a calibrated probability. */
  score: z.number().min(0).max(1),
});

export const MaterialOverridesSchema = z.record(
  z.object({ colorHex: z.string().optional(), roughness: z.number().optional() }),
);

export const SceneObjectSchema = z.object({
  id: UUIDSchema,
  assetId: UUIDSchema.nullable(),
  category: z.string().min(1),
  transform: TransformSchema,
  /** Final world-space size [w, h, d]; the only size geometry rules use. */
  dimensionsM: Vec3Schema,
  locked: z.boolean(),
  source: ObjectSourceSchema,
  displayName: z.string(),
  ownership: z.enum(['existing', 'planned_new']).optional(),
  replacesObjectId: UUIDSchema.optional(),
  renovationDecision: RenovationDecisionSchema.optional(),
  materialOverrides: MaterialOverridesSchema.optional(),
  placement: PlacementSchema.optional(),
  scanMatch: ScanMatchSchema.optional(), // CONTRACT-TBD
  tilt: TiltSchema.optional(), // CONTRACT-TBD
  /** CONTRACT-TBD: persistent editor group (e.g. a table setting); selecting one member selects the group. */
  groupId: UUIDSchema.optional(),
  /** CONTRACT-TBD: light-emitting assets; absent = on. */
  lightOn: z.boolean().optional(),
});
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type RenovationDecision = z.infer<typeof RenovationDecisionSchema>;
export type Support = z.infer<typeof SupportSchema>;
export type ScanMatch = z.infer<typeof ScanMatchSchema>;
export type Tilt = z.infer<typeof TiltSchema>;
export type Placement = z.infer<typeof PlacementSchema>;

/**
 * CONTRACT-TBD: per-scene shell appearance. Stored on the SceneSpec, NOT on the immutable RoomShell —
 * it changes paint/finish only, never geometry.
 */
export const SceneAppearanceSchema = z.object({
  wallColor: z.string().optional(),
  trimColor: z.string().optional(),
  floorMaterial: z.string().optional(),
});
export type SceneAppearance = z.infer<typeof SceneAppearanceSchema>;

export const SceneSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id: UUIDSchema,
  roomId: UUIDSchema,
  shellId: UUIDSchema,
  /** Optimistic concurrency; starts at 0. */
  revision: z.number().int().nonnegative(),
  objects: z.array(SceneObjectSchema),
  /** 'day' | 'evening' | 'golden' (legacy 'warm-interior' = 'day'). */
  lightingPreset: z.string(),
  appearance: SceneAppearanceSchema.optional(), // CONTRACT-TBD
  updatedAt: z.string().datetime(),
});
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

// ---------------------------------------------------------------- Assets
export const PlacementClassSchema = z.enum(['floor', 'flat', 'surface', 'wall', 'ceiling']);

/** Box in object-local, size-normalised coordinates: x, z ∈ [−0.5, 0.5] (× w, d), y ∈ [0, 1] (× h). */
export const NormBoxSchema = z.object({ min: Vec3Schema, max: Vec3Schema });
export type NormBox = z.infer<typeof NormBoxSchema>;
export const CollisionKindSchema = z.enum(['solid', 'table', 'chair', 'open', 'flat', 'soft', 'none']);
export type CollisionKind = z.infer<typeof CollisionKindSchema>;
/** CONTRACT-TBD: compound collision shape; omitted fields fall back to category defaults. */
export const CollisionProfileSchema = z.object({
  kind: CollisionKindSchema,
  boxes: z.array(NormBoxSchema).optional(),
  /** table: top slab thickness (m). open: board thickness (m). */
  slabM: z.number().positive().optional(),
  /** open: board heights, normalised (0..1). */
  boards: z.array(z.number().min(0).max(1)).optional(),
});
export type CollisionProfile = z.infer<typeof CollisionProfileSchema>;
/** CONTRACT-TBD: a surface other objects can rest on. y and polygon are normalised like NormBox. */
export const SupportSurfaceSchema = z.object({
  id: z.string(),
  y: z.number().min(0).max(1),
  polygon: z.array(Vec2Schema).min(3).optional(),
  maxItemHeightM: z.number().positive().optional(),
});
export type SupportSurfaceDef = z.infer<typeof SupportSurfaceSchema>;
/** CONTRACT-TBD: light emitted by an asset (lamps, lanterns, pendants). position normalised like NormBox. */
export const AssetLightSchema = z.object({
  kind: z.enum(['point', 'spot']),
  color: z.string(),
  intensity: z.number().nonnegative(),
  distanceM: z.number().positive().optional(),
  position: Vec3Schema,
  /** Material names that glow when the light is on. */
  emissiveMaterials: z.array(z.string()).optional(),
});
export type AssetLight = z.infer<typeof AssetLightSchema>;
/** CONTRACT-TBD: colour/finish variant, applied via SceneObject.materialOverrides. */
export const AssetVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  swatch: z.string(),
  overrides: MaterialOverridesSchema,
});
export type AssetVariant = z.infer<typeof AssetVariantSchema>;
export type PlacementClass = z.infer<typeof PlacementClassSchema>;

export const AssetSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id: UUIDSchema,
  category: z.string().min(1),
  title: z.string(),
  tags: z.array(z.string()),
  styles: z.array(z.string()),
  colors: z.array(z.string()),
  materials: z.array(z.string()),
  /** [x width, y height, z depth], already normalized. */
  dimensionsM: Vec3Schema,
  glbStorageKey: z.string().min(1),
  thumbnailStorageKey: z.string().optional(),
  source: z.enum(['furnimesh', 'self_authored', 'other', 'generated']),
  sourceUrl: z.string().url().optional(),
  licenseStatus: z.enum(['verified', 'pending', 'restricted']),
  attribution: z.string().optional(),
  estimatedPrice: MoneySchema.optional(),
  triangleCount: z.number().int().nonnegative().optional(),
  textureBytes: z.number().int().nonnegative().optional(),
  contentHash: z.string().min(1),
  searchableDescription: z.string(),
  embeddingVersion: z.string().optional(),
  /** CONTRACT-TBD: overrides the category's default placement class. */
  placementClass: PlacementClassSchema.optional(),
  /** CONTRACT-TBD: model-space direction the asset's front faces. Default '+Z'. */
  frontAxis: z.enum(['+Z', '-Z', '+X', '-X']).optional(),
  /** CONTRACT-TBD: license name for display (e.g. 'CC0-1.0'). */
  license: z.string().optional(),
  collision: CollisionProfileSchema.optional(), // CONTRACT-TBD
  supports: z.array(SupportSurfaceSchema).optional(), // CONTRACT-TBD
  light: AssetLightSchema.optional(), // CONTRACT-TBD
  variants: z.array(AssetVariantSchema).optional(), // CONTRACT-TBD
  /** CONTRACT-TBD: default true; small decor sets false (shadow budget). */
  castShadow: z.boolean().optional(),
  /** CONTRACT-TBD: may be tilted in 90° steps (books, frames, pillows). */
  tiltable: z.boolean().optional(),
});
export type AssetSpec = z.infer<typeof AssetSpecSchema>;

export const AssetCatalogFileSchema = z.object({
  schemaVersion: z.literal(1),
  assets: z.array(AssetSpecSchema),
});
export type AssetCatalogFile = z.infer<typeof AssetCatalogFileSchema>;

// ---------------------------------------------------------------- Operations
export const SceneOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), object: SceneObjectSchema }),
  z.object({ type: z.literal('delete'), objectId: UUIDSchema }),
  z.object({ type: z.literal('move'), objectId: UUIDSchema, transform: TransformSchema }),
  z.object({
    type: z.literal('replaceAsset'), objectId: UUIDSchema,
    /** CONTRACT-TBD: nullable so swapping a placeholder to a model has an expressible inverse. */
    assetId: UUIDSchema.nullable(), dimensionsM: Vec3Schema,
  }),
  z.object({ type: z.literal('replacePhysicalItem'), oldObjectId: UUIDSchema, newObject: SceneObjectSchema }),
  z.object({ type: z.literal('changeMaterial'), objectId: UUIDSchema, overrides: MaterialOverridesSchema.optional() }),
  z.object({ type: z.literal('setLock'), objectId: UUIDSchema, locked: z.boolean() }),
  /** CONTRACT-TBD: re-parent / change support / float (no transform change; transforms are world-space). */
  z.object({ type: z.literal('setPlacement'), objectId: UUIDSchema, placement: PlacementSchema }),
  /** CONTRACT-TBD: change the object's world size (same asset; renderer re-fits). */
  z.object({ type: z.literal('resize'), objectId: UUIDSchema, dimensionsM: Vec3Schema }),
  /** CONTRACT-TBD: decor orientation in 90° steps. */
  z.object({ type: z.literal('setTilt'), objectId: UUIDSchema, tilt: TiltSchema }),
  /** CONTRACT-TBD: (un)group objects; allowed on locked objects (organisation, not editing). */
  z.object({ type: z.literal('setGroup'), objectIds: z.array(UUIDSchema).min(1), groupId: UUIDSchema.nullable() }),
  /** CONTRACT-TBD: lamp switch; allowed on locked objects. */
  z.object({ type: z.literal('setLight'), objectId: UUIDSchema, on: z.boolean() }),
  /** CONTRACT-TBD: scene-level lighting preset and shell appearance (never shell geometry). */
  z.object({ type: z.literal('setSceneSettings'), lightingPreset: z.string().optional(), appearance: SceneAppearanceSchema.optional() }),
  /** CONTRACT-TBD: planning flag; allowed on locked objects. `null` clears it. */
  z.object({
    type: z.literal('setRenovationDecision'), objectId: UUIDSchema,
    decision: RenovationDecisionSchema.nullable(),
  }),
]);
export type SceneOp = z.infer<typeof SceneOpSchema>;
export type SceneOpType = SceneOp['type'];

export const ScenePatchSchema = z.object({
  schemaVersion: z.literal(1),
  id: UUIDSchema,
  roomId: UUIDSchema,
  baseSceneVersionId: UUIDSchema,
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(SceneOpSchema),
});
export type ScenePatch = z.infer<typeof ScenePatchSchema>;

export const ErrorCodeSchema = z.enum([
  'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'VALIDATION_ERROR',
  'ASSET_UNAVAILABLE', 'GENERATION_FAILED', 'RATE_LIMITED',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ---------------------------------------------------------------- Persistence (CONTRACT-TBD transport shape)
/** Logical `saveScenePatch` request (CONTRACTS §5). */
export type SaveScenePatchRequest = {
  roomId: UUID;
  baseRevision: number;
  idempotencyKey: string;
  operations: SceneOp[];
};
export type SaveScenePatchResult =
  | { ok: true; revision: number; scene: SceneSpec }
  | { ok: false; code: 'CONFLICT'; currentRevision: number }
  | { ok: false; code: Exclude<ErrorCode, 'CONFLICT'>; message: string };

// ---------------------------------------------------------------- Fixtures (CONTRACT-TBD)
/** A room bundle: the immutable shell plus its working scene. */
export const RoomFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  shell: RoomShellSchema,
  scene: SceneSpecSchema,
  /** Fixture-only: camera matching a reference photo ("Match photo" preset). */
  photoCamera: z.object({ position: Vec3Schema, target: Vec3Schema, fov: z.number().positive() }).optional(),
  /** Fixture-only: repo-relative path of the reference image this scene reproduces. */
  referenceImage: z.string().optional(),
});
export type RoomFixture = z.infer<typeof RoomFixtureSchema>;

/** Raw-ish RoomPlan object after coordinate normalization, before asset matching. */
export const ScanObjectSchema = z.object({
  scanObjectId: UUIDSchema,
  category: RoomPlanCategorySchema,
  dimensionsM: Vec3Schema,
  transform: TransformSchema,
});
export type ScanObject = z.infer<typeof ScanObjectSchema>;

export const ScanFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  roomId: UUIDSchema,
  shell: RoomShellSchema,
  scanObjects: z.array(ScanObjectSchema),
});
export type ScanFixture = z.infer<typeof ScanFixtureSchema>;
