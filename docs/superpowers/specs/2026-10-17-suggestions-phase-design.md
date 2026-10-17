# Suggestions Phase and Free Swivel — Design

**Date:** 2026-10-17 · **Branch:** `feature/3d-sandbox-codex` · **Status:** approved in conversation, pending spec review

## Goal

Every manual edit in the sandbox becomes a *suggestion*, like a code assistant showing a diff before you approve it. While suggesting, any state is allowed, including overlaps and out-of-bounds pieces. Pressing **Accept (✓)** checks the whole set at once: pieces that fit are applied, and pieces that collide are moved to the nearest valid spot. The same model will later apply AI design proposals.

Rotation also becomes a free swivel controlled by a ring around the selected piece.

## Non-goals

- Partial accept or per-change staging (a single row can be *reverted*, but Accept is all-or-nothing).
- Persisting drafts across reloads.
- AI proposals themselves; this builds the mechanism they will reuse.
- Moving untouched pieces to make room (option C, rejected).

## Architecture

The editor holds two scenes:

- **Accepted scene:** the existing `scene` store. Autosaved, with accepted history.
- **Draft scene:** a new `draft` store, `{ scene: SceneSpec | null, undo: SceneSpec[], redo: SceneSpec[] }`. `null` means there are no pending suggestions.

The 3D view and inspector render the draft when it exists, otherwise the accepted scene. Suggested changes are derived by diffing draft against accepted by object ID, not stored as an op log. That keeps draft undo simple and matches the `ScenePatch`-against-a-base shape in `CONTRACTS.md`.

## 1. Resolving on Accept (`packages/scene-engine`)

New pure function:

```ts
resolveDraft(accepted: SceneSpec, draft: SceneSpec, ctx: SceneContext):
  | { ok: true; scene: SceneSpec; report: ResolutionEntry[] }
  | { ok: false; unresolved: { objectId: string; message: string }[] }

type ResolutionEntry = {
  objectId: string;
  outcome: "applied" | "moved" | "reverted" | "dropped" | "removed";
  distanceM?: number; // for "moved"
};
```

**Algorithm:**

1. **Diff** by object ID:
   - *untouched:* deep-equal in both scenes;
   - *removed:* in accepted only;
   - *changed:* transform, asset, dimensions or material differ;
   - *added:* in the draft only.
2. **Seed** the result with untouched pieces only, with removals applied. Untouched pieces are fixed and never move.
3. **Place** changed and added pieces one at a time, in draft array order, validating each against the pieces placed so far with the existing `validateObject`:
   1. If it is valid where the user put it, the outcome is `applied`.
   2. Otherwise, search rings outward from the suggested position in 5 cm steps, up to 1.5 m, keeping the suggested rotation. If a valid spot is found, the outcome is `moved`, with `distanceM`.
   3. Otherwise:
      - a changed piece is restored to its accepted transform, asset and dimensions if that is valid (`reverted`);
      - an added piece is omitted (`dropped`).
   4. Otherwise it is unresolved.
4. Each placed piece becomes fixed for later pieces.
5. **Locked pieces are never moved by the resolver.** If a locked piece is invalid at its suggested state, skip step 3.2 and go straight to `reverted`.
6. If anything is unresolved, return `{ ok: false }` and commit nothing.
7. Otherwise, return the scene with `revision` incremented once. Array order follows the draft; dropped pieces are omitted.

"Valid" is unchanged: the footprint must be inside the floor polygon, clear of wall bands and doorway clearance, and not overlapping other floor-occupying pieces. Rugs and wall- or object-supported items keep their existing occupancy exemptions.

**Invariant:** an accepted scene always passes full validation for every object.

## 2. Draft editing, undo and saving

**Relaxed reducer.** `applyOp(scene, op, ctx, options?: { allowConflicts?: boolean })`.

- With `allowConflicts`, `validateObject` skips only these fixable checks:
  - `OUT_OF_BOUNDS` (floor polygon and wall band);
  - `BLOCKS_OPENING`;
  - `COLLISION`.
- Still enforced:
  - `OBJECT_LOCKED`;
  - `UNKNOWN_OBJECT`;
  - `UNKNOWN_ASSET`;
  - `DUPLICATE_ID`;
  - `INVALID_TRANSFORM` (including the planar floor rule);
  - `INVALID_SUPPORT`;
  - `ROOM_MISMATCH`.
- The default behaviour, used by commits, the server and tests, is unchanged.

**`suggest(op)`** is the single entry point for all edits:

- drag move;
- swivel;
- R / Shift+R and the rotate buttons;
- the rotation input;
- add;
- replace;
- delete.

On the first suggestion, it clones the accepted scene into the draft. It applies the op with `allowConflicts`. On success, it pushes the previous draft snapshot to `draft.undo` and clears `draft.redo`. On a hard error, it shows the message and leaves the draft unchanged.

**Lock and unlock** stay immediate. They apply to the accepted scene through `commit`, with autosave and accepted history, and to the draft if one exists. A lock is protection, not a design change, so it never shows in the change list.

**Undo and redo:**

- **With a draft:** ⌘Z and ⇧⌘Z step through draft snapshots. Undoing back to a snapshot equal to the accepted scene clears the draft.
- **Without a draft:** they step through accepted history, unchanged from today.
- **Accept:** records one accepted-history entry for the whole batch, using a checkpoint inverse with the before and after scenes, then clears the draft and schedules autosave.
- **Discard:** clears the draft. It is not undoable, which the button tooltip states.

