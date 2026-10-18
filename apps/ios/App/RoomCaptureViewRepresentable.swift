import RoomPlan
import SwiftUI

/// Hosts RoomPlan's own scanning UI (live coaching + wireframe overlay).
struct RoomCaptureViewRepresentable: UIViewRepresentable {
    /// Flip to true to finish; the delegate then delivers the processed result.
    @Binding var stopRequested: Bool
    let onResult: (CapturedRoom) -> Void
    let onError: (Error) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onResult: onResult, onError: onError) }

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = context.coordinator
        view.captureSession.run(configuration: RoomCaptureSession.Configuration())
        return view
    }

    func updateUIView(_ view: RoomCaptureView, context: Context) {
        if stopRequested, !context.coordinator.stopped {
            context.coordinator.stopped = true
            view.captureSession.stop()
        }
    }

    static func dismantleUIView(_ view: RoomCaptureView, coordinator: Coordinator) {
        if !coordinator.stopped { view.captureSession.stop() }
    }

    /// RoomCaptureViewDelegate refines NSCoding, hence the (unused) coder plumbing.
    @objc(HouseRoomCaptureCoordinator)
    final class Coordinator: NSObject, RoomCaptureViewDelegate, NSCoding {
        let onResult: (CapturedRoom) -> Void
        let onError: (Error) -> Void
        var stopped = false

        init(onResult: @escaping (CapturedRoom) -> Void, onError: @escaping (Error) -> Void) {
            self.onResult = onResult; self.onError = onError
        }
        required init?(coder: NSCoder) { fatalError("Not used") }
        func encode(with coder: NSCoder) {}

        func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
            if let error { onError(error); return false }
            return true
        }

        func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
            if let error { onError(error) } else { onResult(processedResult) }
        }
    }
}
