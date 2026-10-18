# RoomPlan integration — notes (Step 0)

**Date:** 2026-10-17 · **Prompts:** `ROOMPLAN_PROMPT.md` + `HOUSE_SCAN_PROMPT.md`. Where they conflict, HOUSE_SCAN wins; see `HOUSE_SCAN_NOTES.md`.
**Precedence:** CONTRACTS.md > FUNCTIONAL_SPEC.md > PRD "11. Merged scope decisions (2026-10-17)" > HOUSE_SCAN_PROMPT > ROOMPLAN_PROMPT > older prompts > other docs.
**Status: stopped for decisions.** Four blockers in §5 change the architecture or need things only you can provide (a Mac, an iPhone, Supabase). Nothing below has been implemented yet.

---

## 1. What the docs say about scanning

| Topic | Source | What it says |
|---|---|---|
| Journey | PRD §4 steps 2–3 | iPhone RoomPlan capture → authenticated upload stores the raw scan and normalized geometry → desktop **My Scans** lists completed scans → opening one loads the canonical scene (shell + approximate furniture or placeholders). |
| Requirements | PRD §5 P-01, P-02, P-03 | Signed-in upload; the scan appears in the same user's My Scans. An immutable shell keeps the scan geometry. Classified furniture sits near the detected coordinates, with an explicit fallback. |
| iPhone UI | PRD §6; §10 "Decided" | Scan and upload status only; no room photos. |
| Security | PRD §7; CONTRACTS §5 "Auth" | RLS on every project row, private raw scans, uploads constrained and validated, short-lived signed URLs, no service-role key on clients. |
| Scope | PRD §8 | "single-room scans" in scope; "complete-house scan merging" out. **Reversed by HOUSE_SCAN** (see HOUSE_SCAN_NOTES §1). |
| Accounts and projects | FUNCTIONAL_SPEC §2 | Supabase Auth; `projects` contain owned `rooms`; each room references a scan and an immutable shell. |
| Scanner behavior | FUNCTIONAL_SPEC §2 | Check support and permissions (unsupported-device and camera-denied states). Start/stop and preview. Upload the raw RoomPlan export plus metadata via signed upload with **size limits, retries, checksums, progress/error, idempotent completion**. |
| Import | FUNCTIONAL_SPEC §2 | An **import worker** parses, normalizes coordinates, meters, openings, classes and dimensions, and produces `RoomShell` + approximate objects with stable IDs. Unknown classes are flagged. Quality checks reject zero area, broken polygons, missing walls and corrupt content. |
| My Scans | FUNCTIONAL_SPEC §2 | Lists only the user's rooms; loading creates or retrieves a working SceneSpec. |
| Failure cases | FUNCTIONAL_SPEC §9 | Unsupported iPhone → stop before scanning. Interrupted upload → retry with idempotent completion, no duplicate project entries. Invalid scan → explain, no broken scene. |
| Tests | FUNCTIONAL_SPEC §10 | F-01 scan roundtrip, F-11 ownership. |
| Jobs | FUNCTIONAL_SPEC §12 "Shared edit/AI behavior" | "AI and scan work run as persisted jobs." |
| UX | FEATURE_DESIGN §3.1, §4.1 | My Scans cards (name, date, status processing/ready/failed, thumbnail, Open, retry, rename). Scan UX states uploading/processing/ready/failed; no catalog match → neutral proxy. |
| Architecture | SYSTEM_ARCHITECTURE §3.1, §3.2, §4.1 | iPhone module: sign in, support check, capture, export raw data and metadata, signed upload, status. The **scan import/normalization worker** validates, parses, normalizes, creates `RoomShell` + initial `SceneSpec`, matches assets, creates proxies. The flow ends in "Room becomes visible in My Scans". |
| Modules | SYSTEM_ARCHITECTURE §5.2 | `scan-import` (normalization, shell and object creation, status tracking). |
| Persistence | SYSTEM_ARCHITECTURE §6.1–6.2 | Tables `projects, rooms, scans, room_shells, scenes, scene_versions`, optional `scan_jobs`; storage group "raw scan artifacts" (no bucket name given). |
| Jobs | SYSTEM_ARCHITECTURE §8 | Scan normalization is an async job. |
| Layout | SYSTEM_ARCHITECTURE §16 | `apps/ios/` (Swift RoomPlan capture/upload only), `apps/api`, `apps/worker` (same host initially, jobs claimed from Postgres), `supabase/migrations`. |
| Coordinates and identity | CONTRACTS §1 | Meters, X right / Y up / Z forward. "Normalizer converts RoomPlan's coordinate reference into this convention **exactly once**. Maintain explicit scan-to-world transform." Shell geometry is parametric. Storage keys are server-managed, never user-supplied. **"All objects belong to one room."** |
| Shell lifecycle | CONTRACTS §3.1 | `RoomShell` is immutable; a new scan → new shell ID (normally a new room). |
| APIs | CONTRACTS §5 | `createScanUpload(auth, projectId, file manifest) → signed upload targets + scanId`; `completeScan(scanId, manifest) → status; shell and scene produced server-side`; `getMyScans(auth)`; `getScene(roomId)`; typed errors. |
| Swift scope | CONTRACTS §9 "Source of truth for shared modules" | Swift uploads raw RoomPlan data via signed APIs and must not re-implement scene semantics. This matches the prompt's two-stage design. |
| Diagram | `finaldiagram.png` | "Swift micro": 3D Scanner (RoomPlan) → **Format adapter CapturedRoom→Json**, with arrows to the 3D render agent and to the Database. Consistent with stage 1 (Swift exporter) plus server import. The "render agent" box = import + asset retrieval. |

