# House — 3D sandbox

A local desktop room editor built with React, React Three Fiber, Drei, Three.js, Zustand, and a pure TypeScript scene engine. It opens directly into a furnished 5.2 × 4.4 m living room. All furniture is editable independently; the desk starts locked, and the scanned side table demonstrates the labelled proxy path.

## Run

Use Node 22.12+ and pnpm 10.32.1. If pnpm is unavailable, install it with Corepack (`corepack enable`) or run commands using `npx pnpm@10.32.1`.

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. Add `?debug` for the live FPS panel. Models, textures, fonts, and the lighting environment are local; no accounts, API, keys, or remote runtime assets are needed.

```sh
pnpm build          # Strict typecheck and Vite production build
pnpm test           # Contracts, pure geometry/operations/history, store/UI/persistence
pnpm typecheck
pnpm lint           # Includes scene-engine dependency restrictions
pnpm assets:verify  # Decode every shipped GLB and check bounds, hashes, textures, triangles
```

An optional Playwright smoke test exercises the canvas, asset picker, rotation, undo/redo, and persistence:

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

`HOUSE_BROWSER_EXECUTABLE=/path/to/chromium pnpm test:browser` can use an existing browser. Screenshots and optional software asset previews are written to ignored `test-results/`.

## Use the room

- Drag empty space to orbit; right/middle drag to pan; scroll to zoom. **Reset view** restores the elevated three-quarter camera. Pan targets are bounded so you cannot move the camera beneath the floor or lose the room. Near walls automatically become a low cutaway as the camera orbits.
- Click a piece to select it. Use **Move** to drag across the floor, or **Move up or down** to constrain the gesture to height while preserving X/Z. Hold **Space** during a horizontal drag to raise/lower the piece, then release Space to keep sliding at that height without releasing the mouse. Switching planes preserves position, and the whole gesture is one suggestion. A vertical arrow guide marks height mode, and Details has an exact height field. Hold **Shift** for 10 cm grid snapping. Nearby floor/object-top faces catch the bottom of the box within 12 cm while you drag; the target face and a `Snapped to …` label light up. Hold **Alt** to bypass the magnetic catch. Exact contact becomes valid support immediately. A plant’s box can overhang a tabletop when its bottom center is supported. **Place on floor** in Details sets floor height exactly. On **Accept**, any remaining floating suggestions settle onto a furniture top or the floor. A blue-violet box and corner dots mark selection. A piece that would collide, leave the room or block the doorway turns red but still lands where you drop it (see suggestions below).
- Selecting a piece shows a floating toolbar above it (move, rotate, duplicate, delete, lock, details) and a details card on the right. Choose **Rotate** in the floating toolbar, then drag anywhere inside the circle or on the piece to swivel it freely; hold **Shift** to snap to 15°. **R / Shift+R** step ±15°, and the details card has an editable degrees field. **V** selects, **G** moves, **L** toggles the lock, and **Delete / Backspace** removes a piece.
- **Every edit is a suggestion.** Moves, swivels, adds, replacements and deletions go into a draft where any state is allowed, like reviewing a code diff before applying it. The bar at the bottom counts suggested changes and conflicts; expand it for a per-piece list with reasons and a ↺ to revert one piece. Changed pieces show a dashed outline where they were, and new pieces a **New** tag.
- **Accept (✓ or Return)** checks everything at once: pieces that fit are applied; colliding pieces move to the nearest valid spot (within 1.5 m, keeping their angle), else return to where they were, or for new pieces are left out. Pieces you didn't touch never move, and locked pieces are never moved to make room. The result is saved and is a single undo step. **Discard (✕, or Esc with nothing selected)** drops the draft.
- **Cmd/Ctrl+Z** undoes; **Shift+Cmd/Ctrl+Z** redoes, stepping through suggestions first, then accepted changes. **Esc** cancels the current gesture, closes the picker, or deselects. Editing shortcuts ignore text fields.
- **Add furniture** (top bar) or **Objects** (left) opens a searchable catalog with category filters, dimensions, and estimated prices. New furniture is placed at the closest free location to the room center that leaves room to rotate it in place, falling back to a tight fit in crowded rooms.
- **Replace model** filters to the selected category and preserves the piece's physical identity, position, and rotation. It changes its visual representation, rather than creating a renovation purchase.
- Locked pieces show a badge. Moving, rotating, replacing, and deleting them is disabled; attempted drags explain how to unlock them.
- Locking is immediate, not a suggestion. Only accepted rooms are saved: the top bar shows **N unsaved suggestions** while a draft exists (and the browser asks before you leave), otherwise **Saved**, **Saving…**, or **Save failed — Retry**, plus undo/redo. The **⋯** room menu contains **Reset room to fixture** and **Reload saved room**. Reset is explicitly persisted and clears local history.
- The round buttons on the right cycle the **lighting preset** (golden hour, daylight, overcast) and fit the room in view.
- Visual only for now: top-bar search (⌘K focuses it) and room switcher, the **Search** pill, **Duplicate**, **2D** plan view, and the **Measurements** toggle.

