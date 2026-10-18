# Merge guidelines: Jordan's sandbox into the codex base

**Branch:** `feature/3d-sandbox-codex-base` (off `feature/3d-sandbox-codex` @ `139676f`), worktree `/Users/jeffreyg/Projects/digital-home-codex-base`.
**Written:** 2026-10-17, after a first merge attempt in the opposite direction (see §7).
**Read this before `docs/HANDOFF.md`.** HANDOFF describes the codex base as it is; this file describes what to bring into it and how.

## 1. The rule

**Keep codex. When Jordan's branch has a feature the codex version doesn't, adapt that feature into the codex base.**

The user tried both builds side by side. The verdict:
- **Codex feels much better.** Its controls, interaction, rotation, collision handling, glass UI and overall UX are the reference. Port nothing from Jordan that replaces a codex behaviour that already works.
- **Jordan's looks better** and includes a complex example (the 45-item `test2` room). Bring over the look and the features codex lacks.

"Adapt" means rebuild the feature inside codex's architecture (its editor store, draft/suggest/accept flow, `Furniture.tsx` gesture model, components and styles). Don't transplant Jordan's modules and reconcile afterwards. That is how the first attempt ended up feeling like Jordan.

### Suggest vs. accept (user rule, non-negotiable)
- **Before Accept is a rule-breaking phase.** No physics, no gravity, no collision enforcement. What the user puts somewhere stays there exactly.
- **Accept turns the rules back on.** Gravity settles moved or added pieces where needed, and then collisions are resolved (resolver option A: only changed pieces move, to the nearest valid spot; otherwise they revert or drop).
- Snapping is allowed while suggesting, because it is a placement aid and not physics. Alt bypasses it.
- Codex already behaves this way (`allowConflicts`, `resolveDraft` using `onNearestSurface`). **Check one detail:** `onNearestSurface` picks the nearest face up *or* down. The user's phrase is "gravity is turned on if needed", so a piece left in mid-air should fall to the surface below it. Decide this with the user if it differs.

## 2. When the rule should NOT apply

Bring Jordan's version instead of keeping codex's in these cases. Each still has to be adapted into codex's structure.

| Area | Take Jordan's because |
|---|---|
| **3D look**: lighting presets and HDRs (`scene/Lighting.tsx`, `public/hdr`), room shell rendering with cut-away/fade walls, glazing and openings (`RoomShellMesh.tsx`), floor textures (`public/textures`), wall paint and floor finishes, model preparation and fit (`prepareModel.ts`, `fit.ts`), lamp lights with a shadow budget, tone mapping and fog | It is "the look" the user chose. Keep codex's scene graph and gesture code, but render with Jordan's lighting, shell and materials. |
| **Camera** (`CameraRig.tsx`, drei `CameraControls`): animated transitions, dolly-to-cursor, damping, view presets (top / iso / eye / frame selection / frame room), **walk mode** | The user called out the walk view and the transitions/animations as good. Codex has only basic orbit with reset view. Don't let camera controls steal codex's drag gestures: codex stops propagation on furniture pointer-down; Jordan used a capture-phase router. |
| **Catalog breadth**: 39 assets, thumbnails, procedural CC0 assets, `tools/asset-ingest` | More and better-looking models. Merge with codex's 15 (FurniMesh/Poly Haven) and keep license provenance for every asset. Re-bake codex collider profiles for every new GLB (codex `scripts/bake-colliders.mjs`, closed base). |
| **Fixtures**: `test2-room.json` (complex reference room), `demo-room.json`, `demo-scan.json`, and the scan-reproduction matching that turns a RoomPlan scan into catalog matches or labelled placeholders | The complex example helps everyone. The room switcher should load these. |
| **Contracts**: Jordan's `packages/contracts` is a superset of the same CONTRACTS.md shape (`placement.float`, `support: 'ceiling'`, `parentId`, `tilt`, `groupId`, `lightOn`, scene `appearance`, plus ops `setPlacement`, `resize`, `setTilt`, `setGroup`, `setLight`, `setSceneSettings`, `setRenovationDecision`, and a nullable `assetId` in `replaceAsset`) | The ported features need these fields, and everything stays schema-first for the agent connection. Add them to codex's schemas **additively**, record each in `apps/web/README.md` Decisions, and keep CONTRACTS.md §10 from Jordan's branch. |
| **Persistence contract**: Jordan saves **op patches** through `saveScenePatch(roomId, baseRevision, idempotencyKey, operations)`, with revision CAS, idempotent retry and a conflict state (`persistence/ScenePersistence.ts`, `state/autosave.ts`) | CONTRACTS.md specifies patches, and the backend will be patch-based. Codex autosaves whole-scene snapshots. Keep codex's autosave UX and status, but make Accept emit a validated contract patch and save that. The first merge attempt implemented `diffToOps` (scene diff → verified op list) and a patch-based autosave you can reuse (§7). |
| **Features codex lacks entirely**: see the inventory in §3 | Not a conflict, so add them. |

