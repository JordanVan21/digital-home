# Remaining phone work and Supabase handoff

**Updated:** 2026-10-18. **Branch:** `feature/room-scanner`.

## Current decision

The user accepted phone checkpoints 1–3 and chose to prioritize Supabase schemas,
scan/GLB storage and the single-room end-to-end connection. The original seven-step
phone plan is retained in `SCANNER_STATUS.md` as history, but finishing every phone
feature is no longer a prerequisite for backend work. The original full phone scope
is not complete; the features below are deferred or move into integration.

`CONTRACTS.md` remains authoritative for shared names, units, normalized transforms,
ownership and server-side validation. This document changes work priority only.

**Hackathon update (2026-10-18):** with ~6 hours left the user prioritized a
**single-room** end-to-end connection (phone → Supabase → render agent → sandbox,
plus planner/budget). Whole-house capture was implemented and then deferred
untested (see below). Every feature in "Deferred standalone phone features" is
still deferred; try them after the single-room demo works.

## Verified phone baseline

- Installation/signing on the user's LiDAR iPhone; unplugged launch and scanning.
- RoomPlan live capture, coaching, Finish and confirmed Cancel/Discard. The user
  confirmed the corrected controls and unobstructed RoomPlan miniature preview.
- Rotatable/zoomable post-scan preview, naming, Save/Discard and saved scan list.
- Durable local storage, saved/unfinished records and recovery. The user answered
  “works” after the checkpoint covering force-close, phone restart and draft discard.
- JSON sharing through the standard iOS sheet/AirDrop; two genuine version 1 scans
  in `apps/ios/Fixtures/real-scan-1.json` and `real-scan-2.json`.
- App-side USDZ preview/backup and native RoomPlan JSON written beside the primary
  scan. The UI currently shares primary JSON only.
- Supabase email/password sign-in and scan upload (`78a368d`): the user confirmed
  sign-up/sign-in works and both uploaded scans appear in the hosted `scans` table.
- Current build checkpoint: unsigned physical-iPhone target build succeeds;
  13 Swift tests pass. This is build evidence, separate from the phone results above.

## Deferred standalone phone features

### Complete version 2 export

Implement the approved target in `SCAN_FORMAT.md`: app/build and hardware metadata,
explicit capture coordinate convention, room IDs/name/type/story, element membership,
full transforms and dimensions, door open/closed state, object attributes/confidence,
source identity and stable ordering. Unknown values must remain unknown.

Keep version 1 fixtures readable. Coordinate normalization still belongs in the
TypeScript importer exactly once. Implement/migrate both wire reader and writer
together when adopting version 2; do not describe version 2 as currently available.

Acceptance: repeat sharing of the same saved artifact returns identical bytes;
real exported data validates against the documented format; old fixtures still import.

### Sharing backup artifacts

Add explicit sharing for USDZ and native RoomPlan JSON alongside the primary scan.
USDZ export/storage already exists; backup sharing does not. A backup export failure
must not prevent primary JSON persistence or upload. Verify AirDrop/Files on the phone.

### Whole-house capture

Add Room/House start choices, Add next room and Finish house. Reuse one continuous
AR session and StructureBuilder alignment on iOS 17+, retain per-room identities and
stories, and recover completed rooms in an unfinished house. Respect tracking/size
limits; independently captured rooms must not be concatenated without alignment.

Acceptance: capture two adjoining rooms unplugged, preview/save/reopen/share the
aligned house, and verify room membership and positions with real data.

**Try later — implementation exists but was never phone-tested.** Commit `05dc2bc`
added it and `4edab99` reverted it to protect the verified single-room flow.
Restore with `git revert 4edab99`. What it does:

- Finish room → Scan next room continues the same AR session
  (`captureSession.stop(pauseARSession: false)`, then `run` again), or Finish house
  merges rooms with `StructureBuilder(options: [.beautifyObjects])`.
- `scan.json` stays the version 1 shape; multi-room adds optional `roomIndex` on every
  surface/object plus `rooms: [{index, id, story, label}]` (label = RoomPlan section,
  e.g. kitchen). Single-room output stays byte-identical (fixture round-trip test).
  `packages/scan-import/src/rawScan.ts` accepts the same optional fields.
