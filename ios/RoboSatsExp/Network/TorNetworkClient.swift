import CryptoKit
import Foundation

@MainActor
protocol TorNetworkClientDelegate: AnyObject {
    func networkClient(_ client: TorNetworkClient, socketOpened id: String, protocolName: String)
    func networkClient(_ client: TorNetworkClient, socket id: String, received message: String)
    func networkClient(_ client: TorNetworkClient, socketClosed id: String, code: Int, reason: String)
    func networkClient(_ client: TorNetworkClient, socketFailed id: String, message: String)
}

final class TorNetworkClient: @unchecked Sendable {
    static let shared = TorNetworkClient()

    nonisolated(unsafe) weak var delegate: TorNetworkClientDelegate?

    private let lock = NSLock()
    private var socksPort: Int?
    private var sockets: [String: TorWebSocket] = [:]
    private var socketsWithMessages = Set<String>()

    func activate(port: Int) {
        deactivate()
        guard (1...65_535).contains(port) else { return }
        lock.withLock { socksPort = port }
    }

    func deactivate() {
        let activeSockets = lock.withLock { () -> [TorWebSocket] in
            let values = Array(sockets.values)
            sockets.removeAll()
            socketsWithMessages.removeAll()
            socksPort = nil
            return values
        }
        activeSockets.forEach { $0.close(code: 1001, reason: "Tor transport stopped", notify: false) }
    }

