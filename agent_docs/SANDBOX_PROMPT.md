# Task: Build the House 3D sandbox (shared viewer/editor) — Feature 2

> Condensed archive of the original Feature 2 brief (given in-session on 2026-10-17; requirements preserved, prose shortened). It's kept here because later prompts (`TEST2_PROMPT.md`) refer to it by name. Where they conflict, `TEST2_PROMPT.md` supersedes this file. Package-name drift (`packages/scene-core` here vs `packages/contracts` + `packages/scene-engine` in the repo) is explained in `SANDBOX_NOTES.md` §3a C1–C2.

You are implementing the desktop 3D room editor for **House**, an AI-assisted room redesign app (DubHacks 2026). A user scans a room with iPhone RoomPlan; this editor shows it as an interactive 3D scene: an immutable room shell (floor, walls, doors, windows, openings) plus furniture reproduced from a curated GLB asset library. Users orbit the camera, select, move, rotate, add, duplicate and swap furniture, lock items, and undo/redo. Edits autosave. The same scene model and geometry rules will later be used by the Node backend to validate AI redesign proposals, so the core logic must be framework-free.

The whole project is **TypeScript only** (Swift only for the separate iOS scanner). If any doc mentions Go, ignore that part.

## Step 0 — Read the project docs first (required)
Read every file in `agent_docs/` before writing any code (CONTRACTS.md authoritative for names/IDs/units/axes/operations/API shapes/invariants; PRD.md §11 overrides earlier PRD text; FUNCTIONAL_SPEC.md exact behaviors; FEATURE_DESIGN.md UX; SYSTEM_ARCHITECTURE.md module boundaries; finaldiagram.png; README.md). Look at `assets/test1.png` and `assets/test2.png` and say what they're for. Do not build photo-to-3D reconstruction (PRD P-17/P-18). Before coding, write `agent_docs/SANDBOX_NOTES.md` (doc summary, every conflict + resolution, CONTRACTS.md naming differences).

Precedence: **CONTRACTS.md > FUNCTIONAL_SPEC.md > PRD §11 > this prompt > other docs**. Bug-avoidance rules marked ⚠ are implementation requirements unless a doc explicitly contradicts them. If CONTRACTS.md doesn't define something, define it in the shared package and mark it `// CONTRACT-TBD`.

## Stack (fixed)
React + TypeScript (strict) + Vite; `@react-three/fiber`, `@react-three/drei`, `three`; `zustand`; Vitest; pnpm monorepo: `packages/scene-core` (pure TS, zero React/Three/DOM imports — scene and asset types, operations, validation, geometry rules, asset matching, undo/redo command logic; imported by the Node backend) and `apps/web` (the R3F editor).

## Conventions
- Meters; right-handed, Y-up, floor at y = 0.
- ⚠ Footprint axes: at yaw 0, `w` along +X, `d` along +Z, `h` along +Y, front faces +Z. Yaw = radians about +Y, same sign as Three's `rotation.y`. Test that footprint corners match a Three `Object3D`.
- ⚠ Floor polygon counter-clockwise viewed from +Y; normalize on load; wall normals derive from it.
- Stable `objectId` (UUID); never identity from mesh names/array index. Scene documents carry `schemaVersion`.

## Domain model (scene-core)
- `RoomShell` immutable: floor polygon, wall segments (default thickness 0.1 m), openings `door | window | opening` with wall ref, offset, width, height, sill, door swing.
- `AssetRecord` (PRD P-09): id, name, categories, placement, dimensions {w,d,h}, GLB/preview URIs, style tags, source, license {reviewed|unreviewed|restricted, attribution}, price or null (never $0).
- `SceneObject`: id, category, assetId|null (placeholder), position (base-center; parent-local if parented), yaw, ⚠ dimensions = final world size (no scale field), locked, ownership keep|replace|remove|null (planning, separate from lock; remove = ghosted, not deleted), parentId, replacesObjectId, origin scan|user|ai, scanMatch.
- `Scene`: id, schemaVersion, version, shell, objects.
- ⚠ Placement classes: `floor` (y = 0, full checks), `flat` (rugs: never overlap-checked; door clearance optional), `surface` (lamps/decor: parent from nesting allow-list), `wall` (back face on one wall, yaw = wall inward normal, no floor support, may be above 0).

## Operations
Typed pure ops (move, rotate, setLocked, setOwnership, add, remove, duplicate, setAsset) → `{scene, inverse} | {error}`; never mutate input; reject shell changes; locked rejects move/rotate/remove/setAsset but ⚠ allows setLocked/setOwnership; command-based undo (setLocked undoable); ⚠ nesting: parent move/rotate carries children, removing a parent removes children (inverse restores; reject if a child is locked); setAsset keeps objectId (not planning "replace").

## Asset reproduction
1. `matchScanObject(scanObject, catalog, opts)`: RoomPlan category → catalog categories via one table; skip restricted; rank by w/d/h relative error (w/d swap via 90° yaw); threshold → placeholder; deterministic; keep scan pose/size; record scanMatch; fixtures.
2. Library drawer (filter, previews) → add at cursor/camera target, nudge to nearest valid spot (spiral search) or place flagged.
3. Ctrl/Cmd+D duplicate (new ids incl. children, free spot); "Swap model" picker ranked by fit → setAsset.

