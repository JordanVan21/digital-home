import Foundation
import RoomScanKit
import Supabase

public enum ScanCloudError: LocalizedError {
    case signedOut, missingScanFile
    public var errorDescription: String? {
        switch self {
        case .signedOut: return "Sign in to upload scans."
        case .missingScanFile: return "This scan's JSON file is missing on this iPhone."
        }
    }
}

/// Email/password sign-in and scan upload to Supabase. Session is kept in the
/// Keychain by the SDK. Uploads send the exact stored files to
/// scan-files/<user_id>/<client_scan_id>/ and upsert one `scans` row, so a retry
/// never creates a duplicate.
@MainActor
public final class ScanCloud: ObservableObject {
    @Published public private(set) var userEmail: String?
    public let client: SupabaseClient

    public init(url: URL = CloudConfig.url, anonKey: String = CloudConfig.anonKey) {
        client = SupabaseClient(supabaseURL: url, supabaseKey: anonKey,
                                options: .init(auth: .init(emitLocalSessionAsInitialSession: true)))
        userEmail = client.auth.currentUser?.email
    }

    public var isSignedIn: Bool { userEmail != nil }

    public func signIn(email: String, password: String) async throws {
        let session = try await client.auth.signIn(email: email, password: password)
        userEmail = session.user.email
    }

    /// Email confirmation is off on the demo project, so sign-up signs in immediately.
    public func signUp(email: String, password: String) async throws {
        let response = try await client.auth.signUp(email: email, password: password)
        userEmail = response.session?.user.email
        if userEmail == nil { try await signIn(email: email, password: password) }
    }

    public func signOut() async {
        try? await client.auth.signOut()
        userEmail = nil
    }

    public func upload(_ record: SavedScan, store: ScanStore) async throws {
        // `session` refreshes an expired access token before we use it.
        guard let userID = try? await client.auth.session.user.id else {
            userEmail = nil
            throw ScanCloudError.signedOut
        }
        let folder = "\(userID.uuidString.lowercased())/\(record.id.uuidString.lowercased())"
        let directory = store.directory(for: record.id)
        let bucket = client.storage.from("scan-files")
        var files: [String: String] = [:]
        for (name, type) in [("scan.json", "application/json"),
                             ("roomplan.json", "application/json"),
                             ("scan.usdz", "model/vnd.usdz+zip")] {
            let url = directory.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            let path = "\(folder)/\(name)"
            try await bucket.upload(path, fileURL: url, options: FileOptions(contentType: type, upsert: true))
            files[name] = path
        }
        guard files["scan.json"] != nil else { throw ScanCloudError.missingScanFile }
        let raw = try store.rawScan(id: record.id)
        let row = ScanRow(userID: userID, clientScanID: record.id, name: record.name,
                          capturedAt: record.capturedAt, schemaVersion: raw.schemaVersion,
                          roomCount: record.roomCount, files: files)
        // status is omitted so a retry never resets server-side processing progress.
        try await client.from("scans")
            .upsert(row, onConflict: "user_id,client_scan_id", returning: .minimal)
            .execute()
    }
}

struct ScanRow: Encodable {
    var userID: UUID
    var clientScanID: UUID
    var name: String
    var capturedAt: Date
    var schemaVersion: Int
    var roomCount: Int
    var files: [String: String]

    enum CodingKeys: String, CodingKey {
        case userID = "user_id", clientScanID = "client_scan_id", name
        case capturedAt = "captured_at", schemaVersion = "schema_version"
        case roomCount = "room_count", files
    }
}
