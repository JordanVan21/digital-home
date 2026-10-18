# Handoff: 3D sandbox session state (2026-10-17)

> **This file describes the codex sandbox *before* the merge.** For this branch's current state, read `docs/MERGE_PLAN.md` first. Since this file was written, colliders have changed: they bake at **2 cm with exact surface heights** (not 4 cm), close seams up to 4 cm, and let pieces settle on the highest top under them (`docs/COLLIDER_PRECISION.md`, README decision 29).

This file records everything that happened in the Claude Code session after your original build. It covers what changed, why it changed, what the user decided, and what is still open.

**Precedence:**

- Where this file and the original brief in `AGENTS.md` disagree, this file wins.
- Product and architecture background lives in `agent_docs/` and is not repeated here.
- The most detailed record of the latest feature is the spec at `docs/superpowers/specs/2026-10-17-suggestions-phase-design.md`.

## Current viewing behavior: no previous-position ghosts

The user changed the display choice: previous-position ghosts are removed entirely. A `Bounding boxes` toggle in the right-side view controls shows or hides current furniture collider exteriors, off by default. It works in development and production and is view-only (no draft/history/save mutation). Outlines use the exterior-only compound union described below and live inside each furniture transform, so they follow dragging, rotation and carried-stack previews. Old `BeforeOutline` and implicit debug selection boxes are removed. The following ghost notes describe the superseded checkpoint; the union algorithm is now used only by the explicit current-scene toggle.

## Current fixes: couch containment and previous-position ghosts

- Reproduced the walnut coffee table entirely hidden inside the linen couch with a real-model browser screenshot. The previous voxel flood fill could reach the space beneath its skirting from below the model; collider baking now treats the supporting plane at model bottom as closed. The couch body becomes solid (58 merged blocks instead of 138), while side-accessible desk/chair gaps and open-top containers remain open. No category rule or full-object convex hull is used. Rebuild via `pnpm geometry:bake`; generated profiles are checked against the same model hashes.
- Dashed `BeforeOutline` ghosts now use the baked compound union's exterior crease edges, replacing the single large box. Shared faces, overlaps, coplanar seams, collinear fragments and enclosed internal cavities are removed. Actual open gaps remain visible. Normalized exterior positions are cached per collider profile, with per-object geometry copies for dimensions and dashed distances; accepted transform/scale are preserved. Normal editor small-box selection overlays remain removed.
- Regression coverage includes couch/table rejection and safe Accept, yaw/scale, support-plane closure versus open gaps, touching/overlapping boxes, L-shaped unions, open holes versus sealed cavities, all catalog profiles, and the GPU-free ghost renderer.

## Latest Codex sandbox update: compound geometry and attached items

This update supersedes older box-support/move-only notes below. Work stays in `/Users/jeffreyg/Projects/digital-home-codex-sandbox` on `feature/3d-sandbox-codex`; no push or main-checkout edits.

- Compound outlines and selection boxes are now development-only; production skips their construction/rendering while keeping opaque model mesh picking. Collision queries use a cached local-space BVH per asset to prune sub-box pairs; geometry and tolerance are unchanged. Warm desk/chair CPU measurements were 6,018 → 284 leaf comparisons and 0.1116 → 0.0432 ms/query (2.58×), with 256 deterministic equivalence cases. `collision.bench.ts` repeats the workload.
- Opaque models use compound renderer outlines and mesh picking in development. Object collisions use baked, normalized 4 cm compound profiles matched by asset ID/content hash, a box broad phase and sub-block narrow phase with 0.1 mm penetration tolerance. Missing/stale/alpha profiles and proxies fall back to boxes. `pnpm geometry:bake` regenerates numeric data; the scene engine stays independent of Three.js.
- Snapping/contact now uses exposed compound top patches (including lower chair seats and interior shelves), lowest occupied child bottom faces, the existing supported-center rule, and nonpenetrating contact. Floor contact remains exact; no category whitelist. Internal covered faces and empty outer-box tops are excluded. Guides show the patch. Alt bypass remains. Room/door bounds still use outer boxes.
- `placement.parentId` defines attachment. `moveAssembly` moves/rotates recursive descendants at local offsets. Moving a child independently leaves its ancestor fixed; its own descendants follow. Locked descendants block support movement; nonuniform group scaling is rejected. Transient `editor.motion` transforms let descendants follow live without pointer-driven React rerenders.
- Accept searches and reverts edited stacks atomically, instead of resolving each child independently. One pointer gesture is one draft undo step; Accept is one saved checkpoint. Reverting a support carries its descendants back too.
- New engine tests were first run failing, then implemented: actual chair seat/shelf snapping; no hidden/empty-face contacts; yaw/scale; recursive movement; detachment; locks; carried collisions; group resolver; elevation. Renderer tests cover imperative translation/rotation/cancel and one-step undo. Browser test `compound-snapping-stack.spec.ts` verifies seat snapping, carrying, undo/redo, save and reload. The earlier missing swivel-drag test has also been added.
- Geometry is still approximate; 0.1 mm query tolerance does not imply 0.1 mm shape fidelity. Legacy placements resting in empty outer-box space need re-snapping. Side/ceiling attachment and real-hardware FPS remain unverified/future work.

