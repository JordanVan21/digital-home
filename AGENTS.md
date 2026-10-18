> **A merge is in progress on this branch (`feature/3d-sandbox-codex-base`). Start here, in this order:**
> 1. `docs/MERGE_GUIDELINES.md`: the rules.
> 2. `docs/MERGE_PLAN.md`: what's done, the user's decisions, and the ordered checklist. The next step is the first unchecked one.
> 3. `docs/SESSION_NOTES.md`: environment, ports, commands and gotchas.
> 4. The spec for the step, if one exists (e.g. `docs/COLLIDER_PRECISION.md` for colliders).
>
> **Working rules for the merge override "work autonomously" below:**
> - Write tests first and see them fail.
> - One feature per commit.
> - Run every check after each step (see MERGE_PLAN "How we work").
> - Verify in GPU Chrome.
> - **Ask the user before every commit, and never push.**
> - Explain each finished step in plain words, with a before/after screenshot when it's visual.

> **Merging Jordan's sandbox into this base? Read `docs/MERGE_GUIDELINES.md` first.** It sets the rule (keep codex; adapt Jordan's missing features and look into it) and its exceptions.

> **Read `docs/HANDOFF.md` first.** It describes the current state of this branch and the user's decisions since this brief was written, and it overrides this brief where they conflict. Notably, collisions no longer block edits: every edit is a suggestion that is resolved on Accept.

# Task: Build the House 3D Sandbox (independent build)

You are building the **3D sandbox** for House, a DubHacks 2026 project. Work autonomously from start to finish on branch `feature/3d-sandbox-codex`. Make reasonable decisions without asking; record notable ones in `apps/web/README.md` under "Decisions".

## 1. What the sandbox is

The sandbox is where a user **views their scanned room in 3D, interacts with it, and controls everything manually**. It is the desktop editor at the center of the product. Nothing else is in scope for this task.

**In scope**
- Rendering a room (floor, walls, doors, windows) from structured JSON, plus furniture as individual GLB models.
- Camera: orbit, pan, zoom, reset view.
- Object editing: select, move, rotate, add (from a small catalog), delete, lock/unlock.
- Collision and room-bounds validation for edits.
- Undo/redo.
- Autosave with visible save status (local persistence only, see §6).
- Minimal editor UI chrome: top bar, floating tool cluster, inspector, asset picker.

**Out of scope. Do not build, stub minimally if an interface requires it:**
auth/Supabase, backend API, iOS/RoomPlan import, AI design proposals, style questionnaire, budget/timeline/milestones, proposal diff preview, Keep/Replace/Remove planning UI, multiplayer.

## 2. Read first

The spec set lives in `agent_docs/`. `CONTRACTS.md` is authoritative for data shapes. Relevant sections:
- `CONTRACTS.md` §1 (coordinates, units, identity), §2 (types: `RoomShell`, `SceneObject`, `SceneSpec`, `AssetSpec`, `SceneOp`), §3 item 5 (undo semantics), §4 (validation rules).
- `FEATURE_DESIGN.md` §2.1, §3.2 (workspace layout), §3.5 (asset browser), §4.2 (editing UX), §5 (state domains), §6 (component inventory), §7 (visual style), §8 (shortcuts).
- `FUNCTIONAL_SPEC.md` §3 (editor behavior), §8 (asset normalization).
- `SYSTEM_ARCHITECTURE.md` §16 (monorepo layout, scene-engine purity rule).
- `agent_docs/finaldiagram.png`: the "3d Sandbox" and "state" boxes summarize the feature list.

Ignore sections about AI, budget, timeline, and backend except where they constrain the data model.

## 3. Visual target

Study `assets/test2.png` and `assets/test1.png`. Aim for `test2.png`:
- Elevated three-quarter "dollhouse" view of a cutaway room: you look down into it from above at an angle.
- Warm, soft, golden-hour lighting; realistic PBR materials (light oak floor, matte warm-white walls); soft contact and directional shadows; environment lighting (Drei `<Environment>` or similar). Tone-mapped (ACES or AgX), sRGB output.
- Walls nearest the camera must not block the view. Implement a cutaway: walls whose outward normal faces the camera are hidden, faded, or cut to a low height, and this updates as the user orbits.
- Selection: a thin, crisp blue-violet bounding box around the selected object with small dot handles at the corners (as on the sofa in `test2.png`). Hover may use a subtler white outline (like `test1.png`).
- Editor chrome: minimal, translucent, soft rounded panels, neutral/dark, clean typography. The room is the hero; the UI should never visually dominate it.

