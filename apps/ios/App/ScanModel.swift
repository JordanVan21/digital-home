import AVFoundation
import Combine
import Foundation
import HouseCloud
import RoomPlan
import RoomScanKit
import UIKit

@MainActor
final class ScanModel: ObservableObject {
    enum Phase: Equatable {
        // scanning/processing = current room; betweenRooms = room captured, AR still running;
        // building = combining the house's rooms with StructureBuilder.
        case checking, unsupported, cameraDenied, ready, scanning, processing, betweenRooms, building, review, saved
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
    @Published private(set) var isUploading = false
    /// Rooms of the house captured so far in this AR session.
    @Published private(set) var capturedRooms: [CapturedRoom] = []
    /// Index of the room being captured; bumped only by `nextRoom()`.
    @Published private(set) var roomNumber = 0
    let cloud = ScanCloud()
    private var cloudChanges: AnyCancellable?
    private(set) var captureID: UUID?
    private var store: ScanStore?
    private var previewTasks: [UUID: Task<Void, Never>] = [:]

    init() {
        // Retire the prototype's manual token setting. This milestone needs no credentials.
        UserDefaults.standard.removeObject(forKey: "uploadToken")
        cloudChanges = cloud.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
        do {
            store = try ScanStore.applicationStore()
            reloadLibrary()
        } catch {
            libraryIssues = ["Could not open scan storage: \(error.localizedDescription)"]
        }
    }

    var canStartCapture: Bool { phase == .ready && store != nil }
    var isCapturing: Bool { [.scanning, .processing, .betweenRooms, .building].contains(phase) }
    var isPreviewLoading: Bool { currentRecord.map { previewLoadingIDs.contains($0.id) } ?? false }
    var exportURL: URL? { currentRecord.flatMap { store?.scanURL(for: $0.id) } }
    var previewURL: URL? {
        guard let entry = currentRecord, entry.hasPreview, let store else { return nil }
        let url = store.previewURL(for: entry.id)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    var summary: String {
        guard let scan else { return "" }
        let rooms = scan.roomCount > 1 ? "\(scan.roomCount) rooms · " : ""
        return rooms + "\(scan.walls.count) walls · \(scan.doors.count) doors · \(scan.windows.count) windows · \(scan.objects.count) objects"
    }
    var qualityHint: String? { scan.flatMap { ScanQuality.assess($0).message } }

    /// Saved scans from before sign-in/upload existed; uploaded only on request.
    var notUploadedCount: Int { records.filter { $0.state == .saved && $0.status == .saved }.count }

    /// Uploads queued scans (new saves, failed or interrupted uploads). Local files
    /// are never removed. `includingSaved` also uploads older never-queued scans.
    func uploadQueued(includingSaved: Bool = false) async {
        guard cloud.isSignedIn, !isUploading, let store else { return }
        isUploading = true
        defer { isUploading = false; reloadLibrary() }
        var pending: Set<ScanUploadStatus> = [.readyToUpload, .uploading, .failed]
        if includingSaved { pending.insert(.saved) }
        for record in records where record.state == .saved && pending.contains(record.status) {
            // Include the USDZ backup if it is still being exported.
            await previewTasks[record.id]?.value
            do {
                try store.setUploadStatus(id: record.id, .uploading)
                reloadLibrary()
                try await cloud.upload(try store.record(id: record.id), store: store)
                try store.setUploadStatus(id: record.id, .uploaded)
            } catch {
                _ = try? store.setUploadStatus(id: record.id, .failed, error: error.localizedDescription)
                if case ScanCloudError.signedOut = error { break }
            }
            if currentRecord?.id == record.id { currentRecord = try? store.record(id: record.id) }
            reloadLibrary()
        }
    }

    func retryUpload() {
        guard let entry = currentRecord, let store else { return }
        currentRecord = try? store.setUploadStatus(id: entry.id, .readyToUpload)
        reloadLibrary()
        Task { await uploadQueued() }
    }

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
        capturedRooms = []
        roomNumber = 0
        captureID = UUID()
        phase = .scanning
    }

    func nextRoom() {
        guard phase == .betweenRooms else { return }
        roomNumber += 1
        phase = .scanning
    }