    func request(
        method: String,
        url: String,
        headers: [String: String],
        body: String,
        completion: @escaping @Sendable (Result<[String: Any], Error>) -> Void
    ) {
        guard let port = lock.withLock({ socksPort }) else {
            completion(.failure(NativeTransportError.unavailable))
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let response = try TorHTTP.perform(
                    method: method,
                    rawURL: url,
                    headers: headers,
                    body: Data(body.utf8),
                    socksPort: port
                )
                completion(.success(response))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func openSocket(id: String, url: String, protocols: [String]) {
        guard let port = lock.withLock({ socksPort }) else {
            emit { $0.networkClient(self, socketFailed: id, message: NativeTransportError.unavailable.localizedDescription) }
            return
        }

        let socket = TorWebSocket(
            id: id,
            rawURL: url,
            protocols: protocols,
            socksPort: port,
            opened: { [weak self] protocolName in self?.socketOpened(id: id, protocolName: protocolName) },
            received: { [weak self] message in self?.socketReceived(id: id, message: message) },
            closed: { [weak self] code, reason in self?.socketClosed(id: id, code: code, reason: reason) },
            failed: { [weak self] message in self?.socketFailed(id: id, message: message) }
        )

        let previous = lock.withLock { sockets.updateValue(socket, forKey: id) }
        previous?.close(code: 1001, reason: "Socket replaced", notify: false)
        AppDiagnostics.shared.record("Network", "Opening relay socket")
        socket.open()
    }

    func sendSocket(id: String, message: String) -> Bool {
        guard let socket = lock.withLock({ sockets[id] }) else { return false }
        return socket.send(message)
    }

    func closeSocket(id: String, code: Int, reason: String) {
        let socket = lock.withLock { sockets[id] }
        socket?.close(code: code, reason: reason, notify: true)
    }

    private func socketOpened(id: String, protocolName: String) {
        guard lock.withLock({ sockets[id] != nil }) else { return }
        AppDiagnostics.shared.record("Network", "Relay socket opened")
        emit { $0.networkClient(self, socketOpened: id, protocolName: protocolName) }
    }

    private func socketReceived(id: String, message: String) {
        let state = lock.withLock { () -> (exists: Bool, firstMessage: Bool) in
            guard sockets[id] != nil else { return (false, false) }
            return (true, socketsWithMessages.insert(id).inserted)
        }
        guard state.exists else { return }
        if state.firstMessage {
            AppDiagnostics.shared.record("Network", "Relay delivered its first message")
        }
        emit { $0.networkClient(self, socket: id, received: message) }
    }

    private func socketClosed(id: String, code: Int, reason: String) {
        guard lock.withLock({
            socketsWithMessages.remove(id)
            return sockets.removeValue(forKey: id) != nil
        }) else { return }
        emit { $0.networkClient(self, socketClosed: id, code: code, reason: reason) }
    }

    private func socketFailed(id: String, message: String) {
        guard lock.withLock({
            socketsWithMessages.remove(id)
            return sockets.removeValue(forKey: id) != nil
        }) else { return }
        AppDiagnostics.shared.record("Network", "Relay socket failed: \(message)")
        emit { $0.networkClient(self, socketFailed: id, message: message) }
    }

    private func emit(_ event: @escaping @MainActor @Sendable (TorNetworkClientDelegate) -> Void) {
        Task { @MainActor [weak self] in
            guard let self, let delegate = self.delegate else { return }
            event(delegate)
        }
    }
}

private enum TorHTTP {
    static func perform(
        method: String,
        rawURL: String,
        headers: [String: String],
        body: Data,
        socksPort: Int
    ) throws -> [String: Any] {
        let destination = try StreamDestination(rawURL: rawURL, allowedSchemes: ["http", "https"])
        let connection = try SOCKSStreamConnection(destination: destination, socksPort: socksPort)
        defer { connection.close() }

        var requestHeaders = sanitized(headers)
        requestHeaders["Host"] = destination.hostHeader
        requestHeaders["Connection"] = "close"
        requestHeaders["Accept-Encoding"] = "identity"
        if !body.isEmpty { requestHeaders["Content-Length"] = String(body.count) }

        let verb = method.uppercased()
        guard verb.range(of: "^[A-Z]{1,16}$", options: .regularExpression) != nil else {
            throw NativeTransportError.invalidRequest
        }

        var request = Data("\(verb) \(destination.requestTarget) HTTP/1.1\r\n".utf8)
        for (name, value) in requestHeaders.sorted(by: { $0.key.lowercased() < $1.key.lowercased() }) {
            request.append(Data("\(name): \(value)\r\n".utf8))
        }
        request.append(Data("\r\n".utf8))
        request.append(body)
        try connection.write(request)

        let responseData = try connection.readToEnd(maximumBytes: 16 * 1_024 * 1_024)
        let parsed = try HTTPResponse.parse(responseData)
        return [
            "status": parsed.status,
            "headers": parsed.headers,
            "body": String(data: parsed.body, encoding: .utf8) ?? ""
        ]
    }

    private static func sanitized(_ headers: [String: String]) -> [String: String] {
        headers.reduce(into: [:]) { result, entry in
            let name = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
            let value = entry.value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard name.range(of: "^[A-Za-z0-9-]{1,64}$", options: .regularExpression) != nil,
                  !["host", "content-length", "connection", "accept-encoding"].contains(name.lowercased()),
                  !value.contains("\r"), !value.contains("\n") else { return }
            result[name] = value
        }
    }
}

private struct HTTPResponse {
    let status: Int
    let headers: [String: String]
    let body: Data

    static func parse(_ data: Data) throws -> HTTPResponse {
        guard let boundary = data.range(of: Data("\r\n\r\n".utf8)),
              let headerText = String(data: data[..<boundary.lowerBound], encoding: .utf8) else {
            throw NativeTransportError.invalidResponse
        }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let statusLine = lines.first else { throw NativeTransportError.invalidResponse }
        let statusParts = statusLine.split(separator: " ", maxSplits: 2)
        guard statusParts.count >= 2, let status = Int(statusParts[1]) else {
            throw NativeTransportError.invalidResponse
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { continue }
            let name = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
            if let existing = headers[name] {
                headers[name] = "\(existing), \(value)"
            } else {
                headers[name] = value
            }
        }

        let rawBody = Data(data[boundary.upperBound...])
        let body: Data
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
            body = try decodeChunked(rawBody)
        } else if let rawLength = headers["content-length"], let length = Int(rawLength), length >= 0 {
            guard rawBody.count >= length else { throw NativeTransportError.invalidResponse }
            body = Data(rawBody.prefix(length))
        } else {
            body = rawBody
        }
        return HTTPResponse(status: status, headers: headers, body: body)
    }

    private static func decodeChunked(_ data: Data) throws -> Data {
        var cursor = data.startIndex
        var output = Data()
        while true {
            guard let lineEnd = data[cursor...].range(of: Data("\r\n".utf8)) else {
                throw NativeTransportError.invalidResponse
            }
            let sizeData = data[cursor..<lineEnd.lowerBound]
            guard let sizeLine = String(data: sizeData, encoding: .ascii),
                  let sizeToken = sizeLine.split(separator: ";", maxSplits: 1).first,
                  let size = Int(sizeToken.trimmingCharacters(in: .whitespaces), radix: 16),
                  size >= 0 else { throw NativeTransportError.invalidResponse }
            cursor = lineEnd.upperBound
            if size == 0 { return output }
            guard data.distance(from: cursor, to: data.endIndex) >= size + 2 else {
                throw NativeTransportError.invalidResponse
            }
            let chunkEnd = data.index(cursor, offsetBy: size)
            output.append(data[cursor..<chunkEnd])
            guard data[chunkEnd..<data.index(chunkEnd, offsetBy: 2)] == Data("\r\n".utf8) else {
                throw NativeTransportError.invalidResponse
            }
            cursor = data.index(chunkEnd, offsetBy: 2)
        }
    }
}

private final class TorWebSocket: @unchecked Sendable {
    typealias Opened = @Sendable (String) -> Void
    typealias Received = @Sendable (String) -> Void
    typealias Closed = @Sendable (Int, String) -> Void
    typealias Failed = @Sendable (String) -> Void

