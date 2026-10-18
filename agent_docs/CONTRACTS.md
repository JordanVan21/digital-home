# House — Shared Contracts and Invariants

**Version:** 1.1 | **Last updated:** 2026-10-17 | **Status:** Implementation baseline

This document is the authority for cross-component data semantics. TypeScript samples are illustrative but sufficiently precise to implement as Zod schemas; Swift models should produce identical normalized JSON. Implement the schemas in `packages/contracts` and generate/verify interfaces. APIs should return typed errors, not unstructured text.

## 1. Coordinate and identity contract
- World distances **meters**; world axes **X right, Y up, Z forward**, positive yaw about Y; radians for rotation; R3F/Three convention. Transform origin in project-local room coordinates. Normalizer converts RoomPlan's coordinate reference into this convention exactly once. Maintain explicit scan-to-world transform and test known fiducials.
- `Object3D` transforms use position `[x,y,z]`, quaternion `[x,y,z,w]` for stored rotations (avoid Euler serialization ambiguity), scale `[x,y,z]` (positive only); UI may display Euler degrees.
- Authoritative structural geometry is parametric: floor polygon in XZ, wall segments (endpoints, thickness and height), doors/windows with parent wall and intervals/vertical dimensions. Scan importer validates closed polygon and rejects/flags overlaps/degenerate dimensions.
- Scene object UUID stays stable when moved/recolored; `replaceAsset` may retain UUID only for a *visual representation change of the same physical item*; physical replacement allocates a new UUID with `replacesObjectId` linking to the old item. All references use UUID, not array index.
- `assetId` references **immutable asset version**; content changes require new asset ID or revision. Storage object keys are server-managed, never user-supplied paths.
- All objects belong to one room; all milestones belong to one room; all DB records derive user ownership via project membership (MVP owner only).
- Use ISO 8601 UTC for created/updated timestamps, YYYY-MM-DD local planning dates, integer currency **minor units** (e.g., cents) and ISO currency codes. No binary GLB stored in JSON/SQL rows.