## Architecture

```text
packages/contracts    Zod schemas + inferred types; shell, scene, curated asset fixtures
packages/scene-engine Pure operations, footprint geometry, collision policy, inverse ops, history
apps/web/src/state    Four Zustand domains, editor commands, drag sessions, repository/autosave
apps/web/src/scene    Rendering adapters, cutaway shell, model instances, selection, camera
apps/web/src/components  TopBar, FloatingToolbar, InspectorPanel, AssetBrowser
```

The engine has no React, Three.js, DOM, or backend dependencies. ESLint enforces that boundary. It validates the same public `SceneOp` shape for previews and commits. Distances are meters, Y is up, the furniture front is +Z, rotations are normalized `[x,y,z,w]` quaternions, IDs are UUIDs, and prices are integer USD cents.

**State domains:** `scene` holds only the persisted scene and load readiness; `interaction` holds selection, hover, tool/panels, and the gesture-active flag; `history` owns bounded undo/redo entries; `save` holds asynchronous save status/error. UI components subscribe to narrow selectors. The canvas is memoized; camera enablement and canvas cursor styling subscribe imperatively.

**Drag pipeline:** pointer-down captures the pointer, records an offset on the floor or vertical drag plane, and disables orbit controls. Pointer moves update the object's `Group.position` through a ref, never a React setter or a scene-store mutation. A mutable `DragSession` retains the candidate transform. Validation runs at most about every 45 ms during movement, updates selection materials imperatively, and runs again on release. Release creates one draft suggestion; Accept resolves it and records one history checkpoint and save. Conflicted drops remain visible in the draft. Cancelled gestures create no draft step and ease back to the working transform. Cheap, invisible object-sized hitboxes handle interaction so pointer events never raycast hundreds of thousands of furniture triangles. Model meshes and outlines opt out of raycasting.

**Geometry:** floor occupancy uses oriented rectangles and SAT on XZ. Touching edges are allowed; positive-area overlap is not. Bounds checking includes rectangle edge intervals, so concave-room notches cannot be crossed just because all corners are inside. Structural wall footprints are keep-outs. Each door reserves a conservative inward rectangle, its width plus 15 cm deep. Rugs, wall-supported objects, and object-supported objects have explicit floor-overlap exemptions; they do not bypass all validation. Supported objects require a valid parent. Deleting a supporting object is rejected until its children are moved.

**History:** bounded to 80 `{ op, inverse }` entries, with immutable before/after checkpoints for exact restoration of object ordering and optional metadata. Undo/redo increases the working revision. New edits clear redo. Checkpoints stay internal to history and never extend the public scene-operation union.

**Persistence:** `SceneRepository` is the replaceable async port. `LocalStorageSceneRepository` parses loaded JSON, checks room identity, rejects stale revisions with typed `CONFLICT`, and falls back to the fixture only when there is no saved room. Web Locks coordinate saves across same-origin tabs where available; read/check/write is synchronous inside the lock. Autosave debounces 500 ms and serializes in-flight saves, retaining the latest pending scene and acknowledging only the latest local revision. Storage failure leaves edits in memory. A conflict requires explicitly reloading the saved room or resetting; retry never silently overwrites another tab. Visibility changes flush pending work; leaving with an unacknowledged edit triggers the browser's unsaved-changes protection. Explicit reset waits for an in-flight save, then stores the fixture atomically under the same room lock, and can recover unreadable JSON.

## Assets