**Never port:**
- Jordan's blocking collision ("block-and-slide", snap-back on error)
- Jordan's wireframe selection boxes and corner dots
- the translate gizmo
- floating "Hits X" drag labels
- per-frame batched drag updates
- relative (delta) rotation snapping
- gravity on release while suggesting

These all lost to codex in the side-by-side comparison.

**Ask the user first:**
- **Jordan's "small decor hops onto the surface under the cursor" while dragging.** Codex needs the piece lifted to the surface height first, then contact-snaps it. The hop is convenient, but it is a Jordan behaviour on top of codex snapping, and the user still felt the first merge was off. Default: don't port it, and offer it.
- **Multi-object rotation** around the selection centre. Codex rotates one piece. Only relevant once multi-select is ported.

## 3. Jordan feature inventory to adapt (all missing from codex)

Paths are in `origin/feature/3d-sandblox-jordan` (`c27fed7`), checked out at `/Users/jeffreyg/Projects/dh-review/3d-sandblox-jordan`.

**Scene and visuals**
1. Lighting presets day / golden hour / evening, with HDR environments and a sun fitted to the room's main opening (`scene/Lighting.tsx`). Map them onto codex's preset-driven theme (`theme.ts`), so `--accent` and backdrop follow them.
2. Room shell (`scene/RoomShellMesh.tsx`, `scene/wallGeometry`): wall modes cut away / fade / show for the walls nearest the camera, glazed doors and windows, floor textures, wall paint (scene `appearance`).
3. Lamp and pendant lights with a scene-wide shadow budget, emissive materials, and a light on/off toggle (`AssetLight` in `scene/SceneObjectMesh.tsx`).
4. Decor tilt in 90° steps, plus a per-instance "Remove" ghost when the plan decision is Remove (`prepareModel.ts` `makeGhost`, `makeVariant`).
5. Finishes: asset `variants` swatches, applied as `materialOverrides`.
6. `IdleFrameloop` (renders on demand when idle) and `PerfProbe` / `?perf`.

**Editing features**
7. Duplicate (codex shows "coming soon"). `duplicateObject` plus a free-spot offset.
8. Multi-select: Shift-click and Shift-drag box select (`interaction/boxSelect.ts`).
9. Persistent groups: Ctrl/Cmd+G to group, Shift to ungroup; clicking selects the group, Alt picks one member.
10. Wall-mounted items (art): slide along walls, crossing corners. Ceiling items (pendants): `wallPose`, `findWallSpot`, `ceilingPose`. Codex has no wall or ceiling class.
11. Resize with keep-proportions; children stay seated (`resizeOps`).
12. Float flag: stays in the air after Accept. It fits the suggest/accept rule as the explicit exception to gravity.
13. Keep / Replace / Remove planning picker, independent of the lock.
14. Replace model ranked by dimension fit (`rankByDimensionFit`, `SwapPicker`). Codex's "Replace model" opens the browser filtered by category; combine the two.
15. Library drag-and-drop into the room (drop point → floor or surface). Codex places new pieces with a ring search from the room centre. Keep that for clicks and add drop for drags.
16. Keyboard additions: arrow-key nudges (camera-relative, Shift ×10), Q/E rotate (snap to the absolute 15° grid as codex does), F frame selection, Home frame room, P walk, Ctrl+D duplicate.
17. Reference photo overlay and "Match photo" camera for test2 (`ui/Overlays.tsx`, `scene/photoCamera.ts`).
18. Dev menu: simulate a save failure, simulate an edit from another session, reset the room.

**From the original sandbox** (`origin/feature/3d-sandbox`, `9c07024`, at `/Users/jeffreyg/Projects/dh-review/3d-sandbox`). The user wants these for the agent connection:
19. Schema-first edit log: every mutation is a list of typed contract ops; suggestions and the accepted patch are logged, and each entry expands to its JSON (`ui/EditLogPanel.tsx`, `state/opLog.ts`).
20. Editable X / Y / Z coordinates with live updates through the same validated path. Codex's inspector shows read-only X/Y/Z plus a height input.

**Not in scope:** the aesthetic-planner agent chat (`feature/aesthetic-planner`). The user said core 3D sandbox only.

## 4. UI direction

