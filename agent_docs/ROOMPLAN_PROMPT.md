# Task: Integrate Apple RoomPlan (Swift) and convert scans into scenes the 3D sandbox can render

This continues `SANDBOX_PROMPT.md` and `TEST2_PROMPT.md`. It adds the iPhone scanner and the full path from a RoomPlan scan to a scene that opens in the desktop Three.js editor.

---

## Step 0 — Read everything and reconcile (required, before code)

Read **every file in `agent_docs/`** (CONTRACTS, PRD, FUNCTIONAL_SPEC, FEATURE_DESIGN, SYSTEM_ARCHITECTURE, README, and view `finaldiagram.png`), plus `SANDBOX_NOTES.md`, `SANDBOX_AUDIT.md`, `TEST2_SCENE_SPEC.md`, `SANDBOX_PROMPT.md` and `TEST2_PROMPT.md`. Then inspect the current code (`packages/scene-core`, `apps/web`, any server package).

Precedence: **CONTRACTS.md > FUNCTIONAL_SPEC.md > PRD "Merged scope decisions (2026-10-17)" > this prompt > older prompts > other docs.** Note: the PRD has two sections numbered 11. Whenever an earlier prompt says "PRD §11" it means the **"Merged scope decisions (2026-10-17)"** section, not "Further documents."

Write `agent_docs/ROOMPLAN_NOTES.md` covering:
1. What each doc says about scanning, upload, storage paths, scan/scene tables, API endpoints, statuses, auth, and the "My Scans" list. Cite section names.
2. **A connection map**: for every hop in the pipeline below (iOS → storage → server → DB → web), the exact name used in the docs (bucket, table, column, endpoint, type) and the name currently used in code. Flag every mismatch, missing piece, or place where the docs and the diagram disagree.
3. Every conflict between the docs and this prompt, with your proposed resolution.
4. Which existing code must change to fit (at minimum: the `demo-scan.json` format and `matchScanObject` input type, see Part B).

Stop and show me the notes if anything blocks you or a conflict changes the architecture. Otherwise continue. Use CONTRACTS.md names in code; mark anything not covered there `// CONTRACT-TBD` and list it.

Language rules from the PRD: **Swift only for the iOS scanner; TypeScript everywhere else** (shared engine, server, web). No Go.

---

## Architecture of the pipeline

```
iPhone (Swift, RoomPlan)
  capture → CapturedRoom → RoomScanExport JSON (faithful, raw world coords)
  → authenticated upload (private storage) → "complete" call
Server (Node TS, trusted writes)
  validate → scene-core importRoomScan() → matchScanObject() → Scene
  → write scan record + initial scene version → status = ready
Web (React/R3F)
  My Scans (RLS-scoped list) → open scene → existing sandbox renders it
```

**Where the conversion happens (decision):** two stages.
1. **Swift exports a faithful, explicit JSON** (`RoomScanExport`): every RoomPlan surface and object with its raw transform, dimensions, category, confidence and parent link, in documented units and matrix layout. No room normalization or furniture matching on the phone.
2. **TypeScript `importRoomScan()` in `scene-core`** turns that into the sandbox `Scene` (normalized floor, CCW polygon, walls, openings attached to walls, objects at base-center with yaw, asset matches).

Reasons: one implementation of scene logic shared by server and web; testable in Vitest with recorded scans and no phone; re-importable when the importer improves (raw export is archived). If CONTRACTS.md or SYSTEM_ARCHITECTURE.md assigns conversion differently, follow the docs and explain the impact in the notes.

---

## Part A — iOS scanner app (Swift)

Location: per SYSTEM_ARCHITECTURE/README; otherwise `apps/ios/HouseScanner` (Xcode project, SwiftUI).