Fifty-four GLBs are shipped: twelve publicly downloadable FurniMesh models, three CC0 Poly Haven models (a leather dining chair, potted succulent, and ceramic vase), and 39 CC0 models from Jordan's sandbox branch (22 Poly Haven, 17 procedurally authored), with embedded textures, meshopt compression, immutable content hashes, local thumbnails, and verified public-library licensing. See [model licenses](public/models/LICENSES.md), [source manifest](../../scripts/asset-sources.json), and [normalization report](../../scripts/asset-report.json).

To reproduce ingestion:

```sh
python3 scripts/fetch-assets.py
pnpm assets:normalize
pnpm assets:verify
node scripts/preview-assets.mjs
pnpm assets:import:polyhaven  # Import the curated CC0 models with provenance and local thumbnails
node scripts/import-jordan-catalog.mjs  # Re-import Jordan's catalog from git, then geometry:bake and assets:verify
node scripts/render-thumbnails.mjs     # GPU-render thumbnails via the dev-only ?thumbnail-studio page
```

Run these commands at the repository root. Raw downloads default to `/tmp/house-raw-models` (`HOUSE_RAW_MODELS` overrides the normalization input). Normalization preserves Y-up/+Z-front orientation, moves the origin to bottom-center, scales to the curated physical envelope, simplifies the mesh, caps textures at 1024², and applies meshopt compression. Catalog dimensions are measured from the resulting GLBs, not guessed again at runtime. Each instance clones its scene graph/materials and fits its actual bounding box to the object's dimensions. Geometry/textures are shared through the GLTF cache. Per-object suspense and error boundaries provide a neutral labelled proxy for loading/missing/failed GLBs. Generated environment lighting avoids remote HDR requests.

Poly Haven imports preserve original PBR materials and meter scale, embed 1K textures, and generate our own thumbnails from model geometry. Website example renders are not redistributed. The importer uses an identifying user-agent; runtime assets remain local. See `scripts/polyhaven-sources.json`, `scripts/polyhaven-provenance.json`, and the Poly Haven section of the model licenses. The existing FurniMesh normalizer retains separately imported catalog/license entries.

## Decisions

1. Followed `CONTRACTS.md` §2 exactly for public field shapes. Added no public scene fields. The sandbox excludes backend, AI, planning, auth, and scan-import flows.
2. Downloaded and checked the FurniMesh public library on **2026-10-17**, which explicitly states free commercial use without attribution. Its public model pages provide direct free GLB downloads. These are source-library models, including photograph-derived geometry, not fabricated downloads.
3. FurniMesh models do not provide reliable measured physical dimensions. Curated believable meter-scale envelopes, recorded those choices in `asset-sources.json`, normalized the geometry to them, and recorded the final measured bounds in the catalog. These dimensions and catalog prices are estimates, not manufacturer measurements or retail quotes.
4. Used 12 pieces in the room, including two instances of the same tree, a locked desk, and an intentionally assetless scanned side table. The catalog includes a second sofa and an additional side table for replacement/add demos.
5. Kept the room shell parametric, cut holes around its JSON openings, and reduced camera-facing walls to 17 cm. No full-room model or decorative geometry acts as the source of truth.
6. Initially chose floor-plane translation, 10 cm Shift snapping, and discrete 15° yaw rotation. Pitch/roll remain disallowed. Decision 17 adds supported elevation and vertical collision intervals.
7. Used a conservative rectangular door clearance rather than a hinge-specific swing sector because the opening contract has no hinge or swing direction. The normal is determined from the floor polygon, not an assumed wall winding.
8. Used internal history checkpoints where the public operation union has no lossless inverse: `replaceAsset` cannot point back to a null proxy, and physical replacement must allocate a new identity. `invertOp` returns a public inverse or a private checkpoint. Checkpoints also preserve exact array order on deletion undo. This follows the contracts' inverse-operation/checkpoint undo semantics without adding invalid public operations.
9. Kept reducers deterministic: the pure engine increments revision without reading a clock. The web adapter/repository applies real ISO timestamps.
10. Used locally packaged fonts, a deterministic procedural oak texture, ACES/sRGB output, a generated environment, one shadow-casting sun, contact shadows, and one small non-shadow-casting lamp light. No post-processing bloom/SSAO pass was added. DPR is capped at 1.7.
11. Inspected the downloaded models in a software contact sheet when browser launch was denied. Fixed the tree's source alpha material to `MASK` with double-sided leaves, reviewed +Z-facing orientation, and oriented the desk chair toward the desk. Software previews are asset checks, not browser screenshots or a performance measurement.
12. Near-center additions use a deterministic ring search, first requiring the piece's full rotation circle to be clear so it can rotate in place, then its real footprint; failures explain that space must be made. Replacement uses `replaceAsset` for visual correction and preserves the existing object's name/category/identity.
13. The UI follows `assets/ui-reference.png`: neutral frosted-glass pills over the room. The chrome adds no warmth of its own; the only hue is `--accent`, which comes from the active lighting preset (`src/theme.ts`) along with the 3D lights. A warm room gets an amber accent, a minimal room a graphite one. Lighting overrides are view state and are not saved with the room.
14. drei `<Html>` labels mount into a fixed portal (`labelLayer`) and never inside Suspense fallbacks; otherwise their React roots are unmounted mid-render (React 19 warnings and a `removeChild` error on load).
15. Edits use a suggestions phase (`docs/superpowers/specs/2026-10-17-suggestions-phase-design.md`). The draft is a second `SceneSpec`; changes are derived by diffing it against the accepted scene, mirroring the `ScenePatch`-against-a-base shape AI proposals will use. Draft edits use `applyOp(..., { allowConflicts: true })`, which skips only fixable checks. `resolveDraft` in the scene engine performs the accept, so the backend can reuse it to apply AI proposals.

