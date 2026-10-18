# Phone half: build, run, and verify on a LiDAR iPhone

Target: a **LiDAR iPhone (iPhone 12 Pro or newer Pro model), on iOS 17 or later**.
The app and RoomPlan adapter have been built for a generic physical iPhone with Xcode 26.2,
without signing. Both existing Swift package tests pass. Real-device installation and capture
are the next verification checkpoint; a successful unsigned build does not prove either.

## 0. What you're building
Scan with RoomPlan -> export `RawRoomScan` JSON -> get the file to the desktop sandbox.
Do **not** convert coordinates, rename categories, or compute geometry in Swift. All normalization lives in
`packages/scan-import` (CONTRACTS.md §1). The JSON field names are a contract with
`packages/scan-import/src/rawScan.ts`; change both sides together or neither.

## 1. Prerequisites
- Mac with a recent Xcode (iOS 17 SDK or newer), a free Apple ID is enough for signing to your own device.
- LiDAR iPhone on **iOS 17 or later** (deployment target is 17.0; Settings > General > Software Update).
- Cable, and Developer Mode on the phone (Settings > Privacy & Security > Developer Mode, then reboot).
- Node + pnpm for the desktop side: `pnpm install` at the repo root.

## 2. Get the code
```sh
cd /Users/jeffreyg/Projects/digital-home/.worktrees/room-scanner/apps/ios
```

This is the existing scanner branch's separate worktree. Do not switch the main checkout.

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

The generated project is intentionally gitignored. Team selection stays in your local Xcode project;
regenerating it may require selecting the team again. The committed `project.yml` and `App/Info.plist`
contain the reproducible app settings and camera permission text.

## 4. Build and run
1. Connect the unlocked iPhone by cable. If asked, tap **Trust** on the phone and enter its passcode.
2. In Xcode, choose **Xcode > Settings > Accounts**, click **+ > Apple Account** if needed, and sign in.
3. Click the blue **HouseScanner** project in the left navigator, select **HouseScanner** under
   **TARGETS**, and open **Signing & Capabilities**. Leave **Automatically manage signing** checked.
   Set **Team** to your personal team. If the bundle ID is unavailable, change it from
   `dev.house.HouseScanner` to a unique value such as `com.jeffreyg.housescanner`.
4. In Xcode's top toolbar, select the **HouseScanner** scheme and your actual iPhone as the destination.
   If missing, open **Window > Devices and Simulators**, select the phone and finish pairing/preparation.
5. On the phone, open **Settings > Privacy & Security > Developer Mode**, turn it on, restart, and
   confirm **Turn On** after restart. If the setting is missing, complete Xcode pairing first.
6. Click Xcode's **Run** triangle (or press **Command-R**). If iOS says the developer is untrusted,
   open **Settings > General > VPN & Device Management**, select your developer profile under
   **Developer App**, tap **Trust**, confirm, then launch House again. The profile appears only after installation.
7. Allow camera access. Expect **Scan your room** with a **Start scan** button. Leave upload settings empty.
8. Stop the debugger with Xcode's square Stop button, unplug the cable, and open **House** from the
   phone's Home Screen. Expect the same start screen without the Mac connected.

For this first checkpoint, report whether House opens unplugged and whether any signing/install error
appears. Scanning and Finish/Cancel verification are the next step. RoomPlan does not work in the Simulator.

To repeat the unsigned build and existing tests from `apps/ios`:

```sh
xcodegen generate
xcodebuild -project HouseScanner.xcodeproj -scheme HouseScanner -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/house-scanner-build CODE_SIGNING_ALLOWED=NO build
swift test
```

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

## 9. Scope boundaries
Authenticated upload needs the API/Supabase and is deferred. Whole-house capture, durable saving,
preview and the offline upload placeholder are planned phone checkpoints in `agent_docs/SCANNER_STATUS.md`.
The scan/export instructions above describe the current prototype; the documented version 2 format is
approved for implementation but has not been built yet. Simulator scanning is unsupported.
