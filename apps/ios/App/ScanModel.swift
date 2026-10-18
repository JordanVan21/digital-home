import AVFoundation
import Foundation
import RoomPlan
import RoomScanKit
import UIKit

@MainActor
final class ScanModel: ObservableObject {
    enum Phase: Equatable {
        case checking, unsupported, cameraDenied, ready, scanning, processing, review, saved
        case failed(String)
    }

    @Published private(set) var phase: Phase = .checking
    @Published private(set) var records: [SavedScan] = []
    @Published private(set) var libraryIssues: [String] = []
    @Published private(set) var currentRecord: SavedScan?
    @Published private(set) var scan: RawRoomScan?
    @Published private(set) var previewLoadingIDs: Set<UUID> = []
    @Published var scanName = ""
    @Published var actionError: String?
    private(set) var captureID: UUID?
    private var store: ScanStore?
    private var previewTasks: [UUID: Task<Void, Never>] = [:]

    init() {
        // Retire the prototype's manual token setting. This milestone needs no credentials.
        UserDefaults.standard.removeObject(forKey: "uploadToken")
        do {
            store = try ScanStore.applicationStore()
            reloadLibrary()
        } catch {
            libraryIssues = ["Could not open scan storage: \(error.localizedDescription)"]
        }
    }

    var canStartCapture: Bool { phase == .ready && store != nil }
    var isCapturing: Bool { phase == .scanning || phase == .processing }
    var isPreviewLoading: Bool { currentRecord.map { previewLoadingIDs.contains($0.id) } ?? false }
    var exportURL: URL? { currentRecord.flatMap { store?.scanURL(for: $0.id) } }
    var previewURL: URL? {
        guard let entry = currentRecord, entry.hasPreview, let store else { return nil }
        let url = store.previewURL(for: entry.id)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    var summary: String {
        guard let scan else { return "" }
        return "\(scan.walls.count) walls · \(scan.doors.count) doors · \(scan.windows.count) windows · \(scan.objects.count) objects"
    }
    var qualityHint: String? { scan.flatMap { ScanQuality.assess($0).message } }

    func checkAvailability() async {
        guard phase == .checking || phase == .cameraDenied || phase == .ready else { return }
        guard RoomCaptureSession.isSupported else { phase = .unsupported; return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: phase = .ready
        case .notDetermined: phase = await AVCaptureDevice.requestAccess(for: .video) ? .ready : .cameraDenied
        default: phase = .cameraDenied
        }
    }

    func reloadLibrary() {
        guard let store else { return }
        do {
            let library = try store.loadLibrary()
            records = library.records
            libraryIssues = library.issues
        } catch {
            libraryIssues = ["Could not refresh saved scans: \(error.localizedDescription)"]
        }
    }

    func startCapture() {
        guard canStartCapture else { return }
        clearSelection()
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
        clearSelection()
        reloadLibrary()
        phase = .checking
        Task { await checkAvailability() }
    }

    func open(_ record: SavedScan) {
        guard let store else { return }
        do {
            let raw = try store.rawScan(id: record.id)
            let latest = try store.record(id: record.id)
            scan = raw
            currentRecord = latest
            scanName = latest.name
            actionError = nil
            phase = latest.state == .draft ? .review : .saved
        } catch {
            actionError = "Could not open this scan: \(error.localizedDescription)"
        }
    }

    func didFinishCapture(_ room: CapturedRoom, captureID: UUID) {
        guard self.captureID == captureID, isCapturing, let store else { return }
        self.captureID = nil
        let device = RawRoomScan.Device(model: UIDevice.current.model, systemVersion: UIDevice.current.systemVersion)
        let raw = RawRoomScan(room: room, device: device)
        scan = raw
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            // Persist raw JSON + Apple's native data before preview work or user actions.
            let entry = try store.createDraft(raw, nativeData: encoder.encode(room))
            currentRecord = entry
            scanName = entry.name
            actionError = nil
            reloadLibrary()
            buildPreview(for: room, id: entry.id)
            phase = .review
        } catch {
            // Leave the capture in memory so a storage failure can be retried.
            pendingRoom = room
            phase = .failed("Could not save the scan on this iPhone: \(error.localizedDescription)")
        }
    }

    private var pendingRoom: CapturedRoom?

    func retrySavingCapture() {
        guard let room = pendingRoom, let raw = scan, let store else { return }
        do {
            reloadLibrary()
            let entry: SavedScan
            if let recovered = records.first(where: { $0.id == raw.scanId }) {
                entry = recovered
            } else {
                entry = try store.createDraft(raw, nativeData: JSONEncoder().encode(room))
            }
            pendingRoom = nil
            currentRecord = entry
            scanName = entry.name
            reloadLibrary()
            buildPreview(for: room, id: entry.id)
            phase = .review
        } catch {
            actionError = "Could not retry saving: \(error.localizedDescription)"
        }
    }

    var canRetrySaving: Bool { pendingRoom != nil }

    func captureFailed(_ error: Error, captureID: UUID) {
        guard self.captureID == captureID, isCapturing else { return }
        self.captureID = nil
        phase = .failed("Scanning stopped: \(error.localizedDescription) Try scanning again with good lighting and slower movement.")
    }

    func saveCurrentDraft() {
        guard let entry = currentRecord, let store else { return }
        do {
            _ = try store.saveDraft(id: entry.id, name: scanName)
            returnToStart()
        } catch {
            actionError = "Could not save: \(error.localizedDescription)"
        }
    }

    func discardCurrentDraft() {
        guard let entry = currentRecord, let store else { return }
        do {
            try store.discardDraft(id: entry.id)
            previewTasks[entry.id]?.cancel()
            returnToStart()
        } catch {
            actionError = "Could not discard: \(error.localizedDescription)"
        }
    }

    private func clearSelection() {
        scan = nil
        pendingRoom = nil
        currentRecord = nil
        scanName = ""
        actionError = nil
    }

    private func buildPreview(for room: CapturedRoom, id: UUID) {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("preview-\(UUID().uuidString).usdz")
        previewLoadingIDs.insert(id)
        previewTasks[id] = Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                try room.export(to: temporary, exportOptions: .parametric)
            }.result
            defer {
                try? FileManager.default.removeItem(at: temporary)
                self?.previewTasks.removeValue(forKey: id)
                self?.previewLoadingIDs.remove(id)
            }
            guard !Task.isCancelled, let self, let store = self.store else { return }
            do {
                switch result {
                case .success:
                    try store.attachPreview(id: id, from: temporary)
                case .failure(let error):
                    try store.recordPreviewFailure(id: id, message: "USDZ backup unavailable: \(error.localizedDescription). The measured geometry preview and JSON are still available.")
                }
                if self.currentRecord?.id == id { self.currentRecord = try store.record(id: id) }
                self.reloadLibrary()
            } catch {
                // The primary capture is already durable; preview failure must not lose it.
                self.libraryIssues.append("Could not save a USDZ preview: \(error.localizedDescription)")
            }
        }
    }
}