16. Rotate is an explicit gesture mode: its full circular disk and the furniture hitbox both start free swivel. Move mode has no rotation hit area, so it only translates. Choosing Rotate does not step the angle; R / Shift+R and the inspector buttons remain 15° shortcuts.

17. Height movement uses a separate camera-facing vertical drag plane; Floor movement preserves height. Both commit one suggestion per release with no React renders during movement. Drafts may float; Accept chooses the nearest surface by vertical distance at the candidate XZ, using floor or a supporting table/desk/sideboard/shelving bounding-box top. Placement records the existing `support`/`parentId` fields. Accepted support requires contact, bottom-center support (refined in Decision 18), and no cycles. Collision uses vertical intervals plus XZ SAT; touching surfaces are valid. Floor/ceiling, walls, and conservative doorway checks remain. Moving a support away from untouched children leaves Accept unresolved instead of moving those children. Decision 18 resolves edited support parents before their children, retaining array order for unrelated pieces. Arbitrary shelves and mesh-surface physics are deferred.

18. Face snapping uses shared pure surface descriptors for floor and furniture tops. A 12 cm proximity catch applies during both move modes and numeric height entry; Alt bypasses it during dragging and Shift grid snapping yields to exact face contact. The renderer updates a contact outline/label imperatively with no model renders per pointer move. Every move infers exact support before validation/persistence, fixing false floor-support conflicts on tabletops. A bottom-center support rule permits bounding-box overhang (such as plant foliage). Accept processes support dependencies first and retains exact snapped stacks. Ceiling snapping is deferred by user choice; top/bottom face descriptors prepare that extension without making side contact imply gravity support. No public schema change.

19. All object bounding-box tops can provide support, regardless of category. Sofas, chairs, plants, rugs, and custom objects follow the same contact and center-support geometry as tables. Self-support and cyclic support remain prohibited; collision and room bounds still apply. Shape-aware support is deferred until geometry better represents the models.

20. Added three locally hosted Poly Haven CC0 models with measured dimensions, stable IDs separate from FurniMesh, source checksums, author/license provenance, preserved PBR materials, compressed GLBs and generated thumbnails. Existing asset IDs/files and the fixture layout are preserved. The catalog and inspector identify Poly Haven correctly. Physical-item prices remain curated estimates, not source/retailer quotations.

21. Holding Space during horizontal dragging temporarily uses the vertical plane; release resumes horizontal movement at the current height. Plane/offset rebasing prevents jumps and preserves both axes across transitions. The guide updates imperatively, avoiding model renders during movement or plane switches. One pointer release creates one suggestion. Keyup/blur clear the modifier; text fields, focused buttons, locked selections, rotation and dialogs retain their keyboard behavior. Explicit Height mode is still available.

