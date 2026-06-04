import { beforeEach, describe, expect, it } from "vitest";
import { readTrustedDevicesCache, writeTrustedDevicesCache } from "./trustedDeviceVault";

describe("trustedDeviceVault", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("round-trips trusted devices by base url", () => {
    const baseUrl = "http://127.0.0.1:41527";
    writeTrustedDevicesCache(baseUrl, [
      {
        id: "dev_001",
        name: "iPad",
        platform: "ios",
        permissions: ["view_window"],
        autoConnect: true,
        createdAt: "2026-06-05T00:00:00.000Z",
        lastConnectedAt: "2026-06-05T00:05:00.000Z",
        wol: {
          supported: true,
          macAddresses: ["AA:BB:CC:DD:EE:FF"],
          broadcastAddress: "192.168.1.255",
          port: 9
        }
      }
    ]);

    const devices = readTrustedDevicesCache(baseUrl);

    expect(devices).toHaveLength(1);
    expect(devices[0]?.wol?.broadcastAddress).toBe("192.168.1.255");
    expect(devices[0]?.name).toBe("iPad");
  });
});
