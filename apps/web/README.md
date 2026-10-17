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
- Click a piece to select it. Drag it directly across the floor; hold **Shift** for 10 cm grid snapping. A blue-violet box and corner dots mark selection. Invalid placements turn red, then ease back on release with a reason.
- **R / Shift+R** rotate ±15°. The inspector also has rotation buttons. **V** selects, **G** moves, **L** toggles the lock, and **Delete / Backspace** removes a piece.
- **Cmd/Ctrl+Z** undoes; **Shift+Cmd/Ctrl+Z** redoes. **Esc** cancels the current gesture, closes the picker, or deselects. Editing shortcuts ignore text fields.
- **Add furniture** opens a searchable catalog with category filters, dimensions, and estimated prices. New furniture is placed at the closest validated free location to the room center.
- **Replace model** filters to the selected category and preserves the piece's physical identity, position, and rotation. It changes its visual representation, rather than creating a renovation purchase.
- Locked pieces show a badge. Moving, rotating, replacing, and deleting them is disabled; attempted drags explain how to unlock them.
- The top bar shows **Saved**, **Saving…**, or **Save failed — Retry**. The room menu contains **Reset room to fixture** and **Reload saved room**. Reset is explicitly persisted and clears local history.

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

**Drag pipeline:** pointer-down captures the pointer, records the initial floor-plane offset, and disables orbit controls. Pointer moves update the object's `Group.position` through a ref, never a React setter or a scene-store mutation. A mutable `DragSession` retains the candidate transform. Validation runs at most about every 45 ms during movement, updates selection materials imperatively, and runs again on release. One accepted release applies one operation, creates one history entry, and schedules one save. Rejected/cancelled gestures create no history and ease back to the committed transform. Cheap, invisible object-sized hitboxes handle interaction so pointer events never raycast hundreds of thousands of furniture triangles. Model meshes and outlines opt out of raycasting.

**Geometry:** floor occupancy uses oriented rectangles and SAT on XZ. Touching edges are allowed; positive-area overlap is not. Bounds checking includes rectangle edge intervals, so concave-room notches cannot be crossed just because all corners are inside. Structural wall footprints are keep-outs. Each door reserves a conservative inward rectangle, its width plus 15 cm deep. Rugs, wall-supported objects, and object-supported objects have explicit floor-overlap exemptions; they do not bypass all validation. Supported objects require a valid parent. Deleting a supporting object is rejected until its children are moved.

**History:** bounded to 80 `{ op, inverse }` entries, with immutable before/after checkpoints for exact restoration of object ordering and optional metadata. Undo/redo increases the working revision. New edits clear redo. Checkpoints stay internal to history and never extend the public scene-operation union.

**Persistence:** `SceneRepository` is the replaceable async port. `LocalStorageSceneRepository` parses loaded JSON, checks room identity, rejects stale revisions with typed `CONFLICT`, and falls back to the fixture only when there is no saved room. Web Locks coordinate saves across same-origin tabs where available; read/check/write is synchronous inside the lock. Autosave debounces 500 ms and serializes in-flight saves, retaining the latest pending scene and acknowledging only the latest local revision. Storage failure leaves edits in memory. A conflict requires explicitly reloading the saved room or resetting; retry never silently overwrites another tab. Visibility changes flush pending work; leaving with an unacknowledged edit triggers the browser's unsaved-changes protection. Explicit reset waits for an in-flight save, then stores the fixture atomically under the same room lock, and can recover unreadable JSON.

## Assets

Twelve publicly downloadable FurniMesh GLBs are shipped, with embedded textures, meshopt compression, immutable content hashes, local thumbnails, and verified public-library licensing. See [model licenses](public/models/LICENSES.md), [source manifest](../../scripts/asset-sources.json), and [normalization report](../../scripts/asset-report.json).

To reproduce ingestion:

```sh
python3 scripts/fetch-assets.py
pnpm assets:normalize
pnpm assets:verify
node scripts/preview-assets.mjs
```

Run these commands at the repository root. Raw downloads default to `/tmp/house-raw-models` (`HOUSE_RAW_MODELS` overrides the normalization input). Normalization preserves Y-up/+Z-front orientation, moves the origin to bottom-center, scales to the curated physical envelope, simplifies the mesh, caps textures at 1024², and applies meshopt compression. Catalog dimensions are measured from the resulting GLBs, not guessed again at runtime. Each instance clones its scene graph/materials and fits its actual bounding box to the object's dimensions. Geometry/textures are shared through the GLTF cache. Per-object suspense and error boundaries provide a neutral labelled proxy for loading/missing/failed GLBs. Generated environment lighting avoids remote HDR requests.

## Decisions

