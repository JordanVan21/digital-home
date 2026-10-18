import RoomPlan
import RoomScanKit
import SwiftUI

/// Hosts RoomPlan's own scanning UI (live coaching + wireframe overlay).
/// Whole-house capture: each room is stopped without pausing the AR session, so
/// the next room (bumped `roomNumber`) continues in the same coordinate frame.
struct RoomCaptureViewRepresentable: UIViewRepresentable {
    /// Which room of the house is being captured (0-based). Increment to start the next room.
    let roomNumber: Int
    /// Flip to true to finish the current room; the delegate then delivers its result.
    let stopRequested: Bool
    let onResult: @MainActor (CapturedRoom) -> Void
    let onError: @MainActor (Error) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onResult: onResult, onError: onError) }

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = context.coordinator
        context.coordinator.roomNumber = roomNumber
        view.captureSession.run(configuration: Self.configuration)
        return view
    }

    func updateUIView(_ view: RoomCaptureView, context: Context) {
        let coordinator = context.coordinator
        if roomNumber != coordinator.roomNumber, coordinator.lifecycle.restart() {
            coordinator.roomNumber = roomNumber
            view.captureSession.run(configuration: Self.configuration)
            return
        }
        if stopRequested, roomNumber == coordinator.roomNumber, coordinator.lifecycle.requestFinish() {
            view.captureSession.stop(pauseARSession: false)
        }
    }

    static func dismantleUIView(_ view: RoomCaptureView, coordinator: Coordinator) {
        // Invalidate callbacks before stopping: RoomPlan may still build a result.
        let needsStop = coordinator.lifecycle.cancel()
        view.delegate = nil
        if needsStop { view.captureSession.stop() }
        // Between rooms the AR session is kept running; release the camera now.
        view.captureSession.arSession.pause()
    }

    private static var configuration: RoomCaptureSession.Configuration {
        var configuration = RoomCaptureSession.Configuration()
        configuration.isCoachingEnabled = true
        return configuration
    }

    /// RoomCaptureViewDelegate refines NSCoding, hence the (unused) coder plumbing.
    @objc(HouseRoomCaptureCoordinator)
    final class Coordinator: NSObject, RoomCaptureViewDelegate, NSCoding {
        let onResult: @MainActor (CapturedRoom) -> Void
        let onError: @MainActor (Error) -> Void
        let lifecycle = CaptureLifecycle()
        var roomNumber = 0

        init(onResult: @escaping @MainActor (CapturedRoom) -> Void,
             onError: @escaping @MainActor (Error) -> Void) {
            self.onResult = onResult; self.onError = onError
        }
        required init?(coder: NSCoder) { fatalError("Not used") }
        func encode(with coder: NSCoder) {}

        func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
            if let error { report(error); return false }
            return lifecycle.shouldProcess
        }

        func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
            if let error { report(error); return }
            guard lifecycle.acceptCompletion() else { return }
            Task { @MainActor in onResult(processedResult) }
        }

        private func report(_ error: Error) {
            guard lifecycle.acceptCompletion() else { return }
            Task { @MainActor in onError(error) }
        }
    }
}
