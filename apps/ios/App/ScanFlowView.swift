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
                    // Give RoomPlan its own bounds: overlays/insets can obscure its
                    // built-in miniature room preview near the bottom of the view.
                    VStack(spacing: 0) {
                        VStack(spacing: 8) {
                            HStack {
                                Button("Cancel") { showCancelConfirmation = true }
                                    .buttonStyle(.bordered)
                                Spacer()
                                Text("Room scan").font(.headline)
                                Spacer()
                                if model.phase == .scanning {
                                    Button("Finish scan") { model.finishCapture() }
                                        .buttonStyle(.borderedProminent)
                                } else {
                                    ProgressView().accessibilityLabel("Building your room")
                                }
                            }
                            Text(model.phase == .scanning
                                 ? "Move slowly. Cover every wall, door, window and furnishing."
                                 : "Building your room… Keep House open.")
                                .font(.footnote).multilineTextAlignment(.center)
                        }
                        .padding(.horizontal).padding(.vertical, 8)
                        .frame(maxWidth: .infinity).background(.regularMaterial)

                        RoomCaptureViewRepresentable(stopRequested: model.phase == .processing,
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
                        Text("Discarding removes this unfinished scan.")
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
