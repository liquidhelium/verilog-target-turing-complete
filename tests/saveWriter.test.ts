import { describe, expect, it } from "vitest";
import { uncompress } from "snappy";
import {
  ComponentKind,
  ComponentRotation,
  WireColor,
  WireKind,
  defaultSavePayload,
  defaultComponent,
  TCSaveWriter,
  TCSynced,
} from "../src/index.js";

describe("TCSaveWriter", () => {
  it("produces a valid header and payload", async () => {
    const payload = defaultSavePayload({
      saveId: 1n,
      hubId: 2,
      gate: 3n,
      delay: 4n,
      menuVisible: true,
      clockSpeed: 5,
      description: "Unit Test",
      cameraPosition: { x: 10, y: -4 },
      synced: TCSynced.Unsynced,
      campaignBound: false,
      hubDescription: "",
      components: [
        defaultComponent({
          kind: ComponentKind.And,
          position: { x: 0, y: 0 },
          rotation: ComponentRotation.Rot90,
          permanentId: 123n,
        }),
      ],
      wires: [
        {
          kind: WireKind.Wk1,
          color: WireColor.Default,
          comment: "",
          path: { start: { x: 0, y: 0 }, body: [0] },
        },
      ],
    });

    const writer = new TCSaveWriter(payload);
    const { saveFile, uncompressed } = await writer.build();

    expect(saveFile[0]).toBe(6);
    const decoded = await uncompress(saveFile.subarray(1), { asBuffer: true });
    if (typeof decoded === "string") {
      throw new Error("Expected snappy to return a Buffer");
    }
    expect(new Uint8Array(decoded)).toStrictEqual(uncompressed);
    expect(uncompressed.length).toBeGreaterThan(0);
  });
});
