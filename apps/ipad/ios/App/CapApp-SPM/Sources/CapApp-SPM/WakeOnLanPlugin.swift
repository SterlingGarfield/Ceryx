import Capacitor
import Darwin
import Foundation

@objc(WakeOnLanPlugin)
public final class WakeOnLanPlugin: CAPPlugin {
    @objc public func send(_ call: CAPPluginCall) {
        do {
            let broadcastAddress = try requireString(call, "broadcastAddress")
            let port = try requirePort(call)
            let macAddresses = try requireMacAddresses(call)
            let repeatCount = max(call.getInt("repeatCount") ?? 3, 1)
            let repeatIntervalMs = max(call.getInt("repeatIntervalMs") ?? 100, 0)

            let sentCount = try Self.sendMagicPackets(
                macAddresses: macAddresses,
                broadcastAddress: broadcastAddress,
                port: port,
                repeatCount: repeatCount,
                repeatIntervalMs: repeatIntervalMs
            )

            call.resolve(["sentCount": sentCount])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    private static func sendMagicPackets(
        macAddresses: [String],
        broadcastAddress: String,
        port: Int,
        repeatCount: Int,
        repeatIntervalMs: Int
    ) throws -> Int {
        var sentCount = 0

        for iteration in 0..<repeatCount {
            for macAddress in macAddresses {
                let packet = try buildMagicPacket(macAddress)
                try sendPacket(packet, broadcastAddress: broadcastAddress, port: port)
                sentCount += 1
            }

            if iteration < repeatCount - 1 && repeatIntervalMs > 0 {
                Thread.sleep(forTimeInterval: Double(repeatIntervalMs) / 1000.0)
            }
        }

        return sentCount
    }

    private static func buildMagicPacket(_ macAddress: String) throws -> Data {
        let cleaned = macAddress.replacingOccurrences(
            of: "[^A-Fa-f0-9]",
            with: "",
            options: .regularExpression
        )

        guard cleaned.count == 12 else {
            throw WakeOnLanPluginError.invalidMacAddress(macAddress)
        }

        var bytes = [UInt8](repeating: 0xFF, count: 6)
        bytes.reserveCapacity(102)

        var macBytes = [UInt8]()
        macBytes.reserveCapacity(6)

        for index in stride(from: 0, to: cleaned.count, by: 2) {
            let start = cleaned.index(cleaned.startIndex, offsetBy: index)
            let end = cleaned.index(start, offsetBy: 2)
            guard let value = UInt8(cleaned[start..<end], radix: 16) else {
                throw WakeOnLanPluginError.invalidMacAddress(macAddress)
            }
            macBytes.append(value)
        }

        for _ in 0..<16 {
            bytes.append(contentsOf: macBytes)
        }

        return Data(bytes)
    }

    private static func sendPacket(_ packet: Data, broadcastAddress: String, port: Int) throws {
        let socketFd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard socketFd >= 0 else {
            throw WakeOnLanPluginError.socketCreationFailed(errno)
        }
        defer { close(socketFd) }

        var enableBroadcast: Int32 = 1
        let broadcastResult = withUnsafePointer(to: &enableBroadcast) { pointer in
            setsockopt(
                socketFd,
                SOL_SOCKET,
                SO_BROADCAST,
                pointer,
                socklen_t(MemoryLayout.size(ofValue: enableBroadcast))
            )
        }
        guard broadcastResult == 0 else {
            throw WakeOnLanPluginError.socketOptionFailed(errno)
        }

        var destination = sockaddr_in()
        destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        destination.sin_family = sa_family_t(AF_INET)
        destination.sin_port = in_port_t(port).bigEndian

        let inetResult = broadcastAddress.withCString { pointer in
            inet_pton(AF_INET, pointer, &destination.sin_addr)
        }
        guard inetResult == 1 else {
            throw WakeOnLanPluginError.invalidBroadcastAddress(broadcastAddress)
        }

        let sentBytes = packet.withUnsafeBytes { buffer in
            guard let baseAddress = buffer.baseAddress else {
                return -1
            }

            return withUnsafePointer(to: &destination) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                    sendto(
                        socketFd,
                        baseAddress,
                        buffer.count,
                        0,
                        sockaddrPointer,
                        socklen_t(MemoryLayout<sockaddr_in>.size)
                    )
                }
            }
        }

        guard sentBytes == packet.count else {
            throw WakeOnLanPluginError.packetSendFailed(errno)
        }
    }

    private func requireString(_ call: CAPPluginCall, _ key: String) throws -> String {
        guard let value = call.getString(key), !value.isEmpty else {
            throw WakeOnLanPluginError.missingField(key)
        }

        return value
    }

    private func requirePort(_ call: CAPPluginCall) throws -> Int {
        guard let port = call.getInt("port"), (1...65535).contains(port) else {
            throw WakeOnLanPluginError.invalidPort
        }

        return port
    }

    private func requireMacAddresses(_ call: CAPPluginCall) throws -> [String] {
        guard let values = call.getArray("macAddresses") else {
            throw WakeOnLanPluginError.missingField("macAddresses")
        }

        let macAddresses = values.compactMap { $0 as? String }.filter { !$0.isEmpty }
        guard !macAddresses.isEmpty else {
            throw WakeOnLanPluginError.missingField("macAddresses")
        }

        return macAddresses
    }
}

private enum WakeOnLanPluginError: LocalizedError {
    case missingField(String)
    case invalidPort
    case invalidMacAddress(String)
    case invalidBroadcastAddress(String)
    case socketCreationFailed(Int32)
    case socketOptionFailed(Int32)
    case packetSendFailed(Int32)

    var errorDescription: String? {
        switch self {
        case .missingField(let field):
            return "\(field) is required."
        case .invalidPort:
            return "port must be between 1 and 65535."
        case .invalidMacAddress(let value):
            return "Invalid MAC address: \(value)."
        case .invalidBroadcastAddress(let value):
            return "Invalid broadcast address: \(value)."
        case .socketCreationFailed(let errnoValue):
            return "Failed to create UDP socket: errno \(errnoValue)."
        case .socketOptionFailed(let errnoValue):
            return "Failed to configure UDP socket: errno \(errnoValue)."
        case .packetSendFailed(let errnoValue):
            return "Failed to send Wake-on-LAN packet: errno \(errnoValue)."
        }
    }
}
