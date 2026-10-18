# iPhone Room Scanner Status

**Read-through:** 2026-10-18  
**Branch:** `feature/room-scanner`  
**Scope:** iPhone app only. No code changes have been made during this read-through.

## Current state

### Done and working in the current environment

- The Swift package `apps/ios` builds on macOS with Swift 6.2.3 and Xcode 26.2. Its two existing tests pass: canonical JSON round-trip/key checks and scan quality checks.
- `RawRoomScan` models walls, doors, windows, openings, floors and classified objects. It records a scan UUID, capture date and optional device/system version.
- `CapturedRoomExport` maps Apple's `CapturedRoom` data to that model, retaining RoomPlan identifiers, confidence, transforms, dimensions and floor polygon corners when supplied. It does not normalize coordinates.
- The SwiftUI flow checks RoomPlan support and camera authorization, embeds Apple's live `RoomCaptureView`, offers Finish, reviews counts and quality hints, and offers a share sheet for the JSON.
- `HTTPScanUploader` is a protocol-backed HTTP uploader with a configurable URL/token, request checksum and idempotency header, a size limit, retry/backoff and progress callback. It is real HTTP behavior, not the requested offline “ready to upload” stand-in.
- A synthetic JSON fixture exists at `apps/ios/Fixtures/sample-scan.json`.

### Partly implemented

- **Xcode project/signing:** `apps/ios/project.yml` describes an iOS app with deployment target 17.0, camera usage text, ARKit device capability and a local `RoomScanKit` package dependency. There is no checked-in or generated `HouseScanner.xcodeproj`, and `xcodegen` is not installed here. Xcode 26.2 is installed. The setup guide says to select a team and set a unique bundle identifier, but this has not been done or tested on a phone. The UIRequiredDeviceCapabilities entry is `arkit`; RoomPlan support is separately checked at runtime.
- **Capture:** The app has one-room capture and finish/processing callbacks. The RoomPlan adapter and SwiftUI app have not been compiled by the successful Swift package build, and there has been no real-device scan. There is no explicit Cancel action once capture starts; restarting is only available after capture/review.
- **Quality feedback:** A low wall count or non-finite values blocks the current “uploadable” action; absent doors/windows/openings is a hint. There is no UI to inspect captured geometry.
- **Upload:** The protocol is named `ScanUploading`, with only `HTTPScanUploader` implemented. There is no stand-in that marks a persisted local scan “ready to upload,” no saved status state, and no sign-in placeholder beyond entering an optional bearer token in the settings UI. The URL and token are stored with `@AppStorage` (including the token), rather than a secure credential store.
- **Sharing:** A normal iOS activity sheet can share the JSON URL. The file is currently written to `FileManager.default.temporaryDirectory`, so it is not durable app storage and may be removed by the system.

### Missing

- Scan start choice between one room and whole house; naming and combining multiple rooms; room IDs, room names/types and floor/story data.
- Persistent scan storage, a scan list, scan detail, rename/delete, and status tracking across app launches or phone restarts.
- Preview beyond text counts; a user-editable scan name and explicit Save/Discard actions.
- RoomPlan USDZ export alongside JSON.
- In-app error history/log sharing and structured logging. Current failures are displayed as transient text in the flow; there is no durable log.
- A ready-to-upload placeholder, upload-status transitions on saved scans, and retry behavior attached to a scan record.
- The requested full documented export contract: app version; room/house metadata and per-room membership; element-to-room links; door open/closed state; object extra attributes; explicit width/depth/height fields; and a fully specified coordinate frame/origin. The current raw RoomPlan export is not yet that format.
- The two requested real phone scans. Only a synthetic fixture is present.

## Build and device status