---

## 1. Where things are

- **Worktree:** `/Users/jeffreyg/Projects/digital-home-codex-sandbox`, on branch `feature/3d-sandbox-codex`.
- **Main checkout:** `/Users/jeffreyg/Projects/digital-home` is on `main`. Do not touch it, and do not touch any other branch.
- **Commits on this branch:** everything is committed; nothing has been pushed.

  | Commit    | What it is                                                   | Author                                   |
  | --------- | ------------------------------------------------------------ | ---------------------------------------- |
  | `30963a8` | Workspace setup                                              | Your original build, committed by Claude |
  | `80162ee` | Contracts package                                            | Your original build, committed by Claude |
  | `b63d327` | Scene engine                                                 | Your original build, committed by Claude |
  | `99f63d5` | FurniMesh assets                                             | Your original build, committed by Claude |
  | `288768b` | Web app, plus two browser-review fixes (see §4)              | Your original build, committed by Claude |
  | `842c6fd` | Glass UI restyle                                             | Claude                                   |
  | `86046a2` | Suggestions-phase spec                                       | Claude                                   |
  | `d5bef5f` | Engine: `allowConflicts`, `resolveDraft`, `recordCheckpoint` | Claude                                   |
  | `74e7b86` | Draft-based editor, 3D draft rendering, swivel ring          | Claude                                   |
  | `22d33a4` | Suggestions bar, rotation input, draft-aware chrome          | Claude                                   |

- **Last full verification:** typecheck, lint, 58 unit and integration tests, the build, and the Playwright smoke test all pass.

## 2. Environment quirks you will hit

- **`pnpm` is not installed globally.**
  - Use the copy you set up earlier: `export PATH=/tmp/house-tools/node_modules/.bin:$PATH`.
  - If `/tmp` has been cleared, run `corepack enable` or `npm i -g pnpm`.
- **Git writes fail inside your workspace-write sandbox.** The worktree's git metadata lives in `/Users/jeffreyg/Projects/digital-home/.git/worktrees/…`, and `index.lock` creation is denied there.
  - If you can't commit, leave the work uncommitted.
  - End with a clear summary of the changed files, so the user (or Claude) can review and commit.
- **Browser test:** run `HOUSE_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm test:browser`.
  - The pinned Playwright Chromium (build 1248) is not downloaded.
  - In your sandbox, Chrome is killed before a page opens. If that happens again, say so; don't claim browser verification.
- **Headless Chrome uses SwiftShader (software WebGL).** This makes the main thread slow, with two visible side effects:
  - CSS transitions and animations crawl. The suggestions bar's fade-in and the accent-colour transition take about 1–2 s.
  - Lighting-preset switches stall for about 2 s while the environment re-bakes.

  These are environment artifacts, not bugs. Screenshots taken right after a UI change can catch elements mid-fade.

- **FPS has never been measured on real hardware.** Use `pnpm dev` and append `?debug` to the URL for the stats overlay.
- **Dev server:** `pnpm dev --host 127.0.0.1 --port 5173 --strictPort`. The server Claude started stops when its session ends.

## 3. What the user decided (respect these)

1. **Sandbox scope.** This branch covers only the sandbox: viewing the 3D room, interacting with it, and manual control. No backend, auth, AI, budget or timeline.
2. **Furniture:** real free models. FurniMesh is preferred, with CC0 sources as fallback. This is already done: 12 models are in place.
3. **UI style follows `assets/ui-reference.png`,** copied in from the user's upload.
   - **Warmth is not a constant.** It belonged to that one room's look, and the user explicitly said a minimal house would not look warm.
   - So the chrome is neutral frosted glass. The only hue is `--accent`, driven by a lighting preset (see §5.3).
   - Panels use dark text on light glass. This is a deliberate deviation from the reference's white-on-dark, because the room sits on a light backdrop.