    private let id: String
    private let rawURL: String
    private let protocols: [String]
    private let socksPort: Int
    private let opened: Opened
    private let received: Received
    private let closed: Closed
    private let failed: Failed
    private let stateLock = NSLock()
    private var connection: SOCKSStreamConnection?
    private var active = true
    private var initialBuffer = Data()

    init(
        id: String,
        rawURL: String,
        protocols: [String],
        socksPort: Int,
        opened: @escaping Opened,
        received: @escaping Received,
        closed: @escaping Closed,
        failed: @escaping Failed
    ) {
        self.id = id
        self.rawURL = rawURL
        self.protocols = protocols.filter {
            $0.range(of: "^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$", options: .regularExpression) != nil
        }
        self.socksPort = socksPort
        self.opened = opened
        self.received = received
        self.closed = closed
        self.failed = failed
    }

    func open() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.run()
        }
    }

    func send(_ message: String) -> Bool {
        guard let connection = stateLock.withLock({ active ? self.connection : nil }) else { return false }
        do {
            try connection.write(webSocketFrame(opcode: 0x1, payload: Data(message.utf8)))
            return true
        } catch {
            finishFailure(error.localizedDescription)
            return false
        }
    }

    func close(code: Int, reason: String, notify: Bool) {
        let connection = stateLock.withLock { () -> SOCKSStreamConnection? in
            guard active else { return nil }
            active = false
            return self.connection
        }
        guard let connection else { return }
        var payload = Data()
        var wireCode = UInt16(clamping: code).bigEndian
        withUnsafeBytes(of: &wireCode) { payload.append(contentsOf: $0) }
        payload.append(Data(reason.prefix(123).utf8))
        try? connection.write(webSocketFrame(opcode: 0x8, payload: payload))
        connection.close()
        if notify { closed(code, reason) }
    }

    private func run() {
        do {
            let destination = try StreamDestination(rawURL: rawURL, allowedSchemes: ["ws", "wss"])
            let startedAt = ContinuousClock.now
            let connection = try SOCKSStreamConnection(destination: destination, socksPort: socksPort)
            AppDiagnostics.shared.record(
                "Network",
                "Relay Tor stream ready in \(Self.elapsedMilliseconds(since: startedAt))ms"
            )
            guard stateLock.withLock({ () -> Bool in
                guard active else { return false }
                self.connection = connection
                return true
            }) else {
                connection.close()
                return
            }

            let selectedProtocol = try handshake(connection: connection, destination: destination)
            AppDiagnostics.shared.record(
                "Network",
                "Relay WebSocket handshake ready in \(Self.elapsedMilliseconds(since: startedAt))ms"
            )
            opened(selectedProtocol)
            try readLoop(connection: connection)
        } catch {
            finishFailure(error.localizedDescription)
        }
    }

    private static func elapsedMilliseconds(since instant: ContinuousClock.Instant) -> Int {
        let duration = instant.duration(to: .now)
        return Int(duration.components.seconds * 1_000 + duration.components.attoseconds / 1_000_000_000_000_000)
    }

    private func handshake(connection: SOCKSStreamConnection, destination: StreamDestination) throws -> String {
        let keyData = randomBytes(count: 16)
        let key = keyData.base64EncodedString()
        var request = "GET \(destination.requestTarget) HTTP/1.1\r\n"
        request += "Host: \(destination.hostHeader)\r\n"
        request += "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        request += "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: \(key)\r\n"
        if !protocols.isEmpty { request += "Sec-WebSocket-Protocol: \(protocols.joined(separator: ", "))\r\n" }
        request += "\r\n"
        try connection.write(Data(request.utf8))

        let response = try connection.readUntil(Data("\r\n\r\n".utf8), maximumBytes: 64 * 1_024)
        initialBuffer = response.remainder
        guard let headerText = String(data: response.prefix, encoding: .utf8) else {
            throw NativeTransportError.invalidWebSocketHandshake
        }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let statusLine = lines.first, statusLine.contains(" 101 ") else {
            throw NativeTransportError.invalidWebSocketHandshake
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { continue }
            headers[line[..<separator].lowercased()] = line[line.index(after: separator)...]
                .trimmingCharacters(in: .whitespaces)
        }
        let expected = Data(Insecure.SHA1.hash(data: Data("\(key)258EAFA5-E914-47DA-95CA-C5AB0DC85B11".utf8)))
            .base64EncodedString()
        guard headers["sec-websocket-accept"] == expected else {
            throw NativeTransportError.invalidWebSocketHandshake
        }
        let selected = headers["sec-websocket-protocol"] ?? ""
        guard selected.isEmpty || protocols.contains(selected) else {
            throw NativeTransportError.invalidWebSocketHandshake
        }
        return selected
    }

    private func readLoop(connection: SOCKSStreamConnection) throws {
        var fragmentedOpcode: UInt8?
        var fragmentedPayload = Data()
        while stateLock.withLock({ active }) {
            let first = try readExactly(2, connection: connection)
            let final = first[0] & 0x80 != 0
            let opcode = first[0] & 0x0f
            let masked = first[1] & 0x80 != 0
            var length = UInt64(first[1] & 0x7f)
            if length == 126 {
                let bytes = try readExactly(2, connection: connection)
                length = UInt64(bytes[0]) << 8 | UInt64(bytes[1])
            } else if length == 127 {
                let bytes = try readExactly(8, connection: connection)
                length = bytes.reduce(0) { ($0 << 8) | UInt64($1) }
            }
            guard length <= 8 * 1_024 * 1_024 else { throw NativeTransportError.responseTooLarge }
            let mask = masked ? try readExactly(4, connection: connection) : Data()
            var payload = try readExactly(Int(length), connection: connection)
            if masked {
                for index in payload.indices { payload[index] ^= mask[index % 4] }
            }

            switch opcode {
            case 0x0:
                guard fragmentedOpcode != nil else { throw NativeTransportError.invalidWebSocketFrame }
                fragmentedPayload.append(payload)
                if final {
                    try deliver(opcode: fragmentedOpcode ?? 0x1, payload: fragmentedPayload)
                    fragmentedOpcode = nil
                    fragmentedPayload.removeAll(keepingCapacity: true)
                }
            case 0x1, 0x2:
                if final {
                    try deliver(opcode: opcode, payload: payload)
                } else {
                    fragmentedOpcode = opcode
                    fragmentedPayload = payload
                }
            case 0x8:
                let (code, reason) = closeDetails(payload)
                try? connection.write(webSocketFrame(opcode: 0x8, payload: payload))
                finishClosed(code: code, reason: reason)
                return
            case 0x9:
                try connection.write(webSocketFrame(opcode: 0xA, payload: payload))
            case 0xA:
                break
            default:
                throw NativeTransportError.invalidWebSocketFrame
            }
        }
    }

    private func deliver(opcode: UInt8, payload: Data) throws {
        guard opcode == 0x1, let text = String(data: payload, encoding: .utf8) else {
            if opcode == 0x2 { return }
            throw NativeTransportError.invalidWebSocketFrame
        }
        received(text)
    }

    private func readExactly(_ count: Int, connection: SOCKSStreamConnection) throws -> Data {
        if count == 0 { return Data() }
        while initialBuffer.count < count {
            initialBuffer.append(try connection.read(maximumBytes: max(4_096, count - initialBuffer.count)))
        }
        let result = Data(initialBuffer.prefix(count))
        initialBuffer.removeFirst(count)
        return result
    }

    private func finishClosed(code: Int, reason: String) {
        let connection = stateLock.withLock { () -> SOCKSStreamConnection? in
            guard active else { return nil }
            active = false
            return self.connection
        }
        connection?.close()
        if connection != nil { closed(code, reason) }
    }

    private func finishFailure(_ message: String) {
        let connection = stateLock.withLock { () -> SOCKSStreamConnection? in
            guard active else { return nil }
            active = false
            return self.connection
        }
        connection?.close()
        if connection != nil || stateLock.withLock({ self.connection == nil }) { failed(message) }
    }

    private func closeDetails(_ payload: Data) -> (Int, String) {
        guard payload.count >= 2 else { return (1000, "") }
        let code = Int(UInt16(payload[0]) << 8 | UInt16(payload[1]))
        return (code, String(data: payload.dropFirst(2), encoding: .utf8) ?? "")
    }
}

