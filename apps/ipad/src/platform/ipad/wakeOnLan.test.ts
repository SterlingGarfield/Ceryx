import { describe, expect, it } from "vitest";
import { buildMagicPacket } from "./wakeOnLan";

describe("buildMagicPacket", () => {
  it("builds the 102-byte magic packet payload", () => {
    const packet = buildMagicPacket("AA:BB:CC:DD:EE:FF");

    expect(packet).toHaveLength(102);
    expect(Array.from(packet.slice(0, 6))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(Array.from(packet.slice(6, 12))).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect(Array.from(packet.slice(96, 102))).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });
});
