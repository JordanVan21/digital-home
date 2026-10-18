# House scanning — notes (Step 0)

**Date:** 2026-10-17 · **Prompt:** `HOUSE_SCAN_PROMPT.md`. It wins over `ROOMPLAN_PROMPT.md`; the RoomPlan side is in `ROOMPLAN_NOTES.md`.
**Status: stopped for decisions.** The scope change is applied to the docs. The data-model change reaches beyond scanning, import and the sandbox: it touches the meaning of `roomId`, which redesign, budget and timeline use. So the CONTRACTS.md types are written as **proposed** (CONTRACTS §11) until you choose D1 and D2 (§3).

---

## 1. Doc edits applied (each doc has a dated "House scanning (2026-10-17)" change note)

| Doc | Edits |
|---|---|
| `PRD.md` | P-01 ("one room **or a whole house**"; a house opens as one navigable house). P-02 (immutable shell = room or house structure; relative positions ±10 cm; shared walls once; interior doors connect rooms). P-03 (furniture in the correct room). §8 in scope adds multi-room house scans (iOS 17 MultiRoom, one story P0, multiple stories where scanned). §8 out of scope **removes** "complete-house scan merging". §9 launch gate says "scan/upload (a room or a house)". New **§12 House scanning** change note. |
| `FUNCTIONAL_SPEC.md` | §1 "single-room-at-a-time" → "one scanned space (a room or a whole house) at a time". F-01 mentions house structures. New **§13**: scanner house flow and merge-failure handling, `structurescan/1` export/upload, import behavior, desktop house behavior, and new tests F-21–F-24. |
| `FEATURE_DESIGN.md` | §4.1 user story includes whole houses. New **§13**: iPhone house flow, My Scans badges, Dollhouse / Room focus / Floor plan / Walk views, level selector, room list with rename, no house clutter for single rooms. |
| `SYSTEM_ARCHITECTURE.md` | §3.1 capture includes multi-room sessions + `StructureBuilder`. §3.2 shell generalized to a multi-room structure. New **§17**: iOS house mode, storage layout, `scan.import` job → `importStructureScan`, re-import as a new shell/version, sandbox performance targets. |
| `CONTRACTS.md` | New **§11 (PROPOSED)**: `StructureScanExport` (`structurescan/1`, `roomscan/1` upcast), `StructureShell` (levels, rooms, walls with `roomIds` and height profiles, openings with `connects`, `importTransform`), scene fields `structureRoomId`/`story`/`roomLabels`, op `setStructureRoom`, invariant and API changes. Not binding yet. |

## 2. Single-room assumptions in the docs and how each behaves with a house