private final class SOCKSStreamConnection: @unchecked Sendable {
    private let input: InputStream
    private let output: OutputStream
    private let writeLock = NSLock()
    private let closeLock = NSLock()
    private var isClosed = false

    init(destination: StreamDestination, socksPort: Int) throws {
        var inputStream: InputStream?
        var outputStream: OutputStream?
        let streamHost = destination.usesTLS ? destination.host : "127.0.0.1"
        let streamPort = destination.usesTLS ? destination.port : socksPort
        Stream.getStreamsToHost(withName: streamHost, port: streamPort, inputStream: &inputStream, outputStream: &outputStream)
        guard let inputStream, let outputStream else { throw NativeTransportError.unavailable }
        input = inputStream
        output = outputStream

        if destination.usesTLS {
            let proxy: [StreamSOCKSProxyConfiguration: Any] = [
                .hostKey: "127.0.0.1",
                .portKey: socksPort,
                .versionKey: StreamSOCKSProxyVersion.version5
            ]
            guard input.setProperty(proxy, forKey: .socksProxyConfigurationKey),
                  output.setProperty(proxy, forKey: .socksProxyConfigurationKey) else {
                throw NativeTransportError.unavailable
            }
            guard input.setProperty(StreamSocketSecurityLevel.negotiatedSSL, forKey: .socketSecurityLevelKey),
                  output.setProperty(StreamSocketSecurityLevel.negotiatedSSL, forKey: .socketSecurityLevelKey) else {
                throw NativeTransportError.unavailable
            }
        }
        input.open()
        output.open()
        try waitUntilOpen(timeout: 30)
        if !destination.usesTLS {
            try negotiateSOCKS5(host: destination.host, port: destination.port)
        }
    }

