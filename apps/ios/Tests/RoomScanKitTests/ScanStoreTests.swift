import XCTest
@testable import RoomScanKit

final class ScanStoreTests: XCTestCase {
    private var root: URL!
    private var store: ScanStore!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("scan-store-tests-\(UUID())")
        store = try ScanStore(rootURL: root)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: root)
    }

    private func scan(date: TimeInterval = 1_700_000_000) -> RawRoomScan {
        RawRoomScan(capturedAt: Date(timeIntervalSince1970: date), walls: [], doors: [],
                    windows: [], openings: [], objects: [
                        .init(id: UUID().uuidString, category: "chair", confidence: .high,
                              transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 2, 1],
                              dimensions: [0.5, 0.9, 0.6])
                    ])
    }

    func testDraftAndNamedScanSurviveReopeningStoreWithUnchangedArtifacts() throws {
        let raw = scan()
        let native = Data("{\"native\":true}".utf8)
        let draft = try store.createDraft(raw, nativeData: native)
        XCTAssertEqual(draft.state, .draft)
        XCTAssertEqual(draft.objectCount, 1)
        XCTAssertFalse(draft.name.isEmpty)
        let sourceBytes = try Data(contentsOf: store.scanURL(for: raw.scanId))

        let reopened = try ScanStore(rootURL: root)
        XCTAssertEqual(try reopened.loadLibrary().records, [draft])
        XCTAssertEqual(try reopened.rawScan(id: raw.scanId), raw)
        _ = try reopened.saveDraft(id: raw.scanId, name: "  Living room  ")

        let afterRestart = try ScanStore(rootURL: root)
        let saved = try XCTUnwrap(afterRestart.loadLibrary().records.first)
        XCTAssertEqual(saved.name, "Living room")
        XCTAssertEqual(saved.state, .saved)
        XCTAssertEqual(saved.status, .saved)
        XCTAssertEqual(saved.roomCount, 1)
        XCTAssertEqual(try Data(contentsOf: afterRestart.scanURL(for: raw.scanId)), sourceBytes)
        XCTAssertEqual(try Data(contentsOf: afterRestart.directory(for: raw.scanId)
            .appendingPathComponent("roomplan.json")), native)
    }

    func testRecoveryAfterInterruptionBeforeManifestWrite() throws {
        let raw = scan()
        let folder = store.directory(for: raw.scanId)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try raw.encoded().write(to: store.scanURL(for: raw.scanId), options: .atomic)

        let recovered = try ScanStore(rootURL: root).loadLibrary()
        XCTAssertEqual(recovered.records.count, 1)
        XCTAssertEqual(recovered.records[0].state, .draft)
        XCTAssertEqual(recovered.records[0].id, raw.scanId)
        XCTAssertEqual(recovered.issues.count, 1)
        XCTAssertEqual(try store.record(id: raw.scanId).state, .draft)
    }

    func testDiscardRemovesOnlyDraftAndNeverSavedNeighbor() throws {
        let saved = scan()
        let draft = scan(date: 1_700_000_100)
        try store.createDraft(saved, nativeData: Data())
        try store.createDraft(draft, nativeData: Data())
        try store.saveDraft(id: saved.scanId, name: "Keep me")
        XCTAssertThrowsError(try store.discardDraft(id: saved.scanId))
        try store.discardDraft(id: draft.scanId)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.directory(for: draft.scanId).path))
        XCTAssertEqual(try store.loadLibrary().records.map(\.id), [saved.scanId])
    }

    func testRepeatedIdCannotOverwriteCaptureAndNamesCannotChangePaths() throws {
        let raw = scan()
        try store.createDraft(raw, nativeData: Data())
        let original = try Data(contentsOf: store.scanURL(for: raw.scanId))
        var changed = raw
        changed.objects = []
        XCTAssertThrowsError(try store.createDraft(changed, nativeData: Data()))
        XCTAssertThrowsError(try store.saveDraft(id: raw.scanId, name: " \n "))
        let saved = try store.saveDraft(id: raw.scanId, name: "../../Outside")
        XCTAssertEqual(saved.name, "../../Outside")
        XCTAssertEqual(try Data(contentsOf: store.scanURL(for: raw.scanId)), original)
        XCTAssertEqual(try store.loadLibrary().records.count, 1)
    }

    func testBrokenRecordDoesNotHideHealthyScanAndIsNotDeleted() throws {
        let good = scan()
        let bad = scan()
        try store.createDraft(good, nativeData: Data())
        try store.createDraft(bad, nativeData: Data())
        let brokenURL = store.directory(for: bad.scanId).appendingPathComponent("record.json")
        try Data("broken".utf8).write(to: brokenURL)
        let library = try store.loadLibrary()
        XCTAssertEqual(library.records.map(\.id), [good.scanId])
        XCTAssertEqual(library.issues.count, 1)
        XCTAssertEqual(try String(contentsOf: brokenURL, encoding: .utf8), "broken")
    }

    func testPreviewFailureAndLaterBackupDoNotModifySavedJsonOrName() throws {
        let raw = scan()
        try store.createDraft(raw, nativeData: Data())
        try store.saveDraft(id: raw.scanId, name: "My room")
        let original = try Data(contentsOf: store.scanURL(for: raw.scanId))
        try store.recordPreviewFailure(id: raw.scanId, message: "Backup failed")
        XCTAssertEqual(try store.record(id: raw.scanId).previewWarning, "Backup failed")
        let temp = root.appendingPathComponent("test-preview.usdz")
        try Data("test bytes".utf8).write(to: temp)
        try store.attachPreview(id: raw.scanId, from: temp)
        let entry = try store.record(id: raw.scanId)
        XCTAssertTrue(entry.hasPreview)
        XCTAssertNil(entry.previewWarning)
        XCTAssertEqual(entry.name, "My room")
        XCTAssertEqual(entry.state, .saved)
        XCTAssertEqual(try Data(contentsOf: store.scanURL(for: raw.scanId)), original)
        XCTAssertEqual(try Data(contentsOf: store.previewURL(for: raw.scanId)), Data("test bytes".utf8))
    }

    func testCannotAttachLatePreviewAfterDiscard() throws {
        let raw = scan()
        try store.createDraft(raw, nativeData: Data())
        try store.discardDraft(id: raw.scanId)
        let temp = root.appendingPathComponent("late-preview.usdz")
        try Data("late result".utf8).write(to: temp)
        XCTAssertThrowsError(try store.attachPreview(id: raw.scanId, from: temp))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.directory(for: raw.scanId).path))
    }

    func testRetryAfterEmptyDirectoryWasLeftByFailedWrite() throws {
        let raw = scan()
        try FileManager.default.createDirectory(at: store.directory(for: raw.scanId), withIntermediateDirectories: true)
        try store.createDraft(raw, nativeData: Data())
        XCTAssertEqual(try store.loadLibrary().records.count, 1)
    }
}
