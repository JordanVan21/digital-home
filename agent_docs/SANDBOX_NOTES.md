# Sandbox (Feature 2) — Implementation Notes

**Status:** Implemented, 2026-10-17. Q1–Q5 approved (see §6). Approved contract changes are recorded in CONTRACTS.md §10.
**Precedence:** CONTRACTS.md > FUNCTIONAL_SPEC.md > PRD §11 > the Feature 2 task prompt > the other docs. The task prompt's ⚠ rules count as implementation requirements unless a doc explicitly contradicts them.

---

## 1. What each doc requires of the sandbox

| Doc | Requirements that apply to the sandbox |
|---|---|
| **CONTRACTS.md** | Units are meters. Axes: X right, Y up, Z forward. Stored rotation is a **quaternion**, and transforms are `{position, rotation, scale}`. Schemas live as Zod in `packages/contracts`, and the pure ops live in `packages/scene-engine` (no React, Three or Supabase). Ops are `add / delete / move / replaceAsset / replacePhysicalItem / changeMaterial / setLock`. Lock blocks delete, move, replace and material changes. Lock is separate from the Keep/Replace/Remove decision. The shell is immutable, and every caller goes through one validator. `replaceAsset` keeps the UUID; a physical replacement gets a new UUID plus `replacesObjectId`. `saveScenePatch(roomId, baseRevision, idempotencyKey, operations)` returns 409 on a stale revision. The asset cache is keyed by immutable asset ID. Typed error codes. Money is in integer minor units. |
| **FUNCTIONAL_SPEC.md** | Camera: orbit, scroll zoom, pan, Reset View, no clipping. Objects: select with an outline, Move/Rotate (Scale omitted), Delete, Esc, undo/redo shortcuts. A drag updates the mesh imperatively; release commits **one** `move` op with an undo inverse and schedules a save. Autosave is debounced and serialized/CAS, shows Saving / Saved / Offline-Retry, and keeps local edits when a save fails. Unmatched scan objects get a "neutral procedural proxy labelled approximate". A missing or corrupt GLB gives a proxy and a warning, never a crash. Assets come in normalized for axes, scale and floor-contact origin. F-02, F-03 and F-12 are sandbox acceptance tests. |
| **PRD §11 (and P-03/04/05/06/09/13)** | Keep/Replace/Remove is separate from `locked`. Everything is TypeScript, using React + R3F + Drei + Zustand. Core ops sit in a pure shared package that backend validation also uses. Unknown prices are never shown as $0. The editor and the timeline are kept separate. Target is about 60 FPS while manipulating objects. |
| **FEATURE_DESIGN.md** | Full-window canvas. Top bar (room name, mode label, save status, Reset View; Design/Preview/Timeline go in later). Left tool cluster (select, move, rotate, add, delete, lock, undo/redo, and optionally duplicate and camera presets). Collapsible right inspector. Asset browser (category filter, search, cards with thumbnail, size, tags and price estimate). Lock badge, and disabled controls when locked. Dark/neutral translucent chrome. Component names come from §6. §12 adds `OwnershipDecisionPicker` (Keep/Replace/Remove). Shortcuts are listed in §8. |
| **SYSTEM_ARCHITECTURE.md** | pnpm monorepo: `apps/web`, `packages/contracts`, `packages/scene-engine`, `packages/asset-service`, and others. Frontend modules are `scene-renderer`, `editor-tools`, `asset-browser` and `data-client`. Reducer names are `applyMove`, `applyAdd`, `applyDelete`, `applyPhysicalReplacement`, `applyMaterial` and `validatePatch`. The renderer is an adapter and never the geometry authority. Edits never go through a job queue. |
| **README.md** | Read order and normative status of the docs. Build order step 2 is the "shared pure scene engine + browser renderer/editing" — that is this feature. |
| **finaldiagram.png** | The "Frontend → 3D Sandbox" box lists move, collision detection, rotation, addition, deletion, edit, zoom/pan/orbit and selecting, with the requirements "smooth, low latency (client side)". Its "state" box has a stack of operations (LIFO undo/redo) and debounced autosave. "Dragging = update client side, async write to DB." The GLB asset library feeds the frontend through the "3D Render Agent". My boundaries follow it: `apps/web` (sandbox + Zustand state), `scene-engine` (collision and op stack logic), an `AssetCatalog` adapter (the GLB asset lib) and a `ScenePersistence` adapter (the Database). |

## 2. Reference assets

