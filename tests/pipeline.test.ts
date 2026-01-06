import { describe, expect, it } from "vitest";
import { convertVerilogToSave } from "../src/index.js";

const SIMPLE_AND = `
module simple(
  input wire a,
  input wire b,
  output wire y
);
  assign y = a & b;
endmodule
`;

describe("Verilog to TC pipeline", () => {
  it("converts a simple AND gate", async () => {
    const { payload, saveFile } = await convertVerilogToSave({ "simple.v": SIMPLE_AND }, { topModule: "simple" });
    expect(payload.components).toHaveLength(4);
    expect(payload.wires).toHaveLength(3);
    expect(saveFile.byteLength).toBeGreaterThan(0);
  }, 30000);
});