Post-processing (SSAO, subtle bloom on lamps) is welcome **only if** it holds frame rate (§8).

## 4. Repository layout

Create a pnpm workspace monorepo, TypeScript strict everywhere:

```text
package.json, pnpm-workspace.yaml, tsconfig.base.json
packages/contracts/      Zod schemas + inferred TS types for the types in CONTRACTS.md §2 that the sandbox uses; fixture data
packages/scene-engine/   Pure TS: apply/validate/invert scene operations, geometry, collision. NO React, Three.js, DOM or Supabase imports.
apps/web/                Vite + React + TypeScript + @react-three/fiber + @react-three/drei + three + zustand
```

Leave room for later `apps/api`, `apps/worker`, and `packages/agents`, but don't create them.

## 5. Contracts and fixtures (`packages/contracts`)

- Implement Zod schemas matching CONTRACTS.md §2 exactly for `Vec3`, `Quat`, `Transform`, `Money`, `FloorPlan`, `Wall`, `Opening`, `RoomShell`, `SceneObject`, `SceneSpec`, `AssetSpec`, `SceneOp`. Export inferred types. Don't rename fields or invent parallel formats. If you genuinely need an additional field, add it as optional and note it under "Decisions".
- Conventions (CONTRACTS.md §1): meters; X right, Y up, Z forward; rotations stored as quaternions `[x,y,z,w]`; UUIDs for all IDs; money in integer cents.
- **Fixture room:** author a believable living room resembling `test2.png`. Use roughly 5.2 m × 4.4 m, ceiling 2.6 m, 0.12 m walls, one door, one wide window/sliding door, and one regular window, described as a `RoomShell`. Include a `SceneSpec` with about 10 objects: sofa, armchair, coffee table, rug, floor lamp, sideboard, bookshelf, two plants, and a desk + chair. Mark the desk as `locked: true` so locking can be demoed. Include one object with `assetId: null` to exercise the proxy path.
- **Fixture catalog:** an `AssetSpec[]` covering every model you ship (§7), with real normalized dimensions, category, styles/tags, an estimated price, `licenseStatus: 'verified'` only if you verified the license, and `glbStorageKey` pointing at the local file path.
- Add a fixture test that parses every fixture with the Zod schemas.

## 6. Scene engine (`packages/scene-engine`)

Pure, deterministic, fully unit-tested (Vitest). Minimum API, but you may shape the signatures:

- `applyOp(scene, op, ctx) -> { ok: true, scene } | { ok: false, error }`. `ctx` carries the `RoomShell` and an asset lookup. Ops: `add`, `delete`, `move` (also covers rotation, since `move` carries a full `Transform`), `replaceAsset`, `changeMaterial`, `setLock`. `replacePhysicalItem` can be implemented if it's cheap, but the sandbox UI doesn't need it.
- `validateOp(scene, op, ctx)`: the same rules, with no mutation. Return typed error codes (for example `OBJECT_LOCKED`, `OUT_OF_BOUNDS`, `COLLISION`, `BLOCKS_OPENING`, `UNKNOWN_OBJECT`, `UNKNOWN_ASSET`, `DUPLICATE_ID`, `INVALID_TRANSFORM`).
- `invertOp(sceneBefore, op) -> SceneOp` for undo.
- Rules (CONTRACTS.md §4):
  - Locked objects reject delete, move, replace, and material changes. Only `setLock` changes the lock.
  - An object's floor footprint must lie inside the floor polygon. Handle rotated footprints: use oriented rectangles, not world AABBs.
  - Footprints must not overlap other floor objects, using a simplified 2D oriented-rectangle (SAT) test on XZ.
  - A door's swing/clearance zone must stay clear.
  - Explicit category exemptions: rugs may sit under anything; wall-mounted items and objects with `placement.support: 'object'` (e.g., a lamp on a desk) are exempt from floor overlap. Encode these as an explicit rule table, not a blanket bypass.