- **`assets/test1.png`** shows what RoomPlan sees. It is a real photo with RoomPlan-style white bounding boxes around a chair, a table, a shelf/storage unit and the walls. The plant, floor lamp, easel and wall art are **not** boxed, because RoomPlan has no categories for them. I read it as the reference for **scan → asset reproduction**: each box (category + dimensions + transform) becomes a matched GLB or a labelled placeholder. One consequence: `demo-scan.json` should only contain RoomPlan categories. The lamp, plant, rug and art in the demo room are user-added catalog items, not scan output.
- **`assets/test2.png`** is an AI-rendered image of the **target look**. It shows an isometric cut-away room with wall tops visible as thick cut sections, a sliding glass door, a light oak floor, cream walls and warm golden-hour light with soft shadows. The selected sofa has a thin blue-violet bounding-box wireframe with corner dots. The furniture set is a sofa on a rug, a round coffee table, an armchair, a floor lamp, a sideboard, a bookshelf, plants and framed art. I'll use it as the visual reference for lighting, wall cut-away, materials and the selection overlay, and as a guide for the demo-room furniture mix. It could also serve later as a sample *inspiration image* for F-13. It is never a geometry source.

## 3. Conflicts and proposed resolutions

### 3a. Task prompt vs CONTRACTS.md (CONTRACTS wins; names in code follow CONTRACTS)

