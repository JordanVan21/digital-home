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
7. Allow camera access. The current checkpoint opens **Your scans** with a **Scan a room** button.
8. Stop the debugger with Xcode's square Stop button, unplug the cable, and open **House** from the
   phone's Home Screen. Expect the same scan list without the Mac connected.

For this first checkpoint, report whether House opens unplugged and whether any signing/install error
appears. Scanning and Finish/Cancel verification are the next step. RoomPlan does not work in the Simulator.

### Checkpoint 2: Finish, Cancel and interruptions

Install the latest source with Command-R using the same generated project (no regeneration needed),
stop the debugger, unplug and launch House. Test these on the phone:

1. Tap **Scan a room**. Expect Apple's live view/coaching plus Room scan, Cancel, guidance and Finish scan.
2. Tap **Cancel > Keep scanning**. The scan should continue. Then **Cancel > Discard scan**; expect the start screen.
3. Scan a small furnished room with a door/window, then **Finish scan**. Expect processing followed by the review;
   even a low-quality result should offer JSON sharing. Start a new scan and repeat to verify a clean session.
4. Start another scan and go to the Home Screen, then return. Expect an interruption message and a way to
   start a fresh scan, without an old result appearing over it. Do not expect unfinished-scan persistence yet.

If processing lasts long enough, also test Cancel during **Building your room…**; it should discard that
attempt and keep its late result from appearing. Report any unexpected screen or error before advancing.

To repeat the unsigned build and existing tests from `apps/ios`:

```sh
xcodegen generate
xcodebuild -project HouseScanner.xcodeproj -scheme HouseScanner -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/house-scanner-build CODE_SIGNING_ALLOWED=NO build
swift test
```

## 5. Scan and export
1. Launch, allow camera access. Tap **Scan a room**.
2. Walk slowly along the walls, aim at doors, windows and furniture, finish where you started. Tap **Finish scan**.
3. On **Review scan**, drag/pinch the preview, check the counts, enter a name, and tap **Save scan**.
4. Open the saved row and tap **Share scan file (AirDrop)**. The durable primary file is named `scan.json`.
   There is no real upload action yet; current upload status is Saved.

### Checkpoint 3: preview and persistence

Use Command-R in the existing Xcode project; no project regeneration or team change is needed.
Then stop the debugger, unplug and run House:

1. Scan a small furnished room with a door/window and Finish. Expect a rotatable, zoomable preview,
   counts, a default date/time name and Save/Discard. The measured-box preview appears immediately;
   the parametric USDZ replaces it when ready. A backup failure must not prevent saving.
2. Name it **Living room test**, tap **Save scan**, and check the list for that name/date, 1 room,
   the detected object count and Saved status. Open it again to see its preview/counts and JSON sharing.
3. Force-close House and reopen. Then restart the iPhone, unlock and reopen. The saved row and preview
   should remain. Do not uninstall House: uninstalling removes local app data.
4. Finish a second scan but force-close from Review before Save. On relaunch it should appear under
   **Unfinished scans**; open it, then name/save it or use **Finish later** to keep it as a draft.
5. Finish a disposable scan, tap **Discard > Discard**. It should disappear; saved neighbors must remain.
   Also confirm Cancel and Finish still work and the capture preview stays visible.

Already-AirDropped prototype files are retained as repo fixtures but are not automatically imported
into the phone library. This checkpoint persists captures made with this app update. Version 2 format,
house capture, persistent error log and upload placeholder are later checkpoints.

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
Authenticated upload needs the API/Supabase and is deferred. Whole-house capture, version 2 export,
persistent diagnostic log and the offline upload placeholder remain later phone checkpoints in
`agent_docs/SCANNER_STATUS.md`. Preview/durable storage are implemented pending phone acceptance.
Simulator scanning is unsupported.
