import SwiftUI
import AVKit
import Security

final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.originalRequest?.url, let target = request.url,
              original.scheme == target.scheme, original.host == target.host, original.port == target.port else { completionHandler(nil); return }
        completionHandler(request)
    }
}
struct TVTitle: Identifiable { let id: String; let title: String }
struct TVEpisode: Identifiable { let id: String; let title: String }
struct TVAudio: Identifiable { let id: Int; let title: String }
@MainActor final class TVModel: ObservableObject {
    @Published var server = UserDefaults.standard.string(forKey: "ioServer") ?? ""
    @Published var status = "Connect to your I/O server."
    @Published var titles: [TVTitle] = []
    @Published var episodes: [TVEpisode] = []
    @Published var selected: TVTitle?
    @Published var player: AVPlayer?
    @Published var paired = false
    @Published var nextOffset: Int?
    @Published var query = ""
    @Published var quality = "720"
    @Published var audio = -1
    @Published var audioOptions: [TVAudio] = []
    @Published var pendingEpisode: TVEpisode?
    private let session = URLSession(configuration: .ephemeral, delegate: SameOriginRedirects(), delegateQueue: nil)
    private var connectionID = UUID()
    private var token = ""
    private var pairingTask: Task<Void, Never>?
    private var observer: Any?
    private var playingTitle = "", playingEpisode = ""
    private var offset: Double = 0

    func connect() async {
        connectionID = UUID(); pairingTask?.cancel()
        do {
            guard let url = URL(string: server.trimmingCharacters(in: .whitespacesAndNewlines)), let host = url.host,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/" else { throw failure("Enter the server address without a path") }
            let parts = host.split(separator: ".", omittingEmptySubsequences: false)
            let octets = parts.compactMap { Int($0) }
            let validIP = parts.count == 4 && octets.count == 4 && octets.allSatisfy { (0...255).contains($0) }
            let local = host == "localhost" || host == "127.0.0.1" || (validIP && (octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && (16...31).contains(octets[1]))))
            guard url.scheme == "https" || (url.scheme == "http" && local) else { throw failure("Use HTTPS for a public server") }
            server = String(server.trimmingCharacters(in: .whitespacesAndNewlines).dropLast(url.path == "/" ? 1 : 0))
            UserDefaults.standard.set(server, forKey: "ioServer")
            token = readToken()
            if token.isEmpty { await pair() } else { paired = true; await catalog() }
        } catch { status = error.localizedDescription }
    }
    func failure(_ message: String) -> NSError { NSError(domain: "IOTV", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func api(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> [String: Any] {
        let expectedConnection = connectionID, origin = server
        guard let url = URL(string: origin + path) else { throw failure("Invalid server address") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 30
        if !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard expectedConnection == connectionID, origin == server, !Task.isCancelled else { throw CancellationError() }
        guard data.count < 2 * 1024 * 1024, let http = response as? HTTPURLResponse,
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw failure("Invalid server response") }
        guard (200..<300).contains(http.statusCode) else { throw failure(result["error"] as? String ?? "Please pair this TV again") }
        return result
    }
    func pair() async {
        pairingTask?.cancel(); paired = false
        do {
            let result = try await api("/api/tv-native/pair/start", method: "POST", body: ["name": "Apple TV"])
            guard let code = result["code"] as? String, let secret = result["pollSecret"] as? String else { throw failure("Invalid pairing response") }
            status = "On your signed-in phone or computer, open:\n\(server)/#/tv-pair/\(code)\n\nCode: \(code)\nExpires in five minutes."
            pairingTask = Task { [weak self] in
                for _ in 0..<100 {
                    do {
                        try await Task.sleep(nanoseconds: 3_000_000_000)
                        guard let self, !Task.isCancelled else { return }
                        let grant = try await self.api("/api/tv-native/pair/poll", method: "POST", body: ["code": code, "pollSecret": secret])
                        if grant["status"] as? String == "approved", let token = grant["token"] as? String {
                            self.token = token; try self.saveToken(token); self.paired = true; await self.catalog(); return
                        }
                    } catch { if !Task.isCancelled { self?.status = error.localizedDescription }; return }
                }
                self?.status = "Pairing expired. Connect again to get a new code."
            }
        } catch { status = error.localizedDescription }
    }
    func catalog(offset: Int = 0) async {
        do {
            selected = nil; pendingEpisode = nil; episodes = []
            var allowed = CharacterSet.urlQueryAllowed; allowed.remove(charactersIn: "&+=?#")
            let data = try await api("/api/tv-native/catalog?offset=\(offset)&q=\(query.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")")
            titles = (data["items"] as? [[String: Any]] ?? []).compactMap { r in guard let id = r["id"] as? String, let title = r["title"] as? String else { return nil }; return TVTitle(id: id, title: title) }
            nextOffset = data["nextOffset"] as? Int; status = "Profile: " + (data["profileName"] as? String ?? "")
        } catch { status = error.localizedDescription }
    }
    func detail(_ title: TVTitle) async {
        do {
            let data = try await api("/api/tv-native/title/" + title.id)
            selected = title; status = data["description"] as? String ?? ""
            episodes = (data["episodes"] as? [[String: Any]] ?? []).compactMap { r in guard let path = r["path"] as? String else { return nil }; return TVEpisode(id: path, title: (r["group"] as? String ?? "") + " · " + (r["title"] as? String ?? path)) }
        } catch { status = error.localizedDescription }
    }
    func options(_ episode: TVEpisode) async {
        guard let title = selected else { return }
        do {
            var allowed = CharacterSet.urlQueryAllowed; allowed.remove(charactersIn: "&+=?#")
            let id = title.id.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
            let ep = episode.id.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
            let data = try await api("/api/tv-native/playback-options?id=" + id + "&episode=" + ep)
            audioOptions = (data["audio"] as? [[String: Any]] ?? []).compactMap { r in guard let index = r["index"] as? Int else { return nil }; return TVAudio(id: index, title: (r["language"] as? String ?? "und") + " · " + (r["title"] as? String ?? "")) }
            audio = -1; pendingEpisode = episode
        } catch { status = error.localizedDescription }
    }
    func play(_ episode: TVEpisode) async {
        guard let title = selected else { return }
        do {
            let info = try await api("/api/tv-native/title/" + title.id), progress = info["progress"] as? [String: Any]
            let resume = progress?["episode"] as? String == episode.id ? (progress?["seconds"] as? Double ?? 0) : 0
            var playbackBody: [String: Any] = ["id": title.id, "episode": episode.id, "offset": resume, "quality": quality]
            if audio >= 0 { playbackBody["audio"] = audio }
            let data = try await api("/api/tv-native/play", method: "POST", body: playbackBody)
            guard let path = data["playlistUrl"] as? String, path.hasPrefix("/api/hls/"), let value = data["streamCookie"] as? String,
                  let url = URL(string: server + path), let host = url.host,
                  let cookie = HTTPCookie(properties: [.domain: host, .path: "/api/hls/", .name: "io_tv_stream", .value: value, .secure: url.scheme == "https" ? "TRUE" : "FALSE", .expires: Date().addingTimeInterval(21600)]) else { throw failure("Invalid stream response") }
            closePlayer(); playingTitle = title.id; playingEpisode = episode.id; offset = data["startOffsetSeconds"] as? Double ?? 0
            let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: [cookie]])
            let current = AVPlayer(playerItem: AVPlayerItem(asset: asset)); player = current
            observer = current.addPeriodicTimeObserver(forInterval: CMTime(seconds: 15, preferredTimescale: 600), queue: .main) { [weak self] _ in Task { @MainActor in await self?.saveProgress() } }
            pendingEpisode = nil; current.play()
        } catch { status = error.localizedDescription }
    }
    func saveProgress() async {
        guard let player else { return }; let position = player.currentTime().seconds, duration = player.currentItem?.duration.seconds ?? 0
        guard position.isFinite, duration.isFinite, duration > 0 else { return }
        _ = try? await api("/api/tv-native/progress", method: "PUT", body: ["id": playingTitle, "episode": playingEpisode, "seconds": offset + position, "duration": offset + max(position, duration)])
    }
    func closePlayer() { if let player { player.pause(); if let observer { player.removeTimeObserver(observer) } }; observer = nil; player = nil }
    func disconnect() { connectionID = UUID(); pairingTask?.cancel(); closePlayer(); token = ""; paired = false; titles = []; selected = nil; SecItemDelete(keychainQuery() as CFDictionary); status = "Connect to pair this TV." }
    private func keychainQuery() -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.io.tv", kSecAttrAccount as String: server] }
    private func readToken() -> String { var q = keychainQuery(); q[kSecReturnData as String] = true; var data: CFTypeRef?; guard SecItemCopyMatching(q as CFDictionary, &data) == errSecSuccess, let bytes = data as? Data else { return "" }; return String(data: bytes, encoding: .utf8) ?? "" }
    private func saveToken(_ token: String) throws { let q = keychainQuery(); SecItemDelete(q as CFDictionary); var entry = q; entry[kSecValueData as String] = Data(token.utf8); entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; guard SecItemAdd(entry as CFDictionary, nil) == errSecSuccess else { throw failure("Could not securely save TV pairing") } }
}