| # | Prompt says | CONTRACTS says | Proposed resolution |
|---|---|---|---|
| C1 | `packages/scene-core` | `packages/scene-engine` (pure ops) + `packages/contracts` (Zod schemas, types, versioned fixtures) | Create **both**. `contracts` holds the Zod schemas + `z.infer` types; `scene-engine` holds ops, validation, geometry, matching and undo logic. Both have zero React/Three/DOM imports, enforced by a test. |
| C2 | Fixtures in `scene-core/fixtures/` | Versioned fixtures belong to `packages/contracts` | Scene fixtures (`demo-room.json`, `demo-scan.json`) go in `packages/contracts/fixtures/`. Geometry-rule and matching case fixtures go in `packages/scene-engine/fixtures/`. The backend can reuse both unchanged. |
| C3 | Plain TS types | Zod runtime schemas are the executable authority | Use Zod (pure TS, fine for the backend). Fixtures are parsed through the schemas in tests. |
| C4 | `objectId` | `SceneObject.id` | Use `id`. "objectId" only appears where CONTRACTS uses it (op fields such as `delete.objectId`). The R3F root group gets `userData.objectId = obj.id`. |
| C5 | `position {x,y,z}` + `yaw` | `transform: { position: Vec3; rotation: Quat; scale: Vec3 }` | Store the contract transform. `scene-engine` exports `yawFromQuat` / `quatFromYaw`. The validator **rejects any rotation that isn't a pure Y-axis rotation** (CONTRACT-TBD: "MVP rotations are yaw-only"). The quaternion `[0, sin(θ/2), 0, cos(θ/2)]` equals Three's `rotation.y = θ`. The axis test proves it. |
| C6 | `dimensions {w,d,h}`, "no separate scale field" | `dimensionsM: Vec3` and `transform.scale: Vec3` | `dimensionsM` is the authoritative world size. ⚠ **Vec3 order is `[x=width, y=height, z=depth]`** (per `AssetSpec.dimensionsM` and the lamp `[0.4,1.4,0.4]` in the example patch), *not* w,d,h. The sandbox always writes `scale: [1,1,1]`, and the validator rejects non-unit scale (CONTRACT-TBD). Render-fit scale is derived at render time and never stored. |
| C7 | `ownership: 'keep'\|'replace'\|'remove'\|null` | `ownership?: 'existing'\|'planned_new'` (physical ownership); `renovationDecision?: 'keep'\|'replace'\|'remove'` | The prompt's "ownership flag" maps to **`renovationDecision`** (optional; absent = undecided). `ownership` stays the contract's existing/planned_new: scan objects are `existing`, and library adds are left unset in the sandbox. |
| C8 | `origin: 'scan'\|'user'\|'ai'` | `source: 'roomplan_approximation'\|'catalog'\|'user'\|'agent'` | Use `source`. Scan reproduction → `roomplan_approximation`. Add from library → `catalog`. Duplicate → `user`. |
| C9 | `parentId` top-level; placement classes `floor/flat/surface/wall` | `placement?: { support: 'floor'\|'wall'\|'object'; parentId?: UUID }` | `placement.support` follows the contract (`surface` → `object`). `flat` isn't in the contract. It becomes a **category/asset rule** in a scene-engine config table: `placementClass` is derived from `support` plus category, so a rug is support `floor` with class `flat`. CONTRACTS §4 asks for "explicit category/support rules", which this matches. The nesting allow-list lives in the same table. |
| C10 | Child `position` relative to parent | "Transform origin in project-local room coordinates" | **Decision needed (Q1).** |
| C11 | `scanMatch?` on SceneObject | Not in contract | Add `scanMatch?: { roomPlanCategory, scanDimensionsM, score }` as an optional additive field, `// CONTRACT-TBD`. |
| C12 | `displayName` absent | `displayName: string` required | Generated from the asset title or category ("Sofa", "Placeholder · Television"). |
| C13 | `Scene { sceneId, version, shell, objects: Record }` | `SceneSpec { schemaVersion:1, id, roomId, shellId, revision, objects: SceneObject[], lightingPreset, updatedAt }`; the shell is separate, by reference | Persist and serialize `SceneSpec` exactly. The shell is loaded separately (`shellId`). Engine functions take `(ctx: { shell, catalog? }, scene, op)`. The editor store may keep a derived `id → index` map; it is never serialized. `version` → `revision`. `lightingPreset` selects the local HDR. |
| C14 | `RoomShell` openings `type: 'door'\|'window'\|'opening'`, door swing, offset semantics | `Opening.kind: 'door'\|'window'`; `offsetM, widthM, bottomM, heightM`; walls `fromXZ/toXZ/heightM/thicknessM`; `floor.polygonXZ`, `elevationY` | Use contract names. The extra `'opening'` kind and `swing` are **Decision needed (Q2)**. `offsetM` is undefined in the contract. I propose it is the distance along the wall from `fromXZ` to the opening's **near edge**, so the interval is `[offsetM, offsetM+widthM]`, matching "intervals" in CONTRACTS §1 (CONTRACT-TBD). `thicknessM` is required, and the importer defaults it to 0.1. `elevationY` must be 0 for MVP, and the validator warns otherwise. |
| C15 | `AssetRecord` fields | `AssetSpec`: `id`, single `category`, `title`, `tags`, `styles`, `dimensionsM [w,h,d]`, `glbStorageKey`, `thumbnailStorageKey?`, `source: furnimesh\|self_authored\|other\|generated`, `sourceUrl?`, `licenseStatus: verified\|pending\|restricted`, `attribution?`, `estimatedPrice?: Money`, `triangleCount?`, `textureBytes?`, `contentHash`, `searchableDescription` | Use AssetSpec. The prompt's `categories[]` becomes `category` plus `tags`. `glbUri`/`previewUri` become storage keys, which `AssetCatalog.resolveUrl` resolves. Additive TBD fields: `placementClass?` and `frontAxis?` (`'+Z'` default; used for the load-time rotation). Price: absent `estimatedPrice` = unknown, shown as "Price unknown", never $0. There is no price-provenance field on AssetSpec; the ledger has `priceSource`. I'll add `priceSource?` as CONTRACT-TBD only if you want it shown in the drawer. |
| C16 | Matcher excludes `license.status === 'restricted'` | §4: ops must reference "known **verified** asset IDs" | The matcher, the swap picker and the library drawer only offer `licenseStatus === 'verified'`. The validator rejects `add`/`replaceAsset` with non-verified asset IDs. |
| C17 | Ops `moveObject, rotateObject, setLocked, setOwnership, addObject, removeObject, duplicateObject, setAsset` | `SceneOp`: `add, delete, move (full transform), replaceAsset, replacePhysicalItem, changeMaterial, setLock` | The engine reducer is `applyOp` dispatching to `applyAdd/applyDelete/applyMove/applyReplaceAsset/applyPhysicalReplacement/applyMaterial/applySetLock` (SYSTEM_ARCH names). The prompt's operations become **editor command builders** that emit contract ops: move/rotate → `move`, remove → `delete`, setAsset → `replaceAsset`, setLocked → `setLock`, duplicate → `add` × (1 + children). **`setOwnership` has no contract op.** I add `{ type:'setRenovationDecision', objectId, decision }` as `// CONTRACT-TBD`. It is allowed on locked objects and excluded from any agent allowlist decision (not mine to make). The contract's endpoint `saveRenovationDecisions` suggests decisions may later move to plan data; the op keeps it undoable in the sandbox until then. |
| C18 | Op result `{ scene, inverse } \| { error }` | Typed errors (`VALIDATION_ERROR`, …) with op index and code | The result is `{ ok:true, scene, inverse: SceneOp[] } \| { ok:false, error: { code, opIndex?, message } }`. The inverse is a **list**, because deleting a parent with children inverts to several `add`s. An undo entry is `{ forward: SceneOp[], inverse: SceneOp[] }`. |
| C19 | `ScenePersistence.save(scene, {baseVersion, requestId})` (full scene) | `saveScenePatch(roomId, baseRevision, idempotencyKey, operations)` → revision + normalized scene, or 409 | The interface becomes `getScene(roomId)` + `saveScenePatch({ roomId, baseRevision, idempotencyKey, operations })` → `{ revision, scene } \| { conflict }`. Autosave sends the ops accumulated since the last acknowledged revision; undo/redo just appends inverse/forward ops. The mock (memory + localStorage) applies ops through `scene-engine` and dedupes by `idempotencyKey`. Field names: `baseRevision`, `idempotencyKey`. |
| C20 | Shift-snap, `G/T` translate | — | No conflict. |