4. **Out-of-scope parts of the reference were left as empty space,** reserved for the features that will fill them:
   - the AI Design Assistant (right side);
   - style chips;
   - Make It Real;
   - Save Version;
   - Designs and Versions;
   - the Home Evolution timeline (bottom strip).
5. **Visual-only controls are acceptable.** The user said "it can be pure ui, not functionality behind the ui". These are currently visual-only:
   - top-bar search (⌘K focuses it);
   - room switcher;
   - the Search nav pill;
   - Duplicate (shows a "coming soon" toast);
   - the 2D toggle;
   - the Measurements toggle.
6. **Suggestions phase.** Every edit is a suggestion; nothing is blocked for collisions. Accept resolves the draft. The user's analogy was Claude showing a code diff before you approve it.
7. **Resolver option A.** Only pieces the user changed may move. Each moves to the nearest valid spot from where it was dropped, keeping its rotation. Otherwise a changed piece reverts and an added piece is dropped. Untouched pieces never move.
8. **Free swivel** replaces stepped-only rotation, via a ring gizmo. Shift snaps to 15°.
9. **Locks stay immediate.** A lock is protection, not a design change, so it is never a suggestion.

**How the user works:**

- They want designs agreed first, one section at a time, and a written spec before significant features.
- They approve commits explicitly; ask before committing.
- They like to try things in the browser themselves.
- Keep summaries short and concrete.

## 4. Bugs found in browser review and fixed (don't regress)

- **Added furniture could not rotate.**
  - **Cause:** placement found the nearest free spot with zero clearance, so pieces were wedged against neighbours.
  - **Fix:** `chooseAsset` first searches with a square footprint the size of the piece's diagonal (its rotation circle), then falls back to the real footprint.
- **React 19 "synchronously unmount a root" errors and an uncaught `removeChild`.** These came from drei `<Html>`. The rules now are:
  1. **Never put `<Html>` inside a Suspense fallback.** Loading proxies have no label.
  2. **Every `<Html>` must pass `portal={labelLayer}`.** This is a stable container from `scene/labelLayer.ts`, set to the canvas wrapper div. Without it, `<Html>` re-parents onto `events.connected` after R3F connects events, which tears down its React root mid-render.
  3. **Give every `<Html>` a small `zIndexRange`**, such as `[2, 0]`, or `[5, 0]` for the object toolbar, so labels stay under the UI panels.
- **Missing favicon (404).** Fixed with an inline SVG favicon in `apps/web/index.html`.
- **UI read the accepted scene instead of the draft,** so draft-only pieces had no details card. All UI must read the _working_ scene:
  - in React, use `useWorkingObject(id)` from `state/useWorking.ts`;
  - imperatively, use `editor.working()`.

## 5. Architecture added this session

### 5.1 Scene engine (`packages/scene-engine`)

- **`validateObject`, `validateOp` and `applyOp` take `options: { allowConflicts?: boolean }`.**
  - When it is set, only the _fixable_ checks are skipped: bounds, wall band, doorway and `COLLISION`.
  - Locks, unknown objects or assets, duplicate IDs, invalid transforms (including the planar floor rule), support and room mismatch are always enforced.
- **`resolve.ts`:**
  - `diffScenes(accepted, draft)` returns `{ untouched, changed, added, removed }` as lists of IDs. The `locked` flag is ignored when comparing.
  - `resolveDraft(accepted, draft, ctx)` returns `{ ok, scene, report }` or `{ ok: false, unresolved }`. Each report entry's `outcome` is one of `applied`, `moved` (with `distanceM`), `reverted`, `dropped` or `removed`.
  - The ring search uses 5 cm steps out to 1.5 m. Pieces are placed in draft array order, so earlier pieces claim space first.
  - Locked pieces are never moved by the resolver; they are only reverted.
- **`history.ts`:**
  - `recordCheckpoint(history, before, after)` stores one undo entry for a whole accepted batch.
  - `HistoryEntry.op` may now be a checkpoint.
- **Room fact used in tests:** the fixture doorway keep-out is x 1.3–2.3, z 1.15–2.2. Don't place test pieces there unless you are testing the doorway.

### 5.2 Editor state (`apps/web/src/state/editor.ts`)

- **Two scenes.**
  - `editor.scene` is the accepted room. It is autosaved and has accepted history.
  - `editor.draft` holds `{ scene | null, undo, redo, conflicts, resolved }`.
  - `editor.working()` returns the draft if there is one, otherwise the accepted scene.
- **`suggest(op)`** is the entry point for every edit except locks. It applies the op with `allowConflicts` and pushes a draft undo step.
  - It auto-clears the draft when no differences remain.
  - `conflicts` maps each piece ID to its full-validation message.