## 2. Connection map (doc name → code today → proposal)

Code today: `packages/contracts`, `packages/scene-engine`, `apps/web`, `tools/asset-ingest`. There is **no `apps/ios`, `apps/api`, `apps/worker` or `supabase/`**, and no Supabase client anywhere.

| Hop | Docs | Code today | Proposed name | Gap |
|---|---|---|---|---|
| Capture | RoomPlan `CapturedRoom` (ROOMPLAN A); `CapturedStructure` (HOUSE A) | — | `apps/ios/HouseScanner` (SYSTEM_ARCH §16 "apps/ios/"; prompt) | Missing (needs a Mac; see §5 B1) |
| Export format | "raw RoomPlan export + structured capture metadata" (FUNCTIONAL_SPEC §2); no schema in CONTRACTS | `ScanFixture` / `ScanObject` in `packages/contracts` (ad-hoc, pre-normalized base-center transforms) | `StructureScanExport` = `structurescan/1` (HOUSE A), upcasting `roomscan/1` (ROOMPLAN A); zod in `packages/contracts` | ⚠ Mismatch: the current `ScanObject` is already normalized, which contradicts "raw values". CONTRACT-TBD |
| Archives | "raw scan artifacts" (SYSTEM_ARCH §6.2) | — | `export.json`, `capturedroom-<n>.json`, `capturedstructure.json`, optional `structure.usdz`, `worldmap.bin` | New |
| Upload start | `createScanUpload(auth, projectId, manifest)` (CONTRACTS §5) | — | `POST /api/scans` → `createScanUpload` | ⚠ The prompt's `POST /scans` has no `projectId` (see §3 C3). Manifest needs **checksums** (FUNCTIONAL_SPEC §2), which the prompt omits |
| Storage | private "raw scan artifacts" bucket; server-managed keys (CONTRACTS §1) | — | bucket `scans` (private); key `{ownerId}/{scanId}/<file>`, generated by the server | Bucket name and key layout CONTRACT-TBD |
| Upload complete | `completeScan(scanId, manifest)` (CONTRACTS §5) | — | `POST /api/scans/:scanId/complete` → `completeScan` | ⚠ Docs: processing is a **persisted job** (FUNCTIONAL_SPEC §12, SYSTEM_ARCH §8); prompt: synchronous. See §3 C2 |
| Job | optional `scan_jobs` (SYSTEM_ARCH §6.1); worker claims from Postgres (§16) | — | `scan_jobs` table + `apps/worker` handler `scan.import` | New |
| Import | "import worker … generates RoomShell" (FUNCTIONAL_SPEC §2; SYSTEM_ARCH §3.2, §5.2 `scan-import`) | `reproduceScanObject`, `matchScanObject` (scene-engine); `sceneFromScan` (web loader) | `importStructureScan()` in `packages/scene-engine` (+ `importRoomScan` wrapper) | Prompt says `packages/scene-core`; the repo uses `scene-engine` (SANDBOX_NOTES C1) |
| Shell row | `room_shells` (SYSTEM_ARCH §6.1); `RoomShell` (CONTRACTS §2) | `RoomShellSchema` (contracts) | Generalized structure shell (HOUSE B), still stored in `room_shells` | ⚠ Single-room type; see HOUSE_SCAN_NOTES §3 |
| Scan row | `scans` (SYSTEM_ARCH §6.1) | — | `scans(id = scanId, owner_id, project_id, room_id, kind, status, error, report, object_count, captured_at, …)` | Columns not specified anywhere: CONTRACT-TBD |
| Room row | `rooms`; "each room references a scan and immutable shell" (FUNCTIONAL_SPEC §2) | `SceneSpec.roomId` | `rooms(id, project_id, owner_id, name, scan_id, shell_id)` | ⚠ "room" now means "the scanned space (one room or a house)"; see HOUSE_SCAN_NOTES §3 D1 |
| Scene | `scenes` (working), `scene_versions` (immutable); `SceneSpec`, `SceneVersion` (CONTRACTS §2–3) | `SceneSpec` + `LocalScenePersistence` mock (`getScene` / `saveScenePatch`) | Import writes `scenes` (revision 0) + `scene_versions(source: 'import')` | ✓ Matches `SceneVersion.source 'import'` |
| Statuses | uploading / processing / ready / failed (FEATURE_DESIGN §4.1) | — | `scans.status`: `uploading → processing → ready \| failed`; iOS-local `pending upload` | ✓ |
| My Scans | `getMyScans(auth)` → owned room/scan summary list (CONTRACTS §5) | Scene picker (fixtures only) | `GET /api/scans` → `getMyScans`, RLS-scoped | Missing |
| Open scene | `getScene(roomId)` (CONTRACTS §5) | `ScenePersistence.getScene(roomId)` (mock) | Supabase/API adapter behind the same interface | Real adapter missing |
| Auth | Supabase Auth JWT verified on a trusted path (CONTRACTS §5) | — | supabase-swift (Keychain session); supabase-js in web; API verifies the JWT | Needs a Supabase project (§5 B2) |
| RLS | owner via project membership (CONTRACTS §1) | — | `owner_id` on every row + RLS; storage policy on `scans/{auth.uid()}/…` | New |

