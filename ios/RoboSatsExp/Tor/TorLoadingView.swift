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
            Color(red: 0.035, green: 0.043, blue: 0.063)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                ZStack {
                    Circle()
                        .stroke(Color(red: 0.208, green: 0.251, blue: 0.322), lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: CGFloat(max(progress, 8)) / 100)
                        .stroke(Color(red: 0.565, green: 0.792, blue: 0.976), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.4), value: progress)
                    loadingMark
                        .resizable()
                        .scaledToFit()
                        .frame(width: 116, height: 116)
                }
                .frame(width: 152, height: 152)

                VStack(spacing: 10) {
                    Text("Preparing RoboSats")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Color(red: 0.953, green: 0.965, blue: 0.98))
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(Color(red: 0.596, green: 0.651, blue: 0.718))
                        .multilineTextAlignment(.center)
                    Text("\(progress)%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Color(red: 0.596, green: 0.651, blue: 0.718))
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
                    .foregroundStyle(Color(red: 0.596, green: 0.651, blue: 0.718))
                    .padding(.top, 10)
                } label: {
                    Text("Connection details")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color(red: 0.596, green: 0.651, blue: 0.718))
                }
                .tint(Color(red: 0.565, green: 0.792, blue: 0.976))
                .frame(maxWidth: 360)

                if message.lowercased().contains("could not") {
                    Button("Try again", action: retry)
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.565, green: 0.792, blue: 0.976))
                        .foregroundStyle(Color(red: 0.031, green: 0.071, blue: 0.11))
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
