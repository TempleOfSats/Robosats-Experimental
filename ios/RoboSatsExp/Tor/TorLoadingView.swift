import SwiftUI
import UIKit

struct TorLoadingView: View {
    let message: String
    let progress: Int
    let actualProgress: Int
    let stage: String
    let diagnosticReport: String
    let retry: () -> Void

    @State private var detailsOpen = false
    @State private var copied = false

    var body: some View {
        ZStack {
            Color(red: 0.043, green: 0.035, blue: 0.035)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.2), lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: CGFloat(max(progress, 8)) / 100)
                        .stroke(Color(red: 1, green: 0.698, blue: 0.247), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.4), value: progress)
                    loadingMark
                        .resizable()
                        .scaledToFit()
                        .frame(width: 116, height: 116)
                        .offset(x: -1, y: 15)
                }
                .frame(width: 152, height: 152)

                VStack(spacing: 10) {
                    Text("Preparing RoboSats")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.white)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.72))
                        .multilineTextAlignment(.center)
                    Text("\(progress)%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.62))
                }

                DisclosureGroup(isExpanded: $detailsOpen) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Tor bootstrap")
                            Spacer()
                            Text("\(actualProgress)%")
                                .monospacedDigit()
                        }
                        Text(stage)
                            .lineLimit(3)
                        Button {
                            UIPasteboard.general.string = diagnosticReport
                            copied = true
                        } label: {
                            Label(copied ? "Diagnostics copied" : "Copy diagnostics", systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(.bordered)
                    }
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.72))
                    .padding(.top, 10)
                } label: {
                    Text("Connection details")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.72))
                }
                .tint(Color(red: 1, green: 0.698, blue: 0.247))
                .frame(maxWidth: 360)

                if message.lowercased().contains("could not") {
                    Button("Try again", action: retry)
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 1, green: 0.698, blue: 0.247))
                        .foregroundStyle(Color(red: 0.13, green: 0.1, blue: 0.09))
                }
            }
            .padding(32)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Preparing RoboSats. \(message). \(progress) percent")
    }

    private static let packagedLoadingMark: UIImage = {
        if let url = AppResources.loadingMarkURL,
           let data = try? Data(contentsOf: url),
           let image = UIImage(data: data) {
            AppDiagnostics.shared.record("Assets", "Loading mark ready")
            return image
        }
        AppDiagnostics.shared.record("Assets", "Loading mark is unavailable")
        return UIImage(systemName: "bolt.fill") ?? UIImage()
    }()

    private var loadingMark: Image {
        Image(uiImage: Self.packagedLoadingMark)
    }
}
