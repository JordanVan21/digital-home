import Foundation

/// Cheap on-device sanity checks so users learn about a bad capture before upload.
/// The importer re-validates authoritatively (closed outline, area, self-intersection).
public struct ScanQuality: Equatable {
    public enum Issue: Equatable {
        case tooFewWalls(found: Int)
        case nonFiniteValues
        case noDoorOrWindow
    }

    public var issues: [Issue]
    /// Blocking issues stop the upload; the rest are shown as hints.
    public var isUploadable: Bool {
        !issues.contains { if case .noDoorOrWindow = $0 { return false } else { return true } }
    }

    public static func assess(_ scan: RawRoomScan) -> ScanQuality {
        var issues: [Issue] = []
        if scan.walls.count < 3 { issues.append(.tooFewWalls(found: scan.walls.count)) }
        var allValues: [Double] = []
        for surface in scan.walls + scan.doors + scan.windows + scan.openings + scan.floors {
            allValues += surface.transform
            allValues += surface.dimensions
            for corner in surface.polygonCorners ?? [] { allValues += corner }
        }
        for object in scan.objects {
            allValues += object.transform
            allValues += object.dimensions
        }
        if allValues.contains(where: { !$0.isFinite }) { issues.append(.nonFiniteValues) }
        if scan.doors.isEmpty && scan.windows.isEmpty && scan.openings.isEmpty { issues.append(.noDoorOrWindow) }
        return ScanQuality(issues: issues)
    }

    public var message: String? {
        guard let first = issues.first else { return nil }
        switch first {
        case .tooFewWalls(let found): return "Only \(found) wall(s) were captured. Scan the full perimeter of the room."
        case .nonFiniteValues: return "The scan contains invalid measurements. Please rescan."
        case .noDoorOrWindow: return "No doors or windows were detected. You can still upload, but check the 3D result."
        }
    }
}
