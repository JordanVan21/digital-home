import XCTest
@testable import RoomScanKit

final class RoomScanKitTests: XCTestCase {
    private func identity(_ x: Double = 0, _ y: Double = 0, _ z: Double = 0) -> [Double] {
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
    }
    private func wall(_ i: Int) -> RawRoomScan.Surface {
        .init(id: UUID().uuidString, category: "wall", confidence: .high, transform: identity(Double(i)), dimensions: [4, 2.5, 0])
    }

    func testRoundTripAndCanonicalKeys() throws {
        let scan = RawRoomScan(scanId: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!,
                               capturedAt: Date(timeIntervalSince1970: 1_700_000_000),
                               walls: (0..<4).map(wall), doors: [], windows: [], openings: [], objects: [])
        let data = try scan.encoded()
        XCTAssertEqual(try RawRoomScan.decode(data), scan)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        // These key names are the wire contract with packages/scan-import/src/rawScan.ts.
        for key in ["schemaVersion", "scanId", "capturedAt", "walls", "doors", "windows", "openings", "floors", "objects"] {
            XCTAssertNotNil(json[key], key)
        }
        XCTAssertEqual(json["schemaVersion"] as? Int, 1)
        XCTAssertEqual((json["capturedAt"] as? String)?.hasSuffix("Z"), true)
        XCTAssertEqual(try scan.encoded(), data, "encoding must be deterministic for checksums")
    }

    func testQualityFlagsBadScans() {
        let few = RawRoomScan(walls: [wall(0), wall(1)], doors: [], windows: [], openings: [], objects: [])
        XCTAssertFalse(ScanQuality.assess(few).isUploadable)

        var bad = wall(0); bad.transform[12] = .nan
        let nan = RawRoomScan(walls: [bad, wall(1), wall(2)], doors: [], windows: [], openings: [], objects: [])
        XCTAssertTrue(ScanQuality.assess(nan).issues.contains(.nonFiniteValues))
        XCTAssertFalse(ScanQuality.assess(nan).isUploadable)

        let noOpenings = RawRoomScan(walls: (0..<4).map(wall), doors: [], windows: [], openings: [], objects: [])
        let q = ScanQuality.assess(noOpenings)
        XCTAssertEqual(q.issues, [.noDoorOrWindow])
        XCTAssertTrue(q.isUploadable, "missing openings is a hint, not a blocker")
    }

    func testRealSingleRoomFixturesStillRoundTripByteForByte() throws {
        for name in ["real-scan-1", "real-scan-2"] {
            let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("../../Fixtures/\(name).json").standardized
            let data = try Data(contentsOf: url)
            let scan = try RawRoomScan.decode(data)
            XCTAssertNil(scan.rooms)
            XCTAssertEqual(scan.roomCount, 1)
            XCTAssertEqual(try scan.encoded(), data, "\(name) must re-encode unchanged")
        }
    }

    func testMultiRoomFieldsRoundTrip() throws {
        var w = wall(0)
        w.roomIndex = 1
        let scan = RawRoomScan(capturedAt: Date(timeIntervalSince1970: 1_700_000_000), walls: [w], doors: [], windows: [], openings: [], objects: [],
                               rooms: [.init(index: 0, id: "a", story: 0, label: "kitchen"),
                                       .init(index: 1, id: "b", story: 0, label: nil)])
        let decoded = try RawRoomScan.decode(scan.encoded())
        XCTAssertEqual(decoded, scan)
        XCTAssertEqual(decoded.roomCount, 2)
    }
}
