import SwiftUI

struct ScanFlowView: View {
    @StateObject private var model = ScanModel()
    @AppStorage("uploadURL") private var uploadURL = ""
    @AppStorage("uploadToken") private var uploadToken = ""
    @Environment(\.scenePhase) private var scenePhase
    @State private var showCancelConfirmation = false
    @State private var showShare = false

    var body: some View {
        ZStack {
            switch model.phase {
            case .checking:
                ProgressView("Checking your iPhone…")
            case .unsupported:
                message("Room scanning isn't available on this iPhone",
                        "House needs an iPhone or iPad with a LiDAR scanner (Pro models). You can still design with the demo room on desktop.")
            case .cameraDenied:
                VStack(spacing: 16) {
                    message("Camera access is off", "House uses the camera and LiDAR to measure your room. Turn camera access on in Settings.")
                    Button("Open Settings") { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
                        .buttonStyle(.borderedProminent)
                }
            case .ready:
                VStack(spacing: 20) {
                    message("Scan your room", "Walk slowly around the room's edges, pointing the camera at walls, doors, windows and furniture. Finish where you started.")
                    Button("Start scan") { model.startCapture() }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                    settings
                }
            case .scanning, .processing:
                if let captureID = model.captureID {
                    RoomCaptureViewRepresentable(stopRequested: model.phase == .processing,
                                                 onResult: { model.didFinishCapture($0, captureID: captureID) },
                                                 onError: { model.captureFailed($0, captureID: captureID) })
                        .id(captureID)
                        .ignoresSafeArea()
                        .safeAreaInset(edge: .top) {
                            HStack {
                                Text("Single room").font(.headline)
                                Spacer()
                                Button("Cancel", role: .cancel) { showCancelConfirmation = true }
                                    .buttonStyle(.bordered)
                            }
                            .padding().background(.regularMaterial)
                        }
                        .safeAreaInset(edge: .bottom) {
                            VStack(spacing: 12) {
                                if model.phase == .scanning {
                                    Text("Walk slowly. Scan every wall, then doors, windows and furniture. Finish where you started.")
                                        .font(.callout).multilineTextAlignment(.center)
                                    Button("Finish scan") { model.finishCapture() }
                                        .buttonStyle(.borderedProminent).controlSize(.large)
                                } else {
                                    ProgressView("Building your room…")
                                    Text("Keep House open while your scan is processed.").font(.caption)
                                }
                            }
                            .frame(maxWidth: .infinity).padding().background(.regularMaterial)
                        }
                        .confirmationDialog("Discard this unfinished scan?", isPresented: $showCancelConfirmation,
                                            titleVisibility: .visible) {
                            Button("Discard scan", role: .destructive) { model.cancelCapture() }
                            Button("Keep scanning", role: .cancel) {}
                        }
                }
            case .review(let summary, let hint, let uploadable):
                VStack(spacing: 16) {
                    Text("Scan complete").font(.title2.bold())
                    Text(summary).foregroundStyle(.secondary)
                    if let hint { Text(hint).font(.callout).multilineTextAlignment(.center).foregroundStyle(uploadable ? .orange : .red) }
                    if uploadable {
                        Button("Upload to desktop") { Task { await model.upload(to: uploadURL, token: uploadToken) } }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .disabled(uploadURL.isEmpty)
                    }
                    // Even incomplete scans are useful for diagnosis and must be shareable.
                    Button("Share scan file (AirDrop)") { showShare = true }
                        .disabled(model.exportURL == nil)
                    Button("Scan again") { model.returnToStart() }
                    settings
                }
                .padding()
                .sheet(isPresented: $showShare) { if let url = model.exportURL { ShareSheet(url: url) } }
            case .uploading(let p):
                ProgressView("Uploading…", value: p)
                    .padding()
            case .uploaded:
                VStack(spacing: 16) {
                    message("Uploaded", "Open House on your computer to see your room.")
                    Button("Scan another room") { model.returnToStart() }
                }
            case .failed(let text):
                VStack(spacing: 16) {
                    message("Something went wrong", text)
                    Button("Try again") { model.retryFromReview() }.buttonStyle(.borderedProminent)
                    Button("Start over") { model.returnToStart() }
                }
            }
        }
        .padding(model.isCapturing ? 0 : 20)
        .task { await model.checkAvailability() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.captureWasBackgrounded() }
            if phase == .active { Task { await model.checkAvailability() } }
        }
        .onChange(of: model.phase) { _, _ in
            if !model.isCapturing { showCancelConfirmation = false }
        }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Upload URL").font(.caption).foregroundStyle(.secondary)
            TextField("https://…/api/scans", text: $uploadURL)
                .textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
            SecureField("Access token (optional)", text: $uploadToken).textFieldStyle(.roundedBorder)
        }
    }

    private func message(_ title: String, _ body: String) -> some View {
        VStack(spacing: 8) {
            Text(title).font(.title2.bold()).multilineTextAlignment(.center)
            Text(body).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
