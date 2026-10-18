import RoomPlan
import RoomScanKit
import SwiftUI

/// Hosts RoomPlan's own scanning UI (live coaching + wireframe overlay).
struct RoomCaptureViewRepresentable: UIViewRepresentable {
    /// Flip to true to finish; the delegate then delivers the processed result.
    let stopRequested: Bool
    let onResult: @MainActor (CapturedRoom) -> Void
    let onError: @MainActor (Error) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onResult: onResult, onError: onError) }

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = context.coordinator
        var configuration = RoomCaptureSession.Configuration()
        configuration.isCoachingEnabled = true
        view.captureSession.run(configuration: configuration)
        return view
    }

    func updateUIView(_ view: RoomCaptureView, context: Context) {
        if stopRequested, context.coordinator.lifecycle.requestFinish() {
            view.captureSession.stop()
        }
    }

    static func dismantleUIView(_ view: RoomCaptureView, coordinator: Coordinator) {
        // Invalidate callbacks before stopping: RoomPlan may still build a result.
        let needsStop = coordinator.lifecycle.cancel()
        view.delegate = nil
        if needsStop { view.captureSession.stop() }
    }

    /// RoomCaptureViewDelegate refines NSCoding, hence the (unused) coder plumbing.
    @objc(HouseRoomCaptureCoordinator)
    final class Coordinator: NSObject, RoomCaptureViewDelegate, NSCoding {
        let onResult: @MainActor (CapturedRoom) -> Void
        let onError: @MainActor (Error) -> Void
        let lifecycle = CaptureLifecycle()

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
