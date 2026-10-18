# Shape-aware geometry experiment — first review checkpoint

Baseline: `feature/3d-sandbox-codex` at **e5140ce**. All existing sandbox work is committed there. This prototype lives on `experiment/shape-aware-geometry`; the renderer integration is now promoted to the Codex sandbox; nothing has been pushed.

## Review locally

Run `pnpm dev`, then open **http://127.0.0.1:5173/?geometry-lab**. The normal `/` editor retains the checkpoint's geometry behavior. The lab never loads/saves working scene rows or commits edits.

Select a table, desk chair, sofa, olive tree, or vase. Switch between the original box, compound-box overlay, and actual triangle wireframe. Click the model or move the probe sliders; compare whole-box, compound-volume and mesh-surface contact. Move the top-down ray across X/Z and below a backrest to inspect lower surfaces. Run a local CPU query benchmark in the panel. `pnpm geometry:benchmark` repeats the fixed workload on all five assets and writes `results.json`.

## What was built

- A new renderer/benchmark adapter bakes normalized model node transforms into triangle data once.
- Existing `three-mesh-bvh` 0.8.3 is now a pinned direct dependency for this experiment; other dependency resolutions are unchanged.
- Original whole-box queries are compared with a 4 cm surface voxelization, exterior flood fill, and greedy merging into compound solid boxes. This is a first automatic approximation, not a finished convex-decomposition pipeline.
- BVH queries measure sphere/triangle contact, first triangle ray hits, and translated mesh-pair triangle intersection. These are surface queries, not a complete solid-volume collision test.
- Synthetic tests demonstrate a clear table underside, leg contact, a lower chair seat, solid-containment limitations, and bounded preprocessing resolution.

The shared scene engine, scene contracts, model files, support rules and normal drag controls are unchanged. The opt-in lab is lazy-loaded. No prototype-generated shape has been made authoritative.

## Measured CPU results

One run on this machine using v25.2.1. Times are milliseconds. Small-query p95 uses 300 deterministic sphere probes after warmup. Pair queries sample three translations of each model against itself. Workload and source asset hashes are recorded in `results.json`.

| Model                          | Triangles | Compound boxes | Build ms | Mesh probe p95 ms | Slowest sampled mesh-pair ms |
| ------------------------------ | --------: | -------------: | -------: | ----------------: | ---------------------------: |
| Sculptural walnut coffee table |    27,000 |             68 |     28.6 |            0.0312 |                        3.796 |
| Cream desk chair               |   122,742 |            102 |     54.8 |            0.0259 |                        2.419 |
| Linen sofa                     |    27,000 |            138 |     15.0 |            0.0168 |                        0.084 |
| Olive tree                     |    26,999 |             14 |     11.1 |            0.0065 |                        0.098 |
| Poly Haven ceramic vase        |    10,296 |             16 |      6.9 |            0.0083 |                        0.646 |

Builds are one-time and currently synchronous in this prototype. Timings are CPU microbenchmarks, **not FPS or end-to-end editor validation measurements**, and include no guarantee for other hardware or worst-case scenes.

## Findings and limits

Accelerated mesh-surface queries are promising enough to continue testing; they are not ruled out by the current triangle counts. Mesh-pair costs are more variable, so broad-phase pruning and query budgets still matter.

The simple compound approximation has useful gaps but is not dependable for every source model. In this run, the desk chair produced zero enclosed grid cells at 4 cm, while the alpha-masked olive tree enclosed 6,957 cells. These are observations about this grid resolution, not proofs of watertightness. Thin/open surfaces can leak; small openings or leaf cards can seal empty space. A vase opening can also be lost at this resolution. The lab explicitly flags masked/transparent material. Mesh queries presently count invisible texture-card geometry.

A sphere wholly inside a closed solid can report no triangle-surface contact. Surface intersection alone therefore cannot be used as the accepted-scene validity test. The prototype deliberately tests and exposes this distinction.

Support needs more than ray hits: bottom contact regions, upward-facing patches, holes, tolerances and stability remain unimplemented. Camera silhouette selection, shape-aware snapping and saved-layout migration are also outside this first checkpoint.

## Recommendation before any editor merge

Review the five overlays. Continue with a hybrid prototype: box broad phase, accelerated mesh queries for picking/contact locations, and validated compound volumes or explicit containment tests for authoritative collisions. Investigate finer/adaptive cells or convex decomposition for thin geometry and separate alpha-mask treatment. Measure full editor/frame costs on demo hardware before selecting the production policy.

The current grid boxes should **not** replace editor validation as-is. Keep this branch separate until the geometry quality and full contact semantics are reviewed. A chair seat or couch cushion can legitimately support an item; geometry fidelity is not a category blacklist.