- Codex layout and components: top bar, side nav, round view controls, floating object toolbar, inspector card, suggestions bar, library modal.
- **Warm, light glass** (user's choice). Codex's glass is neutral; tint it warm and keep it light. The first attempt's tokens are a reasonable start (cream fill `rgba(255,249,241,0.6)`, warm ink `#2b2520`, warm shadow `rgba(64,40,18,…)`, a terracotta accent per preset; more opaque glass over the dark evening backdrop). See `apps/web/src/styles.css` `:root` and `ui/theme.ts` on `feature/3d-sandbox-merge`.
- **Where Jordan features go:**
  - lighting, wall mode, camera views and walk → round view controls on the right
  - paint, floor finish and room facts → an inspector "Room" card when nothing is selected
  - finishes, tilt, light, resize, Float and plan → sections in the inspector
  - duplicate → the object toolbar
  - dev actions → the room menu
  - the scene sources (demo room / from scan / test2) → the room switcher
- Codex's React 19 `<Html>` rules (HANDOFF §4): `portal={labelLayer}`, a small `zIndexRange`, and never inside a Suspense fallback. Jordan's branch is React 18 and doesn't follow them, so apply them to every ported label.

## 5. Process

- Work step by step, one feature per commit, with tests first for engine and editor logic (codex agreement). Ask before committing if the user is present; they approve commits.
- After each step run `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, plus `pnpm test:browser` with `HOUSE_BROWSER_EXECUTABLE` set to the system Chrome.
- **Verify in a real browser with GPU, and compare against codex at `127.0.0.1:5182`** as you go: the user judges by feel. Headless Chrome with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` renders on the M4 GPU. The default headless mode uses SwiftShader, which is slow and misleading for feel.
- `packages/scene-engine` stays pure: no React, Three.js or DOM imports.

## 6. Environment

- **Codex base:** `packageManager pnpm@10.32.1`. A pnpm 10 binary is at `/tmp/house-tools/node_modules/.bin/pnpm`; if `/tmp` was cleared, use `npx -y pnpm@10.32.1`.
- **Jordan, original and first-merge branches:** pin `pnpm@12.14.0`. The local shim is broken; use `npx -y pnpm@12.14.0`.
- **Toolchains:** the codex base is React 19, R3F 9, drei 10, three 0.180 and Vite 7; Jordan's is React 18, R3F 8, drei 9, three 0.170 and Vite 5. Keep codex's toolchain and update ported code to it, for example the drei 10 `CameraControls` and `Environment` APIs.
- **Running review copies** (dev servers started in the previous session may have stopped; restart them with `vite --host 127.0.0.1 --port N --strictPort` from `apps/web`):

  | Branch | Port | Path |
  |---|---|---|
  | jordan | 5181 | `dh-review/3d-sandblox-jordan` |
  | codex | 5182 | `digital-home-codex-sandbox` |
  | original | 5183 | `dh-review/3d-sandbox` |
  | first merge | 5190 | `digital-home-merge` |

- **Fixture asset IDs** differ between codex (`00000000-…-1000` range) and Jordan (`a55e7000-…`). Keep both and union the catalogs. Jordan's fixtures reference his IDs.

## 7. Reusable work from the first attempt (`feature/3d-sandbox-merge`, pushed, tip `6594292`)

That branch went Jordan-base with codex UX ported on top. The user rejected the result: "the controls are not as good as the codex version". Its UX code is therefore not a reference. These pieces are self-contained and worth lifting, adapted to codex's code:

- **`tools/asset-ingest/bake-colliders.mjs`:** codex's voxel collider bake (closed base) for Jordan's catalog, written in Jordan's NormBox convention. Codex's own baker already covers the codex convention; reuse this script's GLB-loading logic, including front-axis rotation.
- **`packages/scene-engine/src/draft.ts` `diffToOps`:** turns any draft into a verified, ordered contract-op list (handles stacks, carried children, replacements and deletes). Use it to make Accept emit a patch.
- **`apps/web/src/state/opLog.ts`, `ui/EditLogPanel.tsx`:** the schema-typed edit log, extended to Jordan's op set.
- **`apps/web/src/ui/theme.ts`, the `styles.css` `:root` tokens:** warm light glass, per-preset accent and glass opacity.
- **Lessons:**
  - Mesh-baked colliders produce up to about 200 boxes per model. Jordan's pairwise SAT was too slow until box pairs were pruned by their bounds; codex's BVH already handles this.
  - Shelf boards need exact heights for items resting on them. Voxel boards quantize up to 4 cm, so keep explicit boards or a top-patch rule for shelving.
  - Alpha-material models (leaves, glass) should keep box profiles, because their mesh isn't their silhouette.
  - zod parsing reorders object keys, so compare scenes with a stable stringify.