**Requirements**
- Minimum **iOS 17** (needed for `floors`, `Surface.polygonCorners`, `parentIdentifier`, curved surfaces and object attributes). LiDAR device required. Check `RoomCaptureSession.isSupported` at launch and show a clear "this iPhone can't scan" screen otherwise.
- RoomPlan does not run in the Simulator. Everything must build there, but scanning is tested on a physical device.
- `Info.plist`: `NSCameraUsageDescription`. No photo library or location permissions (room photos aren't needed per the PRD).
- The iPhone UI is **scan + upload status only** (PRD): sign in, list my scans with status, new scan, scan screen, review summary, upload progress, retry. No editing.

**Capture**
- Wrap `RoomCaptureView` in a `UIViewRepresentable`; implement `RoomCaptureViewDelegate` (`captureView(shouldPresent:error:)` and `captureView(didPresent:error:)`) to receive the processed `CapturedRoom`. Use default `RoomCaptureSession.Configuration()` and RoomPlan's built-in coaching.
- Done button stops the session; show RoomPlan's processing state; handle errors (session interrupted, tracking lost, processing failure) with a retry path that doesn't lose a previous scan.
- Single-room scope. Do not use `StructureBuilder` / multi-room merging (out of scope in the PRD); keep `story` in the export so it can be added later.

**Export (`RoomScanExporter.swift`)**
Produce `RoomScanExport` JSON, schema `"roomscan/1"`:

```jsonc
{
  "schemaVersion": "roomscan/1",
  "scanId": "uuid",                // client-generated, idempotency key for upload
  "capturedAt": "ISO-8601",
  "device": { "model": "iPhone15,3", "osVersion": "17.6" },
  "roomPlanVersion": 2,            // CapturedRoom.version
  "units": "meters",
  "coordinateSystem": { "handedness": "right", "up": "+Y", "matrixLayout": "column-major" },
  "walls":    [ Surface ],
  "doors":    [ Surface ],         // includes "isOpen"
  "windows":  [ Surface ],
  "openings": [ Surface ],
  "floors":   [ Surface ],
  "objects":  [ Object ],
  "sections": [ { "label": "string", "center": [x, y, z], "story": 0 } ]
}
Surface = {
  "id": "uuid", "parentId": "uuid|null", "category": "wall|door|window|opening|floor",
  "isOpen": true | false | null,    // doors only
  "transform": [16 floats],         // column-major
  "dimensions": [x, y, z],          // RoomPlan's simd_float3, unchanged
  "polygonCorners": [[x, y, z], ...], // local plane coordinates, as RoomPlan gives them
  "curve": { ... } | null,          // all fields RoomPlan provides for curved surfaces
  "completedEdges": ["top", "bottom", "left", "right"],
  "confidence": "low|medium|high",
  "story": 0
}
Object = {
  "id": "uuid", "parentId": "uuid|null", "category": "<RoomPlan category>",
  "attributes": ["string", ...],    // iOS 17 object attributes, stringified
  "transform": [16 floats], "dimensions": [x, y, z],
  "confidence": "low|medium|high", "story": 0
}
```

Rules:
- `simd_float4x4` → 16 floats **column by column** (`columns.0` … `columns.3`); translation is `columns.3`. This matches `THREE.Matrix4.fromArray`, so TS can use it directly.
- Export **raw RoomPlan values**: no axis swaps, no floor offset, no unit conversion. Normalization belongs to `importRoomScan`.
- Category strings: stable lowercase camelCase from RoomPlan's enums (`storage, refrigerator, stove, bed, sink, washerDryer, toilet, bathtub, oven, dishwasher, table, sofa, chair, fireplace, television, stairs`). Map explicitly with a `switch`; `@unknown default` writes `"unknown"` plus the raw description. Never crash on new categories.
- Also archive **Apple's own `CapturedRoom` JSON** (it's `Codable`) as `capturedroom.json`, and optionally a parametric USDZ via `CapturedRoom.export(to:)` for debugging. These are archives only; nothing in TS depends on their internal layout.
- Unit tests: decode a recorded `capturedroom.json` fixture (CapturedRoom is `Decodable`) and assert the exporter's output matches a checked-in `export.json`.

