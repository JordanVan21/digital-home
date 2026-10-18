# Merge plan: Jordan's sandbox into the codex base

**Branch:** `feature/3d-sandbox-codex-base`, worktree `/Users/jeffreyg/Projects/digital-home-codex-base`.
**Last updated:** 2026-10-17.

**Read in this order:**
1. `docs/MERGE_GUIDELINES.md`: the rules. It is authoritative.
2. This file: the plan and progress.
3. `docs/SESSION_NOTES.md`: environment, decisions and gotchas from the working sessions.
4. `docs/COLLIDER_PRECISION.md`: the spec for the next step.

**Remaining merge steps are being implemented; full verification runs at the end.** Step 6 was skipped because all test2 pieces now validate without a soft-item exemption.

**Handoff (2026-10-17):** Claude Code did steps 0–4. Codex continues from step 5 under the same rules.

## Framing (user, 2026-10-17)

> "We are taking inspiration from jordan branch to make our codex branch look better. the core functionality is still codex, we are just making that experience richer with better visuals and some bonus fun features."

Codex's interaction stays: controls, the suggest/Accept flow, nearest-surface placement, the resolver and the glass UI. Jordan's branch is a source of looks and features, rebuilt inside codex's architecture.

## How we work

- **One feature per commit.** Write tests first for engine and editor logic, and run them red before implementing.
- **Autonomous continuation approved by the user (2026-10-17):** finish the merge and commit without further approval prompts. Never push. Compare the completed build with both reference versions.
- **After each step, run every check:** `pnpm format`, `typecheck`, `lint`, `test`, `build`, and the browser suite. For the browser suite, set `HOUSE_E2E_PORT=5185` and `HOUSE_BROWSER_EXECUTABLE` to the system Chrome (see SESSION_NOTES).
- **Verify in GPU Chrome and compare against the original codex** at `127.0.0.1:5182`.
- **Explain each finished step plainly:** what the user will *see* differently, with a before/after screenshot when it is visual. Keep summaries short.
- **When a choice between versions is unclear, pick on UX,** and say which you picked and why.

## Done

| Step | Commit | Summary |
|---|---|---|
| 0 Baseline | (none) | Dependencies installed, all checks green, GPU screenshot harness |
| 1 Room abstraction | `8a979c0` | Editor bound to a `RoomDefinition`; `editor.context()`; repository per room; `HOUSE_E2E_PORT` for browser tests |
| 2 Catalog merge | `72c77f2` | Jordan's 39 assets (54 total), colliders baked, self-authored thumbnails GPU-rendered, provider credits fixed |
| 3a Rooms + fixtures | `d21478c` | Room switcher (living room, test2, demo studio, scanned studio); additive contract fields; walls re-centred on import; scan matching ported; sliding doors keep a 0.9 m walkway |
| 3b Tilt | `8a6b889` | Quarter-turn tilt in engine geometry, colliders and rendering; test2's books lie flat |
| Docs | `834ae2c` | This plan, session notes, collider spec |
| 4 Collider precision | `75b7df1` | 2 cm colliders with exact surface heights, seam closing, settling on uneven tops; test2 40/45 valid (the 5 left are the sofa pillows and throw, fixed in step 5) |

## Decisions the user made (do not re-ask)

- No decor "hop" onto the surface under the cursor. No multi-object rotation around the selection centre.
- **No soft-furnishings overlap rule.** test2's pillows sit 9–12 cm inside the sofa's back cushion, which is not physically feasible either. They will be re-posed leaning on the cushion once full rotation exists. A small tolerance for soft items may come later, on top of exact geometry.
- **Every piece can rotate on all three axes**, furniture included.
- **Rotation controls go in the inspector:** X (pitch), Y (turn) and Z (roll) degree fields with ±15° steps, plus quick poses ("Lay flat", "Lean back 15°"). The existing swivel ring stays for yaw; no extra rings in the 3D view.
- **Collider precision: exact surface heights on 2 cm blocks** (options 1 + 2). Convex decomposition (CoACD) was tried and dropped: it was inaccurate and slow on the scanned models. Spec and trial numbers: `docs/COLLIDER_PRECISION.md`. It must be a general rule, not book- or shelf-specific.
- **Stability rule:** a piece is supported when its centre is over its contact area. Applies from step 5.

## Checklist (in order)

### Next: geometry foundation
- [x] **4 Collider precision** (`75b7df1`). Bake at 2 cm and trim every block top to the real geometry (spec: `docs/COLLIDER_PRECISION.md`). Acceptance: test2's shelf books and dishes are valid and snap onto the real boards; the chair-under-desk and couch-containment regressions hold; dragging stays smooth.
- [x] **5 Full 3-axis rotation.** Relax the engine's "Keep furniture upright" rule; add X/Y/Z degree fields and quick poses in the inspector; Accept settles a rotated piece by its lowest point (nearest surface, up or down). Fold `tilt` into `transform.rotation` (the importer converts test2's tilts; keep the schema field for compatibility). Re-pose test2's three sofa pillows leaning back against the back cushion. Update the swivel ring to be yaw about world Y for tipped pieces.
- [x] **6 (Skipped: no soft-item overlap needed after re-posing)** (Optional) a few cm of tolerance for soft items,** only if it still feels needed after steps 4 and 5. Ask the user first.