@main struct IOTVApp: App {
    @StateObject private var model = TVModel()
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("I/O TV").font(.largeTitle)
                        Text(model.status).font(.body)
                        if !model.paired {
                            TextField("I/O server address", text: $model.server).textInputAutocapitalization(.never)
                            Button("Connect") { Task { await model.connect() } }
                        } else if let selected = model.selected {
                            Text(selected.title).font(.title)
                            Button("Back to library") { Task { await model.catalog() } }
                            if let episode = model.pendingEpisode {
                                Text(episode.title)
                                Picker("Quality", selection: $model.quality) { ForEach(["original", "1080", "720", "480", "360"], id: \.self) { Text($0).tag($0) } }
                                Picker("Audio", selection: $model.audio) { Text("Default audio").tag(-1); ForEach(model.audioOptions) { Text($0.title).tag($0.id) } }
                                Button("Play") { Task { await model.play(episode) } }
                                Button("Choose another episode") { model.pendingEpisode = nil }
                            } else {
                                ForEach(model.episodes) { episode in Button(episode.title) { Task { await model.options(episode) } } }
                            }
                        } else {
                            TextField("Search library", text: $model.query)
                            Button("Search") { Task { await model.catalog() } }
                            ForEach(model.titles) { title in Button(title.title) { Task { await model.detail(title) } } }
                            if let offset = model.nextOffset { Button("Next page") { Task { await model.catalog(offset: offset) } } }
                            Button("Disconnect this TV") { model.disconnect() }
                        }
                    }.padding(60)
                }.background(Color(red: 0.06, green: 0.05, blue: 0.09))
            }.task { if !model.server.isEmpty { await model.connect() } }
             .fullScreenCover(isPresented: Binding(get: { model.player != nil }, set: { if !$0 { model.closePlayer() } })) {
                 if let player = model.player { VideoPlayer(player: player).ignoresSafeArea().onExitCommand { Task { await model.saveProgress(); model.closePlayer() } } }
             }
        }
    }
}
