# Task: Whole-house scanning (multi-room RoomPlan) — while keeping single-room scans

This extends `ROOMPLAN_PROMPT.md`. **Where they conflict, this prompt wins.** If the ROOMPLAN_PROMPT work isn't done yet, build both together with these changes applied from the start.

**Goal:** A user can scan either one room or a whole house on their iPhone. A house scan becomes one navigable, editable 3D house in the browser: every room in its correct position relative to the others, shared walls, interior doors connecting rooms, room names, multiple floors where scanned, and each room's furniture reproduced as 3D models. Single-room scans keep working exactly as before.

---

## Step 0 — Docs, scope change and reconciliation

1. Re-read everything in `agent_docs/` (including `finaldiagram.png`), all earlier prompts and notes, and the current code.
2. **Scope change:** the PRD currently lists "complete-house scan merging" as out of scope and "single-room scans" as in scope. That decision is now reversed: multi-room house scans are in scope, single rooms remain supported. Draft the edits to `PRD.md` (scope section, P-01/P-02/P-03 wording, launch gate), `CONTRACTS.md` (types below), `FUNCTIONAL_SPEC.md`, `FEATURE_DESIGN.md` and `SYSTEM_ARCHITECTURE.md`. Apply them, with a dated "House scanning (2026-10-17)" change note in each doc, and list every edit in `agent_docs/HOUSE_SCAN_NOTES.md`.
3. In `HOUSE_SCAN_NOTES.md`, also list: anything in the docs that assumes one room (redesign, budget, timeline, My Scans, scene versioning, RLS paths, the architecture diagram), and how each should behave with a house. Don't implement redesign/budget changes; just record them.
4. Stop and show me the notes if a change affects anything beyond scanning, import and the sandbox. Otherwise continue.

---

## Part A — iOS: scanning a house

Uses RoomPlan's iOS 17 MultiRoom support.

