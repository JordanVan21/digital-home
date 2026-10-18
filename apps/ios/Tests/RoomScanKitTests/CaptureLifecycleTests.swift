import XCTest
@testable import RoomScanKit

final class CaptureLifecycleTests: XCTestCase {
    func testRepeatedFinishAndDelegateCallbacksDeliverOnlyOneCompletion() {
        let attempt = CaptureLifecycle()
        XCTAssertTrue(attempt.requestFinish())
        XCTAssertFalse(attempt.requestFinish())
        XCTAssertTrue(attempt.shouldProcess)
        XCTAssertTrue(attempt.acceptCompletion())
        XCTAssertFalse(attempt.acceptCompletion())
        XCTAssertFalse(attempt.shouldProcess)
    }

    func testCancelDuringCaptureStopsOnceAndRejectsLateResults() {
        let attempt = CaptureLifecycle()
        XCTAssertTrue(attempt.cancel())
        XCTAssertFalse(attempt.cancel())
        XCTAssertFalse(attempt.shouldProcess)
        XCTAssertFalse(attempt.requestFinish())
        XCTAssertFalse(attempt.acceptCompletion())
    }

    func testCancelDuringProcessingRejectsResultWithoutStoppingTwice() {
        let cancelled = CaptureLifecycle()
        XCTAssertTrue(cancelled.requestFinish())
        XCTAssertFalse(cancelled.cancel())
        XCTAssertFalse(cancelled.acceptCompletion())

        let next = CaptureLifecycle()
        XCTAssertTrue(next.requestFinish())
        XCTAssertTrue(next.acceptCompletion(), "A cancelled attempt must not affect a new scan")
        XCTAssertFalse(cancelled.acceptCompletion())
    }
}
