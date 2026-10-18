import Foundation

public enum ScanUploadStatus: String, Codable {
    case saved, readyToUpload, uploading, uploaded, failed

    public var title: String {
        switch self {
        case .saved: return "Saved"
        case .readyToUpload: return "Ready to upload"
        case .uploading: return "Uploading"
        case .uploaded: return "Uploaded"
        case .failed: return "Failed"
        }
    }
}

public struct SavedScan: Codable, Equatable, Identifiable {
    public enum State: String, Codable { case draft, saved }
    public var recordVersion = 1
    public var id: UUID
    public var capturedAt: Date
    public var name: String
    public var state: State
    public var roomCount: Int
    public var objectCount: Int
    public var status: ScanUploadStatus
    public var hasPreview: Bool
    public var previewWarning: String?

    public static func defaultName(for date: Date) -> String {
        "Room — " + date.formatted(date: .abbreviated, time: .shortened)
    }
}

public struct ScanLibrary {
    public var records: [SavedScan]
    public var issues: [String]
}

public enum ScanStoreError: LocalizedError {
    case invalidName, notDraft, identityMismatch
    public var errorDescription: String? {
        switch self {
        case .invalidName: return "Give this scan a name before saving."
        case .notDraft: return "Only an unfinished scan can be discarded."
        case .identityMismatch: return "The saved scan's identity does not match its folder."
        }
    }
}

/// Serialized by its caller (the app's main actor). One directory per scan avoids
/// a shared index becoming a single point of failure. Never derive paths from names.
public final class ScanStore {
    public let rootURL: URL
    private let files = FileManager.default

    public init(rootURL: URL) throws {
        self.rootURL = rootURL
        try files.createDirectory(at: rootURL, withIntermediateDirectories: true)
    }

    public static func applicationStore() throws -> ScanStore {
        let support = try FileManager.default.url(for: .applicationSupportDirectory,
                                                  in: .userDomainMask, appropriateFor: nil, create: true)
        return try ScanStore(rootURL: support.appendingPathComponent("HouseScans", isDirectory: true))
    }

    public func directory(for id: UUID) -> URL {
        rootURL.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true)
    }

    public func scanURL(for id: UUID) -> URL { directory(for: id).appendingPathComponent("scan.json") }
    public func previewURL(for id: UUID) -> URL { directory(for: id).appendingPathComponent("scan.usdz") }

    public func rawScan(id: UUID) throws -> RawRoomScan {
        let raw = try RawRoomScan.decode(Data(contentsOf: scanURL(for: id)))
        guard raw.scanId == id else { throw ScanStoreError.identityMismatch }
        return raw
    }

    public func record(id: UUID) throws -> SavedScan {
        let url = directory(for: id).appendingPathComponent("record.json")
        let record = try decoder().decode(SavedScan.self, from: Data(contentsOf: url))
        guard record.id == id else { throw ScanStoreError.identityMismatch }
        return record
    }

    /// Persist the primary JSON first. If interrupted before the record is written,
    /// loadLibrary reconstructs a recoverable draft from that immutable artifact.
    @discardableResult
    public func createDraft(_ raw: RawRoomScan, nativeData: Data) throws -> SavedScan {
        let folder = directory(for: raw.scanId)
        // Reusing an ID must never overwrite an already saved scan.
        guard !files.fileExists(atPath: scanURL(for: raw.scanId).path),
              !files.fileExists(atPath: folder.appendingPathComponent("record.json").path)
        else { throw CocoaError(.fileWriteFileExists) }
        let rawData = try raw.encoded()
        try files.createDirectory(at: folder, withIntermediateDirectories: true)
        try rawData.write(to: scanURL(for: raw.scanId), options: .atomic)
        try nativeData.write(to: folder.appendingPathComponent("roomplan.json"), options: .atomic)
        let record = draftRecord(raw)
        try writeRecord(record)
        return record
    }

    public func loadLibrary() throws -> ScanLibrary {
        let folders = try files.contentsOfDirectory(at: rootURL, includingPropertiesForKeys: nil,
                                                    options: [.skipsHiddenFiles])
        var records: [SavedScan] = []
        var issues: [String] = []
        for folder in folders {
            guard let id = UUID(uuidString: folder.lastPathComponent) else { continue }
            do {
                let raw = try rawScan(id: id)
                let recordURL = folder.appendingPathComponent("record.json")
                let entry: SavedScan
                if files.fileExists(atPath: recordURL.path) {
                    entry = try record(id: id)
                } else {
                    entry = draftRecord(raw)
                    try writeRecord(entry)
                    issues.append("Recovered an unfinished scan from \(raw.capturedAt.formatted()).")
                }
                records.append(entry)
            } catch {
                // Preserve the broken files; one bad record must not hide healthy scans.
                issues.append("Could not load scan \(id.uuidString.lowercased()): \(error.localizedDescription)")
            }
        }
        records.sort {
            if $0.capturedAt != $1.capturedAt { return $0.capturedAt > $1.capturedAt }
            return $0.id.uuidString < $1.id.uuidString
        }
        return ScanLibrary(records: records, issues: issues)
    }

    @discardableResult
    public func saveDraft(id: UUID, name: String) throws -> SavedScan {
        var entry = try record(id: id)
        guard entry.state == .draft else { throw ScanStoreError.notDraft }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ScanStoreError.invalidName }
        entry.name = trimmed
        entry.state = .saved
        try writeRecord(entry)
        return entry
    }

    public func discardDraft(id: UUID) throws {
        guard try record(id: id).state == .draft else { throw ScanStoreError.notDraft }
        try files.removeItem(at: directory(for: id))
    }

    public func attachPreview(id: UUID, from temporaryURL: URL) throws {
        var entry = try record(id: id)
        try Data(contentsOf: temporaryURL).write(to: previewURL(for: id), options: .atomic)
        entry.hasPreview = true
        entry.previewWarning = nil
        try writeRecord(entry)
    }

    public func recordPreviewFailure(id: UUID, message: String) throws {
        var entry = try record(id: id)
        entry.previewWarning = message
        try writeRecord(entry)
    }

    private func draftRecord(_ raw: RawRoomScan) -> SavedScan {
        SavedScan(id: raw.scanId, capturedAt: raw.capturedAt,
                  name: SavedScan.defaultName(for: raw.capturedAt), state: .draft,
                  roomCount: 1, objectCount: raw.objects.count, status: .saved,
                  hasPreview: files.fileExists(atPath: previewURL(for: raw.scanId).path))
    }

    private func writeRecord(_ record: SavedScan) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(record).write(to: directory(for: record.id).appendingPathComponent("record.json"),
                                         options: .atomic)
    }

    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
