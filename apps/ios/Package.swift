// swift-tools-version:5.9
import PackageDescription

// RoomScanKit is the Swift side of the scan pipeline: RoomPlan capture adapter,
// raw export schema, pre-upload checks and local storage. Pure-Foundation parts build
// and test on macOS; the RoomPlan adapter compiles only where RoomPlan exists (iOS).
// HouseCloud adds Supabase sign-in and upload. It ships inside the RoomScanKit product
// so the generated Xcode project (and its local signing team) needs no regeneration.
let package = Package(
    name: "RoomScanKit",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "RoomScanKit", targets: ["RoomScanKit", "HouseCloud"])],
    dependencies: [
        .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.0.0"),
    ],
    targets: [
        .target(name: "RoomScanKit"),
        .target(name: "HouseCloud", dependencies: [
            "RoomScanKit",
            .product(name: "Supabase", package: "supabase-swift"),
        ]),
        .testTarget(name: "RoomScanKitTests", dependencies: ["RoomScanKit"]),
    ]
)
