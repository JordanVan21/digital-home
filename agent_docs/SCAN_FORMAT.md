# Phone scan format — approved implementation target

Status: approved as part of the phone plan on 2026-10-18; not yet implemented. Version 2 describes raw capture data; it does not replace `RoomShell` or `SceneSpec` from `CONTRACTS.md`.

## Purpose and compatibility

The phone preserves measured geometry and source identity. The TypeScript importer remains responsible for converting scan coordinates to the project's normalized room coordinates exactly once. Rendering and database writes remain downstream responsibilities.

Version 1 fixtures remain unchanged. The existing importer accepts version 1 only; a version 2 reader will be required in the later integration milestone. This is an explicit incompatible version change, rather than silently changing the meaning of existing fields. The phone should also provide the existing version 1 JSON for single-room scans during this transition, so manual desktop checks can continue. A house must never be flattened into a fake single room for that compatibility export.

## Data rules

- `schemaVersion`: integer `2`. `scanId`: lowercase UUID allocated once per capture; `capturedAt`: UTC ISO 8601 timestamp allocated once. Sharing or retries must not regenerate either.
- `name`: capture name, defaulting to local capture date/time. Captured geometry and capture metadata become immutable when saved; changing a display label or upload status does not rewrite the scan artifact.
- `app`: version and build strings from the installed app. `device`: hardware identifier (for example `iPhone13,3`), display model, and iOS version. No device serial number, credentials or account token.
- `kind`: `room` or `house`. `rooms` always contains at least one room; `room` contains exactly one. Each room has its RoomPlan identifier, a display name, nullable type, and integer story from RoomPlan. Room type is null when not supplied or known; no inferred room type is presented as measured fact.
- Room arrays: `walls`, `floors`, `doors`, `windows`, `openings`, `objects`. Every element has a RoomPlan UUID, `roomId`, exact category, confidence (`low`, `medium`, `high`), transform and dimensions. Identity is scoped by room plus element ID; shared boundaries may appear in two rooms and must retain their provenance.
- Transforms use the shared field names: position `[x,y,z]`, quaternion rotation `[x,y,z,w]`, scale `[1,1,1]`. On the phone these are in the capture frame, not normalized scene coordinates. No yaw-only approximation. Quaternion signs are canonicalized so equivalent rotations serialize consistently.
- `dimensionsM`: unrounded RoomPlan local-axis `[x,y,z]` dimensions. For objects these mean width, height, depth. A surface may have zero thickness; do not invent wall thickness or clamp measurements in this file. Polygon corners are in the element's local coordinate frame, transformed by its transform to obtain capture coordinates. The implementation must verify Apple's source-corner convention before converting it to this documented frame.
- Surfaces include `parentId` (RoomPlan parent identifier or null), `story`, and `polygonCorners` (empty if unavailable). Doors additionally have `isOpen`, preserving Apple's category Boolean. `isOpen: null` is reserved for unavailable/unknown source information.
- Objects include `parentId`, `story`, and `attributes`: sorted `{type, value}` records for every available RoomPlan attribute (for example ChairType/dining). Unknown attributes must be preserved using their source identifier/value rather than discarded.
- Floats must be finite; object dimensions must be positive, surface dimensions nonnegative. UUIDs and references must be validated. Suspicious/incomplete capture generates a warning and remains available for sharing; invalid JSON geometry must not replace a previously saved scan.

## Coordinate system

All distances are meters. Capture coordinates use ARKit's right-handed, gravity-aligned world frame: Y up; X right and negative Z toward the initial camera's forward direction. Origin is the AR session's initial origin, not a corner or the floor. Camera movement does not move the origin. There is no geographic or compass alignment guarantee.

A house uses one continuous AR session and StructureBuilder's aligned rooms. Independent room sessions must not be concatenated without alignment. Store the final aligned room transforms in this shared capture frame. Changing stories/large houses may exceed RoomPlan's tracking/size limits; show an error and preserve completed rooms rather than claiming an arbitrary whole building is supported.

The importer later produces `CONTRACTS.md`'s X-right/Y-up/Z-forward room-local scene coordinates. Any needed axis conversion/recentering is explicit there and applied once to both surfaces and objects. Phone decomposition of a matrix into position/quaternion is representation only, not coordinate normalization.

## Complete shape example

This compact illustrative room demonstrates every element type and field. It is not a complete usable room outline or a real test scan. A house uses this same shape with `kind: "house"` and additional room entries in the same coordinate frame.

