import Foundation

/// Raw scan export. Must stay byte-compatible with `RawRoomScan` in
/// packages/scan-import/src/rawScan.ts, which is the only place that converts it
/// into the normalized RoomShell/SceneSpec (CONTRACTS.md §1: normalize exactly once).
///
/// Coordinates are RoomPlan's world frame (ARKit: meters, Y up, right-handed).
/// Matrices are 4x4 column-major (`simd_float4x4` order, 16 values).
public struct RawRoomScan: Codable, Equatable {
    public enum Confidence: String, Codable { case low, medium, high }

    public struct Surface: Codable, Equatable {
        public var id: String
        public var category: String
        public var confidence: Confidence
        public var transform: [Double]
        /// [width, height, thickness]; RoomPlan reports thickness 0 for surfaces.
        public var dimensions: [Double]
        /// Floor outline in world coordinates, when RoomPlan provides one.
        public var polygonCorners: [[Double]]?

        public init(id: String, category: String, confidence: Confidence, transform: [Double],
                    dimensions: [Double], polygonCorners: [[Double]]? = nil) {
            self.id = id; self.category = category; self.confidence = confidence
            self.transform = transform; self.dimensions = dimensions; self.polygonCorners = polygonCorners
        }
    }

    public struct Object: Codable, Equatable {
        public var id: String
        public var category: String
        public var confidence: Confidence
        public var transform: [Double]
        /// [width, height, depth] in the object's local frame.
        public var dimensions: [Double]

        public init(id: String, category: String, confidence: Confidence, transform: [Double], dimensions: [Double]) {
            self.id = id; self.category = category; self.confidence = confidence
            self.transform = transform; self.dimensions = dimensions
        }
    }

    public struct Device: Codable, Equatable {
        public var model: String
        public var systemVersion: String
        public init(model: String, systemVersion: String) { self.model = model; self.systemVersion = systemVersion }
    }

    public var schemaVersion: Int = 1
    /// Client-generated; doubles as the idempotency key for upload completion.
    public var scanId: UUID
    public var capturedAt: Date
    public var device: Device?
    public var walls: [Surface]
    public var doors: [Surface]
    public var windows: [Surface]
    public var openings: [Surface]
    public var floors: [Surface]
    public var objects: [Object]

    public init(scanId: UUID = UUID(), capturedAt: Date = Date(), device: Device? = nil,
                walls: [Surface], doors: [Surface], windows: [Surface], openings: [Surface],
                floors: [Surface] = [], objects: [Object]) {
        self.scanId = scanId; self.capturedAt = capturedAt; self.device = device
        self.walls = walls; self.doors = doors; self.windows = windows
        self.openings = openings; self.floors = floors; self.objects = objects
    }

    /// Canonical JSON: ISO-8601 UTC dates, sorted keys (stable checksums).
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(self)
    }

    public static func decode(_ data: Data) throws -> RawRoomScan {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(RawRoomScan.self, from: data)
    }
}