## Renderer integration

The normal editor now draws cached compound outlines for opaque GLBs and uses accelerated triangle picking, so empty space between legs is no longer a box hit target. Loading, missing, alpha-masked and transparent models retain box outlines and picking. Geometry is normalized with the same model transform as the visible asset; drag updates remain imperative. Shared source geometry is not mutated.

This is deliberately a renderer integration, not a replacement for computational bounds: accepted-scene collisions, support, snapping, room checks and saved scenes still use the existing boxes. A compound outline is an approximate shape preview, not a feasibility guarantee. The containment and support issues above still block making the experimental volumes authoritative.

## Compound collision promotion

At the user's request, the approximation now also drives object-to-object collision checks. Offline generated, content-hash-matched profiles keep the engine independent of Three.js and runtime model loading. Whole bounds remain the broad phase and room/door policy; occupied sub-box pairs are the narrow phase, allowing gaps under tabletops. Touching is permitted with 0.1 mm penetration tolerance. Missing/stale and alpha-model profiles fall back to a solid box. Support/snapping still uses the original top faces.

This deliberately accepts the approximation's documented fidelity limits; it is not exact mesh collision or a remedy for open meshes. Real desk/chair and low-object-under-desk cases, penetration, containment, transforms and resolver preservation are covered by engine tests. Regenerate profiles with `pnpm geometry:bake` when assets change.

## Shape-based snapping and support assemblies

Snapping now uses exposed top patches from the same baked compound data. Overlapping columns are subtracted from each top face to omit covered internal faces. Contact requires an occupied lowest child face, a supported bottom center and no compound penetration. The floor remains an exact plane. Lower chair seats and interior bookshelf shelves are tested, including yaw/scale and rejection of empty outer-box tops. Guides display the selected actual patch.

The existing support-parent relationship also defines moving assemblies. A parent translation/yaw carries recursive descendants, including an imperative live preview with no per-pointer React updates. Independent child movement leaves its parent fixed; locked descendants prevent moving the support. Accept searches/reverts a changed stack as a unit. GPU-free renderer tests cover live translation/rotation, cancel, locks and a single draft step; editor tests cover stack revert/undo/redo; the browser regression covers chair-seat snapping, stack movement, save and reload.

Fidelity remains limited by the reviewed compound approximation. Parent references persist as before; old saves relying on a formerly empty outer-box top require a fresh snap.

## Collision acceleration checkpoint

Compound boxes now have cached local-space BVHs. Queries lazily transform reached bounds and leaves, reject separated branches, and retain the original SAT leaf checks and tolerance. A single whole-model convex hull would seal the under-desk/chair gaps; this optimization preserves the reviewed shape instead. No asset/profile/save data changes are needed.

A warm desk/tucked-chair CPU microbenchmark measured 6,018 linear leaf pairs versus 284 BVH leaf pairs plus 169 node pairs. Mean query time was 0.1116 ms linear and 0.0432 ms BVH (2.58×). Run `pnpm exec vitest bench --run packages/scene-engine/src/collision.bench.ts` to repeat. Timing varies by hardware and placement; this does not establish FPS or worst-case latency. 256 deterministic varied asset pairs match the linear oracle in both query orders.

Production skips compound-outline generation/rendering and debug selection boxes. Development retains them. Accelerated model picking remains enabled independently of outline visibility.

Compound sub-box outlines have now been removed from the normal editor in both development and production, including their runtime generation. Compound collision data, BVH acceleration and shape snapping remain active. The isolated geometry lab remains available for inspection.

## Body containment and exterior ghost correction

The walnut table could be fully hidden inside the linen couch because the baked void beneath the skirting was reachable by flood fill from below the model. Production profile baking now uses `buildProfile(..., {closeBase:true})` (third argument after cell size), blocking flood entry below the supporting plane. The corrected couch merges to 58 boxes. Synthetic regressions retain side-accessible table air and open-top container interiors, and actual desk/chair nesting remains valid. The opt-in lab keeps its original unclosed comparison unless requested explicitly.

Previous-position ghosts now render the compound union's external crease edges, including genuine gaps, with no shared faces, overlap edges, coplanar seams, or sealed internal cavities. Tests cover touching/overlapping unions, concavity, closed cavities and open holes. Shapes are cached in normalized coordinates, independently copied into each object's dashed geometry and placed at its accepted transform.

## Current overlay toggle

The user subsequently removed previous-position ghosts. Their exterior-union geometry is reused by an explicit **Bounding boxes** toggle for the current scene, default off, available in development and production. Overlays are children of live furniture groups, so they track previews and committed/draft transforms with no old-position copy. The toggle does not change scene state, undo history, collisions or snapping.