- The operation history type: a bounded undo/redo stack of `{ op, inverse }` pairs. One completed user gesture produces exactly one entry.
- Never mutate input scenes; return new objects. Increment `revision` on each applied op.

## 7. Furniture assets

- Use **real, free models**:
  - **FurniMesh** (https://furnimesh.com/library/) is the preferred source. It provides GLBs free for commercial use without attribution. Confirm the terms on the site at download time.
  - CC0 sources (Poly Haven, Kenney, Quaternius) are acceptable fallbacks.
  - Pick models that fit the warm, minimal look of `test2.png`.
- Target about 10–14 models across: sofa, armchair, coffee table, rug, floor lamp, sideboard, bookshelf, plant, desk, desk chair, side table, bed (optional).
- If you cannot download from a source in your environment, do not fabricate files. Fall back to well-proportioned procedural proxy furniture built from simple primitives with appropriate materials, keep everything else working, and list the models to fetch under "Decisions".
- Normalize every model (script it, for example with `@gltf-transform/cli` or a Node script):
  - meters scale;
  - +Y up;
  - front facing +Z;
  - origin at bottom-center (floor contact);
  - Draco/meshopt compression where it helps.
  
  Record the final bounding-box dimensions in the catalog.
- Put models in `apps/web/public/models/` and thumbnails (if generated) in `apps/web/public/thumbnails/`.
- Write `apps/web/public/models/LICENSES.md` listing each file's source URL, author, license, and download date. Don't ship any file whose license you couldn't confirm.
- Rendering rules:
  - Cache GLBs by asset ID (`useGLTF` caching is fine).
  - Clone per instance.
  - A missing/failed GLB renders a neutral labelled proxy box sized to `dimensionsM` and must never crash the canvas (use an error boundary per object).
  - Scale each model so its bounding box matches the object's `dimensionsM`.

## 8. Interaction architecture: the hard requirements

These come from the PRD and are the point of the feature:

1. **60 FPS while dragging.** During a drag, update the Three.js object imperatively (refs), not through React state or the Zustand scene store. No React re-render of the scene per pointer move.
2. **Commit on release.** On pointer-up, build one `move` op, validate it with scene-engine, and then:
   - if it's valid, apply it to the store, push it onto undo, and schedule a save;
   - if it's invalid, animate the object back to its last valid transform and show a brief, clear reason (for example a toast saying "Would collide with Sofa").
   
   During the drag, give live validity feedback (selection box turns red/amber when the current position is invalid) using the same pure validator, throttled if needed.
3. **Movement feel.** Drag objects directly on the floor plane (raycast against `y = elevation`). Optional grid snap is toggled by holding a modifier. Don't use a full 3-axis gizmo for move; floor-plane dragging feels much better for furniture. For rotation:
   - a rotation ring/handle around the selected object, or
   - `R`/`Shift+R` to rotate by 15°, or
   - a free rotate mode.
   
   Your choice, but it must feel smooth and snap to 15° by default.
4. **Camera.** Orbit/pan/zoom (Drei `OrbitControls` or `CameraControls`). Disable camera controls while dragging an object. Clamp the polar angle so the camera can't go below the floor, limit the zoom distance, and add a `Reset View` that frames the room. The default view matches the elevated three-quarter angle of `test2.png`.
5. **State domains (Zustand), kept separate:**
   - persisted scene state;
   - ephemeral interaction state (hover, drag, tool mode, open panels);
   - history (undo/redo);
   - save/network status.
   
   Use selectors so UI updates don't re-render the canvas.
6. **Locked objects** show a small lock badge, have disabled move/rotate/delete controls, and reject drags (the object doesn't move; the cursor and toast indicate it's locked).

## 9. Persistence

Define an interface in `apps/web` like:

```ts
interface SceneRepository {
  load(roomId: string): Promise<SceneSpec>;
  save(scene: SceneSpec, baseRevision: number): Promise<{ revision: number }>; // throws a typed CONFLICT error on stale revision
}
```

- Implement `LocalStorageSceneRepository`, falling back to the fixture on first load. A real API implementation will replace it later; don't build that.
- Autosave is debounced about 500 ms after the last committed op, and saves are serialized (never two in flight).
- The top bar shows `Saved` / `Saving…` / `Save failed — Retry`. A reload restores the last saved scene. Add a "Reset room to fixture" action (in a menu) for demos.

## 10. UI (React overlay on full-window canvas)

Follow FEATURE_DESIGN.md §3.2 layout and §6 component names where sensible:
- **TopBar:** room name, mode label, save status, Reset View.
- **FloatingToolbar (left):** select, move, rotate, add, delete, lock/unlock, undo, redo.
- **InspectorPanel (right, collapsible):**
  - with nothing selected: room info (dimensions, object count).
  - with an object selected: name, category, lock toggle, position (m) and rotation (°) readouts, asset source, delete, and replace (opens the asset picker filtered to the same category, keeping the position and rotation).
- **AssetBrowser:** a panel or popover listing catalog items with thumbnail (or a category icon), name, dimensions, and price. Clicking an item places it at a valid free spot near the room center, or enters a "click to place" mode. Either way, the placement is validated.
- **Keyboard shortcuts** (FEATURE_DESIGN §8):

  | Key | Action |
  |---|---|
  | `V` | select |
  | `G` | move |
  | `R` | rotate (or rotate step) |
  | `Delete` / `Backspace` | delete |
  | `Esc` | deselect / close panel |
  | `L` | lock toggle |
  | `Cmd/Ctrl+Z` | undo |
  | `Shift+Cmd/Ctrl+Z` | redo |

  Shortcuts don't fire while typing in inputs.
- **Accessibility:** buttons have labels and tooltips, and the focus state is visible.
- No consumer-facing jargon like `SceneOp`, `revision`, or `patch`.

## 11. Testing and verification

- **scene-engine:** Vitest unit tests for every op, including:
  - lock rejection;
  - out-of-bounds with a rotated footprint;
  - SAT collision (touching vs. overlapping);
  - rug exemption;
  - door clearance;
  - inverse-op round trips (`apply(op)` then `apply(invert(op))` equals the original);
  - undo/redo stack bounds.
- **contracts:** every fixture parses.
- **web:**
  - a few store/integration tests (Vitest + Testing Library) covering:
    - commit-on-release creating exactly one history entry;
    - an invalid drop reverting;
    - debounced autosave firing once for a burst.
  - optionally, a Playwright smoke test that loads the app, verifies the canvas renders with no console errors, selects an object, and moves it.
- **Root scripts:** `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`. All must pass before you finish.
- **Performance check:** with the fixture room loaded, dragging should hold about 60 FPS on a laptop. Keep:
  - total triangles reasonable (aim < 500k);
  - shadow-casting lights to 1–2;
  - textures ≤ 2K.
  
  Add an optional `?debug` query flag that shows `r3f-perf` or Drei's `<Stats>`.

## 12. Definition of done

1. `pnpm install && pnpm dev` opens a polished, warm-lit cutaway room resembling `assets/test2.png`, with real furniture models (or high-quality procedural fallbacks if downloads were impossible).
2. The user can do all of the following, with each edit autosaving and surviving a page reload:
   - orbit, pan, zoom, and reset the view;
   - hover and select objects;
   - drag-move on the floor;
   - rotate;
   - add from the catalog;
   - replace;
   - delete;
   - lock and unlock;
   - undo and redo.
3. Invalid moves (into walls, outside the room, overlapping furniture, blocking the door, or moving a locked object) are prevented with clear feedback.
4. Dragging stays smooth (no React re-render per frame).
5. `pnpm build`, `pnpm test`, `pnpm typecheck`, and `pnpm lint` pass.
6. `apps/web/README.md` explains how to run it, the architecture (store domains, drag pipeline, scene-engine boundary), the "Decisions" list, and known gaps.
7. `LICENSES.md` exists for all shipped models.

## 13. Working agreements

- Commit early and often on `feature/3d-sandbox-codex` with clear messages. Do not push, and do not touch other branches.
- Don't modify `agent_docs/` or `assets/`.
- Prefer small, focused files. Scene-engine purity is non-negotiable, because the backend will import it later to validate AI proposals.
- When the docs and this brief conflict, this brief wins for sandbox scope and `CONTRACTS.md` wins for data shapes.
- If you finish early, polish in this order:
  1. visual fidelity to `test2.png`;
  2. drag/rotate feel;
  3. selection visuals;
  4. empty/error states.