## 3. Conflicts and proposed resolutions

- **C1 — Package name.** The prompts say `packages/scene-core`; the repo has `packages/contracts` (zod types) and `packages/scene-engine` (pure logic), per CONTRACTS §9. → Keep. Export schemas go in `contracts`, the importer in `scene-engine`, fixtures under `packages/scene-engine/fixtures/roomplan/<name>/`.
- **C2 — Synchronous complete vs persisted job.** The prompt runs the import inside `POST …/complete`; FUNCTIONAL_SPEC §12 and SYSTEM_ARCH §8/§16 say scan work runs as a persisted job claimed by the worker. → Docs win. `completeScan` validates the manifest, sets `processing`, inserts a `scan_jobs` row and returns. The worker (same host, same process in dev) runs `importStructureScan` and sets `ready | failed`. Clients poll `getMyScans` (or Supabase Realtime later). Idempotency is unchanged.
- **C3 — `projectId`.** `createScanUpload` requires `projectId` (CONTRACTS §5); the prompt doesn't mention projects, and the iPhone has no project UI (PRD §6). → The server auto-creates one default project per user ("My home") on first use. The iPhone passes no project; the API resolves it. CONTRACT-TBD: `projectId` becomes optional.
- **C4 — Checksums and size limits.** FUNCTIONAL_SPEC §2 requires checksums; the prompt doesn't. → The manifest lists `{ name, bytes, sha256 }` per file, and the server verifies them on complete. Limits live in one shared config: 25 MB per JSON, 60 MB per USDZ, 200 MB total for a house.
- **C5 — Object naming.** Prompt `origin: 'scan'` and `ownership null` → CONTRACTS `source: 'roomplan_approximation'`, `ownership: 'existing'`. Prompt `scanMatch.scanDimensions` + `attributes` → `scanMatch.scanDimensionsM` + new `attributes` (CONTRACT-TBD).
- **C6 — IDs.** The prompt uses RoomPlan UUIDs (lowercased). CONTRACTS only requires UUIDs, so they're compatible. The shell ID is derived deterministically (UUID v5 of `scanId`) so re-imports are byte-identical.
- **C7 — Normalization.** The prompt centers the bounding box and rotates the longest/dominant wall to +X. CONTRACTS §1 says "convert exactly once" and "maintain an explicit scan-to-world transform". → Compatible: one `importTransform` stored on the shell and the scan (CONTRACT-TBD field).
- **C8 — `SANDBOX_PROMPT.md` said normalization was out of scope.** Now owned by the importer. The pre-normalized `ScanObject`, `reproduceScanObject` and web `sceneFromScan` paths are removed and routed through the importer.
- **C9 — Diagram vs docs.** The diagram shows the scanner writing straight to the Database. The docs route writes through the trusted API with signed uploads. → The docs win; the diagram's arrow is read as "raw files land in storage". No conflict in substance.
- **C10 — Wall placement convention.** The sandbox puts walls **on** the floor-polygon boundary with thickness extruded outward (SANDBOX_NOTES §3d). RoomPlan walls are center planes, and house interior walls sit between two rooms. → Walls become centerline segments with thickness centered on the line, and room floor polygons are inset by half the thickness. Affects `shell.ts`, wall collision bodies and the renderer (HOUSE_SCAN_NOTES §4).