- `swift test --package-path apps/ios` succeeds: package build complete, 2 tests passed. This compiles the package sources on macOS, but `#if canImport(RoomPlan)` excludes the RoomPlan adapter there.
- An Xcode app build cannot currently be run because `apps/ios/HouseScanner.xcodeproj` does not exist. The `project.yml` is only a project-generation spec; `xcodegen` is unavailable in this environment. The SwiftUI app sources are outside the Swift package target and have never been confirmed to compile.
- No install or scan has been tested on a physical iPhone. RoomPlan is not supported in the Simulator, so a real LiDAR iPhone and signing setup are required for that test.
- The app deployment target is **iOS 17.0**. RoomPlan single-room capture is available from iOS 16; iOS 17 adds multi-room capture/building scanning APIs. This deployment target permits whole-house support, but this branch only uses `RoomCaptureView` and `CapturedRoom`; it does not implement multi-room capture or merging.
- There are no `ROOMPLAN_PROMPT.md` or `HOUSE_SCAN_PROMPT.md` files in the branch. For cross-system format semantics, `agent_docs/CONTRACTS.md` is authoritative: meters, X right/Y up/Z forward, positive yaw about Y, and a room-local origin after normalization. It also requires positions/quaternion rotations for normalized scene objects. The current raw capture intentionally carries RoomPlan's matrices for downstream normalization instead.

## Current exported JSON

The shape in `apps/ios/Sources/RoomScanKit/RawRoomScan.swift` is:

```json
{
  "schemaVersion": 1,
  "scanId": "a0000000-0000-4000-8000-000000000001",
  "capturedAt": "2026-10-17T12:00:00Z",
  "device": { "model": "iPhone", "systemVersion": "17.6" },
  "walls": [{
    "id": "a0000000-0000-4000-8000-000000000002",
    "category": "wall",
    "confidence": "high",
    "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    "dimensions": [4.0, 2.5, 0.0]
  }],
  "doors": [],
  "windows": [],
  "openings": [],
  "floors": [],
  "objects": [{
    "id": "a0000000-0000-4000-8000-000000000003",
    "category": "chair",
    "confidence": "high",
    "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 2, 1],
    "dimensions": [0.8, 0.8, 0.8]
  }]
}
```

Encoding sorts JSON object keys and uses ISO-8601 dates. The arrays preserve the order supplied by RoomPlan; the encoder does not sort their entries, so whole-file byte stability for a repeated capture is not guaranteed. The example fixture includes four walls, one door, one window and four objects.

The current values are raw RoomPlan data: each transform is a flattened 4×4 `simd_float4x4` in column-major order, and dimensions are the RoomPlan `[x, y, z]` measurements. The code comments describe distances as meters and Y as up, but do not explicitly declare forward direction or a stable origin. It does not convert matrices to position/quaternion, split dimensions into named width/depth/height fields, attach elements to rooms, include wall/opening relationships, infer door open/closed state, or capture object-specific extra attributes. `CapturedRoomExport` maps category names and confidence but performs no coordinate conversion.

`CONTRACTS.md` is a downstream normalized-scene contract, not the full requested phone scan file schema. It requires normalization to happen once in the importer and defines room-local X-right/Y-up/Z-forward coordinates, with meters and quaternion rotations in normalized scene data. The current raw format keeps RoomPlan matrices for that conversion. No prompt reference files were found to compare against.

## Signing instructions for the later phone test

1. Install XcodeGen if needed, then from `apps/ios` run `xcodegen generate` and open `HouseScanner.xcodeproj`.
2. Connect and select the LiDAR iPhone in Xcode. In the app target's **Signing & Capabilities**, enable **Automatically manage signing**, select the user's Apple ID team, and set a unique bundle identifier if Xcode asks.
3. On the iPhone, enable **Settings → Privacy & Security → Developer Mode** and restart if prompted. Trust the developer app/profile under **Settings → General → VPN & Device Management** if iOS prompts after the first install.
4. Run the app from Xcode while the phone is connected. After installation, scanning can run unplugged. Allow camera access when prompted.

The initial Swift package check does not validate signing or app installation.

## Read-through conclusion

There is a useful single-room RoomPlan capture prototype and a deterministic raw JSON encoder with a passing Foundation package test suite. The app is not yet installable from this checkout because the Xcode project has not been generated and the app sources have not been built. Persistent saving/listing, scan naming/preview, whole-house flow, error log, upload placeholder/status lifecycle and the complete documented export format remain to be implemented. The next step is to resolve product choices and record the answers here before preparing the implementation plan.