### 3b. Task prompt vs FUNCTIONAL_SPEC / FEATURE_DESIGN / SYSTEM_ARCHITECTURE

| # | Conflict | Resolution |
|---|---|---|
| F1 | Prompt: non-polygon violations "commit and stay flagged as warnings". CONTRACTS §4: all ops pass one validator, including overlap/clearance checks (severity unspecified). | The validator returns `errors` (shell edit, lock, unknown/duplicate ID, non-finite, non-verified asset, footprint outside polygon, non-yaw rotation) and `warnings` (overlap, wall clearance, door clearance, floor support, nesting). Errors reject the op; warnings are reported. The editor drag-end policy (one config file) snaps back on an outside-polygon error and commits with warnings otherwise. The future server **proposal** policy can promote warnings to errors (config flag); that is outside this sandbox. **Confirm (Q4).** |
| F2 | FEATURE_DESIGN §8: `V` = select. The prompt lacks it. | Add `V` (select tool / no gizmo). Keep all the prompt's shortcuts, including `Ctrl+Y`. |
| F3 | FEATURE_DESIGN layout: top bar + left tools + right inspector + bottom timeline. The prompt lists overlay groups. | Follow FEATURE_DESIGN component names: `TopBar` (room name, "Edit" mode label, `SaveStatusIndicator`, Reset View; Design/Preview/Timeline omitted), `FloatingToolbar` (left; includes undo/redo, duplicate, camera presets), `InspectorPanel` (right; nothing-selected = room info), `AssetBrowser` drawer. No `TimelineBar`; the layout leaves room for one. |
| F4 | FUNCTIONAL_SPEC: unmatched scan objects show a "neutral procedural proxy labelled approximate". The prompt says "category-colored placeholder box". | Category-tinted but desaturated/neutral box with the label "Approximate · <category>". This satisfies both. |
| F5 | SYSTEM_ARCH puts retrieval/top-K in `packages/asset-service`. The prompt puts `matchScanObject` in the shared core. | Prompt beats SYSTEM_ARCH: `matchScanObject` + `rankByDimensionFit` go in `scene-engine/src/matching/`, written as a self-contained module so it can move to `asset-service` later without API changes. |
| F6 | FUNCTIONAL_SPEC §8: assets are normalized at ingestion. The prompt also wants runtime normalization. | Do both. Runtime normalization (bbox recenter, base to y=0, `frontAxis` rotation, fit) is defensive. A small Node ingest script writes `dimensionsM`, `triangleCount`, `textureBytes` and `contentHash` into `catalog.json`. |
| F7 | `setLock` undo can unlock. CONTRACTS: "only explicit authorized user setLock may unlock". | A user-initiated undo of their own lock is explicit user intent, so it's allowed. Agents never get `setLock` (backend concern). |
| F8 | SYSTEM_ARCH §16 shows root `house/` and `docs/`. The repo is `digital-home/` with `agent_docs/`. | Keep the existing repo layout. Add `apps/` and `packages/` at the repo root. |

### 3c. Conflicts between the docs themselves

| # | Conflict | Resolution |
|---|---|---|
| D1 | `finaldiagram.png`: the "3D Render Agent creates 3D assets from JSON descriptions… render assets in parallel". PRD P-17 / README non-goals: runtime generation is future scope. | Treat the render agent box as the asset **resolver/loader** (its "retrieve from asset library" tool). No generation. |
| D2 | Diagram: "autosave — move all stack ops to queue to save them". SYSTEM_ARCH §2.4/§8.2: never put edits on a background queue. | Interpret it as a **client-side serialized save buffer** of ops sent through `saveScenePatch`, not a server job queue. This also fits C19. |
| D3 | CONTRACTS `SceneObject.ownership` = existing/planned_new. PRD §11 calls Keep/Replace/Remove "ownership". | Code uses `renovationDecision` for Keep/Replace/Remove (C7). UI copy follows FEATURE_DESIGN §12 ("Keep this / Replace this / Remove"). |
| D4 | FEATURE_DESIGN §3.3 says inspiration uploads are "required in MVP", while §10 lists them as future. | §12 resolves it (supported in MVP). Not relevant to the sandbox. |
| D5 | PRD has two "## 11" headings. | Cosmetic. "11. Merged scope decisions" is the overriding one. |
| D6 | SYSTEM_ARCH §5.2 reducer names vs CONTRACTS op names (`delete` vs `applyDelete`, `replaceAsset` has no `apply…` name listed). | `applyReplaceAsset` and `applySetLock` are added alongside the listed names (C17). |
| D7 | FUNCTIONAL_SPEC §3 shortcuts omit Backspace and Lock. FEATURE_DESIGN §8 includes them. | Implement the FEATURE_DESIGN set (superset). |