## 4. Existing code that must change
- `packages/contracts`: replace `ScanObject` / `ScanFixture` with `StructureScanExport` (+ `RoomScanExport` upcast); add the structure shell types (HOUSE B).
- `packages/scene-engine`: `matchScanObject` takes export `Object`s (category, raw dimensions, `attributes`). `reproduceScanObject` is folded into `importStructureScan`. Room polygon / wall convention changes ripple into `shell.ts`, `rules.ts` (inside a room polygon, door clearance on both sides), `collision.ts` (wall bodies for centered walls) and `support.ts` (floor height per story).
- `packages/contracts/fixtures/demo-scan.json` → hand-authored `structurescan/1` (kind `room`), plus hand-authored 3-room and 2-story house fixtures.
- `apps/web`: `loader.ts` "From scan" goes through `importStructureScan`. The renderer adds height profiles, open doors, multiple rooms, levels and views (HOUSE D). My Scans; import report; dev "Import scan file".
- New: `apps/api`, `apps/worker`, `supabase/migrations`, `apps/ios/HouseScanner`.

## 5. Blockers and decisions needed

- **B1 — No macOS, Xcode or iPhone here (Windows).** I can write the Swift app, exporter and XCTest sources plus an **XcodeGen `project.yml`**; a hand-written `.pbxproj` is fragile. I can't compile it, run it in the Simulator, scan, verify RoomPlan conventions, or record the real fixtures (ROOMPLAN A "Verify on a real device"; both prompts' recorded scans). **Decision:** OK for me to deliver untested Swift sources plus an on-device verification checklist, with you (or a teammate with a Mac and a LiDAR iPhone) building, scanning and committing the recorded fixtures? Until then the importer is built and tested against hand-authored fixtures based on RoomPlan's documented conventions.
- **B2 — Supabase.** There's no project URL or anon key, no CLI here, and no `supabase/` folder. **Decision:** give me the project URL and anon key (the service-role key goes only in a local `.env`, never committed), or let me write migrations, RLS policies and adapters that you apply. Until then the server runs against an in-memory/file store behind the same interfaces, and RLS is tested as SQL you run.
- **B3 — Server framework.** The docs say "persistent Node TS API" without naming a framework. → I propose **Fastify** for `apps/api` and a plain Node job loop for `apps/worker` (one process in dev). This is a default, not a blocker.
- **B4 — Data-model change that reaches beyond scanning** (from HOUSE_SCAN, see HOUSE_SCAN_NOTES §3): the meaning of `roomId` and the "all objects belong to one room" invariant. **Needs your decision before coding.**

## 6. Device verification checklist (to record once B1 is resolved)
- Object transform origin (box center expected) → base y = center y − h/2.
- Object `dimensions` axis order (expected x = width, y = height, z = depth).
- Object front: which local axis faces into the room. Test with a sofa against a wall and a TV.
- Wall local frame: which axis is along the wall and which is the normal; `dimensions.z == 0`.
- `polygonCorners` plane axes for floors and walls → world via the surface transform.
- Door/window `parentIdentifier` = wall identifier.
- House: whether merged items keep per-room identifiers; shared walls (one or two); per-room floors in `merged`; `sections` → rooms; per-room transforms in shared world space.