Rendering: `useGLTF` with local Draco/Meshopt decoders (no CDN); load each GLB once, `<Clone>` per instance sharing geometry/materials; keep PBR materials, correct color space, shadows; normalize (center footprint, base y = 0, rotate to +Z front); ⚠ fit: uniform by default, non-uniform only within ±15% per axis, else uniform fit-inside + warning; preload; per-instance Suspense + error boundary; missing/failed → category-colored labelled placeholder; `AssetCatalog` interface (list/get/resolveUrl) with a local implementation; dev-only GLB size/triangle budget warnings; seed ~10–15 CC0/self-authored GLBs with source and license recorded.

## Geometry rules (shared JSON fixtures)
Footprint-in-polygon (concave), wall clearance (epsilon; wall items within tolerance of exactly one wall), door/opening approach-zone clearance, oriented overlap (2D SAT + vertical interval; touching ≠ overlap), floor support / surface support, permitted nesting allow-list. Return `{ ok, violations: [{ rule, severity, objectId, otherId?, detail }] }`.

## Editor (apps/web)
Full-window Canvas, shadows, ACES, sRGB; ⚠ `<Environment files=…>` with a committed CC0 HDR (never `preset`); one shadow-casting directional light fitted to the room; shell from data with real wall cut-outs; walls facing the camera fade/hide; translucent collapsible overlays (camera presets, library drawer, selected-object panel, undo/redo, save status).
Camera: OrbitControls makeDefault, can't go under the floor, distances scaled to room; reset frames the room.
⚠ Selection: root `<group userData={{objectId}}>`; select on click only when `e.delta` < ~4 px; walk up parents; stopPropagation; deselect via onPointerMissed but ignore ~150 ms after a TransformControls drag; shell not selectable.
⚠ Highlighting never mutates shared materials (overlay outline/box; ghost via per-instance cloned material).
⚠ Transform: TransformControls per placement class (floor: no Y, rotate Y only; wall: local slide + vertical, no rotation; surface: within parent top); orbit off while dragging; locked = no gizmo; keyboard (ignored in inputs): G/T, R, Esc, Delete+Backspace, L, Ctrl/Cmd+D, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl+Y; Shift snaps (15°, 0.05 m).
Drag performance: never write Zustand per frame; box from scene-core footprint, not `Box3.setFromObject`; Box3 broad-phase on cached boxes + scene-core narrow-phase; one op on drag end; policy file: outside room → snap back + toast, other violations commit as warnings.
State slices: workingScene ⚠ (not "committed"), catalog, selection, history (op+inverse, cap ~100, redo cleared; ⚠ rejected undo → stop, keep entry, toast), save (dirty, status idle|saving|saved|error|conflict, last error, baseVersion), violations; selectors to limit re-renders. Undo/redo never tied to the timeline.
Persistence: `ScenePersistence` (load, save with baseVersion + requestId → version | conflict), ⚠ idempotent per requestId; in-memory/localStorage mock (try/catch); debounced autosave ~500 ms, never mid-drag; errors keep local changes with retry; conflicts never overwrite silently.

## Demo fixture
`demo-room.json` (~4×5 m, door, two windows, doorless opening, ~9 objects incl. sofa on rug, coffee table, desk, chair, shelf, lamp on desk, wall art, plant, one null-asset object) and `demo-scan.json` (raw-ish scan objects). App boots with no backend; toggle between them.

## Deliverables
0 notes + wait for OK · 1 scene-core + tests · 2 asset pipeline · 3 static render + scan demo · 4 selection/highlight/TransformControls/keyboard/lock · 5 library/add/duplicate/swap · 6 drag validation + drag-end policy · 7 undo/redo + autosave + save UI · 8 polish. After each: typecheck + tests + short note.

## Acceptance checklist
Notes exist; boots into demo room, orbit/pan/zoom/reset, camera above floor; scan reproduces every object as GLB or placeholder deterministically; PBR + shadows, no stretched models, each GLB fetched once; add/duplicate/swap undoable; click selects objectId, orbit-drag from furniture doesn't select, gizmo release doesn't deselect, empty click deselects; highlighting one instance never changes others; per-class transforms, orbit off while dragging; ~60 FPS dragging; locked items can't be moved/rotated/swapped/deleted (tested) but ownership can change; desk move carries lamp, delete + undo restores both; shell immutable (tested); rug doesn't flag sofa/coffee table, wall art not flagged for floor support; live invalid feedback, out-of-room snaps back, other issues warn; exact undo/redo, rejected undo toasts without corrupting history; autosave once after editing stops, never mid-drag, failure keeps edits + error, conflict state; missing GLB → placeholder; no CDN requests; scene-core free of React/Three/DOM (lint rule or test).

Out of scope: AI redesign, proposal diff/accept, budget/timeline, auth, Supabase wiring, iOS scanning, photo-to-3D, runtime asset generation, mobile layouts.
