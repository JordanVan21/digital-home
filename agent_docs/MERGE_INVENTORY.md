# Merge inventory: jordan + codex sandboxes

**Date:** 2026-10-17 · **Merge branch:** `feature/3d-sandbox-jordan-merge` (made from jordan)
**Sources:** `feature/3d-sandblox-jordan` (c27fed7, called **J** below) and `origin/feature/3d-sandbox-codex` (139676f, called **C** below)
**Merge-base:** `6fc23a2` "agent_docs and assets". No sandbox code existed at the merge-base, so every code file below was written independently in each branch. Nothing was "inherited from both".

**Marks:**
- **J** = only in jordan
- **C** = only in codex
- **≠** = in both, but different
- **=** = in both, and basically the same

**Rules that still apply** (agent_docs): CONTRACTS.md names win. `packages/scene-engine` (the prompts call it scene-core) stays free of React, Three and DOM. Units are meters, Y is up, and a piece's front faces +Z. Locked items can't be edited, but their Keep/Replace/Remove plan can change. One undo entry per gesture. The room shell can't change. Autosave is debounced and never runs mid-drag.

Your answers are recorded in the **Decision** column during Step 2.

---

## 0. Big-picture differences (affect everything else)

| # | Item | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 0.1 | **Library versions** | React 18, R3F 8, drei 9, three 0.170, Vite 5, Vitest 2, TS 5.6, pnpm 12 | React 19, R3F 9, drei 10, three 0.180, Vite 7, Vitest 3, TS 5.9, pnpm 10 | ≠ | **Upgrade everything to codex's stack** |
| 0.2 | **How edits apply** | Immediately. Collisions block and slide while you drag. On release the piece settles and the change is saved. | Every edit is a **suggestion** in a draft, and anything is allowed (overlaps, out of the room). A bottom bar shows "N suggested changes · M conflicts" with **Accept (✓ / Enter)** and **Discard (✕ / Esc)**. Accept moves colliding pieces to the nearest free spot (within 1.5 m), or else puts them back. | ≠ | **Drop for now** (immediate edits, as in J). Keep the draft/`resolveDraft` code aside for future AI proposals |
| 0.3 | **Room shape support** | Any room shape, with walls that sit *on* the room edge and get thicker outward. Three scenes: demo room, demo scan, test2. | One hard-coded 5.2 × 4.4 m room, with walls *centred* on the room edge. | ≠ | **J** (assumed; needed for flush walls) |
| 0.4 | **Furniture models** | 39 assets: Poly Haven CC0 models, plus self-made procedural ones (rugs, test2 items). | 15 GLBs: 12 FurniMesh models (marked verified) and 3 Poly Haven CC0 models. Collision shapes are baked from each mesh. | ≠ | **J's catalog, plus codex's models.** The FurniMesh ones come in as `pending` (hidden) until the licence is confirmed; codex's Poly Haven CC0 models are fine |
| 0.5 | **Data-shape extras** (CONTRACTS §10 amendments) | Many optional extras: tilt, groupId, float, lightOn, appearance, ceiling support, `opening` kind, glazing, and per-asset collision/supports/variants. `scale` must be 1. | Strict CONTRACTS §2 shapes. Allows `transform.scale` other than 1, and wall support needs a wall id. | ≠ | **J** (assumed; `scale` stays 1) |

> ⚠ 0.4 licensing: `SANDBOX_NOTES.md` §6 says FurniMesh's terms don't clearly allow redistributing the files, so FurniMesh assets should stay `licenseStatus: 'pending'` until the team confirms. Codex marks them `verified`. This needs a decision before codex's models come over.

## 1. Camera and viewing