### 3d. Conventions the docs don't define (my definitions, marked CONTRACT-TBD in code)

- **Front axis:** at yaw 0 the object faces **+Z**. Width runs along X, depth along Z, height along Y. Positive yaw is counter-clockwise seen from above (right-hand about +Y), equal to Three `rotation.y`. The front direction is `(sin θ, 0, cos θ)`.
- **Polygon winding:** "CCW viewed from +Y looking down". With X right, Y up, a camera looking down −Y has screen-up = **−Z**, so the XZ plane appears mirrored relative to math (x, y). CCW-from-above therefore means the shoelace sum `Σ (xᵢ·zᵢ₊₁ − xᵢ₊₁·zᵢ)` is **negative** in raw (x, z) numbers. Winding is normalized on load. For each wall, the inward normal points to the polygon interior and the outward normal is its negation. A test pins this with a Three camera.
- **Object position:** the base-center of the footprint. y = 0 for floor items; the parent's top for `object` support; free for wall items.
- **Opening `offsetM`:** measured from `fromXZ` to the near edge (C14).
- **Door approach zone:** a rectangle on the interior side, width = opening width, depth = opening width (configurable). It applies to doors (and openings, if Q2 = yes), not windows.

## 4. Decisions needed before coding

- **Q1 — Child transforms (C10).** CONTRACTS describes transforms in room coordinates and never mentions parent-relative frames. The prompt stores children relative to their parent.
  *Recommendation:* store **world (room) coordinates for every object**. `applyMove` on a parent rigidly carries its children (it applies the parent's delta transform), so a single contract `move` op on the desk moves the lamp for both users and agents, and its inverse restores both. This keeps agents, validators and the budget planner from having to resolve frames. The renderer still nests the lamp's group under the desk during a drag, so the preview carries it live.
- **Q2 — Doorless openings and door swing (C14).** CONTRACTS limits `Opening.kind` to `door|window`, but RoomPlan has a third kind (`opening`).
  *Recommendation:* make an additive contract amendment, `kind: 'door'|'window'|'opening'` and `swing?: 'left'|'right'|'none'`, marked CONTRACT-TBD, and update CONTRACTS.md when you approve. Alternative: model the doorless opening as a `door` with `swing:'none'`.
- **Q3 — Asset sources (needs network downloads).** Proposed seed of about 12 assets:
  - **Poly Haven models** (CC0, realistic PBR — closest to the `test2.png` look; I'd download 1k-texture glTF variants and pack them to GLB): sofa, armchair, coffee table, side table, shelf, desk, chair, plant, lamp, rug, picture frame.
  - **Kenney Furniture Kit** (CC0, low-poly) only as fallback for gaps such as a TV, fridge or bed.
  - **Self-authored** procedural GLBs (a Node + three `GLTFExporter` script) for anything left over.
  - HDR: one Poly Haven CC0 interior HDRI at 1k (~1–2 MB) in `apps/web/public/hdr/`.
  - Each record carries `source`, `sourceUrl`, `licenseStatus:'verified'` and attribution (CC0, none required).
  - OK to download these, and is ~20–40 MB of committed binaries acceptable? Alternatively I can use Git LFS or put them under `.gitignore` with a fetch script.
- **Q4 — Validator severity split (F1).** Hard errors are: outside polygon, shell, lock, IDs, non-yaw rotation, non-unit scale, non-verified asset. Everything else is a warning. OK?
- **Q5 — `transform.scale` must be `[1,1,1]` (C6).** OK to enforce in the validator, so that `dimensionsM` is the only size?

## 5. Other notes

- **pnpm is not installed** on this machine (Node 24.17, npm 11.13). I'll use `corepack pnpm` (bundled with Node), or `npm i -g pnpm` if you prefer.
- `packages/scene-engine` and `packages/contracts` get a Vitest test that scans their `src/` for imports of `react`, `three`, `@react-three/*`, `window`/`document` and fails on any match. ESLint `no-restricted-imports` is added as well.
- Draco/Meshopt decoders are copied from `three/examples/jsm/libs/` into `apps/web/public/decoders/` at install time (postinstall script), so nothing is fetched from a CDN at runtime. KTX2 (Basis transcoder from the same folder) is added only if a seeded asset needs it.

## 6. Answers and what was built

**Answers (2026-10-17):** Q1 world coordinates, Q2 add `opening` + `swing`, Q4 severity split and Q5 unit scale were approved as recommended. Q3: the team prefers FurniMesh. The pipeline doesn't care where assets come from; the seed is CC0 (see below).

### Asset sourcing (Q3)
- **FurniMesh:** the library page says models are "free for commercial use without attribution". The [Terms](https://furnimesh.com/terms/) say nothing about redistributing downloaded files (repo, Supabase, CDN), and say "a paid subscription is required to download or share generated materials". The models are AI-generated from photos of real products. Until the team confirms redistribution rights in writing, FurniMesh assets should go in with `licenseStatus: 'pending'`. The app and validator refuse non-verified assets, per CONTRACTS §4.
- **Seed catalog (committed, about 7 MB):** 16 Poly Haven CC0 models, 2 self-authored rugs, 1 Poly Haven CC0 floor texture and 1 Poly Haven CC0 HDR. Each record carries `sourceUrl`, `license: 'CC0-1.0'` and author attribution. Re-generate with `pnpm --filter @house/asset-ingest ingest`. The ingest step normalizes (footprint centered, base at y = 0, front baked to +Z), converts textures to WebP and compresses geometry with Meshopt.
- **Adding FurniMesh or other GLBs:** add a `localGlb` entry to `tools/asset-ingest/assets.config.json` with `source`, `license`, `attribution` and `licenseStatus`, then re-run ingest. Check orientation in the dev gallery (`/?gallery`), which draws a +Z arrow per asset. Set `frontAxis` if the front isn't +Z.

### Package layout
```
packages/contracts     Zod schemas + types (+ CONTRACT-TBD extensions), fixtures/demo-room.json, demo-scan.json
packages/scene-engine  pure TS: math, polygon/OBB geometry, rules, ops + inverses, commands, matching,
                       placement search (floor spiral, wall slide), command history; fixtures/*.json for rules + matching
apps/web               Vite + React 18 + R3F 8 + Drei 9 + three 0.170 + Zustand 5
tools/asset-ingest     dev-only catalog builder (gltf-transform, sharp, meshoptimizer)
```

### Implementation decisions worth knowing
- **One mutation path.** UI gestures → `commit(label, ops)` → `applyOps` (scene-engine) → history entry `{forward, inverse}` → `save.pending`. Undo/redo apply the stored inverse/forward ops and append them to `pending`, so autosave sends a linear op log. Geometry enforcement is skipped (`geometry: 'report'`) when replaying undo/redo, so restoring an earlier state is never blocked.
- **Exact undo for nested moves.** The inverse of a parent `move` is the parent's old transform followed by each descendant's exact old transform.
- **Rendering of nesting.** Children render inside their parent's group with a relative transform, so the lamp follows the desk live during a drag. Stored transforms stay in room coordinates (`lib/convert.ts` does the conversion).
- **Drag.** TransformControls moves the Three group directly. A per-frame-at-most tick builds the candidate box from scene-engine dimensions, runs a `Box3` broad-phase against cached boxes, then runs the scene-engine rules on candidates only. Results live in `dragFeedback` (not Zustand) and drive the overlay color and a 3D label. The only store writes during a drag are `dragging: true/false`.
- **Drag-end policy** (`config/editorPolicy.ts`): errors snap back with a toast; warnings commit and stay flagged (amber outline, `!` badge, inspector list). Wall items are re-seated flush to the nearest wall on release. Surface items are clamped to the parent's top during the drag.
- **Highlighting** is an overlay (footprint loop plus box edges from scene-engine dimensions) that reads the live group transform each frame; furniture materials are never touched. "Remove" ghosting clones materials for that instance only (`makeGhost`, tested).
- **Fit.** Non-uniform scaling is allowed while the per-axis ratios are within 15% of each other; beyond that the model is scaled uniformly to fit inside the box and a console warning is logged.
- **Persistence mock.** `LocalScenePersistence` (memory + guarded localStorage) validates every patch with scene-engine, checks the revision (CAS) and dedupes by `idempotencyKey`. Dev menu: *Simulate next save failing*, *Simulate edit from another session* (produces a conflict), *Reset this room*.
- **Scan reproduction** runs client-side in `state/loader.ts`, standing in for the import worker, and uses `reproduceScanObject` from scene-engine, so the backend can reuse it unchanged.

### How to run
```
corepack pnpm install
corepack pnpm dev            # http://localhost:5173  (?source=demo-scan, ?perf, ?gallery)
corepack pnpm typecheck && corepack pnpm test
```

### Verified
- 110 automated tests: 3 contracts, 85 scene-engine, 22 web. They cover concave and rotated geometry, touching vs overlapping, nested and wall items, matching thresholds and determinism, the Three axis convention, purity (no React/Three/DOM imports in contracts and scene-engine), lock/shell/nesting rules, exact undo, autosave debounce, no save mid-drag, failure with same-key retry, conflict handling, rejected undo, add/duplicate/swap undoability, and per-instance ghosting.
- Checked in headless Edge screenshots: boot and orbit framing; top, iso and eye presets; wall fade; door, window and opening cut-outs; scan reproduction (5 matched, 2 placeholders); select, lock and the lock badge; desk drag carrying the lamp, then autosave and undo; snap-back when dragged out of the room; wall-item local gizmo; rotate-only-Y ring; empty-click deselect; library add; swap picker; "Remove" ghost; save failure with Retry. No non-localhost requests at runtime, and each GLB is fetched once.

### Not verified / known gaps
- **60 FPS while dragging** has not been measured. Headless Edge renders with SwiftShader on the CPU. Check on the demo laptop with `?perf` (r3f-perf, dev only).
- **Undo vs. autosave.** Undo across a conflict reload is not supported; reloading after a conflict clears history by design.
- **Picture glass.** "Framed landscape print" has a blended glass layer that renders near-black in this lighting. The demo uses the gilded painting instead.
- **Windows.** The view through windows is the dark backdrop; there is no exterior scenery.
- **Floor items flush against a wall** get a `wall_clearance` warning (2 cm minimum), including raw scans that sit flush.

## 7. Test2 round (`TEST2_PROMPT.md`)

**Docs:** `SANDBOX_AUDIT.md` (audit, performance log), `TEST2_SCENE_SPEC.md` (scene analysis, gap list, assets needed, result), CONTRACTS.md §10.2 (contract changes). This round supersedes `SANDBOX_PROMPT.md` on yaw limits, disabled Y movement, surface items locked to their parent, and the collision approach.

### What changed in the engine (`packages/scene-engine`)
- **`body.ts`:** effective (tilted) size, compound collision boxes per profile (`solid`, `table` = top slab + legs, `chair` = seat block + back slab, `open` = side frames + boards, `flat`, `soft`), and support surfaces (tops, sofa/armchair seats, shelf boards with gap limits, flat books, trays).
- **`collision.ts`:**
  - 3D SAT for yaw-aligned boxes, which is exact because they share the Y axis; tilts are 90° steps.
  - The pair matrix: flat never collides, soft only against solids, soft–soft may overlap 4 cm, and support chains are exempt.
  - Slide-not-stick resolution: sub-stepped minimum translation vector, so thin obstacles can't be tunneled through.
  - Walls are solid boxes.
  - A uniform-grid broad-phase that re-bins only objects that changed.
- **`support.ts`:** topmost fitting surface under a point, gravity settle, Float, and the "what may rest on what" table. Large furniture always rests on the floor; seats hold only soft goods, books and trays.
- **`editing.ts`:** `moveWithSupport` (move + settle + re-parent as one op list), `deleteWithSettle`, group transforms about a pivot, resize/tilt that re-seat children, `YawDial` (continuous rotation), and ceiling/wall poses.
- **Rules:**
  - `wall_clearance` is removed; touching within 1 mm is never a violation.
  - `floor_support` and `surface_support` become `support`.
  - `ceiling_mount` is added.
  - The door approach zone is capped at 1 m deep, so wide sliding doors don't keep half the room clear.

### Decisions
- **`chair` collision profile** (not in the prompt): a chair is a seat block plus a back slab. That's what makes "push a chair under a desk" behave: the seat slides under, and the back stops at the top's edge.
- **Seats** hold soft goods and books only, so a plant can't end up on an armchair when the cursor ray crosses it.
- **Small items** hop onto the support surface under the cursor while dragging (ray-first-hit), not only surfaces below their current height. That's what makes "put the vase back on the table" possible without lifting. Alt-lift plus gravity also works.
- **Camera:** switched to Drei `CameraControls` for animated `setLookAt`/`fitToBox`/`moveTo`, dolly-to-cursor and damping, which OrbitControls (three-stdlib) doesn't provide. A capture-phase pointer router turns orbiting off before the camera sees a press on furniture, the ring or the gizmo.
- **Direct drag replaces "orbit-drag from furniture doesn't select":** dragging an unlocked object now moves it. Locked objects still orbit, and clicks still select.
- **The gizmo** is the precision tool: translate on X/Y/Z, then settle on release. Rotation moved to the floor dial plus Q/E.
- **Lamp shadows default to 0** (1 in the evening preset). Point-light shadows cost about 10–25 FPS each on integrated GPUs. The brief allows "at most 2–3".
- **No instancing:** with BVH raycasts, decimated decor and no lamp shadows, the full test2 scene drags at about 60 FPS on Intel UHD. Instancing would complicate per-object selection for no measured gain. Revisit past about 100 objects.
- **`frameloop="demand"` when idle** (`IdleFrameloop`): continuous while there's input, a drag, walk mode or animation; on-demand after 2.5 s of quiet.
- **Procedural CC0 assets** (`tools/asset-ingest/procedural.mjs`) for 14 test2 items with no good CC0 model (the list is in TEST2_SCENE_SPEC §8). Poly Haven CC0 supplies the vases, plants and pendant. Heavy sources are decimated at ingest (`simplify`).

### How to check the test2 work
```
corepack pnpm dev                      # pick "test2 (photo)", then Match photo / Reference
corepack pnpm capture:test2 -- --gpu   # → test-output/test2-render.png
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
```
Dev hooks: `?perf` (r3f-perf), `window.__housePerf` (frame stats), `window.__houseDebug` (store + world-to-screen projection), `?lampShadows=N`, `?frameloop=always`, `?walls=fade|full|cutaway`, `?hideUi`.

## 8. Merge round: jordan + codex (2026-10-18)

**Docs:** `MERGE_INVENTORY.md` (inventory, every decision, plan, build log). Branch `feature/3d-sandbox-jordan-merge`, built from jordan's sandbox, with pieces from `origin/feature/3d-sandbox-codex` brought over deliberately (no git merge).

### What changed
- **Stack:** React 19, R3F 9, drei 10, three 0.180, Vite 7, Vitest 3, TS 5.9. Every drei `<Html>` mounts into a fixed `labelLayer` (React 19 unmount race; fix from codex). `?perf` uses drei `<Stats>`.
- **Edits stay immediate** (jordan). Codex's suggestions/Accept flow is not wired in; its draft resolver is kept aside for future AI proposals.
- **Toolbar:** the arrow gizmo is gone. New tool: **Collisions on/off (C)**. With collisions off nothing blocks, but problems are still flagged. (A 3D move tool was tried and replaced by codex's Space key: hold Space while dragging to move up/down.)
- **Panel:** editable **X / Y / Z** fields (codex). Typing a position slides there through collision; a typed height is kept. The Float checkbox is gone. Overcast lighting preset and "Reload saved room" come from codex.
- **Walk mode** keeps its own camera position (camera-controls 3 rewrites the camera each frame) and starts at a free spot.
- **Outlines:** the selection outline is codex's shape-hugging outline of the model's baked shape. It is sized like the rendered model and carries jordan's corner dots. A "Show all outlines" switch is in the room panel. Obstacles are not outlined while dragging, so the selection never appears to jump. Drawing only.
- **Collision:** jordan's engine is the only authority. Codex's exception table is added on top: wall-mounted items and furniture never collide.
- **Contact guides:** when a dragged piece presses against something, a line marks the touching side.
- **Stacking + gravity:**
  - surfaces are the real exposed top faces of baked shapes for downloaded and scanned models; self-made models keep exact surfaces;
  - the resting rule is codex's bottom-centre rule plus no sinking into the owner's shape;
  - anything may rest on anything except large furniture;
  - hop up while dragging, never drop mid-drag, fall on release;
  - 12 cm magnetic catch with a green face outline;
  - a "Letting go (tryout)" switch: Mix (default), Always fall, or Never fall.
- **Keys:**
  - Hold Space while dragging to move up/down (codex); scroll while dragging also raises/lowers; Shift gives a 10 cm grid; Alt means no snapping; Ctrl ignores collisions.
  - R picks the Rotate tool, and you drag anywhere inside the ring or on the piece to turn it. Q/E turn 15°.
  - Undo/redo glide into place.
- **Snapping:** only the back-to-wall snap is left (3 cm reach, floor-standing pieces only); neighbour alignment was dropped.
- **Seats:** a downloaded seat's cushion is its real baked face. The backrest and arms (`partsAbove`) block items resting on the seat and flag anything poking into them. While dragging, a piece never climbs to a higher face of what it sits on.
- **Saving:** the mock persistence re-reads storage under a Web Lock, so a stale second tab gets a conflict. The app saves when hidden and warns before closing with an unsaved edit.
- **Assets:** codex's 12 FurniMesh models are in the catalog as `pending`, hidden until redistribution rights are confirmed. Its Poly Haven models were already present.

### Tools
| Command | Purpose |
|---|---|
| `pnpm bake:shapes` | Bakes shapes into `scene-engine/src/shapeProfiles.json` |
| `pnpm assets:verify` | Decodes every GLB and checks hash, bounds and budgets |
| `pnpm --filter @house/asset-ingest ingest --only a,b` | Ingests specific entries offline |
| `?geometry-lab` | Codex's shape inspection lab |
| `pnpm geometry:benchmark` | Codex's shape-query benchmark |
| `pnpm --filter @house/scene-engine bench` | Merged engine microbenchmarks |
| `pnpm smoke` / `pnpm test:browser` | Headless Edge checks; these replace codex's Playwright specs |
