# iOS room scanner (Swift + RoomPlan)

Capture only: scan with RoomPlan, export raw JSON, hand it to the desktop. All
normalization lives in `packages/scan-import` (CONTRACTS.md §1: convert exactly once).

- `Sources/RoomScanKit/` — `RawRoomScan` (wire format, mirrors `packages/scan-import/src/rawScan.ts`),
  `CapturedRoom` adapter (iOS only), `ScanQuality` pre-upload checks, `HTTPScanUploader` (retries, idempotent by `scanId`).
- `App/` — SwiftUI app: support/permission gate, RoomPlan capture, review, upload or AirDrop the file.
- `Fixtures/sample-scan.json` — synthetic scan; use desktop **Import scan** to try the pipeline without a phone.
- `project.yml` — XcodeGen spec. `xcodegen generate`, set a signing team, run on a LiDAR iPhone (no Simulator support).

Status: the Foundation-only sources compile and the JSON they emit parses against the zod schema; the
RoomPlan adapter and SwiftUI app were written against Apple's docs but have never been built in Xcode.
