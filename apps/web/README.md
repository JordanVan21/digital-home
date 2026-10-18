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

Fifteen GLBs are shipped: twelve publicly downloadable FurniMesh models and three CC0 Poly Haven models (a leather dining chair, potted succulent, and ceramic vase), with embedded textures, meshopt compression, immutable content hashes, local thumbnails, and verified public-library licensing. See [model licenses](public/models/LICENSES.md), [source manifest](../../scripts/asset-sources.json), and [normalization report](../../scripts/asset-report.json).

To reproduce ingestion:

```sh
python3 scripts/fetch-assets.py
pnpm assets:normalize
pnpm assets:verify
node scripts/preview-assets.mjs
pnpm assets:import:polyhaven  # Import the curated CC0 models with provenance and local thumbnails
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

## Verification and known gaps

- The required build, test, typecheck, and lint commands pass. The test suite covers fixture parsing, shipped-file/license coverage, the fixture triangle budget, all operations, locks, rotated/concave bounds, SAT touching/overlap, occupancy exemptions, door clearance, inverse/history behavior, drag commit/rejection/cancel (including GPU-free tests of the actual canvas handler, live red feedback, spring-back, and no model rerenders during pointer movement), autosave debounce/serialization/retry, stale/concurrent saves, reset/recovery, and accessible locked controls.
- `assets:verify` independently decodes every GLB and verifies its SHA-256, catalog bounds, bottom-centered origin, triangle counts, and texture sizes. The final fixture stays below 500,000 furniture triangles. This excludes extra draws for shadows and the small procedural shell.
- The Playwright smoke test (`pnpm test:browser`) passes in headless Chrome. Set `HOUSE_BROWSER_EXECUTABLE` to a local Chrome, or run `pnpm exec playwright install`. It uses software WebGL, so it checks behaviour and console errors, not frame rate.
- **60 FPS is not yet measured.** Check it on the demo laptop with `pnpm dev` and `?debug`; the code and triangle budget support the target but do not prove it.
- Collision is intentionally a floor-footprint editor policy, not mesh physics. Height editing can place objects on supported bounding-box tops; material changes remain engine-only. Scene/asset content is local; history is session-local. On browsers without Web Locks, cross-tab CAS remains best-effort, though stale sequential writes are rejected.
- Desktop is the target. Panels adapt to smaller windows, but touch-first editing and mobile layouts are not the product scope. Asset fidelity reflects FurniMesh's source models; the scanned-object proxy is deliberately approximate.

### Renderer shape outlines

Opaque GLBs use cached compound selection outlines and accelerated mesh picking in the normal editor. Proxies, loading models and alpha/transparent assets retain box fallback. The displayed compound shape is approximate. Collision validation and surface snapping still use conservative whole boxes; these renderer changes do not change accepted scene feasibility or save formats. The geometry lab remains available at `?geometry-lab`.