**Flow**
- Start screen offers **Scan a room** (existing flow) or **Scan a house**.
- House mode:
  1. Create one `ARSession` and pass it to `RoomCaptureSession(arSession:)` / the capture view for every room.
  2. After each room, call `stop(pauseARSession: false)` so tracking continues in the same world space. Show: room count so far, a name field (prefilled from RoomPlan's detected room type), **Scan next room** and **Finish house**.
  3. Coach the user to walk directly to the next room with the camera up and not to lock the phone or leave the app (that breaks continuity).
  4. On the last room, call the normal `stop()`.
  5. Merge with `StructureBuilder(options: [.beautifyObjects])` and `try await capturedStructure(from: rooms)` → `CapturedStructure`.
- Keep every individual `CapturedRoom` as well as the merged structure.
- **Merge failure or tracking loss:** never lose captured rooms. Offer: retry the merge, rescan the last room, or save the rooms as separate single-room scans.
- **Add rooms later (P1, do after the core works):** save the session's `ARWorldMap` after a house scan; later, relocalize against it (user starts in an already-scanned room) to scan more rooms and re-merge. Show clear relocalization status; if it fails, don't merge.
- Multiple floors: keep `story` from RoomPlan on everything. Scanning stairs between floors in one session is allowed; test it if a two-story space is available, but one-story houses are the P0 target.

**Export: schema `"structurescan/1"`** (replaces `roomscan/1` for new scans):

```jsonc
{
  "schemaVersion": "structurescan/1",
  "kind": "room" | "house",
  "scanId": "uuid", "capturedAt": "ISO-8601",
  "device": { ... }, "roomPlanVersion": 2,
  "units": "meters",
  "coordinateSystem": { "handedness": "right", "up": "+Y", "matrixLayout": "column-major" },
  "rooms": [
    {
      "roomId": "uuid",           // CapturedRoom.identifier
      "name": "string|null",      // user-entered
      "story": 0,
      "walls": [Surface], "doors": [Surface], "windows": [Surface],
      "openings": [Surface], "floors": [Surface], "objects": [Object],
      "sections": [ { "label": "string", "center": [x, y, z], "story": 0 } ]
    }
  ],
  "merged": {                     // from CapturedStructure; null for kind "room" or failed merge
    "walls": [Surface], "doors": [Surface], "windows": [Surface],
    "openings": [Surface], "floors": [Surface], "objects": [Object],
    "sections": [ ... ]
  } | null
}
```

- `Surface` and `Object` are exactly as in `ROOMPLAN_PROMPT.md` (raw values, column-major matrices).
- A single-room scan is `kind: "room"`, one entry in `rooms`, `merged: null`.
- Archive Apple's raw JSON: each `capturedroom-<n>.json` plus `capturedstructure.json`; optional USDZ of the structure for debugging.
- **Verify on device and record in notes:** whether merged surfaces/objects keep the per-room `identifier`s or get new ones; how shared walls between two rooms appear in `merged` (one wall or two); whether `floors` in `merged` are per room; how `sections` labels map to rooms; that per-room transforms are already in the shared world space.
- Record real fixtures: one house scan with **at least 3 connected rooms** (with interior doors and a doorless opening if possible), plus the single-room fixtures from before. Put them under `packages/scene-core/fixtures/roomplan/<name>/`.

---

## Part B — Scene model: from a room to a structure

Replace the single `RoomShell` with a **structure** that holds one or more rooms. A single-room scene is just a structure with one room. Update CONTRACTS.md (step 0) and the TS types:

```ts
Scene {
  schemaVersion, sceneId, version,
  structure: {
    kind: 'room' | 'house',
    levels: { story: number; elevation: number }[],          // floor height of each story, story 0 at y = 0
    rooms: {
      roomId, name, typeLabel /* from sections, e.g. bedroom */, story,
      floorPolygon /* CCW from +Y, world XZ */, ceilingHeight
    }[],
    walls: { wallId, start, end, height | heightProfile, thickness, story,
             roomIds: [roomA] | [roomA, roomB] /* shared walls list both */ }[],
    openings: { openingId, type: 'door'|'window'|'opening', wallId, offset, width, height,
                sill, isOpen, connects: [roomA, roomB | null] /* null = exterior */ }[],
    importTransform
  },
  objects: Record<objectId, SceneObject & { roomId: string; story: number }>
}
```

- The structure stays **immutable** in the sandbox, like the old shell.
- Every object belongs to exactly one room (`roomId`), derived from its position.
- Migration: existing scenes and `roomscan/1` exports are upcast to a one-room structure automatically. The test2 fixture and demo room keep working unchanged in the UI.

---

## Part C — Import: `importStructureScan()` (replaces `importRoomScan`)

Keep `importRoomScan` as a thin wrapper that upcasts and calls the new function.

- Validate (`structurescan/1`, plus upcast for `roomscan/1`).
- **Geometry source:** if `merged` exists, build walls/openings from it (shared walls deduplicated), and use `rooms[]` to define room boundaries and membership. If `merged` is null for a house (merge failed), import each room separately and place them as disconnected rooms with a warning in the report.
- **Levels:** group by `story`; elevation of each story = its floor height relative to story 0. Story 0 floor → y = 0.
- **Rooms:** floor polygon per room (from that room's floor surface, fallback from its walls); name from the user-entered name, else the `sections` label whose center falls inside the polygon, else "Room N".
- **Shared walls:** when two rooms' walls are coplanar and overlapping within tolerance (5 cm, angle 2°), merge into one wall with both `roomIds`. Wall thickness for shared walls defaults to the measured gap between the two rooms' wall planes if plausible (5–40 cm), else 0.1 m.
- **Openings:** attach to their wall; `connects` = the rooms on each side (null for exterior). Deduplicate the same door seen from both rooms.
- **Objects:** assign `roomId` by footprint-center containment in room polygons (same story); deduplicate objects seen from two rooms (same category, centers within 20 cm, similar size).
- **Normalization:** translate so the whole structure's bounding box is centered at x = z = 0, rotate so the dominant wall direction aligns with +X. One `importTransform` for the whole structure.
- Everything else (base-center positions, yaw, dimension mapping, asset matching, cleanup rules, determinism, `ImportReport`) carries over from `ROOMPLAN_PROMPT.md`. `ImportReport` adds: rooms found, shared walls merged, interior vs exterior doors, objects per room, merge warnings.

---

## Part D — Sandbox changes for houses

**Viewing modes** (overlay switcher; smooth animated transitions):
- **Dollhouse** (default for houses): all rooms of the current level, ceilings off, walls facing the camera faded; optional "cut walls at 1.2 m" toggle.
- **Room focus**: pick a room from a room list or double-click its floor; camera flies to it, other rooms dim and become non-interactive.
- **Floor plan**: top-down orthographic, room names and areas shown, furniture as footprints.
- **Walk mode** (from TEST2_PROMPT): first-person, can walk through open doors and openings between rooms, blocked by walls.
- **Level selector** for multi-story houses: show one story, or stack all with upper stories faded.

**Room list overlay:** names, type labels, area, object count. Click to focus. Rename (stored in scene metadata, not the immutable geometry).

**Editing rules:**
- While dragging, an object may move through doorways and openings into another room. On release, its footprint must sit inside a single room's polygon on its story; its `roomId` updates as part of the same undoable op. Footprint straddling a doorway on release → snap back (same policy file as before).
- Door clearance applies on **both sides** of interior doors.
- Collision, stacking, rotation and all TEST2 behaviors work unchanged inside every room.
- A single-room scan shows no house UI clutter (no level selector, room list collapsed).

**Performance (whole house can have hundreds of objects):**
- Only the current level is interactive; other levels are hidden or rendered without shadows.
- Frustum culling on per-room groups; in Room focus, other rooms' detailed assets may be swapped for footprints.
- Shadow camera fitted to the visible area, not the whole house.
- Load assets per room, nearest rooms first, with placeholders until loaded.
- Target: 60 FPS dragging in Room focus, ≥ 45 FPS orbiting Dollhouse on the 3-room fixture. Record numbers.

---

## Part E — Server & web connections

- One scan = one house **or** one room. Storage path holds all archives: `{userId}/{scanId}/export.json`, `capturedroom-<n>.json`, `capturedstructure.json`, optional `.usdz` and `worldmap.bin` (if saved). Size limits raised accordingly; still private, still RLS.
- Processing runs `importStructureScan`; one scene per scan.
- **My Scans** shows a "House · N rooms" or "Room" badge, rooms listed under the house, and import warnings. Opening a house opens Dollhouse view; opening a room opens it directly.
- "Add rooms" to an existing house (P1): new rooms upload into the same scan and re-run the import. It produces a **new scene version**. Furniture edits already made are carried over by `objectId` where the object still matches, and conflicts are listed in the report — never silently dropped.
- Dev "Import scan file" accepts both schemas.

---

## Tests
- Upcast: every old `roomscan/1` fixture produces the same scene as before (snapshot regression).
- 3-room fixture: rooms in correct relative positions; shared walls deduplicated with both `roomIds`; interior door `connects` both rooms; exterior doors connect to null; no duplicated doors or objects; every object in the right room; section labels named the rooms.
- Merge-failed fixture: rooms imported separately with a warning.
- Two-story fixture (hand-authored if no real one): level elevations, stairs object, objects on the right story.
- Moving an object through a doorway into another room updates `roomId`; undo restores it; straddling on release snaps back.
- Door clearance on both sides of an interior door.
- Determinism snapshot for the house fixture.

## Deliverables, in order
1. `HOUSE_SCAN_NOTES.md` + doc updates (scope change applied).
2. `structurescan/1` schema, upcast from `roomscan/1`, hand-authored 3-room and 2-story fixtures.
3. Structure scene model + `importStructureScan` + tests; migrate existing scenes/fixtures.
4. iOS house mode (continuous session, per-room naming, StructureBuilder merge, failure handling) + exporter tests.
5. Record a real multi-room scan; verify conventions; tighten import.
6. Sandbox: viewing modes, room list, level selector, cross-room editing rules, performance pass.
7. Server/web: storage layout, processing, My Scans badges.
8. P1: save ARWorldMap and add rooms later.
9. End-to-end run with a real house scan on the demo laptop.

After each: build/typecheck + tests, a short note on what works, decisions made, and any doc you changed.

## Acceptance checklist
- [ ] Docs updated so house scanning is in scope, with change notes; `HOUSE_SCAN_NOTES.md` lists all single-room assumptions and their resolution.
- [ ] Single-room scans still work end to end, unchanged.
- [ ] A ≥3-room house scan on iPhone merges, uploads, and opens in the browser as one house with rooms in the right places (spot-check room-to-room distances with a tape measure, within ~10 cm).
- [ ] Shared walls appear once; interior doors connect rooms; rooms are named.
- [ ] Furniture is in the right rooms, facing the right way, as matched GLBs or labeled placeholders.
- [ ] Dollhouse, Room focus, Floor plan and Walk mode work; walking through a door into the next room works.
- [ ] Objects can be moved from one room to another through a doorway; undo works.
- [ ] A failed merge or lost tracking never loses scanned rooms.
- [ ] Performance targets met and recorded.
- [ ] All earlier checklists (sandbox, test2, RoomPlan) still pass.

Still out of scope: editing on iPhone, room photo reconstruction, and changing redesign/budget behavior (only documented in notes for now).