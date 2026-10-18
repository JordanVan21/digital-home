// swift-tools-version:5.9
import PackageDescription

// RoomScanKit is the Swift side of the scan pipeline: RoomPlan capture adapter,
// raw export schema, pre-upload checks and uploader. Pure-Foundation parts build
// and test on macOS; the RoomPlan adapter compiles only where RoomPlan exists (iOS).
let package = Package(
    name: "RoomScanKit",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "RoomScanKit", targets: ["RoomScanKit"])],
    targets: [
        .target(name: "RoomScanKit"),
        .testTarget(name: "RoomScanKitTests", dependencies: ["RoomScanKit"]),
    ]
)
