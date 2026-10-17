# Handoff: 3D Sandbox — session notes

**Branch:** `feature/3d-sandbox` (off `main`, PR open against `JordanVan21/digital-home`)
**As of:** 2026-10-17, commits `ec9dcb1` → `c2fc986` (4 commits, working tree clean, pushed)

This file is implementation-specific context from building the 3D sandbox feature — decisions, bugs, and plan that aren't in `agent_docs/`. Read `agent_docs/` first for product/architecture ground truth; this is the "what actually happened and why" layer on top of it.

## Working process established with the user

We're going step by step, in this order, each step gated on the previous looking/working right before moving on:

1. **Base functionality** — schema-backed, data-driven, every mutation logged and visible. ✅ done
2. **Collision/placement validation** — real geometric checks, not a stub. ✅ done
3. **Visual quality via real assets** — GLBs, not primitive stand-ins. ⬅ **next**
4. **Performance optimization** — after it looks right, make it fast.

Explicit user priorities to keep in mind for step 3+:
- **Hyper-realism is the goal.** Final objects should be either an approved/licensed GLB (FurniMesh candidate per `agent_docs`) or a model authored/edited in Blender — not raw Three.js primitives. Three.js is for *displaying* assets well, not constructing them.
- **Component modularity**: must be able to change one scene item without regenerating/reloading the rest. This was a design constraint while building the current code (see "Architecture notes" below) — keep honoring it when wiring in GLBs.
- **Schema tied to the render**: `SceneObject.assetId` is supposed to resolve to a real `AssetSpec` → GLB. Right now it never does (see "Known gaps").
- The user verifies everything by actually driving the running app in a browser, not just by reading a typecheck pass. Expect to be asked "did you test it" — always do, and fix what you find, including bugs in your own new code and in pre-existing fixture data.
- Fix root causes, not the validator/requirement, when something you built trips a check. E.g. when the new collision validator flagged two overlapping objects in the fixture, we moved the furniture, not loosened the check — because the check's whole purpose is to hold a future agent planner's output to a real standard.
- Commit with a detailed message and push after each step; don't batch unrelated work into one commit.

## What's built, by layer

### `packages/contracts`
Full Zod schema set from `CONTRACTS.md` (not just what the sandbox needs) — `SceneSpec`, `SceneObject`, `RoomShell`, `AssetSpec`, `SceneOp` union, `DesignBrief`, budget types, etc. This is intentionally ahead of what's wired up, so later phases don't need schema rework.

### `packages/scene-engine`
Pure TS, zero React/Three imports — the shared validator/reducer layer `apps/api`/`apps/worker` will reuse later.
- `geometry.ts` — point-in-polygon, quaternion↔yaw conversion, and a 2D oriented-bounding-box (OBB) type + corner computation + SAT overlap test.
- `collision.ts` — the real placement validator: full-footprint floor containment, wall-thickness clearance, doorway keep-out, object-object overlap, with explicit semantic exemptions (rugs exempt from overlap; wall/object-mounted items skip floor-plane checks entirely).
- `reduce.ts` / `invert.ts` — pure `applyOp`/`invertOp` for every `SceneOp` variant.
- `validate.ts` — `validateOp`/`validatePatch`, the single choke point every caller (UI drag, coordinates popup, undo/redo, future agent) goes through.

**Important gotcha, hit twice and worth remembering:** three.js's `Ry(θ)` rotation convention maps local `+X → world (cosθ, -sinθ)` and local `+Z → world (sinθ, cosθ)` in the XZ plane. Both the wall-segment orientation code and the OBB corner math got this backwards on the first pass (objects/walls rendered in the wrong place/orientation) before being corrected. Any new geometry code that rotates something by a yaw angle should double check against this convention rather than re-deriving it from scratch.

### `apps/web`
No backend exists yet — `apps/api`/`apps/worker` are not started. Autosave is a local Zustand-only stand-in (explicitly commented as such in `sceneStore.ts`), and `createDesignProposal`/catalog endpoints etc. don't exist. Treat all UI buttons for unbuilt features (Design, Preview, Timeline, Save Version, search, room switcher, Objects/Designs/Versions/Search nav, AI Design Assistant) as intentional disabled stubs with `title="Coming in a later phase"` — don't silently wire them to fake behavior.