### Then: the look (Jordan wins these, adapted into codex)
- [x] **7 Lighting.** Jordan's day / golden hour / evening, with local HDRs (`public/hdr`), a sun fitted through the main opening, tone mapping and fog, mapped onto codex's `theme.ts` presets (`daylight`, `golden-hour`, `evening`; the fixtures already use these IDs). The accent and backdrop follow the preset.
- [x] **8 Room shell.** Jordan's `RoomShellMesh`: wall modes cut-away / fade / show for camera-facing walls, glazed doors and windows (`glazing`), doorless openings, floor textures (`public/textures`), wall paint and floor finish from scene `appearance`. Hide or fade wall items on cut-down walls (the demo studio's painting floats today). Controls: wall mode in the round view controls; paint and floor in an inspector "Room" card when nothing is selected.
- [x] **9 Warm light glass.** Tint codex's glass warm and light. Start from the tokens in `feature/3d-sandbox-merge` (`styles.css` `:root`, `ui/theme.ts`): cream fill `rgba(255,249,241,0.6)`, ink `#2b2520`, warm shadow `rgba(64,40,18,…)`, a terracotta accent per preset, more opaque glass on the evening backdrop.
- [x] **10 Camera.** drei 10 `CameraControls`: animated transitions, dolly-to-cursor, damping; views top / iso / eye / frame selection / frame room; walk mode. Furniture drags must keep priority (codex stops propagation on pointer-down). Replaces codex's OrbitControls and the step 1 target clamp.
- [x] **11 Lamps.** Lamp and pendant lights with a shadow budget, emissive materials, on/off (`lightOn` contract field, `setLight` op). Render on demand when idle (`IdleFrameloop`) and add a `?perf` probe.

### Then: bonus features (adapt into codex's editor and gestures)
- [x] **12 Duplicate** (toolbar + Ctrl/Cmd+D; the copy goes to a nearby free spot; replaces the "coming soon" toast).
- [x] **13 Keyboard:** arrow nudges relative to the camera (Shift ×10), Q/E rotate on the absolute 15° grid, F frame selection, Home frame room, P walk.
- [x] **14 Editable X / Y / Z position** in the inspector, through `suggest`.
- [x] **15 Multi-select:** Shift-click and Shift-drag box select.
- [x] **16 Groups:** Ctrl/Cmd+G group, Shift+Ctrl/Cmd+G ungroup; click selects the group, Alt picks a member.
- [x] **17 Wall and ceiling items:** art slides along walls and around corners; pendants hang from the ceiling (support `ceiling`).
- [x] **18 Resize** with keep-proportions; children stay seated.
- [ ] **19 Float flag:** stays in the air after Accept (the explicit exception to nearest-surface placement).
- [ ] **20 Finishes:** asset `variants` swatches applied as `materialOverrides` (Jordan's catalog has `variants` and `light` metadata that the step 2 import dropped; re-import it with the schema extension).
- [ ] **21 Keep / Replace / Remove planning picker** (independent of the lock) with a ghost for Remove.
- [ ] **22 Replace model** ranked by dimension fit (`rankByDimensionFit` already exists in `scene-engine/src/matching.ts`).
- [ ] **23 Drag from the library** into the room (drop point onto floor or surface); clicking keeps codex's ring search.
- [ ] **24 Reference photo overlay and "Match photo" camera** for test2 (`photoCamera` and `referenceImage: "assets/test2.png"` are already on the room definition; the image lives in Jordan's branch).
- [ ] **25 Dev menu:** simulate a save failure, simulate an edit from another session, reset room.

### Last: plumbing for the agent connection
- [ ] **26 Patch-based saving.** Accept emits a validated contract patch (`diffToOps` from `feature/3d-sandbox-merge` `packages/scene-engine/src/draft.ts`) and saves it with `saveScenePatch(roomId, baseRevision, idempotencyKey, operations)`: revision CAS, idempotent retry, conflict state. Keep codex's autosave UX.
- [ ] **27 Schema-typed edit log panel** (`opLog.ts`, `EditLogPanel.tsx` from the first merge attempt, extended to the op set).

### Never port
Jordan's block-and-slide collision and snap-back, wireframe selection boxes and corner dots, the translate gizmo, floating "Hits X" labels, per-frame batched drag updates, relative rotation snapping, gravity on release while suggesting, falling-only gravity on Accept. Do not use `feature/3d-sandbox-merge`'s interaction code as a reference.