## User decisions and current scope

- User approved committing the unrelated image on `main`; completed as `a68a11c` before creating this worktree.
- User clarified that work continues on the existing hyphenated `feature/room-scanner` branch. This worktree tracks `origin/feature/room-scanner`.
- User requested completion of milestone 1: finish and verify the phone app, including two real scans. Database/render-service integration remains the later milestone. No push or merge is authorized.
- User approved the implementation plan with “go ahead” on 2026-10-18. Phone verification is still required after each implementation step before advancing.

## Proposed defaults for plan approval

- Keep Swift, SwiftUI, RoomPlan and iOS 17 minimum. Offer room and house capture; preserve aligned room IDs/stories in a house.
- Keep JSON, Apple's native Codable data and USDZ locally; use USDZ for a rotatable preview. Failure to create USDZ does not block saving valid JSON.
- Adopt the proposed raw version 2 format in `SCAN_FORMAT.md`; retain the current single-room version 1 export for manual sandbox checks. Version 2 integration into the TypeScript importer is explicitly later work.
- Save to Application Support with atomic writes and crash-recoverable drafts; store upload/display metadata separately. No network or account is required for this milestone.
- Remove the manual upload URL/token UI and use an injected placeholder. Leave an authentication boundary for the future real uploader; do not implement sign-in now.
- No extra product choices need to block the first build. Phone model/iOS and available signing team can be confirmed during installation.

## Approved implementation plan

Each step ends with an app build, relevant existing/new tests, a clear commit on `feature/room-scanner`, exact phone instructions and a pause for the user's result. Do not advance past a phone checkpoint until the user accepts it. An unsigned device build is useful compilation evidence but does not prove installation or scanning.

1. **Build and install.** Install the missing project generator if required, generate/reproduce the Xcode project, fix app/RoomPlan compilation, and document signing. Phone test: connect, run from Xcode, allow camera, unplug and reopen. Provide exact Apple ID/team, Developer Mode and profile-trust clicks when needed.
2. **Single-room capture.** RoomPlan live guidance with Finish/Cancel, reliable capture lifecycle and errors. Phone test: scan a small room with furniture plus a door/window, finish, then test cancel and capture again.
3. **Preview and durable saving.** Rotatable preview, date/time default name, Save/Discard; persist a draft immediately after processing. Saved list shows name/date/room count/object count/status and survives relaunch/restart. Phone test: name/save, force-close/reopen, restart phone, and verify Discard removes only its draft.
4. **Documented export and sharing.** Implement `SCAN_FORMAT.md`, full source fidelity and deterministic export; include USDZ/native backup and single-room compatibility JSON. Phone test: AirDrop JSON/backup to Mac; record the first real fixture in the repo and check measured structure/counts. Verify byte-identical repeat sharing.
5. **Whole house.** Keep one AR session across rooms, support Add next room/Finish house, align with StructureBuilder, preserve room/story membership and completed-room drafts. Phone test: two adjoining rooms, walking through their doorway; export the result. Use this or a larger room for the second real fixture. Explain tracking/size limits rather than promising unlimited buildings.
6. **Detail and diagnostics.** Scan detail preview/counts, JSON sharing, delete with confirmation, recent persistent error log and log sharing. Phone test: open/detail/share/delete a disposable scan; share diagnostic log via AirDrop/Files.
7. **Upload placeholder.** Inject uploader and future auth boundary; persist saved/ready/uploading/uploaded/failed vocabulary, preparation/retry result and interrupted-attempt recovery. Placeholder returns ready, never uploaded. Phone test: ready-to-upload status survives restart; retry retains the same scan ID/file bytes. Tests cover failure and retry through an injected uploader.

Milestone acceptance requires the physical phone results and two genuine exported scans committed as fixtures. They cannot be substituted with synthetic data. No claim of milestone completion until those results are available.

## Checkpoint 1 — build/install (2026-10-18)

