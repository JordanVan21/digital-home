# iOS room scanner (Swift + RoomPlan)

Capture only: scan with RoomPlan, export raw JSON, hand it to the desktop. All
normalization lives in `packages/scan-import` (CONTRACTS.md §1: convert exactly once).

- `Sources/RoomScanKit/` — raw wire model/RoomPlan adapter, capture lifecycle, quality checks,
  durable `ScanStore` and a legacy HTTP uploader (not connected to the current UI).
- `App/` — SwiftUI room capture, rotatable local preview, naming/Save/Discard, recoverable drafts,
  saved scan list and AirDrop sharing. No account or network is required.
- `Fixtures/sample-scan.json` — synthetic scan; use desktop **Import scan** to try the pipeline without a phone.
- `project.yml` — XcodeGen spec. `xcodegen generate`, set a signing team, run on a LiDAR iPhone (no Simulator support).

Checkpoint 3 (2026-10-18): app builds for a physical iPhone target with Xcode 27.1 (signing disabled);
all 13 Swift package tests pass. User verified installation, scanning, AirDrop, unplugged launch and
the corrected capture controls. New preview/storage UI still needs phone verification.
See `SETUP.md` for the exact installation steps and `agent_docs/SCANNER_STATUS.md` for the staged plan.

Scans live in Application Support/HouseScans/<scan UUID>/ with `scan.json` (currently version 1),
`roomplan.json` (Apple's native Codable export), optional `scan.usdz`, and `record.json` (local metadata).
Primary JSON/native data are written before preview work. Per-file atomic writes plus draft recovery
avoid dependence on a single index. Share uses the stored JSON bytes. Do not uninstall the app to test
restart persistence; iOS removes an app's local data when it is uninstalled.
