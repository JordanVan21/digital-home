import SwiftUI

struct ScanFlowView: View {
    @StateObject private var model = ScanModel()
    @AppStorage("uploadURL") private var uploadURL = ""
    @AppStorage("uploadToken") private var uploadToken = ""
    @State private var stopRequested = false
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
                    Button("Start scan") { stopRequested = false; model.phase = .scanning }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                    settings
                }
            case .scanning, .processing:
                ZStack(alignment: .bottom) {
                    RoomCaptureViewRepresentable(stopRequested: $stopRequested,
                                                 onResult: { model.didFinishCapture($0) },
                                                 onError: { model.captureFailed($0) })
                        .ignoresSafeArea()
                    if model.phase == .scanning {
                        Button("Finish scan") { model.phase = .processing; stopRequested = true }
                            .buttonStyle(.borderedProminent).controlSize(.large).padding(.bottom, 32)
                    } else {
                        ProgressView("Building your room…").padding().background(.regularMaterial, in: Capsule()).padding(.bottom, 32)
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
                        Button("Share scan file (AirDrop)") { showShare = true }
                    }
                    Button("Scan again") { model.phase = .ready }
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
                    Button("Scan another room") { model.phase = .ready }
                }
            case .failed(let text):
                VStack(spacing: 16) {
                    message("Something went wrong", text)
                    Button("Try again") { model.retryFromReview() }.buttonStyle(.borderedProminent)
                    Button("Start over") { model.phase = .ready }
                }
            }
        }
        .padding()
        .task { await model.checkAvailability() }
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
