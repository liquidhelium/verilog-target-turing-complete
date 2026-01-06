import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { convertVerilogToSave, ConvertOptions } from "../src/index.js";

interface Benchmark {
  name: string;
  verilog: string;
  top: string;
}

const BENCHMARKS: Benchmark[] = [
  {
    name: "01_basic_wire",
    top: "basic_wire",
    verilog: `
module basic_wire(input wire a, output wire y);
  assign y = a;
endmodule
`,
  },
  {
    name: "02_basic_not",
    top: "basic_not",
    verilog: `
module basic_not(input wire a, output wire y);
  assign y = ~a;
endmodule
`,
  },
  {
    name: "03_basic_and",
    top: "basic_and",
    verilog: `
module basic_and(input wire a, input wire b, output wire y);
  assign y = a & b;
endmodule
`,
  },
  {
    name: "04_basic_or",
    top: "basic_or",
    verilog: `
module basic_or(input wire a, input wire b, output wire y);
  assign y = a | b;
endmodule
`,
  },
  {
    name: "05_basic_xor",
    top: "basic_xor",
    verilog: `
module basic_xor(input wire a, input wire b, output wire y);
  assign y = a ^ b;
endmodule
`,
  },
  {
    name: "06_complex_logic",
    top: "complex_logic",
    verilog: `
module complex_logic(input wire a, input wire b, input wire c, output wire y);
  assign y = (a & b) | (~c);
endmodule
`,
  },
  {
    name: "07_half_adder",
    top: "half_adder",
    verilog: `
module half_adder(input wire a, input wire b, output wire sum, output wire carry);
  assign sum = a ^ b;
  assign carry = a & b;
endmodule
`,
  },
  {
    name: "08_full_adder",
    top: "full_adder",
    verilog: `
module full_adder(input wire a, input wire b, input wire cin, output wire sum, output wire cout);
  assign sum = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule
`,
  },
  {
    name: "09_multiplexer_2to1",
    top: "mux2",
    verilog: `
module mux2(input wire i0, input wire i1, input wire sel, output wire y);
  assign y = sel ? i1 : i0;
endmodule
`,
  },
  {
    name: "10_demux_1to2",
    top: "demux2",
    verilog: `
module demux2(input wire d, input wire sel, output wire y0, output wire y1);
  assign y0 = sel ? 1'b0 : d;
  assign y1 = sel ? d : 1'b0;
endmodule
`,
  },
  {
    name: "11_bus_and_8",
    top: "bus_and_8",
    verilog: `
module bus_and_8(input wire [7:0] a, input wire [7:0] b, output wire [7:0] y);
  assign y = a & b;
endmodule
`,
  },
  {
    name: "12_bus_and_32",
    top: "bus_and_32",
    verilog: `
module bus_and_32(input wire [31:0] a, input wire [31:0] b, output wire [31:0] y);
  assign y = a & b;
endmodule
`,
  },
  {
    name: "13_bus_odd_31",
    top: "bus_odd_31",
    verilog: `
module bus_odd_31(input wire [30:0] a, input wire [30:0] b, output wire [30:0] y);
  assign y = a & b;
endmodule
`,
  },
  {
    name: "14_bus_mux_8",
    top: "bus_mux_8",
    verilog: `
module bus_mux_8(input wire [7:0] a, input wire [7:0] b, input wire s, output wire [7:0] y);
  assign y = s ? b : a;
endmodule
`,
  },
];

async function main() {
  const filter = process.argv[2];
  let targets = BENCHMARKS;
  if (filter) {
      if (filter === 'new') {
          targets = BENCHMARKS.filter(b => parseInt(b.name.substring(0,2)) >= 11);
      } else if (filter === 'old') {
          targets = BENCHMARKS.filter(b => parseInt(b.name.substring(0,2)) <= 10);
      } else {
          targets = BENCHMARKS.filter(b => b.name.includes(filter));
      }
  }

  const outputBase = resolve("test_output");
  
  // Clean output directory
  try {
    if (!filter) await fs.rm(outputBase, { recursive: true, force: true });
  } catch (e) {}
  await fs.mkdir(outputBase, { recursive: true });

  console.log(`Generating ${targets.length} benchmarks...`);

  for (const bench of targets) {
    const folder = join(outputBase, bench.name);
    await fs.mkdir(folder, { recursive: true });
    
    console.log(`Processing ${bench.name}...`);
    try {
      const result = await convertVerilogToSave(
        { "bench.v": bench.verilog },
        { topModule: bench.top, description: `Benchmark: ${bench.name}` }
      );
      
      await fs.writeFile(join(folder, "circuit.data"), result.saveFile);
      console.log(`  -> OK`);
    } catch (e) {
      console.error(`  -> Failed: ${e}`);
    }
  }
}

main().catch(console.error);