1. Followed `CONTRACTS.md` §2 exactly for public field shapes. Added no public scene fields. The sandbox excludes backend, AI, planning, auth, and scan-import flows.
2. Downloaded and checked the FurniMesh public library on **2026-10-17**, which explicitly states free commercial use without attribution. Its public model pages provide direct free GLB downloads. These are source-library models, including photograph-derived geometry, not fabricated downloads.
3. FurniMesh models do not provide reliable measured physical dimensions. Curated believable meter-scale envelopes, recorded those choices in `asset-sources.json`, normalized the geometry to them, and recorded the final measured bounds in the catalog. These dimensions and catalog prices are estimates, not manufacturer measurements or retail quotes.
4. Used 12 pieces in the room, including two instances of the same tree, a locked desk, and an intentionally assetless scanned side table. The catalog includes a second sofa and an additional side table for replacement/add demos.
5. Kept the room shell parametric, cut holes around its JSON openings, and reduced camera-facing walls to 17 cm. No full-room model or decorative geometry acts as the source of truth.
6. Chose floor-plane translation, 10 cm Shift snapping, and discrete 15° yaw rotation. Floor-supported furniture rejects pitch/roll and non-floor elevation; this keeps the editor's oriented footprint model explicit and correct.
7. Used a conservative rectangular door clearance rather than a hinge-specific swing sector because the opening contract has no hinge or swing direction. The normal is determined from the floor polygon, not an assumed wall winding.
8. Used internal history checkpoints where the public operation union has no lossless inverse: `replaceAsset` cannot point back to a null proxy, and physical replacement must allocate a new identity. `invertOp` returns a public inverse or a private checkpoint. Checkpoints also preserve exact array order on deletion undo. This follows the contracts' inverse-operation/checkpoint undo semantics without adding invalid public operations.
9. Kept reducers deterministic: the pure engine increments revision without reading a clock. The web adapter/repository applies real ISO timestamps.
10. Used locally packaged fonts, a deterministic procedural oak texture, ACES/sRGB output, a generated environment, one shadow-casting sun, contact shadows, and one small non-shadow-casting lamp light. No post-processing bloom/SSAO pass was added. DPR is capped at 1.7.
11. Inspected the downloaded models in a software contact sheet when browser launch was denied. Fixed the tree's source alpha material to `MASK` with double-sided leaves, reviewed +Z-facing orientation, and oriented the desk chair toward the desk. Software previews are asset checks, not browser screenshots or a performance measurement.
12. Near-center additions use a deterministic ring search; failures explain that space must be made. Replacement uses `replaceAsset` for visual correction and preserves the existing object's name/category/identity.
13. Git staging/commits were attempted on the existing `feature/3d-sandbox-codex` branch, but the managed filesystem rejected creation of the worktree's `index.lock` with `Operation not permitted`. No pushes or branch changes were made.

## Verification and known gaps

- The required build, test, typecheck, and lint commands pass. The test suite covers fixture parsing, shipped-file/license coverage, the fixture triangle budget, all operations, locks, rotated/concave bounds, SAT touching/overlap, occupancy exemptions, door clearance, inverse/history behavior, drag commit/rejection/cancel (including GPU-free tests of the actual canvas handler, live red feedback, spring-back, and no model rerenders during pointer movement), autosave debounce/serialization/retry, stale/concurrent saves, reset/recovery, and accessible locked controls.
- `assets:verify` independently decodes every GLB and verifies its SHA-256, catalog bounds, bottom-centered origin, triangle counts, and texture sizes. The final fixture stays below 500,000 furniture triangles. This excludes extra draws for shadows and the small procedural shell.
- **Browser/visual/FPS verification remains blocked in this environment.** Both installed Chrome and Chromium headless shell failed before opening a page. Chromium reported `bootstrap_check_in … MachPortRendezvousServer: Permission denied (1100)`. The Playwright test is included but has not passed here. A measured laptop 60 FPS result and final R3F visual review must be checked in a normal browser with `pnpm dev` and `?debug`; the code and triangle budget support that target but do not prove it.
- **Commits remain blocked** by the worktree metadata write restriction described above. Implementation files are available in the requested working tree, uncommitted.
- Collision is intentionally a floor-footprint editor policy, not mesh physics. Object support placement and material changes are engine-supported but have no dedicated UI. Scene/asset content is local; history is session-local. On browsers without Web Locks, cross-tab CAS remains best-effort, though stale sequential writes are rejected.
- Desktop is the target. Panels adapt to smaller windows, but touch-first editing and mobile layouts are not the product scope. Asset fidelity reflects FurniMesh's source models; the scanned-object proxy is deliberately approximate.