**Verify RoomPlan conventions on a real device (don't assume)** and record results in `ROOMPLAN_NOTES.md`:
- Object `transform` origin: box center vs base (expected: center, so base y = center y − height/2).
- Object `dimensions` axis order: which of x/y/z is width, height, depth in the object's local frame.
- Object **front direction** in local space (scan a sofa against a wall and a TV; see which local axis points into the room).
- Wall local frame: which axis runs along the wall, which is the normal, and that wall `dimensions.z` is 0.
- `polygonCorners` local plane axes for floors and walls, and how to convert them to world with the surface transform.
- Door/window `parentId` is the wall id (check it's populated).

Commit at least two real recorded scans (one simple rectangular room, one with an L-shape or angled wall; ideally also the room in `test2.png`) as fixtures: `packages/scene-core/fixtures/roomplan/<name>/{export.json,capturedroom.json}`.

**Auth & upload**
- Supabase Swift SDK (`supabase-swift`). Same Supabase project and sign-in method as the web app, so the same user sees the scan in desktop My Scans (PRD P-01). Only the anon/public key in the app, **never a service-role key on device**. Persist the session in the Keychain.
- Upload flow (adapt names/endpoints to CONTRACTS.md and SYSTEM_ARCHITECTURE.md):
  1. `POST /scans` (Node API, user JWT) with `scanId` + metadata → server creates the scan record (`status: uploading`) and returns storage paths or signed upload URLs.
  2. Upload `export.json`, `capturedroom.json` (and optional `room.usdz`) to the **private** scans bucket under an owner-scoped path (e.g. `{userId}/{scanId}/…`), matching the storage RLS policy in the docs.
  3. `POST /scans/{scanId}/complete` → server processes (Part C). Poll or subscribe for `processing → ready | failed`.
- Idempotent: retries reuse `scanId`; re-uploading or calling complete twice is safe.
- Failed or offline uploads are saved locally (app sandbox) and retried with backoff; the list shows `pending upload` with a manual retry. Never discard a captured scan because the network failed.
- Enforce the same size limits client-side as the server.

---

## Part B — `importRoomScan()` in scene-core (TypeScript, pure)

`importRoomScan(exp: RoomScanExport, catalog: AssetRecord[], opts) → { scene: Scene, report: ImportReport }`

- **Validate** with a runtime schema (zod or whatever the repo uses), shared by server and web. Reject a wrong `schemaVersion`, non-finite numbers, missing walls; cap array sizes.
- **Matrices**: build from the column-major array with a tiny pure matrix helper in scene-core (no `three` import). Add a test in the web package proving it matches `THREE.Matrix4.fromArray`.
- **Floor height**: from the floor surface if present; otherwise the lowest wall bottom (center y − height/2). Shift everything so the floor is y = 0.
- **Floor polygon**: from `floors[0].polygonCorners` converted to world XZ. Fallback (no floor or degenerate): chain wall endpoints into a polygon (snap endpoints within 5 cm, close small gaps). Normalize to **CCW viewed from +Y**; drop duplicate/collinear vertices.
- **Walls**: endpoints = wall center ± width/2 along the wall's along-axis (as verified in Part A); height from dimensions; non-uniform heights from `polygonCorners` (extend the `RoomShell` wall type with a height profile if needed; that's a contract change). Curved walls become N straight segments (default 8) with the original curve kept in metadata. Thickness default 0.1 m (RoomPlan walls are planes).
- **Openings**: attach doors/windows/openings to their wall via `parentId`; fall back to the nearest wall by projection. Compute offset along wall, width, height, sill height (bottom − floor). Carry `isOpen`. Door swing is unknown; leave it unset.
- **Room normalization**: translate so the floor polygon's bounding-box center is at x = z = 0, and rotate about Y so the longest wall aligns with +X. Store the applied **`importTransform`** (4×4) in scene/scan metadata so raw coordinates can be recovered.
- **Objects**: position = **base-center** (center − height/2 after the floor shift); yaw via `atan2` from the rotation part (if roll/pitch > 2°, log it and use yaw only). Map dimensions to `{ w, d, h }` per the Part A findings and sandbox conventions (w along local +X, d along +Z, front faces +Z). If RoomPlan's front is a different local axis, fold a fixed yaw correction into the import and document it.
- Set `origin: 'scan'`, `scanMatch: { roomPlanCategory, scanDimensions, score, attributes }`, `locked: false`, ownership default per CONTRACTS.md (else `null`).
- RoomPlan object `parentId`: keep only if the pair is in the nesting allow-list; otherwise ignore and note it in the report.
- **Asset matching**: run `matchScanObject()` (from `SANDBOX_PROMPT.md`) per object, now also using `attributes` (e.g. chair or sofa type). Categories without good catalog matches (`stairs`, `fireplace`, built-in appliances) map to fixed placeholders.
- **Never reject a scan for furniture issues**: objects penetrating walls by < 5 cm are pushed inside; larger issues stay and are flagged as warnings. Drop degenerate objects (any dimension < 2 cm). Keep low-confidence items but flag them.
- **IDs**: object and shell IDs = RoomPlan UUIDs (lowercased) for traceability, unless CONTRACTS.md says otherwise.
- `ImportReport`: counts per category, matched vs placeholder, dropped items with reasons, warnings, confidence summary, `importTransform`.
- **Determinism**: same input → byte-identical scene JSON (stable ordering, no random IDs). Snapshot-test it.

**Fix older code to fit**
- Replace the ad-hoc scan shape used by `matchScanObject` and `fixtures/demo-scan.json` with `RoomScanExport` objects. Regenerate `demo-scan.json` as a valid `RoomScanExport` (hand-authored is fine), and route the sandbox's "load scan" path through `importRoomScan`.
- `SANDBOX_PROMPT.md` said floor normalization belonged to an out-of-scope import step; it's now `importRoomScan`. Remove any duplicate normalization elsewhere.
- Reflect shell type changes (height profile, curve metadata, `isOpen`, `importTransform`) in the types and the renderer: walls with varying heights render correctly; open doors render as empty openings with a frame.
- Scans contain only RoomPlan's 16 furniture categories (no decor, lamps, rugs or plants). That's expected; the test2 fixture stays hand-built for decor.

---

## Part C — Server processing (Node TS)

Location per SYSTEM_ARCHITECTURE.md; endpoint names per CONTRACTS.md (names here are placeholders).

- `POST /scans`: verify the Supabase JWT; create the scan row owned by the user (`status: uploading`); return owner-scoped storage paths/signed upload URLs. Idempotent on `scanId`.
- `POST /scans/{scanId}/complete`: verify ownership; download `export.json` from private storage; validate; enforce size/time limits; run `importRoomScan`; write the canonical scene as the scan's initial version (same persistence model the sandbox's `ScenePersistence` uses); set `ready` with the import report, or `failed` with a user-readable error. Completing an already-ready scan returns the existing result.
- Service-role key only server-side. Every row carries `owner_id`; RLS on scans, scenes and the storage bucket restricts access to the owner (PRD: private raw scans, RLS on all project rows).
- Dev CLI: `pnpm import-scan <export.json>` runs the same import locally and writes the scene JSON + report.