    func write(_ data: Data) throws {
        try writeLock.withLock {
            var offset = 0
            try data.withUnsafeBytes { rawBuffer in
                guard let base = rawBuffer.bindMemory(to: UInt8.self).baseAddress else { return }
                while offset < data.count {
                    if let error = output.streamError { throw error }
                    let count = output.write(base.advanced(by: offset), maxLength: data.count - offset)
                    if count < 0 { throw output.streamError ?? NativeTransportError.connectionClosed }
                    if count == 0 {
                        Thread.sleep(forTimeInterval: 0.005)
                    } else {
                        offset += count
                    }
                }
            }
        }
    }

    func read(maximumBytes: Int) throws -> Data {
        var buffer = [UInt8](repeating: 0, count: maximumBytes)
        while true {
            if let error = input.streamError { throw error }
            let count = input.read(&buffer, maxLength: buffer.count)
            if count > 0 { return Data(buffer.prefix(count)) }
            if count < 0 { throw input.streamError ?? NativeTransportError.connectionClosed }
            if input.streamStatus == .atEnd || input.streamStatus == .closed {
                throw NativeTransportError.connectionClosed
            }
            Thread.sleep(forTimeInterval: 0.005)
        }
    }

    func readToEnd(maximumBytes: Int) throws -> Data {
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1_024)
        while true {
            if let error = input.streamError { throw error }
            let count = input.read(&buffer, maxLength: buffer.count)
            if count > 0 {
                guard result.count + count <= maximumBytes else { throw NativeTransportError.responseTooLarge }
                result.append(contentsOf: buffer.prefix(count))
            } else if count < 0 {
                throw input.streamError ?? NativeTransportError.connectionClosed
            } else if input.streamStatus == .atEnd || input.streamStatus == .closed {
                return result
            } else {
                Thread.sleep(forTimeInterval: 0.005)
            }
        }
    }

    func readUntil(_ delimiter: Data, maximumBytes: Int) throws -> (prefix: Data, remainder: Data) {
        var result = Data()
        while result.count <= maximumBytes {
            result.append(try read(maximumBytes: 4_096))
            if let range = result.range(of: delimiter) {
                return (Data(result[..<range.lowerBound]), Data(result[range.upperBound...]))
            }
        }
        throw NativeTransportError.responseTooLarge
    }

    func close() {
        let shouldClose = closeLock.withLock { () -> Bool in
            guard !isClosed else { return false }
            isClosed = true
            return true
        }
        if shouldClose {
            input.close()
            output.close()
        }
    }

    private func waitUntilOpen(timeout: TimeInterval) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let error = input.streamError ?? output.streamError { throw error }
            if output.hasSpaceAvailable || output.streamStatus == .open || output.streamStatus == .writing {
                return
            }
            if [.error, .closed].contains(input.streamStatus) || [.error, .closed].contains(output.streamStatus) {
                throw NativeTransportError.connectionClosed
            }
            Thread.sleep(forTimeInterval: 0.01)
        }
        throw NativeTransportError.timeout
    }

    private func negotiateSOCKS5(host: String, port: Int) throws {
        try write(Data([0x05, 0x01, 0x00]))
        guard try readExactly(2) == Data([0x05, 0x00]) else {
            throw NativeTransportError.socksNegotiationFailed
        }

        let hostBytes = Data(host.utf8)
        guard !hostBytes.isEmpty, hostBytes.count <= 255 else {
            throw NativeTransportError.invalidRequest
        }
        var request = Data([0x05, 0x01, 0x00, 0x03, UInt8(hostBytes.count)])
        request.append(hostBytes)
        request.append(UInt8((port >> 8) & 0xff))
        request.append(UInt8(port & 0xff))
        try write(request)

        let response = try readExactly(4)
        guard response[0] == 0x05, response[1] == 0x00 else {
            throw NativeTransportError.socksNegotiationFailed
        }
        switch response[3] {
        case 0x01:
            _ = try readExactly(6)
        case 0x03:
            let length = Int(try readExactly(1)[0])
            _ = try readExactly(length + 2)
        case 0x04:
            _ = try readExactly(18)
        default:
            throw NativeTransportError.socksNegotiationFailed
        }
    }

    private func readExactly(_ count: Int) throws -> Data {
        var result = Data()
        while result.count < count {
            result.append(try read(maximumBytes: count - result.count))
        }
        return result
    }
}

