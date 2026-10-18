#if canImport(RoomPlan)
import Foundation
import RoomPlan
import simd

/// Adapts Apple's `CapturedRoom` into the raw export. No coordinate conversion or
/// unit changes happen here by design; see `RawRoomScan`.
@available(iOS 17.0, *)
public extension RawRoomScan {
    init(room: CapturedRoom, scanId: UUID = UUID(), capturedAt: Date = Date(), device: Device? = nil) {
        self.init(rooms: [room], scanId: scanId, capturedAt: capturedAt, device: device)
    }

    /// A whole-house capture: rooms from one AR session (normally `CapturedStructure.rooms`)
    /// share a frame, so they are merged as-is with a `roomIndex` on every element.
    /// One room produces exactly the single-room wire format (no index, no `rooms`).
    init(rooms captured: [CapturedRoom], scanId: UUID = UUID(), capturedAt: Date = Date(), device: Device? = nil) {
        let multi = captured.count > 1
        var walls: [Surface] = [], doors: [Surface] = [], windows: [Surface] = []
        var openings: [Surface] = [], floors: [Surface] = [], objects: [Object] = []
        for (index, room) in captured.enumerated() {
            let roomIndex = multi ? index : nil
            func surface(_ s: CapturedRoom.Surface, _ name: String, withCorners: Bool = false) -> Surface {
                Surface(
                    id: s.identifier.uuidString,
                    category: name,
                    confidence: Self.confidence(s.confidence),
                    transform: Self.flatten(s.transform),
                    dimensions: [Double(s.dimensions.x), Double(s.dimensions.y), Double(s.dimensions.z)],
                    polygonCorners: withCorners && !s.polygonCorners.isEmpty
                        ? s.polygonCorners.map { [Double($0.x), Double($0.y), Double($0.z)] } : nil,
                    roomIndex: roomIndex
                )
            }
            walls += room.walls.map { surface($0, "wall") }
            doors += room.doors.map { surface($0, "door") }
            windows += room.windows.map { surface($0, "window") }
            openings += room.openings.map { surface($0, "opening") }
            floors += room.floors.map { surface($0, "floor", withCorners: true) }
            objects += room.objects.map { o in
                Object(
                    id: o.identifier.uuidString,
                    category: Self.name(o.category),
                    confidence: Self.confidence(o.confidence),
                    transform: Self.flatten(o.transform),
                    dimensions: [Double(o.dimensions.x), Double(o.dimensions.y), Double(o.dimensions.z)],
                    roomIndex: roomIndex
                )
            }
        }
        let rooms = multi ? captured.enumerated().map { index, room in
            Room(index: index, id: room.identifier.uuidString, story: room.story,
                 label: room.sections.first.map { $0.label.rawValue })
        } : nil
        self.init(scanId: scanId, capturedAt: capturedAt, device: device, walls: walls, doors: doors,
                  windows: windows, openings: openings, floors: floors, objects: objects, rooms: rooms)
    }

    private static func flatten(_ m: simd_float4x4) -> [Double] {
        [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { c in
            [Double(c.x), Double(c.y), Double(c.z), Double(c.w)]
        }
    }

    private static func confidence(_ c: CapturedRoom.Confidence) -> Confidence {
        switch c {
        case .low: return .low
        case .medium: return .medium
        case .high: return .high
        @unknown default: return .medium
        }
    }

    /// Names match the keys of CATEGORY_MAP in packages/scan-import/src/normalize.ts.
    private static func name(_ c: CapturedRoom.Object.Category) -> String {
        switch c {
        case .storage: return "storage"
        case .refrigerator: return "refrigerator"
        case .stove: return "stove"
        case .bed: return "bed"
        case .sink: return "sink"
        case .washerDryer: return "washerDryer"
        case .toilet: return "toilet"
        case .bathtub: return "bathtub"
        case .oven: return "oven"
        case .dishwasher: return "dishwasher"
        case .table: return "table"
        case .sofa: return "sofa"
        case .chair: return "chair"
        case .fireplace: return "fireplace"
        case .television: return "television"
        case .stairs: return "stairs"
        @unknown default: return "unknown"
        }
    }
}
#endif