    /// Combine the captured rooms into one house and persist it as a draft.
    func finishHouse() {
        guard phase == .betweenRooms, !capturedRooms.isEmpty, let captureID else { return }
        phase = .building
        let rooms = capturedRooms
        let device = RawRoomScan.Device(model: UIDevice.current.model, systemVersion: UIDevice.current.systemVersion)
        Task {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let pending: PendingSave
            if rooms.count == 1 {
                let room = rooms[0]
                pending = PendingSave(raw: RawRoomScan(room: room, device: device),
                                      native: (try? encoder.encode(room)) ?? Data(),
                                      exportPreview: { try room.export(to: $0, exportOptions: .parametric) })
            } else {
                do {
                    let structure = try await StructureBuilder(options: [.beautifyObjects])
                        .capturedStructure(from: rooms)
                    pending = PendingSave(raw: RawRoomScan(rooms: structure.rooms, device: device),
                                          native: (try? encoder.encode(structure)) ?? Data(),
                                          exportPreview: { try structure.export(to: $0, exportOptions: .parametric) })
                } catch {
                    // Rooms from one session already share a frame; keep them unmerged.
                    pending = PendingSave(raw: RawRoomScan(rooms: rooms, device: device),
                                          native: (try? encoder.encode(rooms)) ?? Data(),
                                          exportPreview: { _ in throw error })
                }
            }
            guard self.captureID == captureID, self.phase == .building else { return }
            self.captureID = nil
            self.capturedRooms = []
            self.persist(pending)
        }
    }

    func finishCapture() {
        guard phase == .scanning else { return }
        phase = .processing
    }

    func cancelCapture() {
        guard isCapturing else { return }
        captureID = nil
        capturedRooms = []
        phase = .ready
    }

    func captureWasBackgrounded() {
        guard isCapturing, phase != .building else { return }
        if !capturedRooms.isEmpty {
            // Keep the rooms already captured instead of losing the whole house.
            phase = .betweenRooms
            finishHouse()
            return
        }
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
        guard self.captureID == captureID, phase == .processing || phase == .scanning else { return }
        capturedRooms.append(room)
        phase = .betweenRooms
    }

    private struct PendingSave {
        let raw: RawRoomScan
        let native: Data
        let exportPreview: @Sendable (URL) throws -> Void
    }

    private var pendingSave: PendingSave?

    private func persist(_ pending: PendingSave) {
        guard let store else { return }
        scan = pending.raw
        do {
            // Persist raw JSON + Apple's native data before preview work or user actions.
            let entry = try store.createDraft(pending.raw, nativeData: pending.native)
            pendingSave = nil
            currentRecord = entry
            scanName = entry.name
            actionError = nil
            reloadLibrary()
            buildPreview(id: entry.id, export: pending.exportPreview)
            phase = .review
        } catch {
            // Leave the capture in memory so a storage failure can be retried.
            pendingSave = pending
            phase = .failed("Could not save the scan on this iPhone: \(error.localizedDescription)")
        }
    }

    func retrySavingCapture() {
        guard let pending = pendingSave else { return }
        reloadLibrary()
        if let recovered = records.first(where: { $0.id == pending.raw.scanId }) {
            pendingSave = nil
            scan = pending.raw
            currentRecord = recovered
            scanName = recovered.name
            buildPreview(id: recovered.id, export: pending.exportPreview)
            phase = .review
        } else {
            persist(pending)
        }
    }

    var canRetrySaving: Bool { pendingSave != nil }

    func captureFailed(_ error: Error, captureID: UUID) {
        guard self.captureID == captureID, isCapturing else { return }
        if !capturedRooms.isEmpty {
            // Earlier rooms are fine: let the user rescan this room or finish the house.
            phase = .betweenRooms
            actionError = "This room could not be captured: \(error.localizedDescription) Scan it again or finish the house."
            return
        }
        self.captureID = nil
        phase = .failed("Scanning stopped: \(error.localizedDescription) Try scanning again with good lighting and slower movement.")
    }

    func saveCurrentDraft() {
        guard let entry = currentRecord, let store else { return }
        do {
            _ = try store.saveDraft(id: entry.id, name: scanName)
            returnToStart()
            Task { await uploadQueued() }
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
        pendingSave = nil
        currentRecord = nil
        scanName = ""
        actionError = nil
    }

    private func buildPreview(id: UUID, export: @escaping @Sendable (URL) throws -> Void) {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("preview-\(UUID().uuidString).usdz")
        previewLoadingIDs.insert(id)
        previewTasks[id] = Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                try export(temporary)
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
