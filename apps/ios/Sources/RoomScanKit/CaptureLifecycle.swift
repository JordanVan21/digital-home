import Foundation

/// Guards one capture attempt against repeated stops and late RoomPlan callbacks.
/// RoomPlan delegates are not actor-isolated, so transitions are protected by a lock.
public final class CaptureLifecycle: @unchecked Sendable {
    private enum State { case capturing, processing, cancelled, finished }
    private var state: State = .capturing
    private let lock = NSLock()

    public init() {}

    /// Only the first Finish should stop capture and start processing.
    public func requestFinish() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard state == .capturing else { return false }
        state = .processing
        return true
    }

    public var shouldProcess: Bool {
        lock.lock(); defer { lock.unlock() }
        return state == .capturing || state == .processing
    }

    /// True only when cancellation also needs to stop the still-running session.
    /// Pending processing callbacks are ignored even when no additional stop is needed.
    public func cancel() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let needsStop = state == .capturing
        state = .cancelled
        return needsStop
    }

    /// Deliver at most one result/error, and none after cancellation.
    public func acceptCompletion() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard state == .capturing || state == .processing else { return false }
        state = .finished
        return true
    }
}
