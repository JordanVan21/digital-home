# iOS room scanner (Swift + RoomPlan)

Capture only: scan with RoomPlan, export raw JSON, hand it to the desktop. All
normalization lives in `packages/scan-import` (CONTRACTS.md §1: convert exactly once).

- `Sources/RoomScanKit/` — `RawRoomScan` (wire format, mirrors `packages/scan-import/src/rawScan.ts`),
  `CapturedRoom` adapter (iOS only), `ScanQuality` pre-upload checks, `HTTPScanUploader` (retries, idempotent by `scanId`).
- `App/` — SwiftUI app: support/permission gate, RoomPlan capture, review, upload or AirDrop the file.
- `Fixtures/sample-scan.json` — synthetic scan; use desktop **Import scan** to try the pipeline without a phone.
- `project.yml` — XcodeGen spec. `xcodegen generate`, set a signing team, run on a LiDAR iPhone (no Simulator support).

Build checkpoint (2026-10-18): the SwiftUI app and RoomPlan adapter compile for a generic physical
iPhone target with Xcode 26.2 (signing disabled), and both existing Swift package tests pass.
Signing, installation and scanning on a real LiDAR iPhone still require device verification.
See `SETUP.md` for the exact installation steps and `agent_docs/SCANNER_STATUS.md` for the staged plan.