22. Merged Jordan's 39-asset catalog into this one rather than running two catalogs. Models and thumbnails are copied byte-for-byte from git (`scripts/import-jordan-catalog.mjs`, which records the source commit in the license file); they already follow this catalog's bottom-centered, metre-scale, +Z-front convention, so no renormalization was needed. His asset IDs (`a55e7000-…`) are kept so his fixtures resolve. Category names are mapped onto this vocabulary (`scripts/jordan-categories.mjs`) so the library filters and the rug underlay rule apply to his pieces too. Every opaque model gets a baked compound collider; the four with alpha materials (framed print, tall lantern, olive tree, philodendron) keep box colliders. His self-authored models shipped colour-swatch thumbnails, so they are re-rendered from the models in GPU Chrome. Provider credits come from the asset's source instead of defaulting to FurniMesh.

23. Rooms are switchable from the top bar: the living room, Jordan's `test2` reference room, his demo studio, and a studio reproduced from his RoomPlan scan fixture. The last room opened is remembered per device. Switching is refused while suggestions are pending and waits for the current room's save. Fixtures are imported from git by `scripts/import-jordan-fixtures.mjs` into `packages/contracts/src/rooms/`.
24. Additive contract fields, needed by those fixtures: opening `kind: "opening"` (doorless passage), `swing` and `glazing`; object `tilt` (quarter turns about X/Z) and `scanMatch` (scan provenance); scene `appearance` (wall paint, trim, floor finish); plus `RoomFixtureSchema` and `ScanFixtureSchema`. Older scenes parse unchanged.
25. Jordan's shells put a wall's inner face on the floor edge; this engine centres walls on it. The importer moves each wall outward by half its thickness (corners re-joined, opening offsets kept in place) so his flush furniture is clear of the wall band, and wall items name the wall they hang on.
26. Scan reproduction (`matching.ts`, ported from Jordan) maps each RoomPlan object to the best-fitting verified catalog asset, turning it 90° when width and depth fit swapped. Because models are fitted to the object's box, the error threshold is 25% (Jordan used 35%): a looser match renders visibly stretched, and a labelled placeholder reads better.
27. Doors with `swing: "none"` (sliding) keep a 0.9 m walkway clear instead of a swing-sized zone. Otherwise test2's 2.5 m patio door would reserve 2.65 m, more than half the room.