## 2. TypeScript domain types (normative shape)
```ts
type UUID = string; // UUID validated at boundary
type Vec3 = [number,number,number];
type Quat = [number,number,number,number];
type Transform = { position: Vec3; rotation: Quat; scale: Vec3 };
type Money = { currency: 'USD'; minor: number }; // MVP USD, >=0

type FloorPlan = {
  polygonXZ: [number,number][]; // closed implicitly; >=3 vertices, no self-intersections
  elevationY: number;
};
type Wall = {
  id: UUID; fromXZ: [number,number]; toXZ: [number,number];
  heightM: number; thicknessM: number;
};
type Opening = {
  id: UUID; wallId: UUID; kind: 'door'|'window';
  offsetM: number; widthM: number; bottomM: number; heightM: number;
};
type RoomShell = {
  id: UUID; sourceScanId: UUID; coordinateVersion: 1;
  floor: FloorPlan; walls: Wall[]; openings: Opening[];
  ceilingHeightM?: number;
};
type SceneObject = {
  id: UUID; assetId: UUID | null; category: string;
  transform: Transform; dimensionsM: Vec3; locked: boolean;
  source: 'roomplan_approximation'|'catalog'|'user'|'agent';
  displayName: string;
  ownership?: 'existing'|'planned_new'; replacesObjectId?: UUID;
  renovationDecision?: 'keep'|'replace'|'remove';
  materialOverrides?: Record<string, { colorHex?: string; roughness?: number }>;
  placement?: { support: 'floor'|'wall'|'object'; parentId?: UUID };
};
type SceneSpec = {
  schemaVersion: 1; id: UUID; roomId: UUID; shellId: UUID;
  revision: number; // optimistic concurrency; starts at 0
  objects: SceneObject[]; lightingPreset: string;
  updatedAt: string;
};

type AssetSpec = {
  schemaVersion: 1; id: UUID; category: string; title: string;
  tags: string[]; styles: string[]; colors: string[]; materials: string[];
  dimensionsM: Vec3; // x width, y height, z depth, already normalized
  glbStorageKey: string; thumbnailStorageKey?: string;
  source: 'furnimesh'|'self_authored'|'other'|'generated';
  sourceUrl?: string; licenseStatus: 'verified'|'pending'|'restricted';
  attribution?: string; estimatedPrice?: Money;
  triangleCount?: number; textureBytes?: number; contentHash: string;
  searchableDescription: string; embeddingVersion?: string;
};

type DesignBrief = {
  schemaVersion: 1; roomId: UUID;
  styleTags: string[]; palette: string[]; preferredMaterials: string[];
  forms: string[]; avoid: string[]; priorities: string[];
  mustKeepObjectIds: UUID[]; freeText?: string;
  monthlyBudget?: Money; // explicit monthly savings contribution only
  monthlySpendingCap?: Money; totalSpendingCap?: Money;
  startingCash?: Money; startDate?: string;
  inspirationImageIds?: UUID[]; questionnaireAnswers?: Record<string, unknown>;
};

type SceneOp =
 | { type:'add'; object: SceneObject }
 | { type:'delete'; objectId: UUID }
 | { type:'move'; objectId: UUID; transform: Transform }
 | { type:'replaceAsset'; objectId: UUID; assetId: UUID; dimensionsM: Vec3 } // same physical item, visual model swap
 | { type:'replacePhysicalItem'; oldObjectId: UUID; newObject: SceneObject }
 | { type:'changeMaterial'; objectId: UUID; overrides: SceneObject['materialOverrides'] }
 | { type:'setLock'; objectId: UUID; locked: boolean }; // only explicit user command

type ScenePatch = {
  schemaVersion: 1; id: UUID; roomId: UUID;
  baseSceneVersionId: UUID; baseRevision: number;
  operations: SceneOp[];
};
type DesignProposal = {
  schemaVersion: 1; id: UUID; roomId: UUID;
  baseSceneVersionId: UUID; patch: ScenePatch;
  status: 'planning'|'ready'|'failed'|'accepted'|'rejected'|'stale';
  explanation: string; estimatedAddedCost: Money;
  validation: { valid: boolean; errors: string[]; warnings: string[] };
};
type SceneVersion = {
  id: UUID; roomId: UUID; parentVersionId?: UUID;
  snapshot: SceneSpec; createdAt: string;
  source: 'import'|'user'|'accepted_proposal'|'milestone_edit';
};
type Purchase = {
  id: UUID; objectId: UUID; assetId: UUID; cost: Money;
  priority: number; dependencies: UUID[];
};
type Milestone = {
  id: UUID; roomId: UUID; planId: UUID;
  date: string; title: string; sceneVersionId: UUID;
  purchaseIds: UUID[]; periodSpend: Money; cumulativeSpend: Money;
};
```

## 3. Scene and version semantics
1. `RoomShell` is immutable after scan normalization; importing a new scan creates a new shell ID (and normally a new room) instead of mutating it.
2. `SceneSpec` is a complete composition of shell reference, objects and lighting preset. Never treat a whole-room GLB as authoritative scene state. Individual furniture assets can be independent GLBs; floor/walls can be procedural Three geometry.
3. Working scene is mutable via validated operations and saved by revision-checked autosave. **SceneVersion** is an immutable, accepted snapshot with `parentVersionId` for future branching.
4. `DesignProposal` contains a patch against a specific accepted version. Preview computes `apply(base, patch)` **without committing**. Accept only if base version/revision still matches; otherwise mark stale and ask to regenerate/rebase explicitly. Reject doesn't change accepted state.
5. Undo/redo = locally maintained inverse operations/checkpoints for editor gestures (bounded stack). Timeline = dated immutable milestone snapshots and purchase lists. Neither one substitutes for the other.
6. Milestone playback read-only by default; editing opens a forked working copy. Saving creates another SceneVersion; applying it to roadmap requires explicit user action. This avoids accidental mutation of past/future states.
7. Asset cache keyed by immutable asset ID/content hash, not by a transient signed URL.

