import SwiftUI
import WebKit

/// Hosts the Wakefire game (a self-contained WebGL build in Wakefire.html).
/// The game source lives in ../game-src; run `node build.mjs` there to regenerate the HTML.
struct ContentView: View {
    var body: some View {
        GameView()
            .ignoresSafeArea()
            .background(Color.black)
            #if os(macOS)
            .frame(minWidth: 960, minHeight: 560)
            #endif
    }
}

@MainActor
private func makeGameWebView() -> WKWebView {
    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = []
    #if !os(macOS)
    config.allowsInlineMediaPlayback = true
    #endif
    let webView = WKWebView(frame: .zero, configuration: config)
    #if !os(macOS)
    webView.scrollView.isScrollEnabled = false
    webView.scrollView.bounces = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    webView.isOpaque = false
    webView.backgroundColor = .black
    #endif
    if let url = Bundle.main.url(forResource: "Wakefire", withExtension: "html") {
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
    return webView
}

#if os(macOS)
struct GameView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let webView = makeGameWebView()
        // Give the game keyboard focus as soon as the window is up.
        DispatchQueue.main.async { webView.window?.makeFirstResponder(webView) }
        return webView
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
struct GameView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeGameWebView() }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif

#Preview {
    ContentView()
}