- `roomplan.json` holds the native `CapturedStructure`; USDZ preview is the house.
- Backgrounding or a failed later room keeps the rooms already captured.
- Unverified: whether `RoomCaptureView` restarts cleanly for room 2 after showing its
  processed result. The Supabase schema already supports it (`houses` → many `rooms`,
  each with `placement`); the worker must split elements by `roomIndex` using one
  shared scan-to-world transform so rooms stay aligned.

### Saved-scan management

The current saved record already opens with preview, counts and primary JSON sharing.
Add deletion of saved scans with confirmation; draft discard already works. Keep
deletion of local artifacts distinct from deletion of future remote records.

Acceptance: delete a disposable saved scan, restart, and confirm neighboring scans
remain. Decide remote deletion semantics when remote scans exist.

### Persistent error log

Add recent capture/storage/preview/upload errors in an in-app log and share it via
AirDrop/Files. Current transient errors, storage notices and per-record preview
warnings are not a centralized error log. Do not log credentials.

## Work required during Supabase integration

These items move into the backend milestone rather than waiting for the deferred UI:

1. **Freeze the first upload contract.** Current phone JSON is version 1 and the
   existing importer reads version 1. It can be the first single-room path; decide
   the artifact manifest, checksums, limits and version routing before implementing
   uploads. Database ingestion must not assume the unimplemented version 2 format.
2. **Verify the real importer path.** Run both real fixtures through the actual
   TypeScript importer and validate `RoomShell`/`SceneSpec`. Floor polygon corners
   in real exports are surface-local: the current fallback incorrectly treats them
   as capture/world coordinates. Transform them using the surface matrix and add a
   regression test. Verify placement/orientation in the renderer against the room.
3. **Use stable persistence identities.** The importer currently allocates new room,
   shell and scene IDs on each invocation by default. Reprocessing the same scan must
   not create duplicate rooms/scenes; supply/persist identities and use idempotent
   scan/job completion. Preserve source artifacts and the scan-to-world transform.
4. **Done (minimal, `78a368d`).** **Add the swappable upload boundary.** Inject an uploader that accepts saved
   artifacts and scan ID. Preserve local files before upload; persist status and
   retry without changing IDs/bytes; distinguish ready, uploading, uploaded and
   failed. Existing status enum values alone do not implement those transitions.
   A stand-in may remain for offline testing, but a separate placeholder-only
   release is not required before connecting a real uploader.
5. **Done (`31aa0d9`, `78a368d`): email/password + owner-only RLS.** **Connect identity and ownership.** Supabase Auth/RLS and trusted API ownership
   checks follow `CONTRACTS.md`. The phone still has no sign-in UI; agree the actual
   identity/session handoff as part of integration. Keep service-role/model secrets
   out of the app. The legacy HTTP uploader is unused and is not a Supabase upload flow.

## Next backend deliverable

Design and implement migrations for owned projects/rooms/scans, immutable room
shells, working scenes/accepted scene versions, scan processing jobs and versioned
asset metadata. Store raw/native scan artifacts and GLB binaries in Storage;
database rows hold metadata and storage keys, not binary models. Apply ownership
policies to private scans and explicit access policies to licensed asset files.

Wire the documented `createScanUpload` → signed upload → `completeScan` path to a
durable processing job using the shared TypeScript importer. Resolve render-service
assets into immutable `AssetSpec` references while preserving measured geometry;
unmatched furniture retains an explicit approximation. The desktop must load the
persisted `RoomShell`/`SceneSpec`, not depend on manually selecting an AirDrop file.

The render service implementation/branch and its callable contract have not yet
been inspected in this worktree. Inspect them before choosing its adapter.

Acceptance: one real single-room scan travels from the unplugged iPhone through
upload, Storage/database, processing and asset resolution into the desktop renderer;
reopening loads the same persisted room and retry creates no duplicates. Confirm
another user's scan/storage access is denied. This backend work has not been started
or deployed by this documentation update.
