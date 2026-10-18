# Sandbox audit (before the test2 work)

**Date:** 2026-10-17 · **Branch:** `feature/3d-sandblox-jordan` (all sandbox work still uncommitted) · **Scope:** state of Feature 2 as delivered from `SANDBOX_PROMPT.md`, before `TEST2_PROMPT.md`.

## 1. Commands

| Command | Result |
|---|---|
| `corepack pnpm install` | ✅ OK (pnpm 12.14 via corepack; esbuild and sharp build scripts allowed in `pnpm-workspace.yaml`) |
| `corepack pnpm -r typecheck` | ✅ 0 errors (contracts, scene-engine, web; src and test configs) |
| `corepack pnpm -r test` | ✅ 110/110: contracts 3, scene-engine 85, web 22 |
| `corepack pnpm -r lint` | ❌ **No lint script or ESLint config exists.** The "no React/Three/DOM in core" rule is enforced only by `scene-engine/test/purity.test.ts`. |
| `corepack pnpm --filter @house/web build` | ✅ (single 1.3 MB JS chunk, warning only) |

## 2. Package layout
```
packages/contracts     Zod schemas + types, fixtures/demo-room.json, demo-scan.json
packages/scene-engine  pure TS: math, polygon, obb, shell, config, rules, ops, commands, matching, placement, history,
                       fixtureFormat; fixtures/geometry-cases.json, match-cases.json
apps/web               Vite + React 18 + R3F 8 + Drei 9 + three 0.170 + Zustand 5
  src/catalog          AssetCatalog + LocalAssetCatalog
  src/persistence      ScenePersistence + LocalScenePersistence (mock)
  src/state            store (zustand), autosave, loader (fixtures + scan reproduction)
  src/scene            SceneCanvas, RoomShellMesh, SceneObjectMesh, SelectionOverlay, TransformControlsWrapper,
                       CameraController, Lighting, canvasBridge, registry, dragFeedback, fit, prepareModel
  src/ui               TopBar, FloatingToolbar, InspectorPanel, AssetBrowser, icons, useKeyboardShortcuts
  src/dev              AssetGallery (?gallery)
tools/asset-ingest     catalog builder (Poly Haven CC0 + self-authored rugs)
```

## 3. Original acceptance checklist, re-tested

Re-run in headless Edge (screenshots plus DOM checks) and by unit tests. GPU runs used `--use-angle=d3d11`, which renders on the laptop's **Intel UHD Graphics** (confirmed with `WEBGL_debug_renderer_info`).

| Item | Status |
|---|---|
| Notes exist | ✅ `SANDBOX_NOTES.md` |
| Boots into demo room; orbit/pan/zoom/reset; camera above floor | ✅ (`maxPolarAngle`) |
| Scan reproduction deterministic | ✅ (5 matched, 2 placeholders; tested) |
| PBR + shadows, GLB fetched once | ✅ |
| Add / duplicate / swap undoable | ✅ (store tests) |
| Click selects; orbit-drag from furniture doesn't select; gizmo release doesn't deselect; empty click deselects | ✅ |
| Highlighting one instance doesn't change others | ✅ (overlay; `makeGhost` test) |
| Per-class transforms; orbit off while dragging | ✅ |
| ~60 FPS while dragging | ✅ **58.5 rAF/s** dragging the desk in the 10-object demo room (Intel UHD, 1440×900, DPR 1) |
| Lock rules; ownership still editable | ✅ |
| Desk move carries lamp; delete + undo restores both | ✅ |
| Shell immutable | ✅ |
| Rug/sofa/coffee-table and wall-art exemptions | ✅ |
| Live invalid feedback; out-of-room snap-back; warnings flagged | ✅ |
| Exact undo/redo; rejected undo toasts | ✅ |
| Autosave once, never mid-drag; failure and conflict | ✅ |
| Missing GLB → placeholder; no CDN | ✅ |
| Core free of React/Three/DOM | ✅ (test, not lint) |

## 4. Broken, clunky, or blocking for test2

The ⚠ items conflict with `TEST2_PROMPT.md` and get replaced in this round.

1. ⚠ **Surface items are locked to their parent.** The gizmo clamps the lamp to the desk top, and a lamp can't be moved onto the floor or another surface.
2. ⚠ **Y movement is disabled** for floor items, and there's no vertical move, gravity or re-parenting.
3. ⚠ **Rotation uses the TransformControls ring.** It's hard to grab from top-down or eye-level views, there are no Q/E keys and no numeric yaw.
4. ⚠ **Collision is a single 2D OBB plus a vertical interval per object.** A chair can't tuck under a desk (the table is one solid box), and there are no shelves or seat surfaces.
5. ⚠ **Drags pass through obstacles.** Collisions are only flagged on release; nothing slides or blocks.
6. **`wall_clearance` warns at under 2 cm.** A sofa pushed flush against a wall gets flagged, which contradicts the new contact-tolerance rule.
7. **No direct drag.** Dragging on furniture orbits the camera, and moving requires the gizmo.
8. **Deleting a parent deletes its children.** The new rule is that children settle.
9. **Camera** (OrbitControls): no zoom-to-cursor, no double-click focus, no frame-selection or Home key, no walk mode. Preset transitions are smooth.
10. **Wall fade is a per-frame lerp**, so its speed depends on frame rate. There's no cutaway mode, but test2 shows thick walls cut low.
11. **Shell rendering:** openings render as empty holes or plain glass. There's no multi-panel glazed sliding door, no dark frames and no built-ins (piers).
12. **No light-emitting objects**, no day/evening/golden preset, and the HDR is interior-only, so windows show a dark void.
13. **Render cost scales poorly:** every `SceneObjectNode` re-renders on any commit, because a new `childrenOf` Map prop is created each time. Fine at 10 objects, wasteful at 50–100.
14. **`frameloop` is always on**, so the GPU stays busy while idle.
15. **No multi-select, groups, alignment snaps, resize, variants, shell appearance or tilt.**
16. **Minor:**
    - Hover can flicker when the pointer moves between sub-meshes of the same object (null, then the same id).
    - The dev menu now closes on click (fixed).
    - The "Framed landscape print" glass renders near-black.