State (`src/state/`):
- `sceneStore.ts` — the `SceneSpec`/`RoomShell` live here, typed exactly per `@house/contracts`. `commitOp` is the only path that mutates the scene: validate → apply → push undo entry → log → schedule autosave. `moveObject`/`deleteObject`/`setLock`/`duplicateObject` are thin wrappers over `commitOp`. Everything returns a boolean (accepted/rejected) — UI code should check it.
- `opLog.ts` — `summarizeOp`/`makeLogEntry`, pure formatting, no store coupling.
- `interactionStore.ts` — ephemeral UI state (active tool, hover, camera-reset/top-down tokens, measurements toggle). Deliberately separate from `sceneStore` per the "don't collapse everything into one store" guidance in `agent_docs`.

Scene rendering (`src/scene/`):
- `SceneCanvas.tsx` — R3F `Canvas` (transparent, `gl={{alpha:true}}`), lighting presets (`golden_hour`/`daylight`, real and toggleable), `CameraController`.
- `RoomShellMesh.tsx` — procedural floor + wall-segment boxes with openings carved by splitting into pieces (no CSG). **Per-frame wall auto-fade**: walls between the camera and the room interior lerp their opacity down (not full transparency, ~6%) so the open-top room stays readable from any orbit angle — the real `RoomShell` has all 4 walls, unlike a staged cutaway render. Also renders measurement-dimension labels when toggled.
- `wallGeometry.ts` — splits a wall into solid box segments around its openings (sill/header pieces), given a wall + its openings.
- `objectVisuals.tsx` — **this is the piece step 3 replaces.** Category string → hardcoded primitive-geometry composition (boxes/cylinders/cones). `SceneObject.assetId` is currently always `null`; nothing resolves it to a real asset. This is a legitimate "proxy for unmatched objects" per `FUNCTIONAL_SPEC.md` §9, but there's no asset-id-driven path at all right now — only the proxy path exists.
- `SceneObjectMesh.tsx` — per-object component, keyed by `object.id` in the `SceneCanvas` map. Owns selection/hover, the `TransformControls` gizmo (move/rotate), and snaps the mesh back to the last valid transform if a drag's commit is rejected (see bugs below).
- `ObjectContextToolbar.tsx` — floats above the selected object (not a persistent side rail): move/rotate mode, lock, duplicate, delete, and a coordinates-popup toggle. Connected to the object by a thin line + glow dot, matching the HomeCanvas reference image in `assets/`.
- `CoordinatesPopup.tsx` — X/Y/Z/yaw fields that call `moveObject` directly — i.e. the same `commitOp` path the gizmo uses. This exists specifically to validate that "an external actor writes new coordinates to the scene row" works end-to-end; it's the manual stand-in for what an agent planner does later. Uses local-buffer-commit-on-blur/Enter, not a fully-controlled input (see bugs below for why).
- `SelectionOutline.tsx` — glowing wireframe box + corner dots, matches both reference images' selection style.
- `CameraController.tsx` — owns `OrbitControls` (orbit/pan/zoom — Drei's job, as the user wants). Also handles "reset view" and "snap to top view" via token counters bumped from `interactionStore`. **Drei does not do collision** — that's a separate concern the user initially conflated; collision lives entirely in `scene-engine` as bounding-box math, matching `CONTRACTS.md`'s explicit "not a physics simulation" framing. Worth keeping this distinction clear when talking to the user.

UI chrome (`src/ui/`): `TopBar`, `SideNav` (Objects/Designs/Versions/Search — all disabled stubs), `RightRail` (lighting toggle, top-view, reset-view, fullscreen — all real; Measurements toggle — real), `InspectorPanel` (read-only object/room detail card), `EditLogPanel` (scrollable log of every committed op, newest first, mirrors what's printed to console as `[scene-op:source] summary`).

Visual design (`src/styles/`): glassmorphism — blur + translucency + pill radii — modeled on the third reference image (`assets/131447a3-*.png`, a "HomeCanvas" product mockup the user supplied mid-session). Warm amber/orange gradient reserved for primary-action chrome (the "Design" CTA); blue reserved for 3D selection state, matching both reference images. The literal HDRI-as-background approach was tried and abandoned — drei's built-in environment presets read as a flat color wash when blurred (not photographic). Current approach: transparent canvas over a CSS blurred-blob backdrop (`.backdrop` in `ui.css`), which also makes the glass panels pick up a real tinted blur behind them.

### Fixture (`apps/web/src/fixtures/sampleRoom.ts`)
Stands in for a RoomPlan scan + initial scene until that pipeline exists. 5.2m × 4.2m room, 4 real walls (thickness 0.12m), a window opening on the west wall and a door opening on the south wall, 8 furniture objects. All 8 current positions pass the full collision validator cleanly (floor containment, wall clearance, doorway keep-out, object overlap) — verified via a throwaway script that imported `scene-engine`'s checks directly against the fixture (see `git log` for the exact positions that *didn't* pass before being nudged).

## Bugs found and fixed this session (useful context, not just history)

- **Floor mesh rotated backward**, placing it mirrored outside the room envelope — only a sliver was ever visible, through the door opening. Fixed by flipping the rotation sign; see the `Ry(θ)` note above.
- **Initial camera position looked at the *outside* of the far walls** instead of down into the open-top room — geometrically the camera was beyond the walls rather than above them. Fixed by repositioning higher and steeper.
- **A fully store-controlled number input fought its own re-renders** — `CoordinatesPopup` originally had no local buffer, so typing multi-character/decimal values could get clobbered mid-keystroke by the re-render the previous keystroke's commit triggered. Fixed with local text state, committed on blur/Enter, re-synced from the store only when not focused.
- **Rejected commits didn't revert the UI** — two instances: the coordinates popup kept showing the rejected value instead of the real one (fixed by having `onCommit` return success/failure and reverting on `false`), and the gizmo left the mesh visually in the invalid spot after a rejected drag because `TransformControls` had already mutated the Three object imperatively and the (unchanged) React props wouldn't re-apply (fixed by explicitly resetting `position`/`quaternion` on rejection).
- **`duplicateObject`'s flat +0.3/+0.3 offset guaranteed an overlap** with the source once real overlap checking existed. Changed to offset by the object's own width.
- **Fixture data had two real collisions** once actually checked: the sofa and floor lamp's bounding boxes overlapped by ~2.5cm, and the credenza sat inside the door's keep-out zone. Both were pre-existing and invisible before step 2 (nothing had ever validated the fixture's initial placements). Fixed by moving the furniture.

## Known gaps / explicitly deferred

- **No GLB rendering path.** This is step 3. Need: a local `AssetSpec` catalog (fixtures, mirroring how `sampleRoom.ts` stands in for scan data), `assetId` → `AssetSpec` → GLB resolution via drei's `useGLTF`, with the current primitive renderer kept as the fallback proxy (per `FUNCTIONAL_SPEC.md` §9's "asset missing → neutral proxy" requirement) rather than deleted. Asset source per `agent_docs`: FurniMesh (license status pending) or self-authored/Blender-constructed models — not anything procedurally generated in Three.js.
- **No backend at all** — `apps/api`, `apps/worker` don't exist. Everything is client-only; `scene-engine` is written so those can reuse it unchanged when they exist.
- **`SceneObjectMesh` isn't memoized** — fine at 8-9 objects, flagged for the performance pass (step 4), not before.
- **No automated test suite.** Verification so far has been live-browser-driven plus one throwaway diagnostic script (not committed) that called `scene-engine`'s checks directly against fixture data. Worth considering real unit tests for `scene-engine` given how pure/deterministic it is — not yet requested by the user, but a natural fit whenever it comes up.
- Overlap/placement checks use hard boundaries (no tolerance slack) by design — see the "fix root causes" note above. If this becomes a recurring friction point with more complex/irregular furniture shapes later, that's a deliberate tradeoff to revisit with the user, not a bug to silently patch around.

## Repo/tooling notes
- pnpm `12.14.0` (new enough that build-script approval config lives in `pnpm-workspace.yaml`'s `allowBuilds`, not `package.json`). Node `v26.5.0`. `npx tsx` works for one-off TS diagnostic scripts against workspace packages (run from `apps/web/` so `@house/contracts`/`@house/scene-engine` resolve).
- Dev server: `pnpm dev:web`, runs on `http://localhost:5173`.
- `gh` CLI had to be installed (`brew install gh`) and isn't authenticated — PR creation/updates need the user to run `gh auth login` themselves, or use the GitHub web UI.