**Saving:**

- Autosave writes only the accepted scene.
- While a draft has changes, `beforeunload` asks for confirmation.
- The top-bar status reads **"N unsaved suggestions"** in place of "Saved".

**Live conflicts.** For each changed or added piece, run the full `validateObject` against the draft, excluding the piece itself. These results drive the red boxes, the conflict count and the ⚠ reasons. Recompute them when the draft changes. During a drag, the existing throttled live check now validates against the draft, and release always succeeds; nothing springs back.

## 3. Review UI

**Suggestions bar.** A glass pill, bottom centre, visible whenever a draft exists.

- Shows `● N suggested changes · M conflicts`, a ⌄ expander, a quiet **✕ Discard** button and an accent **✓ Accept** button.
- **Return** accepts.
- **Esc** deselects if something is selected; otherwise it discards.
- Text fields are ignored by both shortcuts.

**Change list (⌄).** Rows are grouped as Moved, Rotated, Replaced, Added and Removed.

- There is one row per piece. A piece that is both moved and rotated is listed under Moved and shows both magnitudes. Replaced takes precedence over Moved.
- Each row shows the piece name, the magnitude of the change (distance in metres or angle in degrees), and ⚠ with the reason if the piece conflicts.
- Clicking a row selects that piece.
- A row's **↺** button reverts just that piece to its accepted state, or removes it if it was added. This is pushed as a draft step.

**In 3D:**

- Changed pieces show a faint dashed "before" outline at their accepted footprint. Removed pieces show only that outline.
- Added pieces get a small accent **New** tag.
- Conflicting pieces get a red selection box, whether selected or not.

**After Accept:**

- A toast summarises the result, for example "Applied 4 changes · Armchair moved 32 cm to fit · Floor lamp removed".
- Pieces with outcome `moved` pulse briefly.
- If any piece is unresolved, the draft stays open, the first stuck piece is selected, and the toast explains how to make room.

**After Discard,** pieces ease back to their accepted transforms using the existing spring-back.

## 4. Free swivel

- **Ring.** When an unlocked piece is selected, show a flat ring just above the floor around it. The radius is half the footprint diagonal plus 0.15 m. A round handle on the ring sits at the piece's +Z front. Colour is the selection blue-violet, brightening on hover. Locked pieces show no ring.
- **Drag.**
  - Dragging the handle or the ring rotates the piece about its centre to the pointer's angle on the floor plane.
  - **Shift** snaps to 15°.
  - Rotation is applied imperatively to the Three.js group, with no React render per frame, mirroring the move pipeline.
  - A floating angle label (for example "127°") follows the handle.
  - The live conflict check updates while dragging.
  - Orbit controls are disabled during the swivel.
- **Commit.** On release, call `suggest({ type: "move", transform })` once. It is never rejected for conflicts.
- **Other controls.**
  - R / Shift+R and the toolbar's rotate button step ±15° as suggestions.
  - The details card shows rotation as an editable degrees input, alongside −/+.
- **Engine.** No change. Rotation is already a `move` op with a full quaternion, and oriented footprints already handle arbitrary angles.

## Testing

**`packages/scene-engine`:**

- `resolveDraft` covers each outcome:
  - applied;
  - moved to the nearest fit, asserting the distance and rotation;
  - reverted;
  - dropped;
  - unresolved.
- It also covers:
  - untouched pieces never moving;
  - locked pieces never moved, only reverted;
  - rug exemption;
  - the doorway;
  - processing order;
  - full validity of every accepted result.
- `applyOp` with `allowConflicts`:
  - permits collisions, out-of-bounds and doorway overlaps;
  - still rejects lock, unknown and invalid-transform errors.

**`apps/web` integration:**

- One gesture produces one draft step.
- Draft undo and redo, then fall-through to accepted undo.
- Accept produces one accepted-history entry and exactly one autosave.
- Discard restores the accepted scene.
- Row revert works.
- Unresolved Accept keeps the draft open.
- Locks stay immediate and are enforced in the draft.

**Browser smoke test:**

- Drag a piece onto another and see the red conflict box and count.
- Accept: the piece ends up moved to fit and the toast reports it.
- No console errors.
- The existing add, rotate, undo and reload flow is updated to the suggestion model.

## Affected files

| File | Change |
|---|---|
| `packages/scene-engine/src/operations.ts` | `allowConflicts` option on `validateObject`, `validateOp` and `applyOp` |
| `packages/scene-engine/src/resolve.ts` (new) | `diffScenes`, `resolveDraft` |
| `apps/web/src/state/editor.ts` | Draft store, `suggest`, accept/discard/revert, draft-aware undo, conflicts; `DragSession` releases into the draft |
| `apps/web/src/scene/Furniture.tsx`, `SceneCanvas.tsx` | Render the draft scene; "before" outlines; New tag; conflict boxes |
| `apps/web/src/scene/SwivelRing.tsx` (new) | Ring, handle and angle label; imperative rotation |
| `apps/web/src/components/SuggestionsBar.tsx` (new) | Bar, change list, accept/discard/revert |
| `apps/web/src/components/TopBar.tsx`, `InspectorPanel.tsx`, `App.tsx` | Unsaved-suggestions status, rotation input, keyboard shortcuts |
| `apps/web/README.md` | Document the suggestion model |