## 5. Drift from agent_docs / prompts
- `packages/scene-core` (prompts) vs `packages/contracts` + `packages/scene-engine` (CONTRACTS.md §9, SYSTEM_ARCHITECTURE §16). Kept, per `SANDBOX_NOTES.md` C1–C2. The new fixture lives at `packages/contracts/fixtures/test2-room.json`, not `packages/scene-core/fixtures/`.
- `SANDBOX_PROMPT.md` wasn't in the repo. A condensed copy is now at `agent_docs/SANDBOX_PROMPT.md`, and this round's brief at `agent_docs/TEST2_PROMPT.md`.
- No lint step, although the prompts and the README build order mention lint. ESLint is added in this round.
- **Environment:** two Vite dev servers from an earlier session are still listening on :5173 (PIDs 356 and 15972). Stopping them was not permitted from the agent. They serve this repo with HMR, so they're harmless, but you may want to close them. The new capture script starts its own server on a separate port.

## 6. Performance log
| Date | Scene | Objects | Interaction | Result (Intel UHD, headless Edge D3D11, 1440×900) |
|---|---|---|---|---|
| 2026-10-17 | demo-room | 10 | gizmo drag (desk + lamp) | 58.5 rAF/s |

| 2026-10-17 | test2 (before fixes) | 45 | barrel-chair drag into sofa | 26 rAF/s, p95 59 ms. Causes: 2 shadow-casting point lights (6 cube faces each) and un-accelerated R3F hover raycasts (264k tris) |
| 2026-10-17 | test2 | 45 | idle, lamp shadows 2 / 1 / 0 | 34 / 50 / 60 FPS |
| 2026-10-17 | test2 (after) | 45 | barrel-chair drag into sofa, 3 runs | **59.8 / 59.7 / 59.9 FPS**, p95 17.8–18.1 ms, 195 draw calls, 187k tris |
| 2026-10-17 | test2 (after) | 45 | idle (frameloop forced on) | 59.8–60 FPS (one outlier run at 44 FPS: thermal/background noise) |

Headless runs are noisy (other processes, thermals), so they're reported as runs or medians. Collision resolve microbenchmark (Node): **0.07 ms per drag tick**; full `validateScene` on test2: **1.1 ms**.

## 7. Resolution status (after the test2 round)
| Audit item | Status |
|---|---|
| No lint | Fixed: ESLint flat config (`pnpm lint`), including the core-purity rule |
| 1–5 surface lock, Y disabled, rotation ring, 2D collision, pass-through drags | Replaced: stacking/supports, lift + gravity, floor dial, compound 3D profiles, block-and-slide |
| 6 2 cm wall clearance | Removed (contact tolerance 1 mm) |
| 7 no direct drag | Fixed: drag the object itself |
| 8 delete cascades | Fixed: children settle (one undo entry) |
| 9 camera | Fixed: Drei CameraControls, dolly-to-cursor, double-click focus, F/Home, walk mode |
| 10 fade / cutaway | Fixed: time-based fade, cut-away (default) / fade / full |
| 11 shell rendering | Fixed: glazed multi-panel doors/windows with dark frames |
| 12 lights / presets | Fixed: lamps emit light, day / golden / evening presets |
| 13 node re-renders | Fixed: subtree-identity memo (only changed subtrees re-render) |
| 14 frameloop | Fixed: on-demand rendering when idle (`IdleFrameloop`) |
| 15 multi-select, groups, snaps, resize, variants, appearance, tilt | Added |
| 16 hover flicker | Mitigated: hover paused during drags; BVH raycasts |
| Stray dev servers on :5173 | Still running (couldn't be stopped from the agent); the capture script uses its own port |


## 8. Merge round performance (2026-10-18, `feature/3d-sandbox-jordan-merge`)
React 19 / R3F 9 / three 0.180 stack, merged features (shape outlines, real top faces, contact guides, magnetic catch). Same machine and method as §6 (Intel UHD, headless Edge D3D11, 1440×900): barrel chair swept into and along the sofa for 4 s (`apps/web/scripts/checks/perf.mjs`).

| Interaction | Run 1 | Run 2 | Run 3 | p95 frame | Draw calls |
|---|---|---|---|---|---|
| Move tool | 59.8 | 59.8 | 59.4 FPS | 17.5–17.6 ms | 164 |
| 3D move | 60.0 | 60.1 | 60.1 FPS | 17.3–17.6 ms | 165 |
| Move + "Show all outlines" | 60.0 | 60.0 | 60.0 FPS | 17.4–17.6 ms | 208 |

CPU microbenchmarks (`pnpm --filter @house/scene-engine bench`, Node): full `validateScene` on test2 0.42 ms; one block-and-slide drag tick 0.03 ms; one gravity `findSupport` with real top faces 0.18 ms.