| # | Feature (what you see) | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 1.1 | Orbit / pan / zoom | Drei CameraControls with smooth damping; zoom goes toward the cursor. | OrbitControls with damping; zoom and pan are clamped to the room. | ≠ | **J** (zoom toward cursor, pan, coasting all better) |
| 1.2 | **Top / isometric / eye-level views** | Toolbar buttons with animated moves (`CameraRig.tsx` `presetPose`, store `requestCamera`). | — | J | **J** (keep) |
| 1.3 | **Frame selection** | `F` key and a toolbar button (`frameCamera('selection')`). | — | J | **J** (keep) |
| 1.4 | Reset view / frame the room | `Home` key and a top-bar button. | "Fit room in view" button (right side) and Reset view. | = | **J** (Home + top-bar Reset view; codex's Fit button not needed) |
| 1.5 | Double-click to re-target the camera | Double-click an object or the floor. | — | J | **J** (keep) |
| 1.6 | **Walk mode** | `P` key or the toolbar; WASD plus mouse look at 1.6 m; you stay inside the room and can't pass through solid objects. | — | J | **J** (keep) |
| 1.7 | "Match photo" camera + reference overlay | test2 only (top bar). | — | J | **J** (keep) |
| 1.8 | Walls nearest the camera | Fade over time. Modes: cut-away (default), fade, full. Picker in the room panel. | Drop to a low 17 cm cutaway automatically. | ≠ | **J** (cut-away / fade / full) |
| 1.9 | 2D plan view, Measurements toggle | — | Buttons only; nothing happens yet. | C | **Leave out** (not needed) |

## 2. Moving objects (X / Y / Z)

| # | Feature | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 2.1 | Drag across the floor | Drag the object itself across whatever it rests on (`sessions.ts` `MoveSession`). | Drag across a horizontal plane at the object's current height (`Furniture.tsx` `down/move/up`, `editor.ts` `DragSession`). | ≠ | **J drag feel** (drag the piece itself, block-and-slide), moving freely like C |
| 2.2 | **Vertical (Y) movement** | Hold **Alt** and drag to lift. A guide line and readout show "cm above floor / above *surface*". The move gizmo's Y arrow also works. | A "Move up or down" button switches to height mode (camera-facing plane, up/down arrow guide). Holding **Space** during a floor drag switches to height temporarily; releasing Space switches back without jumping (`movementModifier.ts`). | ≠ | **C: hold Space while dragging** to move straight up/down (X/Z kept); release Space to keep sliding at that height (2026-10-18: replaces the 3D move button, which felt janky). Scroll wheel also raises/lowers |
| 2.3 | Move gizmo (X/Y/Z arrows) | A TransformControls gizmo in Move mode; Shift snaps it to 5 cm (`TransformControlsWrapper.tsx`). | No gizmo, by design. | J | **Drop** (no coloured arrow gizmo) |
| 2.4 | Keyboard nudges | Arrow keys move 1 cm (Shift: 10 cm) relative to the camera; PageUp/PageDown move up and down. | — | J | **J** (keep) |
| 2.5 | **Position display in the panel** | One line: "1.70, -0.98 m · 0 cm above floor · on *table*" (`InspectorPanel.tsx` `TransformSection`). | Separate **X / Y / Z** readouts (read-only), an editable **Height** box (m), a **Place on floor** button, and a "Resting on *X*" line (`components/InspectorPanel.tsx`). | ≠ | **Option B**: X/Y/Z all editable in J's panel; J's rotate row stays. **No Float checkbox**: float/drop/snap like C (finalized in the stacking + gravity tryout, §14) |
| 2.6 | Floating toolbar above the selection | — | Move · Move up/down · Rotate · Duplicate (says "coming soon") · Delete · Lock · Details (`ObjectToolbar.tsx`). | C | **No** |
| 2.7 | Rotation | A floor ring "dial" for continuous 360° turning (Shift: 15° steps). **Q/E** turn 15° (Shift: 90°). Yaw number box plus ⟲15° / 15°⟳ buttons. Rotation respects collisions. | Rotate mode: drag anywhere inside a ring, or on the piece (Shift: 15° steps), with an angle label. **R / Shift+R** step ±15°. Degrees box plus − / + buttons. | ≠ | **C interaction** (drag anywhere inside the circle or on the piece) **+ J collision** (blocked / pushed clear) |
| 2.8 | Wall items | Slide along walls and up/down, and cross corners onto the next wall. | Wall support exists in the data, but there's no special drag. | J | **J** (keep) |
| 2.9 | Ceiling items (pendants) | Move across the ceiling; Alt changes the drop length. | — | J | **J** (keep) |
| 2.10 | Multi-select and group move | Shift-click and box select; the group moves and turns together with group collision. Ctrl/Cmd+G makes a lasting group. | — | J | **J** (keep) |
| 2.11 | Glide back on undo / discard | Snaps instantly. | Pieces ease smoothly to their new position. | C | **C** (keep) |

## 3. Collision

| # | Feature | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 3.1 | Object shapes used for collision | Category profiles made of compound boxes: solid; table (top plus legs, so a chair tucks under); chair (seat plus back); open shelves; flat (rugs); soft (pillows) (`scene-engine/body.ts`). Optional per-asset boxes in the catalog. | Boxes baked from each model's mesh at 4 cm, with BVH speed-up (`collision.ts`, `colliderProfiles.json`, `pnpm geometry:bake`). Missing profiles fall back to the full box. | ≠ | **J** (category compound boxes) |
| 3.2 | **During a drag** | **Block and slide:** the piece stops at an obstacle and slides along it, so it can't pass through (`collision.ts` `resolveTranslation`, `state/physics.ts`). The objects it hits get a red outline and label. | Nothing blocks. The outline turns red while the spot is invalid, and the drop is allowed (as a suggestion). | ≠ | **J** (block and slide) |
| 3.3 | **Flush against walls and in corners** | Walls are solid boxes *outside* the room edge, and touching within 1 mm isn't a collision. A sofa can sit flush and fit into a corner. | Walls are centred on the room edge, so 6 cm of wall is inside the room: "Leave a little space from the wall." Pieces can't sit flush. | ≠ | **J** (flush walls and corners) |
| 3.4 | **Collision exceptions** | A pair table: flat (rug) never collides; soft collides only with solid and may overlap other soft items by 4 cm; an item never collides with what it rests on (support chain) (`collision.ts` `bodyContact`, `rules.ts` `overlapExempt`). | An explicit rule table, `occupancyRules`: rugs (underlay) and wall-mounted items are skipped for object collisions. Stacked items collide normally; touching faces are allowed (0.1 mm) (`operations.ts` `occupancyRules`/`occupiesFloor`). | ≠ | **C's rule plugged into J**: wall-mounted items pass through furniture (a picture can hang over a cabinet); wall items still collide with each other; J's flat/soft/support-chain rules stay |
| 3.5 | Ctrl to ignore collisions | Holding **Ctrl/Cmd** during a drag ignores collisions; the result is flagged. | — (nothing ever blocks) | J | **New collisions on/off toggle button**: off = nothing blocks, but violations still show (red outline + warnings). Ctrl decided in §10 |
| 3.6 | Doorway clearance | A warning zone inside each door/opening, as deep as the opening is wide, capped at 1 m. | A keep-out the door's width + 15 cm deep (a conflict). | ≠ | **J** (warn, allow) |
| 3.7 | Out of the room on release | Snaps back with a message. | Allowed as a suggestion; Accept fixes it or puts it back. | ≠ | **J** (snap back) |
| 3.8 | Rotation into an obstacle | Pushed clear by up to 30 cm, otherwise blocked. | Allowed; shows red. | ≠ | **J** (blocked / pushed clear) |

## 4. Stacking (putting things on things)

| # | Situation | J (plain words) | C (plain words) | Mark | Decision |
|---|---|---|---|---|---|
| 4.1 | **What counts as a surface** | Tops, shelves, sofa/armchair seats, and the bed top, from category defaults or catalog data (`support.ts`, `body.ts`). Only surfaces the item fits on count. | The real exposed top faces of each model's baked shape, including chair seats and shelves. Hidden inner faces are skipped (`contactFaces.ts`). | ≠ | **C** (real top faces from model shapes) |
| 4.2 | What may rest on what | A rule table: large furniture always sits on the floor; seats hold only pillows, throws, books, trays and decor (`config.ts` `canRestOn`). | Anything on anything, as long as the bottom centre is on the face; overhang is allowed (a plant can stick out over a table). Cycles aren't allowed. | ≠ | **C** (anything on anything, bottom centre on the face) **+ one J rule**: large furniture stays on the floor |
| 4.3 | **Putting an object on top** | Small items **hop onto the surface under the cursor** as you drag (drag a vase over the table and it lands on top). Or Alt-lift above and let go, and it falls onto it. | Raise it first (height mode or Space) until it is within **12 cm** of a top face; it **snaps magnetically** and shows a green outline with "Snapped to *Table*". Alt turns off the snap. | ≠ | **Both**: hop onto surfaces under the cursor while dragging (J) and the 12 cm magnetic snap when raised (C). Raise with the 3D move button, Space while dragging, or (to try) the scroll wheel while dragging |
| 4.4 | **Moving the thing underneath** | Everything on it moves and turns with it, live, in one undo step. | The same: everything attached moves and turns with it, live, in one undo step (`assembly.ts` `moveAssembly`). | = | **Same in both** (keep) |
| 4.5 | **Dragging an object off the edge** | As soon as the cursor is past the edge, a small item drops to the floor (or the next surface below) while you're still dragging. | It **stays at table height in mid-air** and is marked red ("Accept will settle this piece…"), unless it comes within 12 cm of another face. | ≠ | **Stays at its height while dragging (C), drops on release (J)** |
| 4.6 | Deleting the thing underneath | Items on it fall onto the next surface below, in one undo step. | Not allowed: "Move supported objects first." | ≠ | **J** (items fall to the next surface below) |
| 4.7 | A locked item on top | Blocks moving the support. | Blocks moving the support. | = | **Same in both** (keep) |

## 5. Gravity (letting go)

| # | Situation | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 5.1 | **On release** | The piece falls straight down onto the highest surface below it, or the floor (`editing.ts` `moveWithSupport`, `support.ts` `settleTarget`). | Stays exactly where dropped, even floating; it's a suggestion. | ≠ | **J gravity on release**. Whether deliberately raised pieces may stay up: tryout switch in Step 4 (always fall / never fall / mix) |
| 5.2 | Float | A per-object "Float" checkbox turns gravity off for that piece. | — (anything can float until Accept) | J | **No checkbox** (see 2.5) |
| 5.3 | On Accept | — | Floating pieces move to the **nearest** surface by height, which can be *up* or down (`support.ts` `onNearestSurface`). | C | **Not used** (Accept dropped) |
| 5.4 | Place on floor | Settling does it. | A **Place on floor** button. | C | **Not needed** (gravity does it) |

## 6. Snapping

| # | Feature | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 6.1 | Surface snap | Small items hop to the surface under the cursor (see 4.3). | **Face snap:** the bottom face catches a floor or top face within 12 cm, with a green outline and label (`support.ts` `snapToSurface`, `SnapGuide.tsx`). **Alt** bypasses it. | ≠ | **Both**: C's 12 cm face snap with the green guide + J's hop (see 4.3) |
| 6.2 | Grid snap | Only with the gizmo: Shift = 5 cm. | **Shift** = 10 cm grid while dragging. | ≠ | **C**: hold Shift while dragging = 10 cm grid (wall snap off while held) |
| 6.3 | Alignment snaps | Back-to-wall (back face goes flush to a wall), plus edge and centre alignment with nearby objects, with thin guide lines. **Shift turns them off** (`snaps.ts` `smartSnap`). | — | J | **Partly J**: keep back-to-wall snap (flush) with its guide line, and show a guide when a piece is pushed against another. **Drop** edge/centre alignment with neighbours (free placement) |
| 6.4 | Rotation snap | Ring + Shift = 15°; Q/E = 15°. | Ring + Shift = 15°; R/Shift+R and −/+ step on the 15° grid. | ≈ | **Same**: Shift on the ring = 15° steps |

## 7. Bounding box / selection look

| # | Feature | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 7.1 | **Box drawn around the selected object** | Always on when selected: a blue-violet box wireframe plus footprint outline plus corner dots, sized from the object's data size and following live drags (`SelectionOverlay.tsx`). Red/amber when blocked or warned. | Off by default. A **Bounding boxes** button (right side) shows **shape-hugging outlines of the collision shape** for **all** objects (violet when selected, white on hover, red when invalid, green after Accept moved it) (`CollisionOutline.tsx`, `compoundOutline.ts`, `ViewControls.tsx`). When it's off, nothing marks the selection except the floating toolbar. | ≠ | **(a) C's shape-hugging outline** (drawing only, never used for collision), **always on for the selected piece** (violet; red when blocked), **plus J's corner dots**. C's toggle kept as a "Show all outlines" switch in the room panel |
| 7.2 | Hover highlight | A light outline. | A white outline (only when bounding boxes are on). | ≠ | **C** (white outline on hover) |
| 7.3 | Lock badge / "New" tag | A lock badge. | A lock badge plus a "New" tag on added pieces. | ≈ | **J lock badge**; C's "New" tag dropped (it belonged to suggestions) |

## 8. UI layout

| # | Feature | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 8.1 | **Left vertical toolbar** (`agent_docs/ui/toolbar.png`) | select, move, rotate · add, duplicate, delete, lock · undo, redo · top, iso, eye-level, frame selection, walk (`FloatingToolbar.tsx`). | A side nav with only Objects and Search. | J (you want it) | **J**, plus **Collisions on/off** (after Lock). The 3D move button was removed (2026-10-18; Space replaces it) |
| 8.2 | **Selected-object panel** (`agent_docs/ui/panel.png`) | Name, category · lock button; Model (thumbnail, price, licence) with Swap model and Light on/off; **Finish** colour swatches; Position & rotation; Float; **Size W/D/H** with Keep proportions; **Plan** (Undecided/Keep/Replace/Remove); placement warnings; Duplicate, Delete; key hints. A **Hide** button (`InspectorPanel.tsx`). | A "Details" card: preview, name, lock switch, Position X/Y/Z, Height, Place on floor, Rotation, Dimensions (read-only), asset source link, Replace model, Delete, footnote hint. | ≠ (you want J's, with C's position) | **J** panel with option B position (see 2.5, 7.1) |
| 8.3 | Panel with nothing selected | Room info: area, ceiling, openings, items; lighting preset; wall mode; wall paint / floor finish. | Hidden. | J | **J** room panel, plus the "Show all outlines" switch |
| 8.4 | Top bar | "House · Edit" · scene picker · Match photo / Reference (test2) · save status + Retry · Reset view · dev menu (simulate failures, reset room, frame stats). | Room menu (reset room, reload saved) · search (visual only, ⌘K) · room switcher (visual only) · undo/redo · Add furniture · save status / "N unsaved suggestions". | ≠ | **J top bar** + C's "Reload saved room" in the ⋯ menu. Leave out C's show-only search and room switcher (undo/redo and Add are in the toolbar) |
| 8.5 | Look | Dark translucent panels. | Light frosted glass; the accent colour follows the lighting preset. | ≠ | **Dark (J)** |
| 8.6 | Suggestions bar + change list | — | Bottom bar with a per-piece list (Moved/Rotated/Replaced/Added/Removed), reasons, and ↺ to revert one piece. | C (tied to 0.2) | **Dropped** (with 0.2) |
| 8.7 | Right-side round buttons | — | Lighting preset cycle · Bounding boxes · 2D (visual only) · Fit room. | C | **Dropped** (lighting in the room panel, outlines switch in the room panel, Fit = Home) |
| 8.8 | Toasts | Yes. | Yes (top centre). | = | **Same** (keep) |

## 9. Editing tools

| # | Feature | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 9.1 | Add from library | A drawer with category filter and search; places the item at the camera target and nudges it to a free spot. | A catalog panel with search and filters, dimensions and price; places the item at the closest free spot to the room centre that leaves room to rotate. | ≠ | **J** (where the camera is looking, nudged to a free spot) |
| 9.2 | Duplicate | Ctrl/Cmd+D and buttons (copies whatever sits on it too). | Button only says "coming soon". | J | **J** (keep) |
| 9.3 | Delete | Del/Backspace; items on it settle. | Del/Backspace; refused if something sits on it. | ≠ (see 4.6) | **J** (items on it fall; see 4.6) |
| 9.4 | Lock / unlock | L, toolbar, panel. | L, toolbar, panel (lock is immediate, never a suggestion). | = | **Same** (keep) |
| 9.5 | Swap / replace model | "Swap model", ranked by size fit. | "Replace model", filtered to the same category. | ≈ | **J** (ranked by size fit), same category listed first |
| 9.6 | Resize (W/D/H, keep proportions) | Yes. | — (dimensions are read-only) | J | **J** (keep) |
| 9.7 | Finish / colour variants | Yes. | — | J | **J** (keep) |
| 9.8 | Decor orientation (lay flat, on its side) | Yes. | — | J | **J** (keep) |
| 9.9 | Lamps: light on/off; lamps emit light | Yes. | Lamps glow (one non-shadow light); no switch. | ≈ | **J** (light switch; lamps light the room) |
| 9.10 | Plan: Keep / Replace / Remove | Yes (Remove shows the item ghosted). | — | J | **J** (keep) |
| 9.11 | Lighting presets | Day / golden hour / evening (scene setting, saved). | Golden hour / daylight / overcast (view only, not saved). | ≠ | **J** Day / Golden hour / Evening (saved) **+ C's Overcast** |
| 9.12 | Wall paint / floor finish | Yes. | — | J | **J** (keep) |
| 9.13 | Scan reproduction (scan → matched models or placeholders) | Yes (demo scan). | A scanned side table as a proxy only. | J | **J** (keep) |

## 10. Keyboard and modifier keys

| Key | J | C | Conflict? |
|---|---|---|---|
| **Shift** (while dragging) | **Turns alignment snaps off**; with the gizmo, 5 cm / 15° steps | **10 cm grid snap** | ⚠ yes |
| Shift (on the rotate ring) | 15° steps | 15° steps | no |
| **Alt** (while dragging) | **Lift** (vertical move) | **Bypass** the magnetic face snap | ⚠ yes |
| **Ctrl/Cmd** (while dragging) | Ignore collisions | — | J only |
| **Space** (while dragging) | — | Temporary height mode | C only |
| **R** | Rotate mode | Rotate mode **and** turn +15° (Shift+R: −15°) | ⚠ yes |
| G | Move mode (T also works) | Move mode (floor plane) | same |
| V, L, Del/Backspace, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z | same | same | no |
| Ctrl+Y | Redo | — | J only |
| Q / E | Turn 15° (Shift: 90°) | — | J only |
| Arrows, PageUp/PageDown | Nudge | — | J only |
| F / Home / P | Frame selection / frame room / walk mode | — | J only |
| Ctrl/Cmd+D, Ctrl/Cmd+G | Duplicate / group (Shift: ungroup) | — | J only |
| **Enter** | — | Accept suggestions | C only |
| **Esc** | Deselect / exit walk | Deselect or close; **with nothing selected, discard all suggestions** | ⚠ yes (C can throw away work) |
| ⌘K | — | Focus search (visual only) | C only |

### Decided key map (Step 2)
| Key | Does |
|---|---|
| Drag | Move across the floor: hop onto surfaces, block-and-slide (J); off an edge it stays at height and drops on release |
| Scroll wheel while dragging | Raise / lower (new) |
| Shift while dragging | 10 cm grid; wall snap off while held (C) |
| Shift on the rotate ring | 15° steps |
| Alt while dragging | Move freely, no snapping (C) |
| Ctrl/Cmd while dragging | Ignore collisions for this drag (J), alongside the Collisions on/off button |
| R | Rotate tool only (J) |
| Q / E | Turn 15° (Shift: 90°) (J) |
| V / G | Select / Move |
| **C** | **Collisions on/off** (new) |
| Arrows · PageUp/PageDown | Nudge 1 cm (Shift 10 cm) · up/down (J) |
| F · Home · P | Frame selection · frame room · walk mode (J) |
| L · Del/Backspace | Lock · delete |
| Ctrl+D · Ctrl+G (Shift: ungroup) | Duplicate · group (J) |
| Ctrl+Z · Shift+Ctrl+Z / Ctrl+Y | Undo · redo |
| Esc | Deselect, exit walk mode (J) |
| **Space** (hold while dragging) | Up / down, X/Z kept; release to keep sliding at that height (C; replaced the 3D move button 2026-10-18) |
| Enter, ⌘K | Unused (Accept and search dropped) |

Final panel hint: "Drag to move · **scroll** while dragging to raise/lower · drag inside the ring to turn · **Shift** 10 cm grid · **Alt** no snapping · **Ctrl** ignores collisions". It must match the shipped keys (check again at the end).

Key hints in J's panel today: "Drag to move · **Alt**+drag to lift · drag the ring to turn · **Ctrl** ignores collisions · **Shift** disables snaps". These must change to match the final keys.

## 11. Saving and undo

| # | Feature | J | C | Mark | Decision |
|---|---|---|---|---|---|
| 11.1 | Undo/redo | One stack of op + inverse, cap 100; a rejected undo stops and keeps the entry. | Draft steps first, then accepted history (cap 80); Accept is one undo step; checkpoints. | ≠ (tied to 0.2) | **J** (single history; C's drafts dropped) |
| 11.2 | Autosave | 500 ms debounce, contract-shaped `saveScenePatch` (baseRevision + idempotencyKey); conflict and failure states; dev simulators. | 500 ms debounce, saves the whole scene with a revision check; Web Locks across tabs; saves only accepted scenes; warns before leaving with a draft. | ≠ | **J** (contract `saveScenePatch`) **+ C's cross-tab save lock and warn-before-close while a save is pending** |
| 11.3 | Reset / reload room | Dev menu "Reset this room". | Room menu: Reset to fixture, Reload saved room. | ≈ | **Both** in the ⋯ menu: Reset room + Reload saved room |

## 12. Performance and dev tools

| # | Feature | J | C | Mark |
|---|---|---|---|---|
| 12.1 | Measured FPS | About 60 FPS dragging test2 (45 objects) on Intel UHD; recorded in SANDBOX_AUDIT. | Never measured on real hardware. | ≠ |
| 12.2 | Idle rendering | Renders on demand when idle (`IdleFrameloop`). | Always on. | J |
| 12.3 | Picking speed-up | drei `<Bvh>`. | three-mesh-bvh mesh picking plus invisible hitboxes. | ≈ |
| 12.4 | Dev pages / flags | `?gallery`, `?perf`, `?hideUi`, `?walls=`, `?lampShadows=`, `?frameloop=`, capture script. | `?geometry-lab`, `?debug`, collider bake, asset verify, Poly Haven import, collision benchmark. | ≠ |
| 12.5 | Tests | Vitest: contracts 3, scene-engine 126, web 27; ESLint purity rule. | Vitest (16 test files) plus 6 Playwright browser specs; ESLint purity rule. | ≠ |

**Decision (12.x):** keep **all** tools from both: J's on-demand rendering, perf probe, gallery and capture script; C's shape baking (needed for 7.1 and 4.1), asset checker, Poly Haven importer, `?geometry-lab` and collision benchmark. C's browser tests are updated to the merged behaviour.

---

## 13. Your lists mapped to code

| You asked for | Branch | Where it lives |
|---|---|---|
| X/Y/Z movement, position shown and edited | C | `apps/web/src/scene/Furniture.tsx` (drag planes, Shift grid, Alt, height guide) · `state/editor.ts` (`DragSession`, `previewMove`, `movePlane`) · `state/movementModifier.ts` (Space) · `components/ObjectToolbar.tsx` (Move / Move up-down) · `components/InspectorPanel.tsx` (X/Y/Z, Height, Place on floor) |
| Bounding boxes | C | `scene/CollisionOutline.tsx` · `scene/compoundOutline.ts` · `components/ViewControls.tsx` (toggle) · outline colours in `Furniture.tsx` · data from `scene-engine/collision.ts` `colliderBlocks` + `colliderProfiles.json` |
| Snapping | C | `scene-engine/support.ts` (`snapToSurface`, `FACE_SNAP_DISTANCE_M`) · `contactFaces.ts` · `scene/SnapGuide.tsx` · Shift grid / Alt bypass in `Furniture.tsx` · rotation steps in `editor.ts` `rotate` |
| Collision exceptions | C | `scene-engine/operations.ts` (`occupancyRules`, `occupiesFloor`, vertical overlap check) · `collision.ts` (0.1 mm tolerance) |
| Stacking | C | `scene-engine/support.ts` (`canSupport`, `withContactSupport`, `supportCycle`) · `assembly.ts` (`supportedDescendants`, `moveAssembly`) · `contactFaces.ts` · `resolve.ts` (support order) · `editor.ts` `motion` (live carry) |
| Toolbar | J | `apps/web/src/ui/FloatingToolbar.tsx` · `ui/icons.tsx` · `styles.css` (`.toolbar`) |
| Selected-object panel | J | `ui/InspectorPanel.tsx` (`SelectedObject`, `TransformSection`, `SizeSection`, `Variants`, `DecisionPicker`, `SwapPicker`) |
| Camera views (top, iso, eye) | J | `scene/CameraRig.tsx` (`presetPose`, `roomFrame`) · `state/store.ts` (`requestCamera`, `cameraRequest`) |
| Frame selection | J | `state/store.ts` `frameCamera` · `CameraRig.tsx` |
| Walk mode | J | `CameraRig.tsx` (`WalkControls`) · `store.walkMode` · walls from `scene-engine/collision.ts` `wallBodies` |
| Collision detection (flush, corners) | J | `scene-engine/collision.ts` (`wallBodies`, `bodyContact`, `resolveTranslation`, `GridBroadPhase`) · `body.ts` · `config.ts` (`contactToleranceM` 1 mm) · `rules.ts` · `apps/web/src/state/physics.ts` · `scene/interaction/sessions.ts` |
| Gravity | J | `scene-engine/support.ts` (`settleTarget`, `findSupport`) · `editing.ts` (`moveWithSupport`, `deleteWithSettle`) · Float in the panel · release in `sessions.ts` / `TransformControlsWrapper.tsx` |

## 14. Agreed line between stacking (codex) and gravity (jordan)

- **Stacking (codex) decides *where* a piece can rest and *what it's attached to*:**
  - the model's real top faces (seats, shelves), from the baked shapes;
  - the bottom-centre rule (overhang is fine);
  - the magnetic 12 cm catch with the green "Snapped to …" guide;
  - the parent link; the parent carries its children.
  - Anything may rest on anything, except that large furniture stays on the floor.
- **Gravity (jordan) decides *when* a piece falls:**
  - **while dragging**, a small item hops *onto* a surface under the cursor, but dragging *off* an edge keeps it at its height;
  - **on release**, a piece that isn't resting on anything drops straight down onto the highest surface below it;
  - **deleting a support** makes its items fall the same way (one undo).
- **Still to try (Step 4 tryout switch):** whether a piece you deliberately raised (3D move, scroll wheel, typed Y) may stay in the air: *always fall* / *never fall* / *mix*. No Float checkbox.

## 15. Step 3 plan

### 15.1 Final picture: what comes from where
- **From jordan (the base; the merge branch already contains it):**
  - camera: views, frame selection, double-click focus, walk mode, wall modes, Match photo;
  - toolbar, panel, room panel, top bar, dark look;
  - collision: block-and-slide, flush walls/corners, snap back outside the room, door warning, Ctrl to ignore;
  - gravity and delete-settles; wall/ceiling items; multi-select and groups; nudges;
  - duplicate, resize, finish, decor orientation, lights, plan, wall paint, scan demo;
  - contract-shaped autosave, on-demand rendering, all J tests.
- **From codex:**
  - the newer library stack;
  - X/Y/Z position fields (all three editable);
  - rotation by dragging anywhere inside the ring (with J's collision);
  - shape-hugging outlines (selected/hover/all), drawing only;
  - baked model shapes → real top faces; 12 cm magnetic snap + green guide; anything-on-anything;
  - Shift 10 cm grid; Alt = no snapping;
  - wall items pass through furniture;
  - smooth glide on undo;
  - Overcast preset; Reload saved room; two-tab save safety and warn-before-close;
  - the 3 Poly Haven models; FurniMesh models as `pending` (hidden);
  - bake/verify/import scripts, geometry lab, benchmark, browser tests.
  - **Set aside, not wired in:** the draft/Accept/resolver code (kept for future AI proposals).
- **New:**
  - 3D move button (M): pane-of-glass drag; normal drag from the top view;
  - scroll wheel raises/lowers during any drag;
  - Collisions on/off button (C);
  - contact guide when a piece is pushed against another;
  - the tryout switch for raised pieces.

### 15.2 Where things conflict, and how they'll fit
- **Collision + exceptions:**
  - J's collision engine stays the only collision authority.
  - C's exception becomes one new rule in J's pair table: *wall-class vs non-wall never collide*; wall vs wall still collide.
  - C's rug rule already matches J's `flat`. J's soft/support-chain rules stay.
  - The Collisions on/off button sets J's existing "ignore collisions" mode for every drag, so violations are still computed and shown.
- **Stacking + gravity:**
  - C's exposed-top-face code (`contactFaces`) is ported into scene-engine (pure) and produces J's `WorldSurface` list. J's hop, `findSupport`, `settleTarget` and `deleteWithSettle` then use it instead of the category surface table. Where an asset has no baked shape, J's category surfaces remain the fallback.
  - J's rest table shrinks to one rule: large furniture is floor-only.
  - C's 12 cm magnetic catch is added to J's drag (vertical distance to the nearest face) with C's `SnapGuide`.
  - The support chain stays exempt from collision (J), so a vase on a table never "hits" its table even when C's face and J's box heights differ.
- **Bounding boxes:**
  - C's `compoundExteriorPositions` draws from the baked shape profile, mounted in J's `SelectionOverlay` in place of the plain box, keeping J's corner dots and J's colours.
  - It reads the live group transform, as J's overlay does today.
  - It never feeds collision. Without a profile it falls back to J's box.
- **Panel position:**
  - Three number fields (X, Y, Z in metres) replace J's one-line readout in `TransformSection`.
  - Typing a value moves the piece through J's pipeline: block-and-slide from where it is toward the typed spot, then settle per the gravity rule.
  - A toast explains if it stopped short.
  - J's rotate row stays; the Float checkbox goes.
- **Library upgrade:**
  - J's web code is ported to R3F 9 / drei 10 / React 19 / three 0.180.
  - C's React 19 rules for drei `<Html>` (fixed portal, never inside Suspense fallbacks) are applied, because J uses `<Html>` labels too.

### 15.3 Build order (one commit each; you test after each)
| # | Step | What you'll be able to test |
|---|---|---|
| 1 | **Library upgrade** (React 19, R3F 9, drei 10, three 0.180, Vite 7, Vitest 3, TS 5.9); no behaviour change | The app looks and behaves exactly like jordan (5181). All three scenes load; camera views, walk mode and dragging work. |
| 2 | **Toolbar, panel, top bar, keys**: remove the arrow gizmo; add 3D move (M, placeholder that behaves like Move until step 6) and Collisions on/off (C); X/Y/Z fields; remove Float; Overcast; Reload saved room; R/Alt/Ctrl/Shift/M/C key map; panel hints | Toolbar matches `toolbar.png` plus 2 buttons. The panel shows X/Y/Z, and typing moves the piece (blocked by collisions). Collisions-off lets you push through with red outlines. Hints match the keys. |
| 3 | **Assets + baked shapes**: codex's 3 Poly Haven models; FurniMesh as pending; bake/verify scripts adapted to the merged catalog; profiles for every model | The library shows the new models. Nothing else changes (shapes are data only so far). |
| 4 | **Bounding boxes**: shape outline on the selection (violet, corner dots), white hover, red when blocked; "Show all outlines" switch | Outlines hug each model and follow drags and rotations; collision feels identical to before. |
| 5 | **Collision**: wall items pass through furniture; contact guide; + automated tests: flush to wall and corner, vase on table vs another object on the table, wall snap ends flush | A picture hangs over a cabinet. A sofa sits flush in a corner with no red. |
| 6 | **Movement + rotation**: 3D move (pane of glass), scroll-wheel height during drags, rotation by dragging anywhere inside the ring (blocked by collisions), glide on undo | Lift a vase with M or the scroll wheel; spin a chair from any angle; undo glides. |
| 7 | **Stacking + gravity tryout**: real top faces, 12 cm catch + green guide, hop, off-edge stays then drops, anything-on-anything + big-furniture rule, delete → fall; **tryout switch** (always / never / mix) | Put the vase on a chair seat or a shelf; drag it off and release; try the 3 switch settings and pick one. **Stop here until you choose.** |
| 8 | **Snapping**: Shift 10 cm grid, Alt no snapping, wall snap flush (no neighbour alignment) | Shift-drag steps in 10 cm. Alt-drag ignores the table and the wall. A sofa backed toward a wall pops flush. |
| 9 | **Saving and tools**: two-tab save safety, warn-before-close; geometry lab, benchmark, codex browser tests updated; docs | Two tabs don't overwrite each other; closing mid-save warns; `?geometry-lab` opens. |
| 10 | **Final pass**: performance check (60 FPS dragging test2) and your final checklist | Everything on your lists, one last time. |

After each step: typecheck, lint, all tests (J's plus the ported C tests), a commit, exact test steps for you, then wait.

## 16. Build log (Step 4, built without stopping per your instruction on 2026-10-18)

| Step | Commit | What you can test |
|---|---|---|
| 1 Library upgrade | `3edea9e` | Looks and behaves like jordan |
| 2 Toolbar, panel, top bar, keys | `b36ea6e` | 3D move + Collisions buttons; X/Y/Z fields; Overcast; Reload saved room; no gizmo |
| 3 Codex models + baked shapes | `c8a103f` | FurniMesh hidden (pending); shapes baked for 46 models |
| 4 Outlines | `eee6735` | Shape-hugging outline with corner dots; "Show all outlines" |
| 5 Collision | `1355b8f` | Picture over a cabinet; contact guides; the 3 collision checks are automated tests |
| 6 Movement + rotation | `cbb52c2` | 3D move, scroll-wheel height, drag inside the ring or on the piece to turn, undo glides |
| 7 Stacking + gravity | `75a119d` | Real seats and shelves, magnetic catch, off-edge holds then falls, "Letting go (tryout)" switch |
| 8 Snapping + key hints | `43ae94b` | Wall snap only; Shift grid; Alt no snapping; hints match the keys |
| 9 Saving + tools | `b4e8138` | Two-tab conflict, warn on close, `?geometry-lab`, `pnpm assets:verify`, `pnpm test:browser` |
| 10 Final pass | (this commit) | 60 FPS dragging test2 (SANDBOX_AUDIT §8); checklist below |

**Choices made while building** (where your answers left room; each can be changed):
- Self-made (procedural) models keep jordan's exact surfaces. Codex's 4 cm voxel faces are only used for downloaded and scanned models, where nothing better exists.
- Rugs never hold things, so moving a rug doesn't drag a plant along with it.
- Codex's 12 cm magnetic catch also pulls a slightly raised piece back onto the surface. Raise it more than 12 cm, or hold Alt, to keep it up.
- Ceiling items (pendants) still use Alt to change the drop length.
- The tryout switch defaults to **Mix**. Pick one and I'll remove the switch.
- Codex's Poly Haven importer isn't ported, because jordan's ingest already imports the same three models from Poly Haven.

**Final checks run:** typecheck, lint, 199 unit tests (contracts 3, scene-engine 148, web 48), production build, `pnpm assets:verify` (51/51), and `pnpm test:browser` on all three scenes with no page errors.

## 17. Final checklist (go through it once in the merged app)
- [ ] **Toolbar** matches `toolbar.png`, plus **Collisions on/off** (after Lock).
- [ ] **Panel** matches `panel.png`: name + lock, model + Swap + light, finish, **X / Y / Z fields**, rotate row, size W/D/H + keep proportions, plan, duplicate / delete. No Float checkbox. Key hints at the bottom.
- [ ] **Camera:** top, isometric and eye-level buttons; **F** frames the selection; **P** walk mode; double-click re-aims; walls cut away / fade / show.
- [ ] **Moving:** drag freely; hold **Space** while dragging to move up/down (release to keep sliding at that height); **scroll** while dragging to raise/lower; type X/Y/Z; arrows / PageUp / PageDown nudge.
- [ ] **Rotating:** **R**, then drag anywhere inside the ring or on the piece; blocked by collisions; Shift for 15° steps; Q / E.
- [ ] **Outlines:** the selected piece shows an outline hugging its shape with corner dots; white on hover; red when blocked; "Show all outlines" in the room panel.
- [ ] **Collision:** a sofa pushed into a wall and into a corner sits flush with no red. A picture can hang over a cabinet. Ctrl or **C** lets things overlap, still flagged red. A green guide shows where pieces touch.
- [ ] **Stacking:** a vase hops onto a table; it collides with another item on the table but never with the table. It snaps onto a chair seat or shelf when raised within 12 cm ("Snapped to …").
- [ ] **Gravity:** dragged off an edge, a piece holds its height and falls when you let go. Deleting a table drops what's on it. Try the **Letting go** switch: Mix / Always fall / Never fall.
- [ ] **Snapping:** a sofa backed toward a wall snaps flush (green wall line). **Shift** gives the 10 cm grid. **Alt** gives no snapping. Nothing lines up with neighbours.
- [ ] **Undo / redo:** pieces glide back.
- [ ] **Saving:** edits save; a second tab on the same room gets a conflict instead of overwriting; closing mid-save asks first.

## 18. Fixes after your first test (2026-10-18)
| Problem you saw | Cause | Fix |
|---|---|---|
| Walk mode broken | The upgraded camera library (camera-controls 3 in drei 10) rewrites the camera position every frame, even while disabled. Walk mode added each step to that position, so WASD never moved you (looking still worked). Walk mode could also start inside furniture, which blocked every step. | Walk mode keeps its own position and sets the camera from it every frame. It starts at the nearest free spot, and you can walk out of anything you're already inside. Browser check: walking, looking, walls stop you, Esc exits. |
| Dragging seemed to switch to another object when the piece couldn't go further | The obstacle got a red outline, corner dots and a "… hits this" label, so it looked selected. The selection itself never changed. | Obstacles are no longer outlined. Only the piece you hold is outlined (red when blocked, with "hits …"), and a green line marks where they touch. Browser check: the selection stays on the held piece for the whole drag. |
| 3D move button janky | — | Removed. Codex's Space-bar movement is back: hold Space while dragging to go straight up/down, and release to keep sliding at that height with no jump. Browser check added. |