This update supersedes the initial read-through's build/tooling status above.

- Installed XcodeGen 2.46.0 and generated the ignored `apps/ios/HouseScanner.xcodeproj`.
- Fixed the actual app compilation error: the nested RoomPlan delegate implementing NSCoding needs an explicit stable Objective-C runtime name.
- Configured automatic signing, iPhone device family and portrait orientation in the reproducible project spec. No signing team or credentials are committed.
- Updated setup instructions with the exact worktree path, Apple Account/team/bundle ID selection, pairing, Developer Mode, profile trust and unplugged launch test.
- Physical iPhone generic-target build includes both the SwiftUI app and RoomPlan adapter. Signing is disabled for this compilation check. Existing Swift tests: 2 passed.
- Device discovery found no available iPhone (only an unavailable iPad Air). Signing, installation and unplugged launch await the user's connected LiDAR iPhone. Do not advance to checkpoint 2 until that phone test is accepted.

### Phone evidence received after checkpoint 1

- User selected a Personal Team in Xcode, installed/launched the app, reported scanning works, and supplied an AirDropped JSON file. Physical capture/export are now demonstrated. Unplugged launch/restart has not yet been confirmed.
- Saved the original file byte-for-byte as `apps/ios/Fixtures/real-scan-1.json`: 5 walls, 5 doors, 2 windows, 1 floor, 5 objects; 4 objects have low confidence. See the fixtures README for provenance and limitations.
- Raw syntax/UUID/matrix/dimension checks pass. Importer execution has not been verified here; pnpm/dependencies are absent.
- Real data resolves an earlier unknown: floor polygon corners are surface-local, while the current version 1 importer fallback treats them as world-space. This is a documented downstream integration fix; preserve source data and correct the fallback with a regression check during integration.
- Still required: explicit unplugged-launch confirmation, remaining phone checkpoints, and the second real scan.

## Checkpoint 2 — single-room controls (2026-10-18)

- User confirmed House reopens and starts scanning unplugged. Checkpoint 1 is accepted.
- Added clear capture guidance, explicit Finish and confirmed Cancel/Discard controls during capture or processing. Kept Apple's coaching enabled and its internal session delegate intact.
- Capture attempts have individual IDs and a lock-protected lifecycle: repeat Finish does not stop twice, a cancelled capture cannot deliver a result/error, and duplicate callbacks are ignored. Delegate result delivery hops to the main actor; the model also rejects callbacks from old attempts.
- Backgrounding/locking during capture interrupts it with a restart message. Foreground permission checks no longer reset completed results or an active capture. Sharing is available even for captures that fail the upload quality gate.
- iPhone-target app build passes with the currently installed Xcode 27.1 SDK. All 5 Swift tests pass, including cancellation during capture/processing, duplicate completion, and starting an independent new attempt after cancellation.
- Second genuine AirDrop capture received and saved unchanged as `apps/ios/Fixtures/real-scan-2.json`; raw structural validation passes. Contains 4 walls, 3 doors, 3 windows, 1 floor, 9 objects. Two genuine captures now exist; room identity/simple-versus-larger coverage is not confirmed.
- Awaiting phone verification of the updated capture controls. Next test: install with Command-R, unplug; test Keep scanning and Discard; scan a small furnished room and Finish; background a new capture and verify a clear restart message, then start again.
- Durable saving/preview/list, version 2 export, house capture, diagnostic log and uploader placeholder remain later checkpoints. Current real fixtures are version 1.

### Checkpoint 2 phone feedback and correction

- User reported that the confirmation dialog only exposed Discard and the bottom Finish panel obscured Apple's miniature room preview.
- Replaced the confirmation dialog with a two-button alert: Keep scanning (Keep processing while building) and Discard scan.
- Removed the bottom panel. Cancel, Finish and a short guidance line now sit above RoomPlan in a separate vertical layout; the native capture view has unobstructed bounds for its built-in coaching and miniature preview.
- iPhone build and all 5 Swift tests pass. Visual confirmation of the correction is still required on the real phone before moving to preview/persistent storage.