| Where | Assumption today | With a house | This round? |
|---|---|---|---|
| PRD §1–§4 language ("scan a real room", pitch "Redesign your real room") | One room | "Room" means the scanned space; the pitch is unchanged (a house is many rooms). | Wording only, done in §12 |
| CONTRACTS §1 "All objects belong to one room; all milestones belong to one room" | One room per scene | Objects: one space (`roomId`) + one structure room (`structureRoomId`). Milestones: one space (a whole house roadmap) — see the budget rows. | Proposed (CONTRACTS §11) |
| CONTRACTS §2 `RoomShell` (one floor polygon) | One polygon | `StructureShell` with rooms, levels, shared walls; old shells upcast. | Proposed |
| CONTRACTS §3.1 "new scan → new shell (normally a new room)" | Shells never grow | "Add rooms later" = new shell for the **same** space + new SceneVersion; edits carried over by object ID, conflicts reported. | Proposed; implemented in deliverable 8 (P1) |
| CONTRACTS §5 `getScene(roomId)`, `createScanUpload(projectId)` | room = scan | Unchanged if D1 = A; `projectId` becomes optional. | Proposed |
| FUNCTIONAL_SPEC §2 "projects contain owned rooms; each room references a scan and immutable shell" | One room per scan | Still true if "room" = space (D1 = A). | — |
| FUNCTIONAL_SPEC §4, CONTRACTS §2/§9 redesign: `DesignBrief.roomId`, `SemanticDesignPlan`, Design Planner plans "one cohesive whole-room design" | Redesign a room | **Recorded, not implemented.** Recommended default: redesign targets **one structure room at a time** inside a house scene (patch limited to that room's objects; locks and the shell are still enforced house-wide). Whole-house redesign later. The brief would gain an optional `structureRoomId`. | Document only |
| FUNCTIONAL_SPEC §6 / CONTRACTS §6 budget: purchases from a diff, milestones per room | One room's purchases | **Recorded.** A house gets one roadmap; purchases carry `structureRoomId` for grouping and filtering; affordability arithmetic is unchanged. A per-room redesign adds to the same house roadmap. | Document only |
| FUNCTIONAL_SPEC §7 / FEATURE_DESIGN §3.6 timeline: milestone snapshots of a room | Room snapshot | **Recorded.** Snapshots are whole-house SceneVersions; playback can focus the room that changed. | Document only |
| Scene versioning (CONTRACTS §3) | — | One scene per scan (house = one scene); unchanged. | — |
| My Scans (FEATURE_DESIGN §3.1, CONTRACTS `getMyScans`) | Room cards | "House · N rooms" badge, rooms listed under the house. | Yes (deliverable 7) |
| RLS / storage paths (PRD §7, CONTRACTS §1) | Owner-scoped | Unchanged: owner-scoped `{ownerId}/{scanId}/…` holds all of a house's archives. | Yes |
| FEATURE_DESIGN §3.2 top bar "room name" | One name | Space name + current room (Room focus). | Yes (sandbox) |
| `finaldiagram.png` | "3d Scanner" box, single room | Still valid: the Format adapter now emits `structurescan/1`. No redraw needed; noted here. | — |
| Sandbox (`SANDBOX_NOTES`, `TEST2_SCENE_SPEC`) | One `RoomShell`; walls **on** the polygon boundary, extruded outward; `inside_room` = one polygon; door clearance on one side | Walls become centerlines with centered thickness (shared walls sit between rooms); `inside_room` = inside **one** room's polygon on its story; door clearance on both sides of interior doors; walls get door gaps for walking/moving between rooms. test2 and the demo room are upcast unchanged. | Yes (deliverables 3, 6) |

## 3. Decisions needed before coding

- **D1 — What `roomId` means.** The prompt uses `rooms[].roomId` inside a structure and `roomId` on every object. CONTRACTS already uses `roomId` for the **project-level room record** (`rooms` table) in `SceneSpec`, `DesignBrief`, `DesignProposal`, `Milestone`, `getScene(roomId)`, RLS ownership, and so on.
  - **Option A (recommended):** keep `roomId` = the scanned space (one room or a house). Structure-level rooms are `StructureShell.rooms[].id`, and objects carry `structureRoomId`. Nothing in redesign, budget, timeline or the API changes.
  - **Option B:** rename the container (e.g. `spaceId`/`homeId`) across every contract and API, and use `roomId` for structure rooms as the prompt writes it. This churns everything outside scanning.
- **D2 — Where the structure lives.** The prompt embeds `structure` in `Scene`; CONTRACTS §2–3 keeps an immutable shell referenced by `SceneSpec.shellId` (`room_shells` table).
  - **Recommended:** keep the reference. `StructureShell` generalizes `RoomShell` (upcast for old shells), renames go to `SceneSpec.roomLabels`, and immutability stays enforced by construction.
- **D3 — Redesign / budget for houses.** Per the prompt, record only; the recommended defaults are in §2. Confirm no implementation is expected this round.
- **Environment blockers** (same as `ROOMPLAN_NOTES.md` §5):
  - **B1:** no Mac/Xcode/iPhone here. I write untested Swift + an XcodeGen project + a device checklist; you build, scan and commit the real fixtures (≥3-room house, single rooms).
  - **B2:** no Supabase project or keys. I write migrations, RLS and adapters; you apply them or give me the URL + anon key.

## 4. Conflicts between the prompts and the docs (resolutions)
- `roomscan/1` (ROOMPLAN) vs `structurescan/1` (HOUSE) → HOUSE wins. iOS emits only `structurescan/1`; the importer upcasts `roomscan/1`, and `importRoomScan` wraps `importStructureScan`.
- ROOMPLAN "don't use StructureBuilder / multi-room" → reversed by HOUSE.
- Field names (HOUSE Part B: `sceneId`, `version`, `start/end`, `height`, `type`, `offset`, `sill`, `objects: Record`) → CONTRACTS names (`id`, `revision`, `fromXZ/toXZ`, `heightM`, `kind`, `offsetM`, `bottomM`, an objects array), per SANDBOX_NOTES C13.
- HOUSE storage `{userId}/{scanId}/…` matches CONTRACTS (server-managed keys); the server generates it from the verified user.
- HOUSE "cut walls at 1.2 m" vs the sandbox's 1.05 m cut-away → the cut height becomes a setting; Dollhouse uses 1.2 m.
- Sandbox walls are collision boxes over the full wall length (openings ignored); HOUSE needs moving and walking through doorways → wall bodies are split at doors and openings (windows still block).
- Synchronous `complete` (both prompts) vs persisted job (FUNCTIONAL_SPEC §12, SYSTEM_ARCH §8) → job; see ROOMPLAN_NOTES C2.

## 5. Plan once D1–D2 are decided (both prompts merged)
1. Contracts: `structurescan/1` (+ `roomscan/1` upcast), `StructureShell` (+ `RoomShell` upcast), scene fields; hand-authored fixtures: single room (regenerated `demo-scan.json`), 3-room house with interior doors and a doorless opening, 2-story with stairs, merge-failed house.
2. `importStructureScan` + `importRoomScan` wrapper, column-major matrix helper (+ web test vs `THREE.Matrix4.fromArray`), determinism snapshots; migrate `matchScanObject` / demo-scan / web loader.
3. Engine/sandbox: centered walls, multi-room rules (room membership on release, straddle → snap back, door clearance on both sides), door gaps in wall bodies; renderer for structures; views (Dollhouse, Room focus, Floor plan, Walk), room list, level selector; performance pass.
4. iOS app (Swift, XcodeGen): room and house modes, exporter + XCTest with recorded fixtures (once you provide them).
5. Server: `apps/api` (Fastify) `createScanUpload` / `completeScan` / `getMyScans`, `apps/worker` `scan.import`, `supabase/migrations` (tables, RLS, storage policy), dev CLI `pnpm import-scan`.
6. Web: My Scans (badges, rooms, statuses, re-run import), import report, dev "Import scan file".
7. P1: ARWorldMap save + add rooms later (new shell + scene version, edits carried over).