## 4. Operation validation rules
**All** mutating operations must pass the same pure validator, regardless of caller (user or agent):
- Scene/shell ownership, object existence, no duplicate object IDs, known verified asset IDs, finite numbers, valid transforms and dimensions.
- `locked=true` prohibits delete/move/replace/material changes; only explicit authorized user `setLock` may unlock. The agent tool allowlist **excludes setLock**.
- All object ground-contact positions must lie inside floor polygon; wall and doorway keep-out, occupancy overlaps and clearance checks applied using simplified bounding boxes/footprints (not a physics simulation). Implement reasonable semantic exemptions (rug under table, art on wall, lamp above desk) through explicit category/support rules, not silent blanket overlap permission.
- A nonstructural scene op cannot modify shell geometry. No structural mutation operation is exposed.
- Entire patch validated before mutation (all-or-nothing for accept). Include errors with operation index and code.
- Client validation improves UX; **server validation is authoritative** for AI proposals and commits. Client DB upsert must not be allowed to bypass shell/lock/ownership rules: use a Supabase RPC/Edge Function with RLS authorization for authoritative mutation, or restricted table permissions and server-side checks.

## 5. Minimum API contracts (logical, transport may be HTTPS/Edge Functions)
| Operation | Request | Result / error |
|---|---|---|
| `createScanUpload` | auth, projectId, file manifest | signed upload targets + scanId |
| `completeScan` | scanId, manifest | scan processing status; normalized shell and scene produced server-side |
| `getMyScans` | auth | owned room/scan summary list |
| `getScene` | roomId | current working scene + accepted version + revision |
| `saveScenePatch` | roomId, baseRevision, idempotencyKey, operations | revision + normalized scene; 409 on stale revision |
| `searchAssets` | category, dimensions, style tags, topK | AssetSpec summaries and signed GLB/thumbnail retrieval URLs |
| `createDesignProposal` | roomId, acceptedVersionId, DesignBrief | jobId (or completed proposal) |
| `getDesignProposal` | proposalId | status, patch, diff, errors, preview snapshot derivable |
| `acceptDesignProposal` | proposalId, expectedBaseVersion, idempotencyKey | new immutable SceneVersion + updated working scene |
| `rejectDesignProposal` | proposalId | status rejected; scene unchanged |
| `createRoadmap` | acceptedVersionId, budget input | plan + milestones + purchase lists |
| `getMilestones` | roomId, planId | chronological milestones + referenced immutable scenes |
| `forkMilestone` | milestoneId | editable working copy based on that snapshot |