```json
{
  "schemaVersion": 2,
  "scanId": "a0000000-0000-4000-8000-000000000001",
  "capturedAt": "2026-10-18T12:00:00Z",
  "name": "Room — Oct 18, 2026, 5:00 AM",
  "app": { "version": "1.0", "build": "1" },
  "device": { "model": "iPhone 12 Pro", "hardwareIdentifier": "iPhone13,3", "systemVersion": "17.6" },
  "kind": "room",
  "coordinateSystem": {
    "units": "meters",
    "frame": "arkit_capture",
    "handedness": "right",
    "up": "+Y",
    "initialCameraForward": "-Z",
    "origin": "ar_session_start",
    "rotation": "quaternion_xyzw",
    "dimensions": "local_xyz"
  },
  "rooms": [{
    "id": "b0000000-0000-4000-8000-000000000001",
    "name": "Room 1",
    "type": null,
    "story": 0,
    "walls": [{
      "id": "c0000000-0000-4000-8000-000000000001",
      "roomId": "b0000000-0000-4000-8000-000000000001",
      "category": "wall", "confidence": "high", "story": 0, "parentId": null,
      "transform": { "position": [0, 1.25, -2], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "dimensionsM": [4, 2.5, 0], "polygonCorners": []
    }],
    "floors": [{
      "id": "c0000000-0000-4000-8000-000000000002",
      "roomId": "b0000000-0000-4000-8000-000000000001",
      "category": "floor", "confidence": "high", "story": 0, "parentId": null,
      "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "dimensionsM": [4, 0, 4],
      "polygonCorners": [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]]
    }],
    "doors": [{
      "id": "c0000000-0000-4000-8000-000000000003",
      "roomId": "b0000000-0000-4000-8000-000000000001",
      "category": "door", "confidence": "high", "story": 0,
      "parentId": "c0000000-0000-4000-8000-000000000001", "isOpen": false,
      "transform": { "position": [-1, 1, -2], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "dimensionsM": [0.9, 2, 0], "polygonCorners": []
    }],
    "windows": [{
      "id": "c0000000-0000-4000-8000-000000000004",
      "roomId": "b0000000-0000-4000-8000-000000000001",
      "category": "window", "confidence": "medium", "story": 0,
      "parentId": "c0000000-0000-4000-8000-000000000001",
      "transform": { "position": [1, 1.5, -2], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "dimensionsM": [1, 1, 0], "polygonCorners": []
    }],
    "openings": [{
      "id": "c0000000-0000-4000-8000-000000000005",
      "roomId": "b0000000-0000-4000-8000-000000000001",
      "category": "opening", "confidence": "medium", "story": 0, "parentId": null,
      "transform": { "position": [2, 1, 0], "rotation": [0, 0.7071067811865475, 0, 0.7071067811865476], "scale": [1, 1, 1] },
      "dimensionsM": [1, 2, 0], "polygonCorners": []
    }],
    "objects": [{
      "id": "c0000000-0000-4000-8000-000000000006",
      "roomId": "b0000000-0000-4000-8000-000000000001",
      "category": "chair", "confidence": "high", "story": 0, "parentId": null,
      "transform": { "position": [1, 0.45, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "dimensionsM": [0.5, 0.9, 0.55],
      "attributes": [{ "type": "ChairType", "value": "dining" }]
    }]
  }]
}
```

## Files, determinism and mutable state

Each scan gets a directory under app Application Support with `scan.json`, Apple's native Codable export (`roomplan.json`), and a parametric `scan.usdz` for preview/backup. Keep a version 1 compatibility export for a single room. Native JSON preserves source properties not yet represented in the documented schema. USDZ is recommended: it supports a local preview and gives a useful geometry cross-check. A USDZ failure is logged and does not prevent saving/sharing valid JSON.

Use atomic writes and recover incomplete drafts after app relaunch. Save the processed result immediately as a local draft, before upload preparation; Save finalizes the name/record, Discard removes the draft explicitly. Completed rooms in an unfinished house also need recovery storage. A separate manifest holds display name, counts, file availability, draft/saved state, upload status, attempt count and latest error; upload preparation must never mutate `scan.json`.

Sort JSON keys; pretty-print consistently; sort rooms by lowercase UUID and each element array by lowercase UUID. Sort attributes by type then value. Preserve polygon winding and vertex order because these carry geometry meaning. Dates and IDs are captured once; no export-time timestamps. Repeated export/share of the same saved artifact must return identical bytes. These rules do not claim two independent physical scans will be identical.

## Upload boundary

Inject a `ScanUploader` abstraction that accepts a saved scan's artifact URLs and scan ID. Its result distinguishes `readyToUpload` from `uploaded`; the placeholder returns only `readyToUpload`, makes no network request and does not imply remote success. A future authenticated Supabase implementation uses this same interface and obtains identity from a separate injected authentication boundary.

Persist statuses `saved`, `readyToUpload`, `uploading`, `uploaded`, `failed`. Saving commits `saved`; placeholder preparation transitions to `readyToUpload`; a real uploader later uses `uploading` then `uploaded` or `failed`. Retry reuses the saved artifacts and scan ID. Recover an interrupted real upload as retryable. The placeholder never displays a fake upload success. Dependency-injected failures exercise the same failure/retry path in tests without a production failure toggle.
