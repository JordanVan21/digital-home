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