Auth: Supabase Auth JWT verified by trusted server path, ownership checked for each room/project, signed URLs short-lived. Never expose service-role key or AI credentials in browser/iPhone. Use consistent typed errors `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `ASSET_UNAVAILABLE`, `GENERATION_FAILED`, `RATE_LIMITED`.

## 6. Budget scheduling contract
For each new purchasable asset introduced by the accepted target redesign, create one `Purchase` with estimated price, priority, and optional dependencies. Compare to original owned objects; moving existing items is free and retained belongings are not re-purchased. `startingCash + monthlyBudget * elapsedMonths - cumulativeSpend >= 0` for every milestone, with purchase dependencies respected. Unaffordable items must remain unscheduled with explanation, not force a negative budget. Never imply prices are live retail quotations; use catalog estimates. `Milestone.sceneVersionId` points to a materialized snapshot of base shell + purchases completed to date. Intermediate milestones may contain temporary gaps where removed/replaced items are deferred; ideally schedule swaps atomically, keeping old items until replacement arrives.

## 7. Example patch
```json
{
  "schemaVersion": 1,
  "id": "11111111-1111-4111-8111-111111111111",
  "roomId": "22222222-2222-4222-8222-222222222222",
  "baseSceneVersionId": "33333333-3333-4333-8333-333333333333",
  "baseRevision": 5,
  "operations": [
    {"type":"delete","objectId":"44444444-4444-4444-8444-444444444444"},
    {"type":"add","object":{"id":"55555555-5555-4555-8555-555555555555","assetId":"66666666-6666-4666-8666-666666666666","category":"lamp","transform":{"position":[1.1,0,1.6],"rotation":[0,0,0,1],"scale":[1,1,1]},"dimensionsM":[0.4,1.4,0.4],"locked":false,"source":"agent","displayName":"Floor lamp","placement":{"support":"floor"}}}
  ]
}
```

## 8. Migration/versioning discipline
Additive schema migrations preferred; `schemaVersion` increment and explicit migration functions for incompatible changes. Keep fixture JSON in repository and CI validate import, replay, backwards compatibility, all operations, preview/reject/commit, and budget invariants. Shared `CONTRACTS.md` and generated Zod schemas must change together; feature teams must not invent parallel ad-hoc scene formats.


## 9. Revised cross-system contracts (normative, 2026-10-17)
**Use these refinements when older examples conflict.** Implement them as actual Zod runtime schemas in `packages/contracts`; only the schemas are executable validation authority. Semantic planner outputs never directly become scene mutations.

```ts
type StyleTrait = {
  value: string;
  origin: 'questionnaire'|'free_text'|'inspiration_image'|'inferred_default';
  sourceImageId?: UUID;
  confidence?: number; // optional; never claim a calibrated probability
};
type DesignInput = {
  roomId: UUID;
  questionnaire?: Record<string, unknown>;
  freeText?: string;
  inspirationImageIds: UUID[]; // authorized uploaded JPEG/PNG references
};
type SemanticDesignItem = {
  action: 'keep'|'remove'|'move'|'replace'|'add';
  objectId?: UUID;
  desiredCategory?: string;
  desiredStyleTags?: string[];
  placementIntent?: string;
  maxDimensionsM?: Vec3;
};
type SemanticDesignPlan = {
  schemaVersion: 1;
  roomId: UUID;
  baseSceneVersionId: UUID;
  designBrief: DesignBrief;
  items: SemanticDesignItem[];
  rationale: string;
};
type PurchaseLedgerItem = {
  id: UUID;
  targetObjectId: UUID;
  assetId: UUID;
  replacesObjectId?: UUID;
  estimatedUnitCost: Money | null;
  quantity: number;
  priceStatus: 'estimated'|'verified'|'unknown';
  priceSource?: string;
  stageId?: UUID;
};
type RenovationPlan = {
  id: UUID;
  roomId: UUID;
  desiredTargetVersionId: UUID;
  adjustedTargetVersionId?: UUID;
  fundedFinalVersionId?: UUID;
  baselineVersionId: UUID;
  purchases: PurchaseLedgerItem[];
  totalSpendingCap?: Money;
  monthlySpendingCap?: Money;
  savingsContributionPerMonth?: Money;
  startingCash?: Money;
  startDate?: string;
  estimateIncomplete: boolean;
  unfundedPurchaseIds: UUID[];
};
```

**Invariants:** Only actual new physical items emit purchase events. Never re-count purchases on later snapshots. Lock is orthogonal to Keep/Replace/Remove intent. `replaceAsset` is a display-model correction, not a purchase; `replacePhysicalItem` creates new identity and lineage and may require a purchase. Quoted prices are not guaranteed market prices. If no explicit savings contribution is supplied, no calendar month/date may be inferred for affordability; cumulative spending stages remain supported. All monetary totals compute in integer cents.

### Typed agent ports
```ts
interface StyleInterpreterPort {
  interpret(input: DesignInput): Promise<DesignBrief>;
}
interface DesignPlannerPort {
  plan(scene: SceneSpec, brief: DesignBrief): Promise<SemanticDesignPlan>;
}
interface AssetResolverPort {
  resolve(plan: SemanticDesignPlan): Promise<ResolvedDesignAssets>;
}
interface PlacementSolverPort {
  solve(scene: SceneSpec, plan: SemanticDesignPlan, assets: ResolvedDesignAssets): ScenePatch;
}
interface BudgetPriorityPlannerPort {
  prioritize(plan: RenovationPlan): Promise<UUID[]>;
}
// Define ResolvedDesignAssets in the TS package as a list of chosen, authorized AssetSpec IDs
// and exact normalized dimensions for each SemanticDesignItem.
```
Model calls only happen inside trusted `apps/worker`. The orchestrator sequences ports explicitly and limits retries. The API validates every generated patch, persists as a proposal, and accepts only with explicit user approval and a version checked transaction. Never provide agents generic SQL/write-scene tools.

### Aesthetic experiment amendment (2026-10-18)

The approved first milestone is single-room. Shared runtime schemas live in `packages/contracts/src/aestheticPlanner.ts`; planner logic lives in `packages/aesthetic-planner`, and trusted model calls in the isolated `apps/planner-server`.

`Keep` preserves physical identity, model, size and appearance but permits movement; `Lock` preserves everything. Replace and Remove are instructions, with Lock taking precedence. Proposal generation uses a frozen original snapshot. Eventually Accept creates and opens a separately named version; subsequent original edits remain on their own version and do not block saving the separate design. Merging changes and restoring unfinished runs are excluded.

The experiment's semantic plan is an intermediate, unsaved composition: `schemaVersion`, `roomId`, `rationale`, and `items`. Each item has a stable `key`, action, existing `objectId` where applicable, desired category/appearance/size for new pieces, and a structured `placementIntent` (`original`, `center`, `wall` by real wall ID, or `near` or `on` another item key with `beside`/`in_front_of`/`faces`/`near`/`on` relationships; code orders the dependency graph and rejects unknown anchors/cycles). The model never supplies coordinates or asset IDs. Missing appearance arrays on existing keep/remove items normalize to empty arrays; new pieces require an appearance description and positive maximum dimensions. Version IDs and approved brief references become required in persisted proposals when version saving is built; this unsaved experiment has no accept endpoint.

`DesignBrief` adds `lightingMood` and `householdNeeds`. `PriceRecord` enforces amount/status agreement: unknown is null; existing pieces carry zero; replacements use new IDs and `replacesObjectId`. `DesignReview` contains subjective style/composition/usability scores, at most five object-keyed findings and a complete revised plan for repairs. `RoomView` carries three distinct JPEG views of a particular candidate plus unavailable-object IDs. Every revision repeats placement and shared geometry checks; at most two visual repairs. Placeholder appearance stays unverified.

### Endpoint additions
| Operation | Request | Result |
|---|---|---|
| `createInspirationUpload` | roomId, MIME, bytes, checksum | authorized signed upload target + imageId |
| `createDesignProposal` | roomId, baseVersionId, DesignInput | durable jobId |
| `getJob` | jobId | owner-scoped persisted status/stage/result IDs |
| `saveRenovationDecisions` | roomId, decisions, expectedRevision | updated plan draft or conflict |
| `createRoadmap` | accepted target, decisions, spending cap, optional savings assumptions | plan + stages + unpriced/unfunded flags |

### Source of truth for shared modules
`packages/scene-engine`: pure deterministic TS operations, geometry and collision policies, no React/Three/Supabase imports. `apps/web` uses it for immediate preview and interaction commits; `apps/api` uses it for trusted validation and versioned persistence; `apps/worker` uses it for proposal construction. Swift uploads raw RoomPlan data/normalized scan metadata via documented signed APIs; do not reimplement independent scene operation semantics in Swift.
