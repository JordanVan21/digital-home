import AVFoundation
import Foundation
import RoomPlan
import RoomScanKit
import UIKit

/// Drives the whole iPhone experience: support/permission gate -> capture -> review -> upload.
@MainActor
final class ScanModel: ObservableObject {
    enum Phase: Equatable {
        case checking
        case unsupported            // no LiDAR / RoomPlan on this device
        case cameraDenied
        case ready
        case scanning
        case processing
        case review(summary: String, hint: String?, uploadable: Bool)
        case uploading(Double)
        case uploaded
        case failed(String)
    }

    @Published var phase: Phase = .checking
    private(set) var captureID: UUID?
    private(set) var scan: RawRoomScan?
    private(set) var exportURL: URL?

    func checkAvailability() async {
        // Returning from Settings/share sheets must not reset an active result or scan.
        guard phase == .checking || phase == .cameraDenied || phase == .ready else { return }
        guard RoomCaptureSession.isSupported else { phase = .unsupported; return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: phase = .ready
        case .notDetermined: phase = await AVCaptureDevice.requestAccess(for: .video) ? .ready : .cameraDenied
        default: phase = .cameraDenied
        }
    }

    var isCapturing: Bool { phase == .scanning || phase == .processing }

    func startCapture() {
        guard phase == .ready else { return }
        scan = nil
        exportURL = nil
        captureID = UUID()
        phase = .scanning
    }

    func finishCapture() {
        guard phase == .scanning else { return }
        phase = .processing
    }

    func cancelCapture() {
        guard isCapturing else { return }
        captureID = nil
        phase = .ready
    }

    func captureWasBackgrounded() {
        guard isCapturing else { return }
        captureID = nil
        phase = .failed("Scanning was interrupted when House left the screen. Keep House open and your iPhone unlocked while scanning, then start a new scan.")
    }

    func returnToStart() {
        captureID = nil
        phase = .ready
    }

    func didFinishCapture(_ room: CapturedRoom, captureID: UUID) {
        guard self.captureID == captureID, isCapturing else { return }
        self.captureID = nil
        let device = RawRoomScan.Device(model: UIDevice.current.model, systemVersion: UIDevice.current.systemVersion)
        let raw = RawRoomScan(room: room, device: device)
        scan = raw
        let quality = ScanQuality.assess(raw)
        let summary = "\(raw.walls.count) walls · \(raw.doors.count) doors · \(raw.windows.count) windows · \(raw.objects.count) objects"
        do {
            exportURL = try writeExport(raw)
            phase = .review(summary: summary, hint: quality.message, uploadable: quality.isUploadable)
        } catch {
            phase = .failed("Could not save the scan: \(error.localizedDescription)")
        }
    }

    func captureFailed(_ error: Error, captureID: UUID) {
        guard self.captureID == captureID, isCapturing else { return }
        self.captureID = nil
        phase = .failed("Scanning stopped: \(error.localizedDescription) Try scanning again with good lighting and slower movement.")
    }

    /// `uploadURLString` empty = export file only (share sheet).
    func upload(to uploadURLString: String, token uploadToken: String) async {
        guard let scan, let url = URL(string: uploadURLString), url.scheme?.hasPrefix("http") == true else {
            phase = .failed("Enter a valid upload URL first, or share the scan file instead.")
            return
        }
        phase = .uploading(0)
        let uploader = HTTPScanUploader(endpoint: url, bearerToken: uploadToken.isEmpty ? nil : uploadToken)
        do {
            try await uploader.upload(scan) { [weak self] p in Task { @MainActor in self?.phase = .uploading(p) } }
            phase = .uploaded
        } catch {
            // The scan stays on device; retrying re-sends the same scanId, so no duplicates.
            phase = .failed(error.localizedDescription)
        }
    }

    func retryFromReview() {
        guard let scan else { phase = .ready; return }
        let quality = ScanQuality.assess(scan)
        phase = .review(summary: "\(scan.walls.count) walls · \(scan.doors.count) doors · \(scan.windows.count) windows · \(scan.objects.count) objects",
                        hint: quality.message, uploadable: quality.isUploadable)
    }

    private func writeExport(_ raw: RawRoomScan) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("room-\(raw.scanId.uuidString.lowercased()).json")
        try raw.encoded().write(to: url, options: .atomic)
        return url
    }
}
