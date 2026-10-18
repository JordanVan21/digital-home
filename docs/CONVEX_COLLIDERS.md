# Convex colliders: replacing the 4 cm voxel boxes

**Status:** design draft, not yet approved. Get the open questions (bottom) answered before writing code.
**Step:** 4 in `docs/MERGE_PLAN.md`. It comes before full 3-axis rotation (step 5), which builds on it.

## Why

The user wants a general rule that is precise in any scenario, so the sandbox can express arrangements like books on a shelf, a pillow leaning on a cushion, or a chair tucked under a desk. It should not rely on per-category exceptions. They also want every piece to rotate on all three axes. Codex's voxel colliders can't do either.

### How the current colliders work
- **The bake** is `pnpm geometry:bake` (`scripts/bake-colliders.mjs`, using `apps/web/src/geometry-lab/queries.ts` `bakeGeometry`/`buildProfile`). It voxelizes each opaque GLB at **4 cm**, flood-fills from outside with the supporting plane at the model bottom treated as closed (`closeBase`, the couch-containment fix), and merges solid voxels into boxes. It writes `packages/scene-engine/src/colliderProfiles.json`: per asset ID, `{contentHash, boxes: [[min],[max]]}` normalized to the unit box of `dimensionsM`.
- **Fallback:** alpha-material models (leaves, glass, the framed print, the lantern) and missing or stale profiles fall back to a single full box.
- **The engine** (`packages/scene-engine/src`):
  - `collision.ts`: `colliderBlocks` (with tilt rotation from step 3b), `worldBlocks` (each block becomes an *upright prism*: a yaw-rotated rectangle in XZ plus a y range), a cached local BVH per profile, and `objectsCollide` (penetration tolerance `COLLISION_TOLERANCE_M = 0.0001`).
  - `contactFaces.ts`: `exposedTops` (block tops not covered by a higher block) and `bottomContactFaces`.
  - `support.ts`: `canSupport` (exact contact, `CONTACT_EPS_M = 1e-5`, bottom-centre must be on the face), `snapToSurface` (`FACE_SNAP_DISTANCE_M = 0.12`), `withContactSupport`, `onNearestSurface` (Accept's placement), `topY`.
  - `operations.ts` `validateObject`: always rejects non-yaw rotations ("Keep furniture upright") except for wall support.
  - `resolve.ts` `fitAt`: settles the root on the nearest surface and carries descendants.
- **The renderer:** `CollisionOutline.tsx` plus `compoundOutline.ts` draw the exterior of the union (the "Bounding boxes" toggle). Model meshes are picked with a three-mesh-bvh raycast.

### Errors observed with the voxel approach (2026-10-17, test2 fixture)
1. **Shelf boards 1–3 cm too high.** Jordan's open bookshelf (`a55e7000-…`, "Open oak and steel bookshelf") has real board tops at 0.47 / 0.89 / 1.31 / 1.73 m. The voxel tops are 0.48 / 0.92 / 1.32 / 1.76 m. Books authored on the real boards count as *colliding* with the shelf, and `snapToSurface` places books on the voxel tops, so they **hover** 1–3 cm above the visible board. This affects 17 shelf items in test2. The merge guideline warned about it: "Voxel boards quantize up to 4 cm."
2. **Curved and soft surfaces are stepped.** The modern cream sofa's (`…0019`) seat cushion top comes out as 0.44 and 0.48 m blocks, while the authored seat is 0.451 m. Its exposed tops are 0.44, 0.48, 0.56, 0.60, 0.64, 0.76, 0.80 and 0.82 m. The back cushion is one block at sofa-local z −0.24…−0.08 up to y 0.64 m, and the backrest is z −0.47…−0.24 up to 0.80 m.
3. **Pillows inside the back cushion.** test2's three pillows (0.45 × 0.45 × 0.15 m, centred at sofa-local z −0.25, y 0.451) sit 9–12 cm inside that block. The overlap needed to make each one legal was 8.6, 12.1 and 11.6 cm, and the throw needed 5.1 cm. Moving them forward until legal took 24–29 cm, which is off the back of the seat. The user rejected an overlap exception: the configuration isn't physically feasible. The fix is exact geometry plus leaning poses (step 5).
4. **Sides are on the grid too.** Chair-under-desk tucking, books against shelf uprights and lamps beside sofa arms all have up to 4 cm of slop. Thin parts (legs, uprights) become 4 cm blocks.
5. **Upright-only by construction.** `worldBlocks` turns every block into a yaw-rotated vertical prism. Arbitrary 3D rotation can't be represented; step 3b only handles quarter-turn tilts by permuting block axes.
6. **Box counts.** Some models need about 200 merged boxes, such as the sculpted sofa (215) and both of Jordan's sofas (~210). Codex's BVH keeps this fast, but it is a sign the representation is inefficient.
7. **Alpha models** fall back to a single box, so plants and glass lanterns are coarse.

These are all symptoms of one cause: a fixed axis-aligned grid in model space.

## The change

Represent each model by an **approximate convex decomposition**: a small set of convex hulls that follow the real shape within a chosen tolerance. Robotics and physics simulators (PyBullet, MuJoCo, Drake, MoveIt) do the same. Answer geometric queries with **GJK** (overlap and distance between convex sets) at any orientation.

Codex's editing behaviour stays identical: suggest-then-Accept, no physics while suggesting, nearest-surface placement then resolve on Accept, snapping as a placement aid with Alt to skip it, locks, carried children. Only the shape data and the geometric queries change.

### Bake
- **Decomposition:** use CoACD (collision-aware approximate convex decomposition, MIT). It's distributed as a Python package; a Node or WASM option is an open question. Run it offline in `scripts/`, never at runtime.
  - Input: the GLB triangles in model space (the `closeBase` idea may still be needed so a couch's skirt doesn't leave a hollow underside).
  - Parameters: concavity threshold about **5 mm** (tune with the user), a cap on hulls per model (e.g. 32), and on vertices per hull (e.g. 64).
- **Output:** a new profile file, normalized to the unit box like today so `dimensionsM` scaling still works:
  ```ts
  { contentHash, hulls: { vertices: number[] /* xyz */; faces?: number[] }[] }
  ```
  Non-uniform scaling of convex hulls stays convex, so normalization is safe.
- **Alpha models:** decompose the opaque parts and the outer envelope of leaves and glass (the convex hull of the alpha geometry). That's better than today's single box.
- **Verification:** keep the profiles hash-checked against `catalog.json` as today. Add a check that every hull vertex is within tolerance of the mesh surface, and record hull counts and errors in the bake log.

### Engine (pure TS, no Three.js)
- `hulls.ts`: per-object world hulls computed lazily from the transform (full quaternion, scale, dimensions), plus a cached local BVH over hull AABBs, reusing codex's BVH approach.
- `gjk.ts`: a boolean intersection test and a distance query (GJK; add EPA only if penetration depth is needed). Collision means penetration beyond the tolerance (`COLLISION_TOLERANCE_M`, 0.1 mm today). Keep a broad phase of footprint, AABB and BVH so dragging stays smooth.
- **Resting and contact,** replacing `exposedTops` and `canSupport`:
  - Lower the piece along −Y (a GJK-based time-of-impact or conservative advancement) until it touches the first hull below: that's the support height and the supporting object.
  - `snapToSurface`: the same query within `FACE_SNAP_DISTANCE_M`, up or down (codex's nearest surface).
  - `onNearestSurface` on Accept: choose the nearest contact height above or below, as now.
  - "Supported": the piece touches a hull below it, and its centre of mass (projected) lies inside the convex hull of its contact points. That's the stability rule in general form, replacing the bottom-centre-on-face rule. It decides `placement.parentId`.
- `scaledDimensions`, `footprint` and `topY` stay for room bounds, wall band, doorway and fast rejection. Footprints become the XZ projection of the rotated AABB.
- `tilt` from step 3b becomes a rotation (step 5). Until then, apply it as a rotation of the hulls.

### Renderer and dev tools
- The "Bounding boxes" toggle draws the hull edges instead of the voxel exterior.
- The geometry lab (`?geometry-lab`) gets a voxel-versus-hull comparison per model.
- A temporary **collider switch** (a `?colliders=voxel|hull` URL flag, or a dev setting) lets the user compare feel side by side. Remove the voxel path once approved.

### Tests (write first)
- **Shelves:** test2's shelf books are valid at their authored heights, and a book dropped above a board snaps to the real board height (within about 2 mm, no hover).
- **Pillows:** a pillow leaning 15° against test2's back cushion and sitting on the seat is valid; one pushed into the cushion is not.
- **Regressions to keep:**
  - the real desk chair partly under the desk is valid (`collision.test.ts`, `compound-collision.spec.ts`);
  - the coffee table hidden inside the couch is rejected;
  - seat and shelf snapping (`compound-snapping-stack.spec.ts`, `surface-snapping.spec.ts`);
  - carried stacks and Accept atomicity (`assembly.test.ts`, `resolve.test.ts`);
  - tilt (`tilt.test.ts`).
- **Rotation invariance:** the same pair gives the same answer under any shared rigid transform.
- **Performance:** keep `collision.bench.ts` and add the hull workload. Budget: no regression in drag smoothness on the M4. Codex measured 0.043 ms per query for the desk/chair pair with BVH; record the hull equivalent.

## Open questions for the user
1. Concavity tolerance: 5 mm, or tighter? It trades accuracy against hull count and speed.
2. Run CoACD from Python at bake time (needs a local Python) or find a JS/WASM build? Runtime is unaffected either way.
3. Keep the voxel path behind a switch for comparison until approved? (Recommended.)
4. Should "supported" use the general stability rule (centre of mass over the contact area), or keep codex's simpler bottom-centre rule?
