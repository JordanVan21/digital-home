# Phone half: build, run, and verify on a LiDAR iPhone

For whoever has a Mac with Xcode. Target device: **iPhone 14 Pro Max** (has LiDAR; supports RoomPlan).
Written without access to Xcode, so the Swift in `App/` and `CapturedRoomExport.swift` has only been
syntax-checked, never built. Expect to fix small compile errors. Everything else is tested.

## 0. What you're building
Scan with RoomPlan -> export `RawRoomScan` JSON -> get the file to the desktop sandbox.
Do **not** convert coordinates, rename categories, or compute geometry in Swift. All normalization lives in
`packages/scan-import` (CONTRACTS.md §1). The JSON field names are a contract with
`packages/scan-import/src/rawScan.ts`; change both sides together or neither.

## 1. Prerequisites
- Mac with a recent Xcode (iOS 17 SDK or newer), a free Apple ID is enough for signing to your own device.
- iPhone 14 Pro Max on **iOS 17 or later** (deployment target is 17.0; Settings > General > Software Update).
- Cable, and Developer Mode on the phone (Settings > Privacy & Security > Developer Mode, then reboot).
- Node + pnpm for the desktop side: `pnpm install` at the repo root.

## 2. Get the code
```sh
git fetch && git checkout feature/room-scanner
cd apps/ios
```

## 3. Create the Xcode project
Option A (preferred, spec is already written):
```sh
brew install xcodegen
xcodegen generate        # creates HouseScanner.xcodeproj (gitignored)
open HouseScanner.xcodeproj
```
Option B (manual): new iOS App project "HouseScanner" (SwiftUI, iOS 17). Delete the template files, add the
`App/` folder, add the local Swift package at `apps/ios` (File > Add Package Dependencies > Add Local), link
`RoomScanKit`. Add to Info: `NSCameraUsageDescription`, `UIRequiredDeviceCapabilities` = `arkit`, and
`NSAppTransportSecurity > NSAllowsLocalNetworking = YES`.

In the target's **Signing & Capabilities**, pick your team and make the bundle id unique.

## 4. Build and run
Select the physical iPhone (RoomPlan does not work in the Simulator; the app will show the
"not available" screen there) and Run. Trust the developer certificate on the phone if prompted
(Settings > General > VPN & Device Management).

Likely first-build fixes (not yet compiled anywhere):
- `RoomScanKit` types need `import RoomScanKit` in each `App/` file; they have it, but check access levels.
- `CapturedRoomExport.swift` uses `room.floors` and `Surface.polygonCorners` (iOS 17 APIs). If a property name
  differs in your SDK, adjust it there only.
- `RoomCaptureViewRepresentable.Coordinator` must conform to `RoomCaptureViewDelegate` and `NSCoding`; keep that.
- Swift 6 strict-concurrency warnings can be ignored; project is set to Swift 5 mode.

## 5. Scan and export
1. Launch, allow camera access. Tap **Start scan**.
2. Walk slowly along the walls, aim at doors, windows and furniture, finish where you started. Tap **Finish scan**.
3. On the review screen note the counts (walls / doors / windows / objects). Expect >= 3 walls.
4. Tap **Share scan file (AirDrop)** and send the JSON to the Mac. (Upload needs a server that doesn't exist yet;
   leave the URL empty.) File name: `room-<uuid>.json`.

## 6. Verify on the desktop
```sh
pnpm dev:web             # http://localhost:5173
```
Click **Import scan** (top bar) and pick the file. Check:
- Floor outline and wall lengths match the real room within about 10 cm; room is not mirrored or rotated oddly.
  (If it is mirrored, the matrix axis assumption in `packages/scan-import/src/normalize.ts` needs fixing.)
- Doors and windows sit on the right walls at the right positions and heights.
- Furniture is in the right place, faces the right way, rests on the floor.
- A top-bar message appears for warnings or rejection reasons; read it, it is user-facing text.

Rejection messages ("fewer than 3 usable walls", "do not form a closed room", ...) are intended behavior for a bad
scan: rescan, overlapping where you started.

## 7. Send the data back (most valuable thing you can do)
Commit one real scan so the importer can be tuned against reality:
```sh
cp ~/Downloads/room-<uuid>.json apps/ios/Fixtures/real-scan-1.json   # remove anything you consider private
```
Also write down: wall count, anything mis-placed, any `polygonCorners` on floors (check `floors[].polygonCorners`
in the JSON), and which object categories appeared. Then run `pnpm --filter @house/scan-import test`.

## 8. Known unknowns to check on device
| Question | Where |
|---|---|
| Does a wall's local X axis run along its width (assumed)? | `wallSegment` in normalize.ts |
| Are floor `polygonCorners` populated? | JSON `floors[]` |
| Do object `dimensions` come out [width, height, depth] in local frame? | `toSceneObject` |
| Is thickness always 0 for surfaces (assumed, default 0.12 m used)? | normalize.ts |
| Do openings (unframed) appear, and are they doorways? | JSON `openings[]` |

## 9. Out of scope for this pass
Authenticated upload (needs the API/Supabase), multi-room merge, scan editing on the phone, Simulator support.
