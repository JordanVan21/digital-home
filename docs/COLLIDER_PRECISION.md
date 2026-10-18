# Collider precision: exact surface heights on 2 cm blocks

**Status:** approved by the user on 2026-10-17 (options 1 + 2); implemented as step 4 (see "As built"). This replaces the earlier convex-decomposition (CoACD) plan; see "Why not convex decomposition" below.
**Step:** 4 in `docs/MERGE_PLAN.md`. It comes before full 3-axis rotation (step 5), which runs on these blocks.

## Why

The 4 cm voxel colliders put every surface on a 4 cm grid. Things that should rest on a real board, seat or tabletop either count as colliding with it or hover above it. The user wants a general rule that works for any model, not a shelf or book exception.

### How the current colliders work
- **The bake** is `pnpm geometry:bake` (`scripts/bake-colliders.mjs`, using `apps/web/src/geometry-lab/queries.ts` `bakeGeometry`/`buildProfile`/`compoundBoxes`).
  - It voxelizes each opaque GLB at **4 cm**.
  - It flood-fills from outside, with the supporting plane at the model bottom treated as closed (`closeBase`, the couch-containment fix).
  - It merges solid voxels into boxes and writes `packages/scene-engine/src/colliderProfiles.json`: per asset ID, `{contentHash, boxes: [[min],[max]]}` normalized to the unit box of `dimensionsM`.
