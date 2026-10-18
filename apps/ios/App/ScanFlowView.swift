import SceneKit
import simd
import SwiftUI
import HouseCloud
import RoomScanKit

struct ScanFlowView: View {
    @StateObject private var model = ScanModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var showCancelConfirmation = false
    @State private var showDiscardConfirmation = false
    @State private var showShare = false
    @State private var shareURL: URL?
    @State private var showSignIn = false
    @FocusState private var nameIsFocused: Bool

    var body: some View {
        Group {
            switch model.phase {
            case .checking, .unsupported, .cameraDenied, .ready:
                library
            case .scanning, .processing, .betweenRooms, .building:
                capture
            case .review, .saved:
                scanReview
            case .failed(let text):
                VStack(spacing: 16) {
                    Text("Something went wrong").font(.title2.bold())
                    Text(text).multilineTextAlignment(.center)
                    if model.canRetrySaving {
                        Button("Retry saving") { model.retrySavingCapture() }
                            .buttonStyle(.borderedProminent)
                    }
                    Button("Back to scans") { model.returnToStart() }
                }.padding()
            }
        }
        .task {
            await model.checkAvailability()
            await model.uploadQueued()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.captureWasBackgrounded() }
            if phase == .active {
                Task {
                    await model.checkAvailability()
                    await model.uploadQueued()
                }
            }
        }
        .sheet(isPresented: $showSignIn) {
            SignInView(cloud: model.cloud) {
                showSignIn = false
                Task { await model.uploadQueued() }
            }
        }
        .onChange(of: model.phase) { _, _ in
            if !model.isCapturing { showCancelConfirmation = false }
        }
        .sheet(isPresented: $showShare) {
            if let shareURL { ShareSheet(url: shareURL) }
        }
        .alert("Could not complete action", isPresented: Binding(
            get: { model.actionError != nil },
            set: { if !$0 { model.actionError = nil } }
        )) {
            Button("OK", role: .cancel) { model.actionError = nil }
        } message: { Text(model.actionError ?? "") }
    }

    private var library: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Your scans").font(.largeTitle.bold())
                switch model.phase {
                case .checking:
                    ProgressView("Checking your iPhone…")
                case .unsupported:
                    Text("New scans need an iPhone with LiDAR. Your saved scans are still available.")
                case .cameraDenied:
                    Text("Allow camera access in Settings to scan a room.")
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                default:
                    Text("Scan a room, then preview, name and save it on this iPhone.")
                        .foregroundStyle(.secondary)
                    Button("Scan a room") { model.startCapture() }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(!model.canStartCapture)
                }
            }
            .padding(.horizontal).padding(.top)

            List {
                account
                if !model.libraryIssues.isEmpty {
                    Section("Storage notices") {
                        ForEach(Array(model.libraryIssues.enumerated()), id: \.offset) { _, issue in
                            Text(issue).font(.footnote).foregroundStyle(.orange)
                        }
                    }
                }
                let drafts = model.records.filter { $0.state == .draft }
                if !drafts.isEmpty {
                    Section("Unfinished scans") {
                        ForEach(drafts) { record in scanRow(record) }
                    }
                }
                let saved = model.records.filter { $0.state == .saved }
                Section("Saved scans") {
                    if saved.isEmpty {
                        Text("No saved scans yet. Finish a scan and tap Save scan.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(saved) { record in scanRow(record) }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    @ViewBuilder private var account: some View {
        Section("Cloud") {
            if let email = model.cloud.userEmail {
                Label(email, systemImage: "person.crop.circle.badge.checkmark")
                if model.isUploading {
                    ProgressView("Uploading scans…")
                } else if model.notUploadedCount > 0 {
                    Button("Upload \(model.notUploadedCount) earlier saved scan(s)") {
                        Task { await model.uploadQueued(includingSaved: true) }
                    }
                }
                Button("Sign out", role: .destructive) { Task { await model.cloud.signOut() } }
            } else {
                Text("Sign in to upload saved scans to your House account.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Sign in or create account") { showSignIn = true }
            }
        }
    }

    private func scanRow(_ record: SavedScan) -> some View {
        Button { model.open(record) } label: {
            HStack(spacing: 12) {
                Image(systemName: record.state == .draft ? "square.and.pencil" : "cube")
                    .font(.title2).foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 4) {
                    Text(record.name).font(.headline).foregroundStyle(.primary)
                    Text(record.capturedAt, format: .dateTime.month(.abbreviated).day().year().hour().minute())
                        .font(.caption).foregroundStyle(.secondary)
                    Text("\(record.roomCount) room\(record.roomCount == 1 ? "" : "s") · \(record.objectCount) objects")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(record.state == .draft ? "Unfinished" : record.status.title)
                    .font(.caption).foregroundStyle(.secondary)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    private var capture: some View {
        Group {
            if let captureID = model.captureID {
                VStack(spacing: 0) {
                    VStack(spacing: 8) {
                        HStack {
                            Button("Cancel") { showCancelConfirmation = true }.buttonStyle(.bordered)
                                .disabled(model.phase == .building)
                            Spacer()
                            Text("Room \(model.roomNumber + 1)").font(.headline)
                            Spacer()
                            switch model.phase {
                            case .scanning:
                                Button("Finish room") { model.finishCapture() }.buttonStyle(.borderedProminent)
                            case .betweenRooms:
                                Button("Finish house") { model.finishHouse() }.buttonStyle(.borderedProminent)
                            default:
                                ProgressView().accessibilityLabel("Building your room")
                            }
                        }
                        switch model.phase {
                        case .scanning:
                            Text("Move slowly. Cover every wall, door, window and furnishing.")
                                .font(.footnote).multilineTextAlignment(.center)
                        case .processing:
                            Text("Building this room… Keep House open.").font(.footnote)
                        case .betweenRooms:
                            Text("\(model.capturedRooms.count) room(s) captured. Walk through the doorway into the next room, then tap Scan next room. Keep the iPhone up.")
                                .font(.footnote).multilineTextAlignment(.center)
                            Button("Scan next room") { model.nextRoom() }.buttonStyle(.bordered)
                        default:
                            Text("Combining \(model.capturedRooms.count) rooms into your house…").font(.footnote)
                        }
                    }
                    .padding(.horizontal).padding(.vertical, 8)
                    .frame(maxWidth: .infinity).background(.regularMaterial)

                    RoomCaptureViewRepresentable(roomNumber: model.roomNumber,
                                                 stopRequested: model.phase == .processing,
                                                 onResult: { model.didFinishCapture($0, captureID: captureID) },
                                                 onError: { model.captureFailed($0, captureID: captureID) })
                        .id(captureID)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                }
                .alert("Discard this unfinished scan?", isPresented: $showCancelConfirmation) {
                    Button(model.phase == .processing ? "Keep processing" : "Keep scanning", role: .cancel) {}
                    Button("Discard scan", role: .destructive) { model.cancelCapture() }
                } message: {
                    Text(model.capturedRooms.isEmpty ? "Discarding removes this unfinished scan."
                         : "Discarding removes all \(model.capturedRooms.count) captured room(s). Tap Finish house to keep them.")
                }
            }
        }
    }

    private var scanReview: some View {
        ScrollView {
            if let record = model.currentRecord, let scan = model.scan {
                VStack(alignment: .leading, spacing: 16) {
                    Text(record.state == .draft ? "Review scan" : record.name).font(.title.bold())
                    RoomPreview(scan: scan, previewURL: model.previewURL)
                        .frame(height: 300).clipShape(RoundedRectangle(cornerRadius: 16))
                        .accessibilityLabel("Interactive room preview")
                    Text("Drag to rotate · Pinch to zoom").font(.caption).foregroundStyle(.secondary)
                    if model.isPreviewLoading {
                        ProgressView("Preparing USDZ backup… Your JSON is already on this iPhone.")
                            .font(.caption)
                    }
                    if let warning = record.previewWarning {
                        Text(warning).font(.caption).foregroundStyle(.orange)
                    }
                    Text(model.summary).font(.callout)
                    Text(record.capturedAt, format: .dateTime.month().day().year().hour().minute())
                        .font(.caption).foregroundStyle(.secondary)
                    if let hint = model.qualityHint {
                        Text(hint).font(.callout).foregroundStyle(.orange)
                    }
                    if record.state == .draft {
                        Text("Scan name").font(.headline)
                        TextField("Name your scan", text: $model.scanName)
                            .textFieldStyle(.roundedBorder).focused($nameIsFocused)
                            .submitLabel(.done).onSubmit { nameIsFocused = false }
                        Text("An unfinished copy is already stored on this iPhone. Save to add it to your saved scans.")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button("Save scan") { nameIsFocused = false; model.saveCurrentDraft() }
                                .buttonStyle(.borderedProminent).controlSize(.large)
                                .disabled(model.scanName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            Button("Discard", role: .destructive) { showDiscardConfirmation = true }
                                .buttonStyle(.bordered).controlSize(.large)
                        }
                        Button("Finish later") { nameIsFocused = false; model.returnToStart() }
                    } else {
                        Label(record.status.title, systemImage: record.status == .uploaded ? "icloud.and.arrow.up" : "checkmark.circle")
                        if let error = record.uploadError, record.status == .failed {
                            Text(error).font(.caption).foregroundStyle(.orange)
                            Button("Retry upload") { model.retryUpload() }.disabled(!model.cloud.isSignedIn)
                        }
                        if !model.cloud.isSignedIn, record.status != .uploaded {
                            Text("Sign in from Your scans to upload this scan.").font(.caption).foregroundStyle(.secondary)
                        }
                        Button("Back to scans") { model.returnToStart() }.buttonStyle(.borderedProminent)
                    }
                    Button("Share scan file (AirDrop)") {
                        shareURL = model.exportURL
                        showShare = shareURL != nil
                    }
                }
                .padding()
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .alert("Discard this scan?", isPresented: $showDiscardConfirmation) {
            Button("Keep scan", role: .cancel) {}
            Button("Discard", role: .destructive) { nameIsFocused = false; model.discardCurrentDraft() }
        } message: { Text("This removes this unfinished scan and its files from your iPhone.") }
    }
}

/// Local viewer only; all geometry stays in RoomPlan's capture frame. USDZ is
/// preferred, with a measured-box preview available immediately or after recovery.
struct RoomPreview: UIViewRepresentable {
    let scan: RawRoomScan
    let previewURL: URL?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.backgroundColor = .secondarySystemBackground
        view.allowsCameraControl = true
        view.autoenablesDefaultLighting = true
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        let key = scan.scanId.uuidString + (previewURL?.path ?? "measured")
        guard context.coordinator.key != key else { return }
        context.coordinator.key = key
        let scene = previewURL.flatMap { try? SCNScene(url: $0, options: nil) } ?? measuredScene()
        let bounds = scene.rootNode.boundingBox
        let center = SCNVector3((bounds.min.x + bounds.max.x) / 2,
                                (bounds.min.y + bounds.max.y) / 2,
                                (bounds.min.z + bounds.max.z) / 2)
        let extent = max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y,
                         bounds.max.z - bounds.min.z, 2)
        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.zNear = 0.01
        camera.camera?.zFar = 1000
        camera.position = SCNVector3(center.x + extent, center.y + extent, center.z + extent)
        camera.look(at: center)
        scene.rootNode.addChildNode(camera)
        view.scene = scene
        view.pointOfView = camera
        view.defaultCameraController.target = center
    }

    private func measuredScene() -> SCNScene {
        let scene = SCNScene()
        for surface in scan.walls + scan.floors {
            addBox(to: scene, dimensions: surface.dimensions, transform: surface.transform,
                   color: UIColor.systemGray.withAlphaComponent(surface.category == "wall" ? 0.25 : 0.5))
        }
        for surface in scan.doors + scan.windows + scan.openings {
            addBox(to: scene, dimensions: surface.dimensions, transform: surface.transform,
                   color: UIColor.systemTeal.withAlphaComponent(0.6))
        }
        for object in scan.objects {
            addBox(to: scene, dimensions: object.dimensions, transform: object.transform,
                   color: UIColor.systemBlue.withAlphaComponent(0.8))
        }
        return scene
    }

    private func addBox(to scene: SCNScene, dimensions: [Double], transform: [Double], color: UIColor) {
        guard dimensions.count == 3, transform.count == 16,
              (dimensions + transform).allSatisfy({ $0.isFinite }) else { return }
        // Give zero-thickness measured surfaces visible thickness only in this viewer.
        let box = SCNBox(width: max(dimensions[0], 0.02), height: max(dimensions[1], 0.02),
                         length: max(dimensions[2], 0.02), chamferRadius: 0)
        let material = SCNMaterial()
        material.diffuse.contents = color
        material.isDoubleSided = true
        box.materials = [material]
        let node = SCNNode(geometry: box)
        let values: [Float] = transform.map { Float($0) }
        let c0 = SIMD4<Float>(values[0], values[1], values[2], values[3])
        let c1 = SIMD4<Float>(values[4], values[5], values[6], values[7])
        let c2 = SIMD4<Float>(values[8], values[9], values[10], values[11])
        let c3 = SIMD4<Float>(values[12], values[13], values[14], values[15])
        node.simdTransform = simd_float4x4(columns: (c0, c1, c2, c3))
        scene.rootNode.addChildNode(node)
    }

    final class Coordinator { var key: String? }
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

struct SignInView: View {
    @ObservedObject var cloud: ScanCloud
    var onDone: () -> Void
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password (6+ characters)", text: $password).textContentType(.password)
                }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                Section {
                    Button("Sign in") { run { try await cloud.signIn(email: email, password: password) } }
                    Button("Create account") { run { try await cloud.signUp(email: email, password: password) } }
                }
                .disabled(busy || email.isEmpty || password.count < 6)
                if busy { ProgressView() }
            }
            .navigationTitle("House account")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onDone) } }
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do { try await action(); onDone() } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