private struct StreamDestination {
    let host: String
    let port: Int
    let requestTarget: String
    let hostHeader: String
    let usesTLS: Bool

    init(rawURL: String, allowedSchemes: Set<String>) throws {
        guard let components = URLComponents(string: rawURL),
              let scheme = components.scheme?.lowercased(),
              allowedSchemes.contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else {
            throw NativeTransportError.invalidRequest
        }
        let tls = scheme == "https" || scheme == "wss"
        let defaultPort = tls ? 443 : 80
        let port = components.port ?? defaultPort
        guard (1...65_535).contains(port) else { throw NativeTransportError.invalidRequest }
        self.host = host
        self.port = port
        usesTLS = tls
        let path = components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath
        requestTarget = components.percentEncodedQuery.map { "\(path)?\($0)" } ?? path
        let formattedHost = host.contains(":") ? "[\(host)]" : host
        hostHeader = port == defaultPort ? formattedHost : "\(formattedHost):\(port)"
    }
}

private func randomBytes(count: Int) -> Data {
    Data((0..<count).map { _ in UInt8.random(in: .min ... .max) })
}

private func webSocketFrame(opcode: UInt8, payload: Data) -> Data {
    var frame = Data([0x80 | opcode])
    let maskKey = randomBytes(count: 4)
    if payload.count < 126 {
        frame.append(0x80 | UInt8(payload.count))
    } else if payload.count <= Int(UInt16.max) {
        frame.append(0x80 | 126)
        var length = UInt16(payload.count).bigEndian
        withUnsafeBytes(of: &length) { frame.append(contentsOf: $0) }
    } else {
        frame.append(0x80 | 127)
        var length = UInt64(payload.count).bigEndian
        withUnsafeBytes(of: &length) { frame.append(contentsOf: $0) }
    }
    frame.append(maskKey)
    for (index, byte) in payload.enumerated() { frame.append(byte ^ maskKey[index % 4]) }
    return frame
}

private enum NativeTransportError: LocalizedError {
    case unavailable
    case invalidRequest
    case invalidResponse
    case invalidWebSocketHandshake
    case invalidWebSocketFrame
    case connectionClosed
    case responseTooLarge
    case timeout
    case socksNegotiationFailed

    var errorDescription: String? {
        switch self {
        case .unavailable: "Tor transport is not ready"
        case .invalidRequest: "The destination is not valid"
        case .invalidResponse: "The Tor request returned an invalid response"
        case .invalidWebSocketHandshake: "The relay rejected the secure WebSocket handshake"
        case .invalidWebSocketFrame: "The relay returned an invalid WebSocket message"
        case .connectionClosed: "The Tor connection closed unexpectedly"
        case .responseTooLarge: "The Tor response exceeded the safety limit"
        case .timeout: "The Tor connection took too long"
        case .socksNegotiationFailed: "Tor could not open the private destination"
        }
    }
}