- **Fallback:** alpha-material models (olive tree, philodendron, potted olive, framed landscape print, tall lantern) and missing or stale profiles fall back to a single full box.
- **The engine** (`packages/scene-engine/src`):
  - `collision.ts`: `colliderBlocks` (with step 3b's tilt), `worldBlocks` (yaw-rotated prisms), a BVH per profile, and `objectsCollide` (penetration tolerance `COLLISION_TOLERANCE_M = 0.0001`).
  - `contactFaces.ts`: `exposedTops` and `bottomContactFaces`.
  - `support.ts`: `canSupport` (`CONTACT_EPS_M = 1e-5`; the bottom-centre must be on the face), `snapToSurface` (`FACE_SNAP_DISTANCE_M = 0.12`), `onNearestSurface`.

### Errors observed with 4 cm voxels (test2 fixture)
1. **Shelf boards 1–3 cm too high.** Jordan's "Open oak and steel bookshelf" (`…0024`) has real board tops at 0.47 / 0.89 / 1.31 / 1.73 m. The voxel tops are 0.48 / 0.92 / 1.32 / 1.76 m. Books on the real boards count as colliding, and snapped books hover. This affects 17 shelf items in test2.
2. **Curved surfaces are stepped.** The modern cream sofa's (`…0019`) seat cushion comes out as 0.44 and 0.48 m blocks.
3. **Pillows inside the back cushion.** The real back cushions span sofa-local z −0.286…−0.064 m and y 0.42…0.82 m. test2's pillows (0.15 m deep, centred at z −0.25) are 11–19 cm inside the *real* cushion, so no collider fixes them. They need re-posing, leaning in front of the cushion, in step 5.
4. **Sides are on the grid,** with up to 4 cm of slop: a chair tucked under a desk, books against uprights, thin legs.
5. **Upright-only.** Step 3b handles quarter-turn tilts by permuting blocks; arbitrary rotation is step 5.

## The change

### Option 2: 2 cm cells
- Bake at **2 cm** instead of 4 cm. This halves side slop and stepping everywhere.
- `compoundBoxes` caps the grid at 200,000 cells, and the large sofas at 2 cm need about 250,000. Raise the cap; a `Uint8Array` of a few million cells is fine for an offline bake.
- Box counts roughly double to quadruple. Codex's per-profile BVH keeps queries fast; record counts and `collision.bench.ts` numbers before and after.

### Option 1: exact surface heights
After merging, trim each box's **top** to the highest real geometry inside its top cell layer:
- For box B with top `t`, take the mesh triangles clipped to B's XZ range and to `y ∈ (t − cell, t]`. If there are any, set B's top to their highest point.
- Voxel tops are always at or above the real surface, because a cell becomes solid when a triangle touches it. So trimming only moves tops down onto real geometry. Flat boards, tabletops and book tops become exact; curved tops become their true highest point inside each block.
- **Don't trim a box that another box sits on.** If a box's bottom equals `t` and overlaps B in XZ, leave B alone, so no gaps open inside a solid.
- This is a general rule: no categories, no hand-authored surfaces. Jordan's branch has a hand-typed `supports` list in its asset contract, but only 1 of 39 assets fills it in. This rule bakes the equivalent for every model automatically.
- Bottoms already sit at the model bottom (`closeBase`), so nothing changes there.

### As built (step 4, 2026-10-17)
The plan above needed six further rules once the real catalog was baked:
- **Caps per cell, not per box.**
  - Trimming whole merged boxes doesn't work: a shelf's uprights pass through the board's layer, so the box's highest geometry stays at the grid line.
  - Instead, every solid cell with open air above it gets its real top (the highest triangle point clipped to that cell). These "cap" cells merge separately: on the same layer, with tops within 2 mm (`CAP_MERGE_M`), keeping the highest.
  - A cap thinner than 0.1 mm (`MIN_CAP_M`) is dropped when the cell below is solid, and kept as a whole cell over open space.
- **Seam closing** (`closeGapsM: 0.04`).
  - At 2 cm the outside fill leaked through seams in scanned shells that 4 cm cells used to cover. The couch body went hollow (so the hidden coffee table passed), and so did the walnut table.
  - The bake now thickens the surface by one cell for the outside fill, then shrinks the outside back except across the real surface. Seams up to about 4 cm close; the outer shape stays at 2 cm.
- **Settling on uneven tops** (`SETTLE_BAND_M = 0.02`, `support.ts`).
  - Real tops vary by millimetres; the desk chair's seat slopes 0.469–0.4725 m under an 8 cm item.
  - A piece rests on the highest top under its footprint within 2 cm of the face under its centre. Anything taller is an obstacle.
- **Contact tolerance = collision tolerance = 0.1 mm.**
  - The GLBs store quantized positions, so Jordan's shelf boards are really at 0.46994 / 0.89004 m, tens of micrometres from the authored 0.47 / 0.89.
  - The old 10 µm contact check rejected the authored books.
- **Boxes clip to the model bounds,** and slivers under 10 µm are dropped.
- **The outline toggle** snaps corners to 5 mm in real units (`OUTLINE_STEP_M`). Otherwise the exact cap heights explode its grid; this is display only.

**Results:**
- All 18 of test2's shelf items validate, and lifted books snap back to 0.89 / 1.73 m (4 cm voxels: 0.92 / 1.76).
- **Collision query speed:** 0.042 ms (BVH), unchanged.
- **Boxes:** 2,401 → about 17,000.
- **Collider file:** 0.27 → 1.0 MB, adding about 150 kB gzipped to the main bundle. Lazy-loading it is possible later if the bundle size matters.

**Finding:** the "Sculptural walnut coffee table" (codex `…1002`) is multi-level. Its real top is 0.282 m, with raised 0.35 m blocks; the voxels had filled the whole thing to 0.35. Codex tests that assumed a 0.35 m top now use the flat "Concrete-top coffee table" (`a55e7000-…0003`). One added test pins the walnut's real surface.

### Unchanged
The profile file format, collision queries, Accept placement, tilt and suggest/Accept all stay as they are.

### No collider switch
The earlier plan kept the old colliders behind a URL flag. Because this is a bake-output change only, compare with before/after screenshots and the test2 validity counts instead.

## Tests (write first, run red)
- **`queries.test.ts`** (bake level, synthetic geometry):
  - A shelf whose board top is at 0.47 m: baked at 2 cm, the board box's top is 0.47 within 0.1 mm. Today it's 0.48.
  - Two stacked solid parts: no gap opens between them after trimming.
  - The table-legs and chair-seat cases still hold at 2 cm.
- **Engine, using the shipped profiles:**
  - The open bookshelf's exposed tops include 0.47 / 0.89 / 1.31 / 1.73 m within 1 mm.
  - test2's shelf books and dishes validate at their authored heights.
  - A book dropped just above a board snaps onto the real board height, with no hover.
- **Regressions:** chair partly under the desk valid; coffee table inside the couch rejected; seat and shelf snapping; assemblies and Accept; tilt; the browser suite.
- **Performance:** `collision.bench.ts` before and after. The budget is no visible drag regression on the M4.

## Why not convex decomposition (tried 2026-10-17)

The plan was approximate convex decomposition (CoACD) plus GJK, as in robotics simulators. Trials on the real catalog:
- **Whole-model CoACD:**
  - Jordan's bookshelf: 385 hulls, up to 15 mm off the surface.
  - A two-box book: 87 hulls, 13 mm off.
  - With remeshing on: the scanned armchairs took 2–4 minutes each, with hulls bulging 5–15 cm past the surface.

  Cause: CoACD expects one closed solid, and most models are many overlapping or loose parts.
- **"Parts first"** (split into connected parts, keep convex parts as their exact hull) was exact on Jordan's procedural models:
  - bookshelf: 13 hulls, board tops exactly 0.47 / 0.89 / 1.31 / 1.73;
  - modern cream sofa: 12 hulls within 0.2 mm;
  - book: 1 hull;
  - also the tray, rugs, sideboard and pillow.
- **But the scanned and curved models** have up to 9,503 loose fragments (desk chair) and large non-convex parts. CoACD on a single part (the barrel chair's body) gave 315 hulls with corners up to 9 cm off the surface.
- **Conclusion (user):** the cases that matter (shelf books, pillows) look nearly the same with options 1 + 2, for far less work. If millimetre side contact is ever needed, "parts first" hulls for models that split cleanly is the starting point. CoACD runs on this Mac with `uv run --no-project --with coacd --with trimesh python …`.

## Decisions carried forward
- **The stability rule from the old open questions** (a piece's centre must be over its contact area, rather than codex's bottom-centre-on-face rule) was approved. It applies when tipped pieces arrive in step 5, on these blocks.