---

## Part D — Web connections

- **My Scans**: lists the signed-in user's scans (name, captured date, status, object count) via Supabase with RLS. Ready scans open in the sandbox; processing shows progress; failed shows the error and a "re-run import" action.
- Opening a scan loads through the real `ScenePersistence` adapter if it exists; otherwise through the mock, fed by the import output.
- Show the `ImportReport` once on first open (matched, placeholders, dropped, warnings), dismissible.
- Dev-only **"Import scan file"**: drop a `RoomScanExport` JSON into the browser and run `importRoomScan` client-side, for testing without the server.
- The sandbox needs zero special cases for imported scenes: everything the importer produces must already be valid `Scene` data.

---

## Tests
- Swift: exporter output for recorded fixtures matches checked-in `export.json`; category mapping exhaustive; matrices column-major.
- scene-core (Vitest), using recorded and hand-authored fixtures:
  - Floor at y = 0; polygon CCW; no self-intersections.
  - Walls match floor polygon edges within 5 cm; openings lie within their wall's span and height.
  - Objects: base on floor (±1 cm), yaw round-trips, dimension mapping, correct front direction for the sofa/TV fixture.
  - Fallback polygon from walls when `floors` is empty; curved wall segmentation; non-uniform wall heights.
  - Determinism snapshot; validation rejects malformed exports.
  - Imported scenes pass geometry rules with no `error`-severity violations (warnings allowed and reported).
- Server: idempotent create/complete; ownership enforced; failed import sets `failed` with a message.
- End-to-end (manual, documented in `ROOMPLAN_NOTES.md`): scan on iPhone → appears in desktop My Scans for the same user → opens in the sandbox → move an object → autosave.

## Deliverables, in order
1. `ROOMPLAN_NOTES.md` with the connection map and conflicts.
2. `RoomScanExport` schema (zod + TS types in scene-core, JSON Schema doc) and a hand-authored fixture.
3. `importRoomScan` with tests on that fixture; migrate `matchScanObject` and `demo-scan.json`.
4. iOS app: capture, review, exporter, unit tests (builds in Simulator; scanning on device).
5. Record real scans, verify conventions, commit fixtures, tighten importer and tests.
6. Auth + upload + server processing + RLS.
7. Web My Scans, import report, dev import-file tool.
8. End-to-end run on the demo laptop and iPhone; record results.

After each: build/typecheck + tests, and a short note on what works, decisions made, and any doc/code connection you changed.

## Acceptance checklist (PRD P-01, P-02, P-03 and launch gate)
- [ ] `ROOMPLAN_NOTES.md` maps every pipeline hop to doc names and code names with no unresolved mismatch.
- [ ] Unsupported device shows a clear message; supported device completes a scan with RoomPlan coaching.
- [ ] A finished scan uploads while signed in, survives a network drop (retries), and never uploads twice.
- [ ] The same user sees it in desktop My Scans; another user can't see or fetch it (RLS tested).
- [ ] It opens in the sandbox with the correct footprint, wall heights, and doors/windows/openings in the right places (spot-check with a tape measure: walls within ~5 cm).
- [ ] Furniture appears at the scanned positions, facing the right way, at plausible size, as matched GLBs or labeled placeholders.
- [ ] The shell is immutable in the sandbox; furniture is editable and autosaves.
- [ ] Raw `export.json` and `capturedroom.json` are archived privately; re-running the import reproduces the same scene.
- [ ] No service-role key or model/provider credentials in the iOS or web bundle.
- [ ] The existing sandbox and test2 checklists still pass.

Out of scope: multi-room merging, editing on iPhone, room photo capture/reconstruction, AI redesign, budget/timeline.