- **`accept()`** calls `resolveDraft`, commits the result as one checkpoint history entry, autosaves, and shows a summary toast. It also fills `draft.resolved` with the IDs of moved pieces, which drives a green pulse.
  - If anything is unresolved, it keeps the draft, selects the stuck piece and shows a toast.
- **`discard()`** drops the draft. **`revertPiece(id)`** reverts one piece as a draft step. **`changes()`** returns one `Change` row per piece.
- **`setYaw(radians)`** applies a free yaw as a suggestion. **`rotate(±1)`** steps to the 15° grid via `setYaw`.
- **`toggleLock`** commits to the accepted scene and also patches the draft.
- **`travel(dir)`** undoes and redoes through the draft first (when a draft exists or the draft stack is non-empty), then through accepted history.
  - Draft snapshots are re-synced to the accepted lock flags.
  - `TopBar`'s `canUndo`/`canRedo` mirror this logic exactly. Keep them in sync.
- **`DragSession`**: `preview` runs full validation for live red feedback, and `release` always calls `suggest`.

### 5.3 Rendering and UI (`apps/web/src`)

- **`theme.ts`** defines the lighting presets `golden-hour`, `daylight` and `overcast`.
  - Each preset sets the lights, environment, backdrop, contact-shadow colour, lamp intensity, and `accent`/`accentInk`.
  - `useLighting()` returns the view override (`interaction.lighting`, which is not persisted) or `scene.lightingPreset`.
  - `ThemeSync` in `App.tsx` writes `--accent`, `--accent-ink` and `--backdrop` onto `:root`.
- **`SceneCanvas` `Objects`** renders working-scene pieces. It passes `isNew` for added pieces and renders a `BeforeOutline` (a dashed box at the accepted transform) for changed and removed pieces.
- **`Furniture`:**
  - Group position and rotation are set only on mount.
  - After that, `useFrame` eases toward the piece's transform in `editor.working()`. This is why discard, undo and resolver moves glide.
  - Drag and swivel write to the Three.js group imperatively. There must be no React state updates per pointer move; a test checks `Model` render counts.
  - A gesture's `mode` is `"move"`, `"swivel"` or `null`.
  - The outline colour is red for a live-invalid gesture or a persistent conflict, green for a resolver pulse, and violet when selected.
- **`SwivelRing`:**
  - A child of the piece's group, so its handle stays at the +Z front.
  - Ring radius is half the footprint diagonal plus 0.15 m.
  - The angle label text is set imperatively via a ref.
- **Chrome components:**
  - `TopBar`;
  - `SideNav` (Objects, Search);
  - `ViewControls` (lighting, 2D, fit) and `MeasurementsToggle`;
  - `ObjectToolbar`, rendered in `<Html>` above the selected piece;
  - `InspectorPanel`: shown only while something is selected, with an editable rotation `<input aria-label="Rotation in degrees">`;
  - `SuggestionsBar`.
- **Toast:** now top-centre, at `top: 100px`, because the suggestions bar owns the bottom-centre.
- **Keyboard:**
  - Return accepts.
  - Esc closes or deselects first; with nothing to close, it discards.
  - Text inputs are ignored by the global shortcuts.
  - `beforeunload` warns while a draft exists.

## 6. Open items and known gaps (none are assigned yet; confirm with the user before large work)

- The swivel ring _drag_ has no automated test. Rotation via buttons and the input is tested. Hand-testing is pending.
- FPS on real hardware is unmeasured for drag, swivel, and lighting-preset switches.
- The visual-only controls in §3.5 have no behaviour yet.
- The resolver places pieces in draft array order, and a piece's revert target can be taken by an earlier-placed piece. That case is reported as unresolved, which is correct per the spec, but the UX for it is just a toast.
- `DragSession.preview` and the live check both validate against the working scene, which includes other conflicted draft pieces. That is acceptable; just know it.
- A draft does not survive a reload; this is a spec non-goal.
- `apps/web/README.md` is kept current, including Decisions 13–15. Update it with any behaviour change.

## 7. Working agreements (unchanged from the brief unless noted)

- `packages/scene-engine` stays pure: no React, Three.js or DOM.
- Contracts change only additively, and changes are recorded in the README's Decisions.
- Follow test-first for engine and editor logic.
- After changes, run `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, plus the browser test if Chrome works in your environment.
- Do not modify `agent_docs/` or `assets/`.
- Do not push.

Compound sub-box outlines have now been removed from the normal editor in both development and production, including their runtime generation. Compound collision data, BVH acceleration and shape snapping remain active. The isolated geometry lab remains available for inspection.
