import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

public enum ScanUploadError: Error, Equatable, LocalizedError {
    case tooLarge(bytes: Int)
    case rejected(status: Int, message: String)
    case network(String)

    public var errorDescription: String? {
        switch self {
        case .tooLarge(let bytes): return "Scan is too large to upload (\(bytes / 1_000_000) MB)."
        case .rejected(_, let message): return message
        case .network(let message): return "Network problem: \(message)"
        }
    }
}

public protocol ScanUploading {
    /// Idempotent: re-sending the same scan (same `scanId`) never creates a duplicate.
    func upload(_ scan: RawRoomScan, progress: @escaping (Double) -> Void) async throws
}

/// Single-request upload with retries. Stands in for the documented
/// createScanUpload -> signed upload -> completeScan flow (CONTRACTS.md §5) until
/// the authenticated API exists; the `Idempotency-Key` and checksum headers are what
/// that flow's completion call will rely on.
public struct HTTPScanUploader: ScanUploading {
    public var endpoint: URL
    public var bearerToken: String?
    public var maxBytes: Int
    public var maxAttempts: Int
    public var session: URLSession

    public init(endpoint: URL, bearerToken: String? = nil, maxBytes: Int = 20_000_000,
                maxAttempts: Int = 3, session: URLSession = .shared) {
        self.endpoint = endpoint; self.bearerToken = bearerToken
        self.maxBytes = maxBytes; self.maxAttempts = maxAttempts; self.session = session
    }

    public func upload(_ scan: RawRoomScan, progress: @escaping (Double) -> Void) async throws {
        let body = try scan.encoded()
        guard body.count <= maxBytes else { throw ScanUploadError.tooLarge(bytes: body.count) }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(scan.scanId.uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key")
        #if canImport(CryptoKit)
        request.setValue(SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined(), forHTTPHeaderField: "X-Content-SHA256")
        #endif
        if let bearerToken { request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }

        var lastError: Error = ScanUploadError.network("unknown")
        for attempt in 1...maxAttempts {
            progress(Double(attempt - 1) / Double(maxAttempts))
            do {
                let (data, response) = try await session.upload(for: request, from: body)
                guard let http = response as? HTTPURLResponse else { throw ScanUploadError.network("no response") }
                if (200..<300).contains(http.statusCode) { progress(1); return }
                let message = String(data: data, encoding: .utf8).flatMap { $0.isEmpty ? nil : String($0.prefix(300)) }
                    ?? "Server rejected the scan (\(http.statusCode))."
                // 4xx other than 408/429 are permanent: retrying the same payload cannot help.
                if (400..<500).contains(http.statusCode), http.statusCode != 408, http.statusCode != 429 {
                    throw ScanUploadError.rejected(status: http.statusCode, message: message)
                }
                lastError = ScanUploadError.rejected(status: http.statusCode, message: message)
            } catch let error as ScanUploadError {
                if case .rejected(let status, _) = error, (400..<500).contains(status), status != 408, status != 429 { throw error }
                lastError = error
            } catch {
                lastError = ScanUploadError.network(error.localizedDescription)
            }
            if attempt < maxAttempts { try await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(attempt - 1)) * 1_000_000_000)) }
        }
        throw lastError
    }
}