28. Decor tilt (quarter turns about the object's X, then Z) is part of the geometry, not just the look. `dimensionsM` stays the model's upright size; `scaledDimensions`, footprints and `colliderBlocks` use the tilted size, and compound collider blocks are rotated with the model (cached per profile and tilt, so collision BVHs and exposed-face lookups stay cached). The renderer turns the model about its centre and re-bases it on y = 0. There is no tilt control yet; test2's flat books use it.

29. Colliders bake at 2 cm with exact tops (`docs/COLLIDER_PRECISION.md`). Every solid cell with air above it gets its real top height, merged into thin caps, so shelf boards, seats and tabletops are millimetre-exact; seams up to 4 cm are closed for the outside fill so scanned shells stay solid. A piece settles on the highest top under its footprint within 2 cm, and contact uses the same 0.1 mm tolerance as collision because GLB positions are quantized. Convex decomposition (CoACD) was tried and dropped: inaccurate and slow on the scanned models.

30. Full three-axis rotation supersedes the upright-only rule and separate fixture tilts. The inspector uses X/pitch, Y/turn, Z/roll (YXZ Euler order), while saves stay quaternion-based. Swivels turn about world Y, carry full child poses, and remain imperative. Accept uses the lowest occupied point and contact stability; see “Full rotation (merge step 5)” below.

31. Lighting presets use local CC0 HDRs imported from Jordan’s branch, with credits in `public/hdr/SOURCE.md`. Daylight, Golden hour and Evening fit their sun and shadow camera to the active room’s main glazed opening. The familiar Golden hour → Daylight first click remains; Evening follows Daylight. Presets also drive the backdrop and accent. ACES tone mapping stays in the existing canvas.

32. Room shell rendering keeps Codex’s low cut-away height and adds Fade / Show modes, Jordan’s glazing and local CC0 floor textures. Wall-mounted items hide and stop intercepting clicks with cut-away walls. Per-scene paint and floor finish use the additive `setAppearance` contract op through suggestions, Accept, undo and save; room-only edits appear in the change list. Legacy appearance strings still parse; new paint ops require six-digit hex colors. Texture credits are in `public/textures/SOURCE.md`.

## Verification and known gaps

- The required build, test, typecheck, and lint commands pass. The test suite covers fixture parsing, shipped-file/license coverage, the fixture triangle budget, all operations, locks, rotated/concave bounds, SAT touching/overlap, occupancy exemptions, door clearance, inverse/history behavior, drag commit/rejection/cancel (including GPU-free tests of the actual canvas handler, live red feedback, spring-back, and no model rerenders during pointer movement), autosave debounce/serialization/retry, stale/concurrent saves, reset/recovery, and accessible locked controls.
- `assets:verify` independently decodes every GLB and verifies its SHA-256, catalog bounds, bottom-centered origin, triangle counts, and texture sizes. The final fixture stays below 500,000 furniture triangles. This excludes extra draws for shadows and the small procedural shell.
- The Playwright smoke test (`pnpm test:browser`) passes in headless Chrome. Set `HOUSE_BROWSER_EXECUTABLE` to a local Chrome, or run `pnpm exec playwright install`. It uses software WebGL, so it checks behaviour and console errors, not frame rate.
- **60 FPS is not yet measured.** Check it on the demo laptop with `pnpm dev` and `?debug`; the code and triangle budget support the target but do not prove it.
- Collision is intentionally a floor-footprint editor policy, not mesh physics. Height editing can place objects on supported bounding-box tops; material changes remain engine-only. Scene/asset content is local; history is session-local. On browsers without Web Locks, cross-tab CAS remains best-effort, though stale sequential writes are rejected.
- Desktop is the target. Panels adapt to smaller windows, but touch-first editing and mobile layouts are not the product scope. Asset fidelity reflects FurniMesh's source models; the scanned-object proxy is deliberately approximate.

### Renderer shape outlines

Opaque GLBs use cached compound selection outlines and accelerated mesh picking in the normal editor. Proxies, loading models and alpha/transparent assets retain box fallback. The displayed compound shape is approximate. Object-to-object collision validation uses the baked compound volumes described below. Surface snapping now uses exposed compound top faces as described below; these renderer changes do not change accepted scene feasibility or save formats. The geometry lab remains available at `?geometry-lab`.

### Compound collisions

Object collisions use an outer-box broad phase followed by yaw-aware, scaled compound-box overlap. Touching faces are allowed, with a 0.1 mm penetration tolerance and no whole-object clearance halo. Thus overlapping outer boxes can be valid when their occupied sub-blocks do not intersect (for example, furniture partly under a desk). Draft previews and Accept use the same pure engine query. Room boundaries and doorway clearances retain the outer bounds. Floor and furniture contact use the rules below.

`pnpm geometry:bake` regenerates normalized collider profiles from shipped opaque GLBs using the same 4 cm voxel approximation as the outline preview, clipped to model bounds. Profiles are keyed by asset ID and content hash. Missing/stale profiles, alpha-card models and proxies retain full-box collision fallback. Profiles do not change scene saves. The 0.1 mm tolerance is query tolerance, not model accuracy: open/thin meshes and small holes remain approximate.

### Shape snapping and attached items

Floor and furniture snapping uses the same collider profiles as collisions. Furniture targets are exposed top-face patches: covered internal faces are removed, and empty space above a chair seat is no longer a target at backrest height. Lowest occupied bottom faces must contact a patch, the bottom center must remain above the patch (overhang is allowed), and the resulting compound volumes must not intersect. This supports chair seats and interior shelves, including yaw and scale. Alt still bypasses magnetic snapping. Transparent/missing/stale-profile assets retain full-box fallback.

Exact contact records the existing `placement.parentId`. Moving or rotating a support carries all its attached descendants at their local offsets, live during the gesture and in one draft undo step. Moving a child leaves its parent in place; leaving the support detaches it, while that child's own children follow. Nearby pieces are never implicitly grouped. Locked descendants block moving a support. Uniform scale carries children; nonuniform group scaling is rejected because it would require shear.

Accept validates and resolves an edited stack together, preserving contacts even when searching for a nearby fit or reverting. Stack reverts, discard and undo/redo preserve group movement. Saves need no schema change. Existing placements that depended on empty outer-box space must be re-snapped to an actual face. Ceiling and side-face attachment remain future work.

### Collision hierarchy and production outlines

Collision queries use a cached per-asset binary BVH over the existing compound boxes. Conservative transformed node bounds prune whole branches, and only reached leaf pairs use the existing tight-tolerance SAT query. Geometry, snapping, support and save formats are unchanged. Trees are built once per asset in memory and reused across instances; moving a piece does not rebuild them.

Compound and selection-box outlines are development-only (`import.meta.env.DEV`). Production skips compound-outline generation while retaining accelerated opaque-model picking, the model itself, and interactive controls. Draft before-position ghosts and snap guides remain functional UI.

`pnpm exec vitest bench --run packages/scene-engine/src/collision.bench.ts` compares the retained linear reference against the BVH. One warm desk/tucked-chair run reduced leaf comparisons from 6,018 to 284 (169 node pairs), and averaged 0.1116 ms linear versus 0.0432 ms BVH (2.58×). These are a single workload's CPU timings, not frame-rate or worst-case guarantees. Deterministic equivalence tests cover 256 asset/transform pairs in both orders, plus existing containment, contacts, stale profiles, stacking and nesting tests.

Compound sub-box outlines have now been removed from the normal editor in both development and production, including their runtime generation. Compound collision data, BVH acceleration and shape snapping remain active. The isolated geometry lab remains available for inspection.

### Couch body closure and exterior ghosts

Collider baking closes exterior flood-fill access below the model's minimum Y, representing its supporting plane. This fills trapped body voids beneath skirting (including the linen couch) without sealing side-accessible under-desk space or open-top containers. This is a volume approximation, not a sweep/path simulation; saved overlapping placements from before the fix are not silently rearranged.

Dashed previous-position ghosts draw only exterior crease edges of the baked compound union. Coordinate-compressed occupancy removes shared/covered faces and sealed internal cavities; coplanar seams and collinear fragments are removed. Open gaps are preserved. The normalized result is cached per profile and copied/scaled for each changed object's accepted pose. Proxies and stale/missing profiles retain their box fallback.

### Current bounding-box view

Previous-position ghosts have been removed. Use the **Bounding boxes** button in the right-side view controls to toggle collider outlines for the current working scene. It starts off, works in development and production, and does not create edits or affect undo/save history. The overlay follows each furniture group's live transform, including attached items during drag/rotation. It shows the compound union's exterior edges without shared box seams or sealed internal cavities. No old-position or implicit selected-object boxes are drawn. The view preference resets on reload; collision and snapping remain active regardless of visibility.

### Full rotation (merge step 5)

The inspector now edits X/pitch, Y/turn and Z/roll, with 15° steps and Lay flat / Lean back 15° poses. Stored rotations are quaternions; degree controls use YXZ Euler order. The full-disk swivel stays horizontal and turns about world Y without erasing pitch or roll. Drafts remain unrestricted; Accept settles the lowest occupied point onto the nearest floor or supported furniture surface.

Collision BVHs now prune transformed three-dimensional boxes, with a 15-axis OBB SAT at the leaves. The 2 cm profiles and 0.1 mm collision tolerance are unchanged. Quarter-turn fixture tilts have been folded into the quaternion, preserving model centres; legacy tilt fields still render for compatibility. Attached pieces retain their complete relative rotation.

Tipped pieces use a projected occupied-volume centre over their contact region, including side contact when leaning against a back cushion. Stability uses the existing 2 cm uneven-surface band; collision penetration still allows only 0.1 mm. Authored upright floor assets remain assumed stable because their material density and weighted bases are unavailable. This is a geometric stability approximation, not a rigid-body physics simulation. Supporting surfaces remain floor and upward horizontal furniture faces. test2's three pillows and folded throw have been re-posed without soft-item overlap exemptions; all 45 pieces validate.

30. Full three-axis rotation supersedes the upright-only rule and separate fixture tilts. The inspector uses X/pitch, Y/turn, Z/roll (YXZ Euler order), while saves stay quaternion-based. Swivels turn about world Y, carry full child poses, and remain imperative. Accept uses the lowest occupied point and contact stability; see “Full rotation (merge step 5)” below.
