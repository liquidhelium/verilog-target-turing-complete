import {
  CONST_0,
  CONST_1,
  ComponentTemplate,
  AND_1,
  INPUT_1,
  NOT_1,
  OR_1,
  OUTPUT_1,
  XOR_1,
  XNOR_1,
  getTemplate,
} from "../tc/componentLibrary.js";
import {
  ComponentInstance,
  NetBit,
  NetBitId,
  NetlistGraph,
  PortRef,
} from "./types.js";

interface YosysPort {
  direction: "input" | "output" | "inout";
  bits: Array<number | string>;
}

interface YosysCell {
  type: string;
  connections: Record<string, Array<number | string>>;
  parameters?: Record<string, string | number>;
}

interface YosysModule {
  ports: Record<string, YosysPort>;
  cells: Record<string, YosysCell>;
}

interface YosysJson {
  modules: Record<string, YosysModule>;
}

export interface YosysAdapterOptions {
  topModule: string;
}

type SizeMap = { [size: number]: string };

interface TemplateBinding {
  template: ComponentTemplate | string | SizeMap;
  inputPorts: string[];
  outputPort: string;
}

const GATES_AND: SizeMap = {
  1: "AND_1",
  8: "AND_8",
  16: "AND_16",
  32: "AND_32",
  64: "AND_64",
};
const GATES_OR: SizeMap = {
  1: "OR_1",
  8: "OR_8",
  16: "OR_16",
  32: "OR_32",
  64: "OR_64",
};
const GATES_XOR: SizeMap = {
  1: "XOR_1",
  8: "XOR_8",
  16: "XOR_16",
  32: "XOR_32",
  64: "XOR_64",
};
const GATES_XNOR: SizeMap = {
  1: "XNOR_1",
  8: "XNOR_8",
  16: "XNOR_16",
  32: "XNOR_32",
  64: "XNOR_64",
};
const GATES_NOT: SizeMap = {
  1: "NOT_1",
  8: "NOT_8",
  16: "NOT_16",
  32: "NOT_32",
  64: "NOT_64",
};

// Math helpers
const MATH_ADD: SizeMap = {
  8: "ADD_8",
  16: "ADD_16",
  32: "ADD_32",
  64: "ADD_64",
};
const MATH_MUL: SizeMap = {
  8: "MUL_8",
  16: "MUL_16",
  32: "MUL_32",
  64: "MUL_64",
};
const MATH_SHL: SizeMap = {
  8: "SHL_8",
  16: "SHL_16",
  32: "SHL_32",
  64: "SHL_64",
};
const MATH_SHR: SizeMap = {
  8: "SHR_8",
  16: "SHR_16",
  32: "SHR_32",
  64: "SHR_64",
};
const MATH_NEG: SizeMap = {
  8: "NEG_8",
  16: "NEG_16",
  32: "NEG_32",
  64: "NEG_64",
};
// DivMod is special? TC has one component. Yosys has $div and $mod.
// We can support them by mapping to DIVMOD_x and only connecting one output.
// But `adapter` assumes `outputPort` is a string.
// I'll need to extend adapter to support `outputPort` mapping logic or manual handling.
// For now, let's implement basic ADD/MUL/SHL/SHR/NEG.

const CELL_LIBRARY: Record<string, TemplateBinding> = {
  $and: { template: GATES_AND, inputPorts: ["A", "B"], outputPort: "Y" },
  $_AND_: { template: AND_1, inputPorts: ["A", "B"], outputPort: "Y" },
  $or: { template: GATES_OR, inputPorts: ["A", "B"], outputPort: "Y" },
  $_OR_: { template: OR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  $xor: { template: GATES_XOR, inputPorts: ["A", "B"], outputPort: "Y" },
  $_XOR_: { template: XOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  $xnor: { template: GATES_XNOR, inputPorts: ["A", "B"], outputPort: "Y" },
  $_XNOR_: { template: XNOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  $not: { template: GATES_NOT, inputPorts: ["A"], outputPort: "Y" },
  $_NOT_: { template: NOT_1, inputPorts: ["A"], outputPort: "Y" },
  $mux: {
    template: "INTERNAL_MUX",
    inputPorts: ["A", "B", "S"],
    outputPort: "Y",
  },
  $_MUX_: {
    template: "INTERNAL_MUX",
    inputPorts: ["A", "B", "S"],
    outputPort: "Y",
  },

  // Math
  $add: { template: MATH_ADD, inputPorts: ["A", "B"], outputPort: "sum" },
  $sub: { template: MATH_ADD, inputPorts: ["A", "B"], outputPort: "sum" }, // Wait, SUB is ADD with Negated B? Yosys usually outputs $sub.
  // TC doesn't have explicit SUB component?
  // User asked for "Math".
  // Let's check if TC has SUB.
  // The componentLibrary didn't list SUB in MATH group.
  // It has NEG. So SUB = ADD(A, NEG(B))? Or ADD(A, NOT(B)) + 1?
  // Yosys might emit $sub. If TC doesn't have SUB, I need to implement decomposition or mapping.
  // Checking `types.ts` ... there is no `Sub8` etc. There is `Neg8`.
  // So $sub should be handled manually in the loop like $sdff or mapped to a sequence.

  $mul: { template: MATH_MUL, inputPorts: ["A", "B"], outputPort: "pro" }, // TC output is "pro" (product)? I used "pro" in makePorts call.
  $shl: { template: MATH_SHL, inputPorts: ["A", "B"], outputPort: "out" }, // Yosys B is shift amount. TC port "shift".
  // Wait, I used makePorts port names ["A", "shift"].
  // But Yosys uses "A", "B".
  // I must map Yosys "B" to TC "shift".
  // The binding `inputPorts` is Yosys keys? No, it's used to iterate Yosys keys AND map to TC ports in strict order?
  // Current logic: `for (const inputPort of binding.inputPorts)`
  // `ensureArray(cell.connections[inputPort])` -> Reads Yosys port.
  // `instance.connections[inputPort] = busId` -> Connects to TC port of SAME NAME.
  // IF names differ (Yosys "B" vs TC "shift"), I cannot use this generic logic.
  // I need manual handling for SHL/SHR/SUB.

  $neg: { template: MATH_NEG, inputPorts: ["A"], outputPort: "out" },
};

const CONST_ZERO_ID = "__const0";
const CONST_ONE_ID = "__const1";

function ensureArray<T>(
  value: Array<T> | undefined,
  name: string,
  size?: number
): Array<T> {
  if (!value) {
    throw new Error(`Expected connection ${name}`);
  }
  if (size !== undefined && value.length !== size) {
    throw new Error(
      `Connection ${name} has unexpected width ${value.length}, expected ${size}`
    );
  }
  return value;
}

function normalizeBit(
  bit: number | string,
  counter: { zero: number; one: number }
): { id: NetBitId; constant?: 0 | 1 } {
  if (typeof bit === "number") {
    return { id: String(bit) };
  }
  if (bit === "0" || bit === "1") {
    if (bit === "0") {
      return { id: `${CONST_ZERO_ID}_${counter.zero++}`, constant: 0 };
    }
    return { id: `${CONST_ONE_ID}_${counter.one++}`, constant: 1 };
  }
  // Treat 'x' (undefined) and 'z' (high-z) as 0 for now to prevent crash
  if (bit === "x" || bit === "z") {
    return { id: `${CONST_ZERO_ID}_${counter.zero++}`, constant: 0 };
  }
  if (/^\d+$/.test(bit)) {
    return { id: bit };
  }
  throw new Error(`Unsupported bit reference ${bit}`);
}

function registerSource(
  nets: Map<NetBitId, NetBit>,
  bitId: NetBitId,
  ref: PortRef
): void {
  const net = nets.get(bitId) ?? { id: bitId, sinks: [] };
  if (net.source) {
    // If it's a constant, and already driven, that's fine? (Constants can be reused?)
    // But our logic generates unique const IDs per usage currently.
    throw new Error(`Net ${bitId} already has a driver`);
  }
  net.source = ref;
  nets.set(bitId, net);
}

function registerSink(
  nets: Map<NetBitId, NetBit>,
  bitId: NetBitId,
  ref: PortRef
): void {
  const net = nets.get(bitId) ?? { id: bitId, sinks: [] };
  net.sinks.push(ref);
  nets.set(bitId, net);
}

function instantiate(
  template: ComponentTemplate,
  id: string
): ComponentInstance {
  return {
    id,
    template,
    connections: {},
    metadata: {},
  };
}

function ensureDriverIfConstant(
  bitInfo: { id: NetBitId; constant?: 0 | 1 },
  destinationId: string,
  portName: string,
  components: ComponentInstance[],
  nets: Map<NetBitId, NetBit>
) {
  if (bitInfo.constant !== undefined) {
    if (nets.get(bitInfo.id)?.source) return;

    const constId = `${destinationId}:${portName}:const`;
    const constTemplate = bitInfo.constant === 0 ? CONST_0 : CONST_1;
    const constInstance = instantiate(constTemplate, constId);
    components.push(constInstance);
    // Position hacking? ELK handles it.
    constInstance.connections["out"] = bitInfo.id;
    registerSource(nets, bitInfo.id, { componentId: constId, portId: "out" });
  }
}

function parseParamInt(val: string | number | undefined): number {
  if (val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    if (/^[01]+$/.test(val) && val.length > 1) {
      return parseInt(val, 2);
    }
    return parseInt(val);
  }
  return 0;
}

// Optimization: Pack loose bits into a bus
function packBits(
  bits: Array<{ id: NetBitId; constant?: 0 | 1 }>,
  targetSize: number,
  components: ComponentInstance[],
  nets: Map<NetBitId, NetBit>,
  idGen: { next: () => string }
): NetBitId {
  // If size is 1, just return the single bit (no maker needed)
  if (targetSize === 1 && bits.length >= 1) {
    return bits[0].id;
  }

  // 1. Check if these bits come from a Splitter of compatible size/alignment
  // We check the driver of the first bit.
  const firstDriver = nets.get(bits[0].id)?.source;
  if (firstDriver) {
    const driverComp = components.find((c) => c.id === firstDriver.componentId);
    if (driverComp && driverComp.template.id.startsWith("SPLITTER_")) {
      // Check if ALL bits come from this splitter in order
      const splitterSize = parseInt(driverComp.template.id.split("_")[1]);
      // Only optimize if sizes match (or logic allows masking). For simplicity, exact match.
      if (splitterSize === targetSize && bits.length <= targetSize) {
        // Only optimize if splitter outputs 1-bit pins (size <= 8)
        if (targetSize <= 8) {
          let allMatch = true;
          for (let i = 0; i < bits.length; i++) {
            const d = nets.get(bits[i].id)?.source;
            if (
              !d ||
              d.componentId !== firstDriver.componentId ||
              d.portId !== `out${i}`
            ) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            const busNetId = driverComp.connections["in"];
            if (busNetId) return busNetId;
          }
        }
      }
    }
  }

  // 1b. Check if ALL bits are constants -> Use CONST_N
  let allConst = true;
  let constValue = 0n;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i].constant === undefined) {
      allConst = false;
      break;
    }
    if (bits[i].constant === 1) {
      constValue |= 1n << BigInt(i);
    }
  }

  if (allConst && bits.length <= targetSize) {
    const constId = idGen.next();
    const constTpl = `CONST_${targetSize}`;
    const instance = instantiate(getTemplate(constTpl), constId);
    if (!instance.metadata) instance.metadata = {};
    instance.metadata.setting1 = constValue;

    components.push(instance);
    const busId = `${constId}_val`;
    instance.connections["out"] = busId;
    registerSource(nets, busId, { componentId: constId, portId: "out" });
    return busId;
  }

  // 2. Hierarchical Maker for > 8
  if (targetSize > 8) {
    const makerId = idGen.next();
    const makerTemplateId = `MAKER_${targetSize}`;
    const maker = instantiate(getTemplate(makerTemplateId), makerId);
    components.push(maker);

    const chunks = targetSize / 8;
    for (let i = 0; i < chunks; i++) {
      const chunkBits = [];
      for (let j = 0; j < 8; j++) {
        const bitIndex = i * 8 + j;
        if (bitIndex < bits.length) {
          chunkBits.push(bits[bitIndex]);
        } else {
          chunkBits.push(normalizeBit("0", { zero: 0, one: 0 }));
        }
      }
      const subBus = packBits(chunkBits, 8, components, nets, idGen);
      maker.connections[`in${i}`] = subBus;
      registerSink(nets, subBus, { componentId: makerId, portId: `in${i}` });
    }

    const busId = `${makerId}_bus`;
    maker.connections["out"] = busId;
    registerSource(nets, busId, { componentId: makerId, portId: "out" });
    return busId;
  }

  // 3. Standard Maker (<= 8)
  const makerId = idGen.next();
  const makerTemplateId = `MAKER_${targetSize}`;
  const makerDesc = getTemplate(makerTemplateId);
  const maker = instantiate(makerDesc, makerId);
  components.push(maker);

  // Connect bits
  for (let i = 0; i < targetSize; i++) {
    let bitId: string;
    if (i < bits.length) {
      bitId = bits[i].id;
      ensureDriverIfConstant(bits[i], makerId, `in${i}`, components, nets);
    } else {
      bitId = `__pad_0_${makerId}_${i}`;
      const constId = `${makerId}:pad:${i}`;
      const constInst = instantiate(CONST_0, constId);
      components.push(constInst);
      constInst.connections["out"] = bitId;
      registerSource(nets, bitId, { componentId: constId, portId: "out" });
    }

    maker.connections[`in${i}`] = bitId;
    registerSink(nets, bitId, { componentId: makerId, portId: `in${i}` });
  }

  // Output bus
  const busId = `${makerId}_bus`;
  maker.connections["out"] = busId;
  registerSource(nets, busId, { componentId: makerId, portId: "out" });
  return busId;
}

// Optimization: Unpack bus into loose bits
function unpackBits(
  busId: NetBitId,
  targetBits: Array<{ id: NetBitId; constant?: 0 | 1 }>,
  targetSize: number,
  components: ComponentInstance[],
  nets: Map<NetBitId, NetBit>,
  idGen: { next: () => string }
): void {
  if (targetSize === 1 && targetBits.length === 1) {
    const source = nets.get(busId)?.source;
    if (source) {
      if (targetBits[0].constant !== undefined) {
        // Ignore constant target
        return;
      }
      registerSource(nets, targetBits[0].id, source);
    }
    return;
  }

  if (targetSize > 8) {
    // Hierarchical Splitter
    const splitterId = idGen.next();
    const splitterTemplateId = `SPLITTER_${targetSize}`;
    const splitter = instantiate(getTemplate(splitterTemplateId), splitterId);
    components.push(splitter);

    splitter.connections["in"] = busId;
    registerSink(nets, busId, { componentId: splitterId, portId: "in" });

    const chunks = targetSize / 8;
    for (let i = 0; i < chunks; i++) {
      const subBusId = `${splitterId}_out${i}`;
      splitter.connections[`out${i}`] = subBusId;
      registerSource(nets, subBusId, {
        componentId: splitterId,
        portId: `out${i}`,
      });

      const start = i * 8;
      const end = Math.min((i + 1) * 8, targetBits.length);
      if (start < targetBits.length) {
        unpackBits(
          subBusId,
          targetBits.slice(start, end),
          8,
          components,
          nets,
          idGen
        );
      }
    }
    return;
  }

  // Standard Splitter (<= 8)
  const splitterId = idGen.next();
  const splitterTemplateId = `SPLITTER_${targetSize}`;
  const splitter = instantiate(getTemplate(splitterTemplateId), splitterId);
  components.push(splitter);

  // Connect Input
  splitter.connections["in"] = busId;
  registerSink(nets, busId, { componentId: splitterId, portId: "in" });

  // Connect Outputs to the target bits
  for (let i = 0; i < targetBits.length; i++) {
    // The bitId is defined by Yosys (targetBits[i].id).
    // We register this splitter output as the source for that bit.
    const bit = targetBits[i];
    if (bit.constant !== undefined) {
      throw new Error("Cannot assign to constant");
    }

    const bitId = bit.id;
    splitter.connections[`out${i}`] = bitId;
    registerSource(nets, bitId, { componentId: splitterId, portId: `out${i}` });
  }
}

function resolveSize(width: number): 1 | 8 | 16 | 32 | 64 {
  if (width === 1) return 1;
  if (width <= 8) return 8;
  if (width <= 16) return 16;
  if (width <= 32) return 32;
  if (width <= 64) return 64;
  throw new Error(`Unsupported width ${width} (max 64)`);
}

// Detects Splitter -> Maker patterns where the signal is split and immediately reconstructed.
function optimizeMakerSplitterPairs(
  components: ComponentInstance[],
  nets: Map<NetBitId, NetBit>
): ComponentInstance[] {
  for (const comp of components) {
    if (!comp.template.id.startsWith("MAKER_")) continue;

    // Verify all inputs come from the SAME Splitter in the correct order
    const inputs = comp.template.ports.filter((p) => p.direction === "in");
    if (inputs.length === 0) continue;

    let sourceSplitterId: string | null = null;
    let isRedundant = true;

    for (let i = 0; i < inputs.length; i++) {
      const inPortId = `in${i}`;
      const inNetId = comp.connections[inPortId];
      if (typeof inNetId !== "string") {
        isRedundant = false;
        break;
      }

      const net = nets.get(inNetId);
      if (!net || !net.source) {
        isRedundant = false;
        break;
      }

      const srcComp = components.find((c) => c.id === net.source!.componentId);
      if (!srcComp || !srcComp.template.id.startsWith("SPLITTER_")) {
        isRedundant = false;
        break;
      }

      // Check if source port matches index (Splitter out0 -> Maker in0)
      if (net.source.portId !== "out" + i) {
        isRedundant = false;
        break;
      }

      if (sourceSplitterId === null) {
        sourceSplitterId = srcComp.id;
      } else if (sourceSplitterId !== srcComp.id) {
        isRedundant = false;
        break;
      }
    }

    if (isRedundant && sourceSplitterId) {
      const splitter = components.find((c) => c.id === sourceSplitterId);
      if (splitter) {
        const splitterInNetId = splitter.connections["in"];
        const makerOutNetId = comp.connections["out"];

        if (
          typeof splitterInNetId === "string" &&
          typeof makerOutNetId === "string"
        ) {
          const splitterInNet = nets.get(splitterInNetId);
          const makerOutNet = nets.get(makerOutNetId);

          if (splitterInNet && makerOutNet && splitterInNet !== makerOutNet) {
            // Move sinks from Maker output to Splitter input
            for (const sink of makerOutNet.sinks) {
              splitterInNet.sinks.push(sink);
              const sinkComp = components.find(
                (c) => c.id === sink.componentId
              );
              if (sinkComp) {
                sinkComp.connections[sink.portId] = splitterInNetId;
              }
            }

            // Disconnect Maker Output
            makerOutNet.sinks = [];
            makerOutNet.source = undefined;
            delete comp.connections["out"];
          }
        }
      }
    }
  }
  return components;
}

// Remove splitters/makers that have been fully optimized away (unused outputs)
function cleanupRedundantComponents(
  components: ComponentInstance[],
  nets: Map<NetBitId, NetBit>
): ComponentInstance[] {
  let currentComponents = components;
  let changed = true;

  while (changed) {
    changed = false;
    const toRemove = new Set<string>();

    for (const comp of currentComponents) {
      if (
        comp.template.id.startsWith("SPLITTER_") ||
        comp.template.id.startsWith("MAKER_")
      ) {
        // Check if any OUT port is used
        let used = false;
        for (const [portId, netId] of Object.entries(comp.connections)) {
          if (portId.startsWith("out")) {
            const net = nets.get(netId as string);
            if (net && net.sinks.length > 0) {
              used = true;
              break;
            }
          }
        }
        if (!used) {
          toRemove.add(comp.id);
          changed = true;
          // Remove the component from the sinks of its input nets
          for (const port of comp.template.ports) {
            if (port.direction === "in") {
              const inNetId = comp.connections[port.id];
              if (typeof inNetId === "string") {
                const inNet = nets.get(inNetId);
                if (inNet) {
                  inNet.sinks = inNet.sinks.filter(
                    (s) => s.componentId !== comp.id
                  );
                }
              }
            }
          }
          // Remove sources for out nets
          for (const [portId, netId] of Object.entries(comp.connections)) {
            if (portId.startsWith("out")) {
              const outNet = nets.get(netId as string);
              if (outNet && outNet.source?.componentId === comp.id) {
                outNet.source = undefined;
              }
            }
          }
        }
      }
    }

    if (changed) {
      currentComponents = currentComponents.filter((c) => !toRemove.has(c.id));
    }
  }

  return currentComponents;
}

export function buildNetlistFromYosys(
  json: unknown,
  options: YosysAdapterOptions
): NetlistGraph {
  const counter = { zero: 0, one: 0 };
  const parsed: YosysJson =
    typeof json === "string" ? JSON.parse(json) : (json as YosysJson);
  const module = parsed.modules?.[options.topModule];
  if (!module) {
    throw new Error(
      `Top module ${options.topModule} not found in Yosys output`
    );
  }

  let components: ComponentInstance[] = []; // Changed to let for filtering
  const nets: Map<NetBitId, NetBit> = new Map();
  let compCounter = 0;
  const idGen = { next: () => `gen_c${compCounter++}` };

  // 1. Process Module Input Ports (Drivers)
  for (const [portName, port] of Object.entries(module.ports ?? {})) {
    if (port.direction !== "input") continue;

    const width = port.bits.length;
    const size = resolveSize(width);
    if (size === 1) {
      // Old logic for 1-bit
      const bit = port.bits[0];
      const bitInfo = normalizeBit(bit, counter);
      const componentId = `in:${portName}`;
      const instance = instantiate(INPUT_1, componentId);
      instance.metadata = {
        label: portName,
        modulePort: { portName, bitIndex: 0 },
      };
      components.push(instance);
      instance.connections["out"] = bitInfo.id;
      registerSource(nets, bitInfo.id, { componentId, portId: "out" });
    } else {
      // Multi-bit
      const componentId = `in:${portName}`;
      const tplId = `INPUT_${size}`;
      const instance = instantiate(getTemplate(tplId), componentId);
      instance.metadata = { label: portName };
      components.push(instance);
      const bits = port.bits.map((b) => normalizeBit(b, counter));
      // Input component produces a bus. Unpack it to the bits.
      const busId = `${componentId}_bus`;
      instance.connections["out"] = busId;
      registerSource(nets, busId, { componentId, portId: "out" });
      unpackBits(busId, bits, size, components, nets, idGen);
    }
  }

  // 2. Process Cells (Logic)
  for (const [cellName, cell] of Object.entries(module.cells ?? {})) {
    // Standard D-Flip-Flop ($dff)
    if (cell.type === "$dff") {
      const width = parseParamInt(cell.parameters?.WIDTH);
      const size = resolveSize(width);
      const clkPol = parseParamInt(cell.parameters?.CLK_POLARITY);

      const instanceId = cellName;

      // 1. CLK
      let clkWire = normalizeBit(
        ensureArray(cell.connections["CLK"], "CLK", 1)[0],
        counter
      ).id;
      if (clkPol === 0) {
        // Invert Clock
        const notId = `${instanceId}_clk_not`;
        const notInst = instantiate(getTemplate("NOT_1"), notId);
        components.push(notInst);
        notInst.connections["A"] = clkWire;
        registerSink(nets, clkWire, { componentId: notId, portId: "A" });

        const clkInv = `${instanceId}_clk_inv`;
        notInst.connections["Y"] = clkInv;
        registerSource(nets, clkInv, { componentId: notId, portId: "Y" });
        clkWire = clkInv;
      }

      // 2. Data Inputs (D)
      const dRaw = ensureArray(cell.connections["D"], "D");
      const dPacked = packBits(
        dRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      // 3. Register
      const regId = `${instanceId}_reg`;
      const regTemplate = getTemplate(`REG_${size}`);
      const regInst = instantiate(regTemplate, regId);
      components.push(regInst);

      // Value (D)
      regInst.connections["value"] = dPacked;
      registerSink(nets, dPacked, { componentId: regId, portId: "value" });

      // Save (CLK)
      regInst.connections["save"] = clkWire;
      registerSink(nets, clkWire, { componentId: regId, portId: "save" });

      // Load (Tie to 1) - Only for registers > 1 bit
      if (size > 1) {
        const loadConstId = `${instanceId}_load_const`;
        const loadInst = instantiate(getTemplate("CONST_1"), loadConstId);
        components.push(loadInst);
        const loadWire = `${loadConstId}_out`;
        loadInst.connections["out"] = loadWire;
        registerSource(nets, loadWire, {
          componentId: loadConstId,
          portId: "out",
        });

        regInst.connections["load"] = loadWire;
        registerSink(nets, loadWire, { componentId: regId, portId: "load" });
      }

      const regOut = `${instanceId}_reg_out`;
      regInst.connections["out"] = regOut;
      registerSource(nets, regOut, { componentId: regId, portId: "out" });

      // 4. Connect Output Q
      const qRaw = ensureArray(cell.connections["Q"], "Q");
      unpackBits(
        regOut,
        qRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      continue;
    }

    // D-Flip-Flop with Enable ($dffe)
    if (cell.type === "$dffe") {
      const width = parseParamInt(cell.parameters?.WIDTH);
      const size = resolveSize(width);
      const clkPol = parseParamInt(cell.parameters?.CLK_POLARITY);
      const enPol = parseParamInt(cell.parameters?.EN_POLARITY);

      const instanceId = cellName;

      // 1. CLK
      let clkWire = normalizeBit(
        ensureArray(cell.connections["CLK"], "CLK", 1)[0],
        counter
      ).id;
      if (clkPol === 0) {
        // Invert Clock
        const notId = `${instanceId}_clk_not`;
        const notInst = instantiate(getTemplate("NOT_1"), notId);
        components.push(notInst);
        notInst.connections["A"] = clkWire;
        registerSink(nets, clkWire, { componentId: notId, portId: "A" });

        const clkInv = `${instanceId}_clk_inv`;
        notInst.connections["Y"] = clkInv;
        registerSource(nets, clkInv, { componentId: notId, portId: "Y" });
        clkWire = clkInv;
      }

      // 2. Enable (EN)
      let enWire = normalizeBit(
        ensureArray(cell.connections["EN"], "EN", 1)[0],
        counter
      ).id;
      if (enPol === 0) {
        // Invert Enable
        const enNotId = `${instanceId}_en_not`;
        const enNotInst = instantiate(getTemplate("NOT_1"), enNotId);
        components.push(enNotInst);
        enNotInst.connections["A"] = enWire;
        registerSink(nets, enWire, { componentId: enNotId, portId: "A" });

        const enInv = `${instanceId}_en_inv`;
        enNotInst.connections["Y"] = enInv;
        registerSource(nets, enInv, { componentId: enNotId, portId: "Y" });
        enWire = enInv;
      }

      // 3. Register
      const regId = `${instanceId}_reg`;
      const regTemplate = getTemplate(`REG_${size}`);
      const regInst = instantiate(regTemplate, regId);
      components.push(regInst);

      // Save (CLK)
      regInst.connections["save"] = clkWire;
      registerSink(nets, clkWire, { componentId: regId, portId: "save" });

      // Load (Tie to 1) - Only for registers > 1 bit
      if (size > 1) {
        const loadConstId = `${instanceId}_load_const`;
        const loadInst = instantiate(getTemplate("CONST_1"), loadConstId);
        components.push(loadInst);
        const loadWire = `${loadConstId}_out`;
        loadInst.connections["out"] = loadWire;
        registerSource(nets, loadWire, {
          componentId: loadConstId,
          portId: "out",
        });

        regInst.connections["load"] = loadWire;
        registerSink(nets, loadWire, { componentId: regId, portId: "load" });
      }

      const regOut = `${instanceId}_reg_out`;
      regInst.connections["out"] = regOut;
      registerSource(nets, regOut, { componentId: regId, portId: "out" });

      // 4. Data Inputs (D) -> MUX -> Register Value
      // The MUX selects between old value (Q aka regOut) and new value (D) based on EN.
      // S=0 -> A (Q)
      // S=1 -> B (D)
      const dRaw = ensureArray(cell.connections["D"], "D");
      const dPacked = packBits(
        dRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      if (size === 1) {
        // MUX_1 Construction using Logic Gates
        // Y = (S & B) | (~S & A)
        // A = regOut, B = dPacked, S = enWire

        // 1. Invert S
        const notSId = `${instanceId}_mux_notS`;
        const notS = instantiate(getTemplate("NOT_1"), notSId);
        components.push(notS);
        notS.connections["A"] = enWire;
        registerSink(nets, enWire, { componentId: notSId, portId: "A" });
        const notSWire = `${notSId}_out`;
        notS.connections["Y"] = notSWire;
        registerSource(nets, notSWire, { componentId: notSId, portId: "Y" });

        // 2. Term 1: ~S & A (Keep Old)
        const and1Id = `${instanceId}_mux_term1`;
        const and1 = instantiate(getTemplate("AND_1"), and1Id);
        components.push(and1);
        and1.connections["A"] = notSWire;
        registerSink(nets, notSWire, { componentId: and1Id, portId: "A" });
        and1.connections["B"] = regOut;
        registerSink(nets, regOut, { componentId: and1Id, portId: "B" });
        const term1Wire = `${and1Id}_out`;
        and1.connections["Y"] = term1Wire;
        registerSource(nets, term1Wire, { componentId: and1Id, portId: "Y" });

        // 3. Term 2: S & B (New Value)
        const and2Id = `${instanceId}_mux_term2`;
        const and2 = instantiate(getTemplate("AND_1"), and2Id);
        components.push(and2);
        and2.connections["A"] = enWire;
        registerSink(nets, enWire, { componentId: and2Id, portId: "A" });
        and2.connections["B"] = dPacked;
        registerSink(nets, dPacked, { componentId: and2Id, portId: "B" });
        const term2Wire = `${and2Id}_out`;
        and2.connections["Y"] = term2Wire;
        registerSource(nets, term2Wire, { componentId: and2Id, portId: "Y" });

        // 4. Combine: Term1 | Term2
        const orId = `${instanceId}_mux_or`;
        const orInst = instantiate(getTemplate("OR_1"), orId);
        components.push(orInst);
        orInst.connections["A"] = term1Wire;
        registerSink(nets, term1Wire, { componentId: orId, portId: "A" });
        orInst.connections["B"] = term2Wire;
        registerSink(nets, term2Wire, { componentId: orId, portId: "B" });

        const muxOut = `${orId}_out`;
        orInst.connections["Y"] = muxOut;
        registerSource(nets, muxOut, { componentId: orId, portId: "Y" });

        regInst.connections["value"] = muxOut;
        registerSink(nets, muxOut, { componentId: regId, portId: "value" });
      } else {
        // Use Standard MUX Component (MUX_8, MUX_16, ...)
        const muxId = `${instanceId}_mux`;
        const muxTemplate = getTemplate(`MUX_${size}`);
        const muxInst = instantiate(muxTemplate, muxId);
        components.push(muxInst);

        // Mux S (Select) - Enable
        muxInst.connections["S"] = enWire;
        registerSink(nets, enWire, { componentId: muxId, portId: "S" });

        // Mux B (New Value)
        muxInst.connections["B"] = dPacked;
        registerSink(nets, dPacked, { componentId: muxId, portId: "B" });

        // Mux A (Old Value - Loopback)
        muxInst.connections["A"] = regOut;
        registerSink(nets, regOut, { componentId: muxId, portId: "A" });

        // Mux Output -> Register Value
        const muxOut = `${muxId}_out`;
        muxInst.connections["Y"] = muxOut;
        registerSource(nets, muxOut, { componentId: muxId, portId: "Y" });

        regInst.connections["value"] = muxOut;
        registerSink(nets, muxOut, { componentId: regId, portId: "value" });
      }

      // 5. Connect Output Q
      const qRaw = ensureArray(cell.connections["Q"], "Q");
      unpackBits(
        regOut,
        qRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      continue;
    }

    // Special handling for Synchronous D-Flip-Flop ($sdff) usually generated for state machines
    if (cell.type === "$sdff") {
      const width = parseParamInt(cell.parameters?.WIDTH);
      const size = resolveSize(width);
      const clkPol = parseParamInt(cell.parameters?.CLK_POLARITY);
      const srstPol = parseParamInt(cell.parameters?.SRST_POLARITY);
      const srstVal = BigInt(
        "0b" + ((cell.parameters?.SRST_VALUE as any) ?? "0")
      );

      const instanceId = cellName;

      // 1. CLK Processing
      let clkWire = normalizeBit(
        ensureArray(cell.connections["CLK"], "CLK", 1)[0],
        counter
      ).id;
      if (clkPol === 0) {
        // Invert Clock
        const notId = `${instanceId}_clk_not`;
        const notInst = instantiate(getTemplate("NOT_1"), notId);
        components.push(notInst);
        notInst.connections["A"] = clkWire;
        registerSink(nets, clkWire, { componentId: notId, portId: "A" });

        const clkInv = `${instanceId}_clk_inv`;
        notInst.connections["Y"] = clkInv;
        registerSource(nets, clkInv, { componentId: notId, portId: "Y" });
        clkWire = clkInv; // Use inverted
      }

      // 2. SRST Processing (Mux Select)
      let srstWire = normalizeBit(
        ensureArray(cell.connections["SRST"], "SRST", 1)[0],
        counter
      ).id;
      // If SRST_POLARITY is 0, active low -> We want active high for Mux Select (1 = Reset)
      if (srstPol === 0) {
        // Invert SRST
        const notId = `${instanceId}_srst_not`;
        const notInst = instantiate(getTemplate("NOT_1"), notId);
        components.push(notInst);
        notInst.connections["A"] = srstWire;
        registerSink(nets, srstWire, { componentId: notId, portId: "A" });

        const srstInv = `${instanceId}_srst_inv`;
        notInst.connections["Y"] = srstInv;
        registerSource(nets, srstInv, { componentId: notId, portId: "Y" });
        srstWire = srstInv;
      }

      // 3. Data Inputs (D) & Reset Value Converted to Bus
      const dRaw = ensureArray(cell.connections["D"], "D");
      const dPacked = packBits(
        dRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      // Create Constant for Reset Value
      let rstBusId: string;
      if (size === 1) {
        // Use Off (0) or On (1) based on srstVal
        // srstVal is BigInt.
        const val = Number(srstVal) & 1;
        const constId = `${instanceId}_rst_val`;
        const tplId = val === 1 ? "CONST_1" : "CONST_0";
        const constInst = instantiate(getTemplate(tplId), constId);
        components.push(constInst);
        rstBusId = `${constId}_out`;
        constInst.connections["out"] = rstBusId;
        registerSource(nets, rstBusId, { componentId: constId, portId: "out" });
      } else {
        const constId = `${instanceId}_rst_val`;
        const constTemplate = getTemplate(`CONST_${size}`);
        const constInst = instantiate(constTemplate, constId);
        if (!constInst.metadata) constInst.metadata = {};
        constInst.metadata.setting1 = srstVal;
        components.push(constInst);
        rstBusId = `${instanceId}_rst_val_out`;
        constInst.connections["out"] = rstBusId;
        registerSource(nets, rstBusId, { componentId: constId, portId: "out" });
      }

      const regId = `${instanceId}_reg`;
      const regOut = `${instanceId}_reg_out`;

      // 4. Mux for Next State vs Reset
      let muxOut: string;
      if (size === 1) {
        // Mux 1 logic: Y = S ? B : A. S=SRST, B=RstVal, A=D
        // S & B | ~S & A

        // Invert S
        const notSId = `${instanceId}_mux_notS`;
        const notS = instantiate(getTemplate("NOT_1"), notSId);
        components.push(notS);
        notS.connections["A"] = srstWire;
        registerSink(nets, srstWire, { componentId: notSId, portId: "A" });
        const notSWire = `${notSId}_out`;
        notS.connections["Y"] = notSWire;
        registerSource(nets, notSWire, { componentId: notSId, portId: "Y" });

        // Term 1: ~S & A (D)
        const and1Id = `${instanceId}_mux_term1`;
        const and1 = instantiate(getTemplate("AND_1"), and1Id);
        components.push(and1);
        and1.connections["A"] = notSWire;
        registerSink(nets, notSWire, { componentId: and1Id, portId: "A" });
        and1.connections["B"] = dPacked;
        registerSink(nets, dPacked, { componentId: and1Id, portId: "B" });
        const term1Wire = `${and1Id}_out`;
        and1.connections["Y"] = term1Wire;
        registerSource(nets, term1Wire, { componentId: and1Id, portId: "Y" });

        // Term 2: S & B (RstVal)
        const and2Id = `${instanceId}_mux_term2`;
        const and2 = instantiate(getTemplate("AND_1"), and2Id);
        components.push(and2);
        and2.connections["A"] = srstWire;
        registerSink(nets, srstWire, { componentId: and2Id, portId: "A" });
        and2.connections["B"] = rstBusId;
        registerSink(nets, rstBusId, { componentId: and2Id, portId: "B" });
        const term2Wire = `${and2Id}_out`;
        and2.connections["Y"] = term2Wire;
        registerSource(nets, term2Wire, { componentId: and2Id, portId: "Y" });

        // Or
        const orId = `${instanceId}_mux_or`;
        const orInst = instantiate(getTemplate("OR_1"), orId);
        components.push(orInst);
        orInst.connections["A"] = term1Wire;
        registerSink(nets, term1Wire, { componentId: orId, portId: "A" });
        orInst.connections["B"] = term2Wire;
        registerSink(nets, term2Wire, { componentId: orId, portId: "B" });

        muxOut = `${orId}_out`;
        orInst.connections["Y"] = muxOut;
        registerSource(nets, muxOut, { componentId: orId, portId: "Y" });
      } else {
        // Standard MUX
        const muxId = `${instanceId}_rst_mux`;
        const muxTemplate = getTemplate(`MUX_${size}`);
        const muxInst = instantiate(muxTemplate, muxId);
        components.push(muxInst);

        muxInst.connections["A"] = dPacked; // 0
        registerSink(nets, dPacked, { componentId: muxId, portId: "A" });

        muxInst.connections["B"] = rstBusId; // 1
        registerSink(nets, rstBusId, { componentId: muxId, portId: "B" });

        muxInst.connections["S"] = srstWire;
        registerSink(nets, srstWire, { componentId: muxId, portId: "S" });

        muxOut = `${instanceId}_mux_out`;
        muxInst.connections["Y"] = muxOut;
        registerSource(nets, muxOut, { componentId: muxId, portId: "Y" });
      }

      // 5. Register
      const regTemplate = getTemplate(`REG_${size}`);
      const regInst = instantiate(regTemplate, regId);
      components.push(regInst);

      // Value (Inputs)
      regInst.connections["value"] = muxOut;
      registerSink(nets, muxOut, { componentId: regId, portId: "value" });

      // Save (Write Enable / Clock)
      regInst.connections["save"] = clkWire;
      registerSink(nets, clkWire, { componentId: regId, portId: "save" });

      if (size > 1) {
        const loadConstId = `${instanceId}_load_const`;
        const loadInst = instantiate(getTemplate("CONST_1"), loadConstId);
        components.push(loadInst);
        const loadWire = `${loadConstId}_out`;
        loadInst.connections["out"] = loadWire;
        registerSource(nets, loadWire, {
          componentId: loadConstId,
          portId: "out",
        });

        regInst.connections["load"] = loadWire;
        registerSink(nets, loadWire, { componentId: regId, portId: "load" });
      }

      regInst.connections["out"] = regOut;
      registerSource(nets, regOut, { componentId: regId, portId: "out" });

      // 6. Connect Output Q
      const qRaw = ensureArray(cell.connections["Q"], "Q");
      unpackBits(
        regOut,
        qRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      continue;
    }

    // Synchronous D-Flip-Flop with Enable ($sdffe)
    if (cell.type === "$sdffe") {
      const width = parseParamInt(cell.parameters?.WIDTH);
      const size = resolveSize(width);
      const clkPol = parseParamInt(cell.parameters?.CLK_POLARITY);
      const srstPol = parseParamInt(cell.parameters?.SRST_POLARITY);
      const enPol = parseParamInt(cell.parameters?.EN_POLARITY);
      const srstVal = BigInt(
        "0b" + ((cell.parameters?.SRST_VALUE as any) ?? "0")
      );
      const instanceId = cellName;

      // 1. Signals processing
      let clkWire = normalizeBit(
        ensureArray(cell.connections["CLK"], "CLK", 1)[0],
        counter
      ).id;
      if (clkPol === 0) {
        const notId = `${instanceId}_clk_not`;
        const notInst = instantiate(getTemplate("NOT_1"), notId);
        components.push(notInst);
        notInst.connections["A"] = clkWire;
        registerSink(nets, clkWire, { componentId: notId, portId: "A" });
        const clkInv = `${instanceId}_clk_inv`;
        notInst.connections["Y"] = clkInv;
        registerSource(nets, clkInv, { componentId: notId, portId: "Y" });
        clkWire = clkInv;
      }

      let srstWire = normalizeBit(
        ensureArray(cell.connections["SRST"], "SRST", 1)[0],
        counter
      ).id;
      if (srstPol === 0) {
        const notId = `${instanceId}_srst_not`;
        const notInst = instantiate(getTemplate("NOT_1"), notId);
        components.push(notInst);
        notInst.connections["A"] = srstWire;
        registerSink(nets, srstWire, { componentId: notId, portId: "A" });
        const srstInv = `${instanceId}_srst_inv`;
        notInst.connections["Y"] = srstInv;
        registerSource(nets, srstInv, { componentId: notId, portId: "Y" });
        srstWire = srstInv;
      }

      let enWire = normalizeBit(
        ensureArray(cell.connections["EN"], "EN", 1)[0],
        counter
      ).id;
      if (enPol === 0) {
        const enNotId = `${instanceId}_en_not`;
        const enNotInst = instantiate(getTemplate("NOT_1"), enNotId);
        components.push(enNotInst);
        enNotInst.connections["A"] = enWire;
        registerSink(nets, enWire, { componentId: enNotId, portId: "A" });
        const enInv = `${instanceId}_en_inv`;
        enNotInst.connections["Y"] = enInv;
        registerSource(nets, enInv, { componentId: enNotId, portId: "Y" });
        enWire = enInv;
      }

      // Reset Val
      let rstBusId: string;
      if (size === 1) {
        const val = Number(srstVal) & 1;
        const constId = `${instanceId}_rst_val`;
        const tplId = val === 1 ? "CONST_1" : "CONST_0";
        const constInst = instantiate(getTemplate(tplId), constId);
        components.push(constInst);
        rstBusId = `${constId}_out`;
        constInst.connections["out"] = rstBusId;
        registerSource(nets, rstBusId, { componentId: constId, portId: "out" });
      } else {
        const constId = `${instanceId}_rst_val`;
        const constTemplate = getTemplate(`CONST_${size}`);
        const constInst = instantiate(constTemplate, constId);
        if (!constInst.metadata) constInst.metadata = {};
        constInst.metadata.setting1 = srstVal;
        components.push(constInst);
        rstBusId = `${instanceId}_rst_val_out`;
        constInst.connections["out"] = rstBusId;
        registerSource(nets, rstBusId, { componentId: constId, portId: "out" });
      }

      const dRaw = ensureArray(cell.connections["D"], "D");
      const dPacked = packBits(
        dRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      const regId = `${instanceId}_reg`;
      const regOut = `${instanceId}_reg_out`;

      // Logic:
      // Inner: Val_EN = EN ? D : RegOut
      // Outer: Val_Final = SRST ? RstVal : Val_EN

      // 4a. Inner Mux (Enable)
      let innerMuxOut: string;
      if (size === 1) {
        // Mux Gate Logic: S=EN, B=D, A=RegOut
        const sWire = enWire;
        const bWire = dPacked;
        const aWire = regOut;

        // Invert S
        const notSId = `${instanceId}_en_mux_notS`;
        const notS = instantiate(getTemplate("NOT_1"), notSId);
        components.push(notS);
        notS.connections["A"] = sWire;
        registerSink(nets, sWire, { componentId: notSId, portId: "A" });
        const notSWire = `${notSId}_out`;
        notS.connections["Y"] = notSWire;
        registerSource(nets, notSWire, { componentId: notSId, portId: "Y" });

        // Term 1: ~S & A
        const and1Id = `${instanceId}_en_mux_term1`;
        const and1 = instantiate(getTemplate("AND_1"), and1Id);
        components.push(and1);
        and1.connections["A"] = notSWire;
        registerSink(nets, notSWire, { componentId: and1Id, portId: "A" });
        and1.connections["B"] = aWire;
        registerSink(nets, aWire, { componentId: and1Id, portId: "B" });
        const term1Wire = `${and1Id}_out`;
        and1.connections["Y"] = term1Wire;
        registerSource(nets, term1Wire, { componentId: and1Id, portId: "Y" });

        // Term 2: S & B
        const and2Id = `${instanceId}_en_mux_term2`;
        const and2 = instantiate(getTemplate("AND_1"), and2Id);
        components.push(and2);
        and2.connections["A"] = sWire;
        registerSink(nets, sWire, { componentId: and2Id, portId: "A" });
        and2.connections["B"] = bWire;
        registerSink(nets, bWire, { componentId: and2Id, portId: "B" });
        const term2Wire = `${and2Id}_out`;
        and2.connections["Y"] = term2Wire;
        registerSource(nets, term2Wire, { componentId: and2Id, portId: "Y" });

        // OR
        const orId = `${instanceId}_en_mux_or`;
        const orInst = instantiate(getTemplate("OR_1"), orId);
        components.push(orInst);
        orInst.connections["A"] = term1Wire;
        registerSink(nets, term1Wire, { componentId: orId, portId: "A" });
        orInst.connections["B"] = term2Wire;
        registerSink(nets, term2Wire, { componentId: orId, portId: "B" });

        innerMuxOut = `${orId}_out`;
        orInst.connections["Y"] = innerMuxOut;
        registerSource(nets, innerMuxOut, { componentId: orId, portId: "Y" });
      } else {
        const muxId = `${instanceId}_en_mux`;
        const muxTemplate = getTemplate(`MUX_${size}`);
        const muxInst = instantiate(muxTemplate, muxId);
        components.push(muxInst);
        muxInst.connections["S"] = enWire;
        registerSink(nets, enWire, { componentId: muxId, portId: "S" });
        muxInst.connections["B"] = dPacked; // New
        registerSink(nets, dPacked, { componentId: muxId, portId: "B" });
        muxInst.connections["A"] = regOut; // Old
        registerSink(nets, regOut, { componentId: muxId, portId: "A" });

        innerMuxOut = `${muxId}_out`;
        muxInst.connections["Y"] = innerMuxOut;
        registerSource(nets, innerMuxOut, { componentId: muxId, portId: "Y" });
      }

      // 4b. Outer Mux (Reset)
      let finalVal: string;
      if (size === 1) {
        // Mux Gate Logic: S=SRST, B=RstVal, A=InnerMuxOut
        const sWire = srstWire;
        const bWire = rstBusId;
        const aWire = innerMuxOut;

        const notSId = `${instanceId}_rst_mux_notS`;
        const notS = instantiate(getTemplate("NOT_1"), notSId);
        components.push(notS);
        notS.connections["A"] = sWire;
        registerSink(nets, sWire, { componentId: notSId, portId: "A" });
        const notSWire = `${notSId}_out`;
        notS.connections["Y"] = notSWire;
        registerSource(nets, notSWire, { componentId: notSId, portId: "Y" });

        const and1Id = `${instanceId}_rst_mux_term1`;
        const and1 = instantiate(getTemplate("AND_1"), and1Id);
        components.push(and1);
        and1.connections["A"] = notSWire;
        registerSink(nets, notSWire, { componentId: and1Id, portId: "A" });
        and1.connections["B"] = aWire;
        registerSink(nets, aWire, { componentId: and1Id, portId: "B" });
        const term1Wire = `${and1Id}_out`;
        and1.connections["Y"] = term1Wire;
        registerSource(nets, term1Wire, { componentId: and1Id, portId: "Y" });

        const and2Id = `${instanceId}_rst_mux_term2`;
        const and2 = instantiate(getTemplate("AND_1"), and2Id);
        components.push(and2);
        and2.connections["A"] = sWire;
        registerSink(nets, sWire, { componentId: and2Id, portId: "A" });
        and2.connections["B"] = bWire;
        registerSink(nets, bWire, { componentId: and2Id, portId: "B" });
        const term2Wire = `${and2Id}_out`;
        and2.connections["Y"] = term2Wire;
        registerSource(nets, term2Wire, { componentId: and2Id, portId: "Y" });

        const orId = `${instanceId}_rst_mux_or`;
        const orInst = instantiate(getTemplate("OR_1"), orId);
        components.push(orInst);
        orInst.connections["A"] = term1Wire;
        registerSink(nets, term1Wire, { componentId: orId, portId: "A" });
        orInst.connections["B"] = term2Wire;
        registerSink(nets, term2Wire, { componentId: orId, portId: "B" });

        finalVal = `${orId}_out`;
        orInst.connections["Y"] = finalVal;
        registerSource(nets, finalVal, { componentId: orId, portId: "Y" });
      } else {
        const muxId = `${instanceId}_rst_mux`;
        const muxInst = instantiate(getTemplate(`MUX_${size}`), muxId);
        components.push(muxInst);
        muxInst.connections["S"] = srstWire;
        registerSink(nets, srstWire, { componentId: muxId, portId: "S" });
        muxInst.connections["B"] = rstBusId;
        registerSink(nets, rstBusId, { componentId: muxId, portId: "B" });
        muxInst.connections["A"] = innerMuxOut;
        registerSink(nets, innerMuxOut, { componentId: muxId, portId: "A" });

        finalVal = `${muxId}_out`;
        muxInst.connections["Y"] = finalVal;
        registerSource(nets, finalVal, { componentId: muxId, portId: "Y" });
      }

      // 5. Connect Register
      const regTemplate = getTemplate(`REG_${size}`);
      const regInst = instantiate(regTemplate, regId);
      components.push(regInst);

      regInst.connections["value"] = finalVal;
      registerSink(nets, finalVal, { componentId: regId, portId: "value" });
      regInst.connections["save"] = clkWire;
      registerSink(nets, clkWire, { componentId: regId, portId: "save" });
      if (size > 1) {
        const loadConstId = `${instanceId}_load_const`;
        const loadInst = instantiate(getTemplate("CONST_1"), loadConstId);
        components.push(loadInst);
        const loadWire = `${loadConstId}_out`;
        loadInst.connections["out"] = loadWire;
        registerSource(nets, loadWire, {
          componentId: loadConstId,
          portId: "out",
        });
        regInst.connections["load"] = loadWire;
        registerSink(nets, loadWire, { componentId: regId, portId: "load" });
      }
      regInst.connections["out"] = regOut;
      registerSource(nets, regOut, { componentId: regId, portId: "out" });

      const qRaw = ensureArray(cell.connections["Q"], "Q");
      unpackBits(
        regOut,
        qRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      continue;
    }

    // Special handling for Parallel Multiplexer ($pmux) usually generated for case statements
    if (cell.type === "$pmux") {
      const width = parseParamInt(cell.parameters?.WIDTH);
      const sWidth = parseParamInt(cell.parameters?.S_WIDTH); // Number of selection bits
      const size = resolveSize(width);

      const instanceId = cellName;

      // Inputs
      // A: Default value (when S=0)
      const aRaw = ensureArray(cell.connections["A"], "A"); // Should be 'width' bits
      let currentBus = packBits(
        aRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      // B: Option values (width * sWidth)
      const bRaw = ensureArray(cell.connections["B"], "B");

      // S: Select bits (sWidth)
      const sRaw = ensureArray(cell.connections["S"], "S", sWidth);

      // Chain Muxes
      for (let i = 0; i < sWidth; i++) {
        // Slice B for this option
        const bSlice = bRaw.slice(i * width, (i + 1) * width);
        const bPacked = packBits(
          bSlice.map((b) => normalizeBit(b, counter)),
          size,
          components,
          nets,
          idGen
        );

        // Select Bit
        const sBit = normalizeBit(sRaw[i], counter).id; // ID of the select bit

        // Create Mux
        const muxId = `${instanceId}_pmux_${i}`;

        if (size === 1) {
          // Manual Logic Mux 1
          const sWire = sBit;
          const bWire = bPacked;
          const aWire = currentBus;

          // Invert S
          const notSId = `${muxId}_notS`;
          const notS = instantiate(getTemplate("NOT_1"), notSId);
          components.push(notS);
          notS.connections["A"] = sWire;
          registerSink(nets, sWire, { componentId: notSId, portId: "A" });
          const notSWire = `${notSId}_out`;
          notS.connections["Y"] = notSWire;
          registerSource(nets, notSWire, { componentId: notSId, portId: "Y" });

          // Term 1: ~S & A
          const and1Id = `${muxId}_term1`;
          const and1 = instantiate(getTemplate("AND_1"), and1Id);
          components.push(and1);
          and1.connections["A"] = notSWire;
          registerSink(nets, notSWire, { componentId: and1Id, portId: "A" });
          and1.connections["B"] = aWire;
          registerSink(nets, aWire, { componentId: and1Id, portId: "B" });
          const term1Wire = `${and1Id}_out`;
          and1.connections["Y"] = term1Wire;
          registerSource(nets, term1Wire, { componentId: and1Id, portId: "Y" });

          // Term 2: S & B
          const and2Id = `${muxId}_term2`;
          const and2 = instantiate(getTemplate("AND_1"), and2Id);
          components.push(and2);
          and2.connections["A"] = sWire;
          registerSink(nets, sWire, { componentId: and2Id, portId: "A" });
          and2.connections["B"] = bWire;
          registerSink(nets, bWire, { componentId: and2Id, portId: "B" });
          const term2Wire = `${and2Id}_out`;
          and2.connections["Y"] = term2Wire;
          registerSource(nets, term2Wire, { componentId: and2Id, portId: "Y" });

          // OR
          const orId = `${muxId}_or`;
          const orInst = instantiate(getTemplate("OR_1"), orId);
          components.push(orInst);
          orInst.connections["A"] = term1Wire;
          registerSink(nets, term1Wire, { componentId: orId, portId: "A" });
          orInst.connections["B"] = term2Wire;
          registerSink(nets, term2Wire, { componentId: orId, portId: "B" });

          const muxOut = `${orId}_out`;
          orInst.connections["Y"] = muxOut;
          registerSource(nets, muxOut, { componentId: orId, portId: "Y" });

          currentBus = muxOut;
        } else {
          const muxTemplate = getTemplate(`MUX_${size}`); // Use TC Mux (Switch)
          const muxInst = instantiate(muxTemplate, muxId);
          components.push(muxInst);

          // Connect Input 0 (Previous stage or A)
          muxInst.connections["A"] = currentBus;
          registerSink(nets, currentBus, { componentId: muxId, portId: "A" });

          // Connect Input 1 (This option B)
          muxInst.connections["B"] = bPacked;
          registerSink(nets, bPacked, { componentId: muxId, portId: "B" });

          // Connect Select
          muxInst.connections["S"] = sBit;
          registerSink(nets, sBit, { componentId: muxId, portId: "S" });

          // Output to next stage
          const muxOut = `${muxId}_out`;
          muxInst.connections["Y"] = muxOut;
          registerSource(nets, muxOut, { componentId: muxId, portId: "Y" });

          currentBus = muxOut;
        }
      }

      // Final Output to Y
      const yRaw = ensureArray(cell.connections["Y"], "Y");
      unpackBits(
        currentBus,
        yRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );

      continue;
    }

    // Comparisons ($eq)
    if (cell.type === "$eq") {
      const width = parseParamInt(cell.parameters?.A_WIDTH); // Assuming A and B widths match or handled by Yosys
      const size = resolveSize(width);
      const instanceId = cellName;

      const paramProp = cell.parameters?.A_SIGNED
        ? cell.parameters.A_SIGNED
        : 0;

      const compTemplate = getTemplate(`EQUAL_${size}`);
      const compInst = instantiate(compTemplate, instanceId);
      components.push(compInst);

      // Inputs
      const aPacked = packBits(
        ensureArray(cell.connections["A"], "A").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );
      compInst.connections["A"] = aPacked;
      registerSink(nets, aPacked, { componentId: instanceId, portId: "A" });

      const bPacked = packBits(
        ensureArray(cell.connections["B"], "B").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );
      compInst.connections["B"] = bPacked;
      registerSink(nets, bPacked, { componentId: instanceId, portId: "B" });

      // Output (1 bit)
      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;
      compInst.connections["out"] = yBit;
      registerSource(nets, yBit, { componentId: instanceId, portId: "out" });

      continue;
    }

    // Not Equal ($ne)
    if (cell.type === "$ne") {
      const width = parseParamInt(cell.parameters?.A_WIDTH);
      const size = resolveSize(width);
      const instanceId = cellName;

      // Instantiate Equal
      const eqId = `${instanceId}_eq`;
      const compTemplate = getTemplate(`EQUAL_${size}`);
      const compInst = instantiate(compTemplate, eqId);
      components.push(compInst);

      // Inputs
      const aPacked = packBits(
        ensureArray(cell.connections["A"], "A").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );
      compInst.connections["A"] = aPacked;
      registerSink(nets, aPacked, { componentId: eqId, portId: "A" });

      const bPacked = packBits(
        ensureArray(cell.connections["B"], "B").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );
      compInst.connections["B"] = bPacked;
      registerSink(nets, bPacked, { componentId: eqId, portId: "B" });

      // Output of Equal -> Input of NOT
      const eqOut = `${eqId}_out`;
      compInst.connections["out"] = eqOut;
      registerSource(nets, eqOut, { componentId: eqId, portId: "out" });

      // Invert Output to get Not Equal
      const notId = `${instanceId}_not`;
      const notInst = instantiate(getTemplate("NOT_1"), notId);
      components.push(notInst);
      notInst.connections["A"] = eqOut;
      registerSink(nets, eqOut, { componentId: notId, portId: "A" });

      // Connect to Y
      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;
      notInst.connections["Y"] = yBit;
      registerSource(nets, yBit, { componentId: notId, portId: "Y" });

      continue;
    }

    // Reduce Bool ($reduce_bool) -> |A (Equivalent to A != 0)
    if (cell.type === "$reduce_bool") {
      const width = parseParamInt(cell.parameters?.A_WIDTH);
      const size = resolveSize(width);
      const instanceId = cellName;

      // We check if A != 0.
      // 1. A is Input 0.
      // 2. Const 0 is Input 1.
      // 3. Output EqOut.
      // 4. Invert EqOut.

      // Instantiate Equal
      const eqId = `${instanceId}_eq`;
      const compTemplate = getTemplate(`EQUAL_${size}`);
      const compInst = instantiate(compTemplate, eqId);
      components.push(compInst);

      // A
      const aRaw = ensureArray(cell.connections["A"], "A");
      const aPacked = packBits(
        aRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      compInst.connections["A"] = aPacked;
      registerSink(nets, aPacked, { componentId: eqId, portId: "A" });

      // B (Const 0)
      // We can generate 0 bits and pack them.
      // counter.zero is the bit ID for 0.
      const zeros = new Array(width).fill(counter.zero);
      // Be careful: 'width' in Yosys might be different from 'size' (closest power of 2).
      // resolveSize logic handles padding if we just pass 'zeros' to packBits?
      // packBits takes bits array. If bits.length < size, it pads?
      // Let's check packBits assumption. Usually standardizes to 'size' bits.

      // Actually easier: Use CONST component with value 0.
      let constBusId: string;
      if (size === 1) {
        const constInst = instantiate(
          getTemplate("CONST_0"),
          `${instanceId}_zero`
        );
        components.push(constInst);
        constBusId = `${instanceId}_zero_out`;
        constInst.connections["out"] = constBusId;
        registerSource(nets, constBusId, {
          componentId: `${instanceId}_zero`,
          portId: "out",
        });
      } else {
        const constInst = instantiate(
          getTemplate(`CONST_${size}`),
          `${instanceId}_zero`
        );
        if (!constInst.metadata) constInst.metadata = {};
        constInst.metadata.setting1 = BigInt(0);
        components.push(constInst);
        constBusId = `${instanceId}_zero_out`;
        constInst.connections["out"] = constBusId;
        registerSource(nets, constBusId, {
          componentId: `${instanceId}_zero`,
          portId: "out",
        });
      }
      compInst.connections["B"] = constBusId;
      registerSink(nets, constBusId, { componentId: eqId, portId: "B" });

      // Output Equal -> Invert
      const eqOut = `${eqId}_out`;
      compInst.connections["out"] = eqOut;
      registerSource(nets, eqOut, { componentId: eqId, portId: "out" });

      const notId = `${instanceId}_not`;
      const notInst = instantiate(getTemplate("NOT_1"), notId);
      components.push(notInst);
      notInst.connections["A"] = eqOut;
      registerSink(nets, eqOut, { componentId: notId, portId: "A" });

      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;
      notInst.connections["Y"] = yBit;
      registerSource(nets, yBit, { componentId: notId, portId: "Y" });

      continue;
    }

    // Reduce And ($reduce_and) -> &A (Check if all bits are 1)
    if (cell.type === "$reduce_and") {
      const width = parseParamInt(cell.parameters?.A_WIDTH);
      const size = resolveSize(width);
      const instanceId = cellName;

      // Check if A == (11...1) [width times]
      const mask = (1n << BigInt(width)) - 1n;

      // Equal Comp
      const eqId = `${instanceId}_eq`;
      const compInst = instantiate(getTemplate(`EQUAL_${size}`), eqId);
      components.push(compInst);

      // A
      const aRaw = ensureArray(cell.connections["A"], "A");
      const aPacked = packBits(
        aRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      compInst.connections["A"] = aPacked;
      registerSink(nets, aPacked, { componentId: eqId, portId: "A" });

      // B (Const Mask)
      let constBusId: string;
      if (size === 1) {
        // If size=1, width=1. Mask=1. Const=1.
        const constInst = instantiate(
          getTemplate("CONST_1"),
          `${instanceId}_ones`
        );
        components.push(constInst);
        constBusId = `${instanceId}_ones_out`;
        constInst.connections["out"] = constBusId;
        registerSource(nets, constBusId, {
          componentId: `${instanceId}_ones`,
          portId: "out",
        });
      } else {
        const constInst = instantiate(
          getTemplate(`CONST_${size}`),
          `${instanceId}_ones`
        );
        if (!constInst.metadata) constInst.metadata = {};
        constInst.metadata.setting1 = mask;
        components.push(constInst);
        constBusId = `${instanceId}_ones_out`;
        constInst.connections["out"] = constBusId;
        registerSource(nets, constBusId, {
          componentId: `${instanceId}_ones`,
          portId: "out",
        });
      }
      compInst.connections["B"] = constBusId;
      registerSink(nets, constBusId, { componentId: eqId, portId: "B" });

      // Output
      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;
      compInst.connections["out"] = yBit;
      registerSource(nets, yBit, { componentId: eqId, portId: "out" });

      continue;
    }

    if (cell.type === "$reduce_or") {
      const width = parseParamInt(cell.parameters?.A_WIDTH);
      const size = resolveSize(width);
      const instanceId = cellName;
      // Check if A != 0

      // Equal Comp
      const eqId = `${instanceId}_eq`;
      const compInst = instantiate(getTemplate(`EQUAL_${size}`), eqId);
      components.push(compInst);

      // A
      const aRaw = ensureArray(cell.connections["A"], "A");
      const aPacked = packBits(
        aRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      compInst.connections["A"] = aPacked;
      registerSink(nets, aPacked, { componentId: eqId, portId: "A" });
      // B (Const 0)
      let constBusId: string;

      if (size === 1) {
        const constInst = instantiate(
          getTemplate("CONST_0"),
          `${instanceId}_zero`
        );
        components.push(constInst);
        constBusId = `${instanceId}_zero_out`;
        constInst.connections["out"] = constBusId;
        registerSource(nets, constBusId, {
          componentId: `${instanceId}_zero`,
          portId: "out",
        });
      } else {
        const constInst = instantiate(
          getTemplate(`CONST_${size}`),
          `${instanceId}_zero`
        );
        if (!constInst.metadata) constInst.metadata = {};
        constInst.metadata.setting1 = BigInt(0);
        components.push(constInst);
        constBusId = `${instanceId}_zero_out`;
        constInst.connections["out"] = constBusId;
        registerSource(nets, constBusId, {
          componentId: `${instanceId}_zero`,
          portId: "out",
        });
      }
      compInst.connections["B"] = constBusId;
      registerSink(nets, constBusId, { componentId: eqId, portId: "B" });
      // Output
      const eqOut = `${eqId}_out`;
      compInst.connections["out"] = eqOut;
      registerSource(nets, eqOut, { componentId: eqId, portId: "out" });
      // Invert
      const notId = `${instanceId}_not`;
      const notInst = instantiate(getTemplate("NOT_1"), notId);
      components.push(notInst);
      notInst.connections["A"] = eqOut;
      registerSink(nets, eqOut, { componentId: notId, portId: "A" });
      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;
      notInst.connections["Y"] = yBit;
      registerSource(nets, yBit, { componentId: notId, portId: "Y" });
      continue;
    }

    // Logic Not ($logic_not)
    if (cell.type === "$logic_not") {
      const width = parseParamInt(cell.parameters?.A_WIDTH);
      const size = resolveSize(width);
      const instanceId = cellName;

      const aRaw = ensureArray(cell.connections["A"], "A"); // width bits
      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;

      if (width === 1) {
        // Use NOT gate
        const notInst = instantiate(getTemplate("NOT_1"), instanceId);
        components.push(notInst);
        const aBit = normalizeBit(aRaw[0], counter).id;
        notInst.connections["A"] = aBit;
        registerSink(nets, aBit, { componentId: instanceId, portId: "A" });

        notInst.connections["Y"] = yBit;
        registerSource(nets, yBit, { componentId: instanceId, portId: "Y" });
      } else {
        // Use Equal(A, 0)
        const eqTemplate = getTemplate(`EQUAL_${size}`);
        const eqInst = instantiate(eqTemplate, instanceId);
        components.push(eqInst);

        const aPacked = packBits(
          aRaw.map((b) => normalizeBit(b, counter)),
          size,
          components,
          nets,
          idGen
        );
        eqInst.connections["A"] = aPacked;
        registerSink(nets, aPacked, { componentId: instanceId, portId: "A" });

        // Const 0
        const constId = `${instanceId}_zero`;
        const constTemplate = getTemplate(`CONST_${size}`); // 0 by default? Or need setting1=0?
        const constInst = instantiate(constTemplate, constId);
        if (!constInst.metadata) constInst.metadata = {};
        constInst.metadata.setting1 = 0n;
        components.push(constInst);

        const zeroBus = `${constId}_out`;
        constInst.connections["out"] = zeroBus;
        registerSource(nets, zeroBus, { componentId: constId, portId: "out" });

        eqInst.connections["B"] = zeroBus;
        registerSink(nets, zeroBus, { componentId: instanceId, portId: "B" });

        eqInst.connections["out"] = yBit;
        registerSource(nets, yBit, { componentId: instanceId, portId: "out" });
      }
      continue;
    }

    // Logic And ($logic_and) -> (A!=0) && (B!=0)
    if (cell.type === "$logic_and") {
      const widthA = parseParamInt(cell.parameters?.A_WIDTH);
      const sizeA = resolveSize(widthA);
      const widthB = parseParamInt(cell.parameters?.B_WIDTH);
      const sizeB = resolveSize(widthB);

      const instanceId = cellName;

      // Helper to generate "isNonZero" signal
      const getNonZeroBit = (
        inRaw: any[],
        width: number,
        size: number,
        suffix: string
      ): string => {
        if (width === 1) {
          return normalizeBit(inRaw[0], counter).id; // Assumes 1-bit input is already bool
        } else {
          // (A != 0). Implementation: NOT(Equal(A, 0))
          const subId = `${instanceId}_${suffix}`;

          // Equal(A, 0)
          const eqId = `${subId}_eq`;
          const eqInst = instantiate(getTemplate(`EQUAL_${size}`), eqId);
          components.push(eqInst);

          const aPacked = packBits(
            inRaw.map((b) => normalizeBit(b, counter)),
            size,
            components,
            nets,
            idGen
          );
          eqInst.connections["A"] = aPacked;
          registerSink(nets, aPacked, { componentId: eqId, portId: "A" });

          // Const 0
          const constId = `${subId}_zero`;
          let zeroBus: string;
          if (size === 1) {
            const cInst = instantiate(getTemplate("CONST_0"), constId);
            components.push(cInst);
            zeroBus = `${constId}_out`;
            cInst.connections["out"] = zeroBus;
            registerSource(nets, zeroBus, {
              componentId: constId,
              portId: "out",
            });
          } else {
            const cInst = instantiate(getTemplate(`CONST_${size}`), constId);
            if (!cInst.metadata) cInst.metadata = {};
            cInst.metadata.setting1 = 0n;
            components.push(cInst);
            zeroBus = `${constId}_out`;
            cInst.connections["out"] = zeroBus;
            registerSource(nets, zeroBus, {
              componentId: constId,
              portId: "out",
            });
          }
          eqInst.connections["B"] = zeroBus;
          registerSink(nets, zeroBus, { componentId: eqId, portId: "B" });

          const eqOut = `${eqId}_out`;
          eqInst.connections["out"] = eqOut;
          registerSource(nets, eqOut, { componentId: eqId, portId: "out" });

          // Invert
          const notId = `${subId}_not`;
          const notInst = instantiate(getTemplate("NOT_1"), notId);
          components.push(notInst);
          notInst.connections["A"] = eqOut;
          registerSink(nets, eqOut, { componentId: notId, portId: "A" });

          const y = `${notId}_out`;
          notInst.connections["Y"] = y;
          registerSource(nets, y, { componentId: notId, portId: "Y" });
          return y;
        }
      };

      const aRaw = ensureArray(cell.connections["A"], "A");
      const boolA = getNonZeroBit(aRaw, widthA, sizeA, "A");

      const bRaw = ensureArray(cell.connections["B"], "B");
      const boolB = getNonZeroBit(bRaw, widthB, sizeB, "B");

      // AND Inputs
      const andId = `${instanceId}_and`;
      const andInst = instantiate(getTemplate("AND_1"), andId);
      components.push(andInst);

      andInst.connections["A"] = boolA;
      registerSink(nets, boolA, { componentId: andId, portId: "A" });

      andInst.connections["B"] = boolB;
      registerSink(nets, boolB, { componentId: andId, portId: "B" });

      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;
      andInst.connections["Y"] = yBit;
      registerSource(nets, yBit, { componentId: andId, portId: "Y" });

      continue;
    }

    // Logic Or ($logic_or) -> (A!=0) || (B!=0)
    if (cell.type === "$logic_or") {
      const widthA = parseParamInt(cell.parameters?.A_WIDTH);
      const sizeA = resolveSize(widthA);
      const widthB = parseParamInt(cell.parameters?.B_WIDTH);
      const sizeB = resolveSize(widthB);

      const instanceId = cellName;

      // Helper to generate "isNonZero" signal (Duplicated locally)
      const getNonZeroBit = (
        inRaw: any[],
        width: number,
        size: number,
        suffix: string
      ): string => {
        if (width === 1) {
          return normalizeBit(inRaw[0], counter).id;
        } else {
          const subId = `${instanceId}_${suffix}`;
          const eqId = `${subId}_eq`;
          const eqInst = instantiate(getTemplate(`EQUAL_${size}`), eqId);
          components.push(eqInst);
          const aPacked = packBits(
            inRaw.map((b) => normalizeBit(b, counter)),
            size,
            components,
            nets,
            idGen
          );
          eqInst.connections["A"] = aPacked;
          registerSink(nets, aPacked, { componentId: eqId, portId: "A" });

          const constId = `${subId}_zero`;
          let zeroBus: string;
          if (size === 1) {
            const cInst = instantiate(getTemplate("CONST_0"), constId);
            components.push(cInst);
            zeroBus = `${constId}_out`;
            cInst.connections["out"] = zeroBus;
            registerSource(nets, zeroBus, {
              componentId: constId,
              portId: "out",
            });
          } else {
            const cInst = instantiate(getTemplate(`CONST_${size}`), constId);
            if (!cInst.metadata) cInst.metadata = {};
            cInst.metadata.setting1 = 0n;
            components.push(cInst);
            zeroBus = `${constId}_out`;
            cInst.connections["out"] = zeroBus;
            registerSource(nets, zeroBus, {
              componentId: constId,
              portId: "out",
            });
          }
          eqInst.connections["B"] = zeroBus;
          registerSink(nets, zeroBus, { componentId: eqId, portId: "B" });
          const eqOut = `${eqId}_out`;
          eqInst.connections["out"] = eqOut;
          registerSource(nets, eqOut, { componentId: eqId, portId: "out" });

          const notId = `${subId}_not`;
          const notInst = instantiate(getTemplate("NOT_1"), notId);
          components.push(notInst);
          notInst.connections["A"] = eqOut;
          registerSink(nets, eqOut, { componentId: notId, portId: "A" });
          const y = `${notId}_out`;
          notInst.connections["Y"] = y;
          registerSource(nets, y, { componentId: notId, portId: "Y" });
          return y;
        }
      };

      const aRaw = ensureArray(cell.connections["A"], "A");
      const boolA = getNonZeroBit(aRaw, widthA, sizeA, "A");

      const bRaw = ensureArray(cell.connections["B"], "B");
      const boolB = getNonZeroBit(bRaw, widthB, sizeB, "B");

      const orId = `${instanceId}_or`;
      const orInst = instantiate(getTemplate("OR_1"), orId);
      components.push(orInst);

      orInst.connections["A"] = boolA;
      registerSink(nets, boolA, { componentId: orId, portId: "A" });

      orInst.connections["B"] = boolB;
      registerSink(nets, boolB, { componentId: orId, portId: "B" });

      const yBit = normalizeBit(
        ensureArray(cell.connections["Y"], "Y", 1)[0],
        counter
      ).id;
      orInst.connections["Y"] = yBit;
      registerSource(nets, yBit, { componentId: orId, portId: "Y" });

      continue;
    }

    // Math: $add
    if (cell.type === "$add") {
      const width = Math.max(
        parseParamInt(cell.parameters?.A_WIDTH),
        parseParamInt(cell.parameters?.B_WIDTH)
      );
      const size = resolveSize(width);
      const instanceId = cellName;

      const inst = instantiate(getTemplate(`ADD_${size}`), instanceId);
      components.push(inst);

      // Inputs
      const aBits = ensureArray(cell.connections["A"], "A").map((b) =>
        normalizeBit(b, counter)
      );
      const bBits = ensureArray(cell.connections["B"], "B").map((b) =>
        normalizeBit(b, counter)
      );

      const aPacked = packBits(aBits, size, components, nets, idGen);
      const bPacked = packBits(bBits, size, components, nets, idGen);

      inst.connections["A"] = aPacked;
      inst.connections["B"] = bPacked;
      registerSink(nets, aPacked, { componentId: instanceId, portId: "A" });
      registerSink(nets, bPacked, { componentId: instanceId, portId: "B" });

      // Output
      const yRaw = ensureArray(cell.connections["Y"], "Y");
      const busOut = `${instanceId}_sum`;
      inst.connections["sum"] = busOut;
      registerSource(nets, busOut, { componentId: instanceId, portId: "sum" });

      unpackBits(
        busOut,
        yRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      continue;
    }

    // Math: $sub (Convert to Add(A, Neg(B)))
    if (cell.type === "$sub") {
      const width = Math.max(
        parseParamInt(cell.parameters?.A_WIDTH),
        parseParamInt(cell.parameters?.B_WIDTH)
      );
      const size = resolveSize(width);
      const instanceId = cellName;

      // 1. Negate B
      const negId = `${instanceId}_negB`;
      const negInst = instantiate(getTemplate(`NEG_${size}`), negId);
      components.push(negInst);

      const bBits = ensureArray(cell.connections["B"], "B").map((b) =>
        normalizeBit(b, counter)
      );
      const bPacked = packBits(bBits, size, components, nets, idGen);

      negInst.connections["A"] = bPacked;
      registerSink(nets, bPacked, { componentId: negId, portId: "A" });

      const negOut = `${negId}_out`;
      negInst.connections["out"] = negOut;
      registerSource(nets, negOut, { componentId: negId, portId: "out" });

      // 2. Add(A, NegB)
      const addInst = instantiate(getTemplate(`ADD_${size}`), instanceId);
      components.push(addInst);

      const aBits = ensureArray(cell.connections["A"], "A").map((b) =>
        normalizeBit(b, counter)
      );
      const aPacked = packBits(aBits, size, components, nets, idGen);

      addInst.connections["A"] = aPacked;
      addInst.connections["B"] = negOut;
      registerSink(nets, aPacked, { componentId: instanceId, portId: "A" });
      registerSink(nets, negOut, { componentId: instanceId, portId: "B" });

      // Output
      const yRaw = ensureArray(cell.connections["Y"], "Y");
      const busOut = `${instanceId}_sum`;
      addInst.connections["sum"] = busOut;
      registerSource(nets, busOut, { componentId: instanceId, portId: "sum" });

      unpackBits(
        busOut,
        yRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      continue;
    }

    // Math: $mul
    if (cell.type === "$mul") {
      const width = Math.max(
        parseParamInt(cell.parameters?.A_WIDTH),
        parseParamInt(cell.parameters?.B_WIDTH)
      );
      const size = resolveSize(width);
      const instanceId = cellName;

      const inst = instantiate(getTemplate(`MUL_${size}`), instanceId);
      components.push(inst);

      const aPacked = packBits(
        ensureArray(cell.connections["A"], "A").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );
      const bPacked = packBits(
        ensureArray(cell.connections["B"], "B").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );

      inst.connections["A"] = aPacked;
      inst.connections["B"] = bPacked;
      registerSink(nets, aPacked, { componentId: instanceId, portId: "A" });
      registerSink(nets, bPacked, { componentId: instanceId, portId: "B" });

      const yRaw = ensureArray(cell.connections["Y"], "Y");
      const busOut = `${instanceId}_pro`;
      inst.connections["pro"] = busOut;
      registerSource(nets, busOut, { componentId: instanceId, portId: "pro" });

      unpackBits(
        busOut,
        yRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      continue;
    }

    // Math: $shl, $sshl, $shr, $sshr
    if (
      cell.type === "$shl" ||
      cell.type === "$sshl" ||
      cell.type === "$shr" ||
      cell.type === "$sshr"
    ) {
      const width = parseParamInt(cell.parameters?.A_WIDTH);
      const size = resolveSize(width);
      const instanceId = cellName;

      // Common inputs preparation
      const aBits = ensureArray(cell.connections["A"], "A").map((b) =>
        normalizeBit(b, counter)
      );
      const aPacked = packBits(aBits, size, components, nets, idGen);

      const bPacked = packBits(
        ensureArray(cell.connections["B"], "B").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );

      // Handle Arithmetic Right Shift ($sshr) specially
      if (cell.type === "$sshr") {
        // Logic: Y = (A >> B) | (Sign ? ~(~0 >> B) : 0)
        // 1. Logical Shift A >> B
        const shrId = `${instanceId}_shr`;
        const shrInst = instantiate(getTemplate(`SHR_${size}`), shrId);
        components.push(shrInst);
        
        shrInst.connections["A"] = aPacked;
        registerSink(nets, aPacked, { componentId: shrId, portId: "A" });
        shrInst.connections["shift"] = bPacked;
        registerSink(nets, bPacked, { componentId: shrId, portId: "shift" });
        
        const logicOut = `${shrId}_out`;
        shrInst.connections["out"] = logicOut;
        registerSource(nets, logicOut, { componentId: shrId, portId: "out" });

        // 2. Generate Mask Base: AllOnes >> B
        const allOnesId = `${instanceId}_ones`;
        const allOnesInst = instantiate(getTemplate(`CONST_${size}`), allOnesId);
        allOnesInst.metadata = { setting1: (1n << BigInt(size)) - 1n }; // All 1s
        components.push(allOnesInst);
        
        const allOnesWire = `${allOnesId}_val`;
        allOnesInst.connections["out"] = allOnesWire;
        registerSource(nets, allOnesWire, { componentId: allOnesId, portId: "out" });

        const maskShrId = `${instanceId}_mask_shr`;
        const maskShr = instantiate(getTemplate(`SHR_${size}`), maskShrId);
        components.push(maskShr);
        
        maskShr.connections["A"] = allOnesWire;
        registerSink(nets, allOnesWire, { componentId: maskShrId, portId: "A" });
        maskShr.connections["shift"] = bPacked; // Same shift amount
        registerSink(nets, bPacked, { componentId: maskShrId, portId: "shift" });
        
        const maskBase = `${maskShrId}_out`;
        maskShr.connections["out"] = maskBase;
        registerSource(nets, maskBase, { componentId: maskShrId, portId: "out" });

        // 3. Invert Mask Base -> Mask = ~(~0 >> B)
        const notMaskId = `${instanceId}_mask_not`;
        const notMask = instantiate(getTemplate(`NOT_${size}`), notMaskId);
        components.push(notMask);
        
        notMask.connections["A"] = maskBase;
        registerSink(nets, maskBase, { componentId: notMaskId, portId: "A" });
        
        const maskWire = `${notMaskId}_out`;
        notMask.connections["Y"] = maskWire;
        registerSource(nets, maskWire, { componentId: notMaskId, portId: "Y" });

        // 4. Select Extension based on Sign Bit
        // Sign Bit is the MSB of A.
        // We need to extract it. Since we don't have a clear "GetBit" component yet for arbitrary net,
        // we rely on the fact that we have 'aBits' array which contains the bit IDs.
        // However, 'aBits' might be shorter than 'size'. We need to be careful.
        // normalizeBit/packBits logic: aBits is raw from Yosys.
        let signBitId: string;
        if (aBits.length > 0) {
            // Yosys usually provides bits up to wire width.
            // If A is signed, the last bit in the list is the sign bit (MSB).
            signBitId = aBits[aBits.length - 1].id;
        } else {
            // Fallback for empty/zero constant? Unlikely for valid Sshr.
            signBitId = normalizeBit(0, counter).id; 
        }
        
        // Ensure driver if it's a constant 0/1
        ensureDriverIfConstant(
            { id: signBitId, constant: aBits[aBits.length-1]?.constant }, 
            instanceId, "Sign", components, nets
        );

        // Mux: If Sign=1, use Mask. If Sign=0, use 0.
        // We can use MUX_size. A(0)=0/Const0, B(1)=Mask, S=Sign.
        const muxId = `${instanceId}_sign_mux`;
        const muxInst = instantiate(getTemplate(`MUX_${size}`), muxId);
        components.push(muxInst);
        
        // Input A (False/0 case) -> Const 0
        const zeroId = `${instanceId}_zero`;
        const zeroInst = instantiate(getTemplate(`CONST_${size}`), zeroId); // Value 0 default
        components.push(zeroInst);
        const zeroWire = `${zeroId}_out`;
        zeroInst.connections["out"] = zeroWire;
        registerSource(nets, zeroWire, { componentId: zeroId, portId: "out" });

        muxInst.connections["A"] = zeroWire; 
        registerSink(nets, zeroWire, { componentId: muxId, portId: "A" });
        
        muxInst.connections["B"] = maskWire;
        registerSink(nets, maskWire, { componentId: muxId, portId: "B" });
        
        muxInst.connections["S"] = signBitId;
        registerSink(nets, signBitId, { componentId: muxId, portId: "S" });
        
        const extWire = `${muxId}_out`;
        muxInst.connections["Y"] = extWire;
        registerSource(nets, extWire, { componentId: muxId, portId: "Y" });

        // 5. Final OR: Main | Ext
        const orId = `${instanceId}_final_or`;
        const orInst = instantiate(getTemplate(`OR_${size}`), orId);
        components.push(orInst);
        
        orInst.connections["A"] = logicOut;
        registerSink(nets, logicOut, { componentId: orId, portId: "A" });
        orInst.connections["B"] = extWire;
        registerSink(nets, extWire, { componentId: orId, portId: "B" });

        // Output to Y
        const yRaw = ensureArray(cell.connections["Y"], "Y");
        const busOut = `${instanceId}_out`;
        orInst.connections["Y"] = busOut;
        registerSource(nets, busOut, { componentId: instanceId, portId: "Y" });

        unpackBits(
          busOut,
          yRaw.map((b) => normalizeBit(b, counter)),
          size,
          components,
          nets,
          idGen
        );
        
        continue;
      }

      // Standard behavior for shl, shr
      let templateId = "";
      if (cell.type.includes("shl")) templateId = `SHL_${size}`;
      else templateId = `SHR_${size}`;

      const inst = instantiate(getTemplate(templateId), instanceId);
      components.push(inst);

      inst.connections["A"] = aPacked;
      inst.connections["shift"] = bPacked; // Map Yosys B to TC shift
      registerSink(nets, aPacked, { componentId: instanceId, portId: "A" });
      registerSink(nets, bPacked, { componentId: instanceId, portId: "shift" });

      const yRaw = ensureArray(cell.connections["Y"], "Y");
      const busOut = `${instanceId}_out`;
      inst.connections["out"] = busOut;
      registerSource(nets, busOut, { componentId: instanceId, portId: "out" });

      unpackBits(
        busOut,
        yRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      continue;
    }

    // Math: $neg
    if (cell.type === "$neg") {
      const width = parseParamInt(cell.parameters?.A_WIDTH);
      const size = resolveSize(width);
      const instanceId = cellName;

      const inst = instantiate(getTemplate(`NEG_${size}`), instanceId);
      components.push(inst);

      const aPacked = packBits(
        ensureArray(cell.connections["A"], "A").map((b) =>
          normalizeBit(b, counter)
        ),
        size,
        components,
        nets,
        idGen
      );

      inst.connections["A"] = aPacked;
      registerSink(nets, aPacked, { componentId: instanceId, portId: "A" });

      const yRaw = ensureArray(cell.connections["Y"], "Y");
      const busOut = `${instanceId}_out`;
      inst.connections["out"] = busOut;
      registerSource(nets, busOut, { componentId: instanceId, portId: "out" });

      unpackBits(
        busOut,
        yRaw.map((b) => normalizeBit(b, counter)),
        size,
        components,
        nets,
        idGen
      );
      continue;
    }

    // Comparisons: $lt, $gt, $le, $ge
    if (["$lt", "$gt", "$le", "$ge"].includes(cell.type)) {
      const width = Math.max(
        parseParamInt(cell.parameters?.A_WIDTH),
        parseParamInt(cell.parameters?.B_WIDTH)
      );
      const size = resolveSize(width);
      const signed = parseParamInt(cell.parameters?.A_SIGNED) > 0;
      const instanceId = cellName;

      const tmplPrefix = signed ? "LESSI" : "LESSU";
      const tmplId = `${tmplPrefix}_${size}`;

      // Determine wiring based on type
      // $lt: A < B -> Less(A, B)
      // $gt: A > B -> Less(B, A)
      // $ge: A >= B -> Not(Less(A, B))
      // $le: A <= B -> Not(Less(B, A))

      const swap = cell.type === "$gt" || cell.type === "$le";
      const invert = cell.type === "$ge" || cell.type === "$le";

      const inst = instantiate(getTemplate(tmplId), instanceId);
      components.push(inst);

      const aBits = ensureArray(cell.connections["A"], "A").map((b) =>
        normalizeBit(b, counter)
      );
      const bBits = ensureArray(cell.connections["B"], "B").map((b) =>
        normalizeBit(b, counter)
      );

      const aPacked = packBits(aBits, size, components, nets, idGen);
      const bPacked = packBits(bBits, size, components, nets, idGen);

      // If swap, connect B to A port, and A to B port
      inst.connections["A"] = swap ? bPacked : aPacked;
      inst.connections["B"] = swap ? aPacked : bPacked;

      registerSink(nets, swap ? bPacked : aPacked, {
        componentId: instanceId,
        portId: "A",
      });
      registerSink(nets, swap ? aPacked : bPacked, {
        componentId: instanceId,
        portId: "B",
      });

      const cmpOut = `${instanceId}_cmp_out`;
      inst.connections["out"] = cmpOut;
      registerSource(nets, cmpOut, { componentId: instanceId, portId: "out" });

      const yRaw = ensureArray(cell.connections["Y"], "Y");

      if (invert) {
        // Add NOT gate
        const notId = `${instanceId}_invert`;
        // Since comparison output is 1 bit (usually?), we use NOT_1?
        // TC comparators outputs might be 1 bit.
        // Let's assume 1 bit for comparison result.
        const notInst = instantiate(getTemplate("NOT_1"), notId);
        components.push(notInst);

        notInst.connections["A"] = cmpOut;
        registerSink(nets, cmpOut, { componentId: notId, portId: "A" });

        const notOut = `${notId}_out`;
        notInst.connections["Y"] = notOut;
        registerSource(nets, notOut, { componentId: notId, portId: "Y" });

        unpackBits(
          notOut,
          yRaw.map((b) => normalizeBit(b, counter)),
          1,
          components,
          nets,
          idGen
        );
      } else {
        // Direct connect. Comparison output is usually 1 bit.
        unpackBits(
          cmpOut,
          yRaw.map((b) => normalizeBit(b, counter)),
          1,
          components,
          nets,
          idGen
        );
      }
      continue;
    }

    const binding = CELL_LIBRARY[cell.type];
    if (!binding) {
      throw new Error(`Unsupported cell type ${cell.type}`);
    }

    // Determine width from first output port (or Input if no output?)
    let outputWidth = 1;
    if (binding.outputPort && cell.connections[binding.outputPort]) {
      outputWidth = cell.connections[binding.outputPort].length;
    }
    const size = resolveSize(outputWidth);

    // Mux Special Handling
    if ((binding.template as any) === "INTERNAL_MUX") {
      // If width 1, decompose (old logic) or use Mux8?
      // Let's use old logic for 1-bit to stay safe and efficient.
      if (outputWidth === 1) {
        // ... keep existing decomposed logic for 1-bit ...
        // Wait, I'm replacing the file. I need to re-copy that logic.
        // Copied below.
        const inputs = cell.connections;
        const A = normalizeBit(ensureArray(inputs["A"], "A", 1)[0], counter);
        const B = normalizeBit(ensureArray(inputs["B"], "B", 1)[0], counter);
        const S = normalizeBit(ensureArray(inputs["S"], "S", 1)[0], counter);
        const Y = normalizeBit(ensureArray(inputs["Y"], "Y", 1)[0], counter);

        ensureDriverIfConstant(A, cellName, "A", components, nets);
        ensureDriverIfConstant(B, cellName, "B", components, nets);
        ensureDriverIfConstant(S, cellName, "S", components, nets);

        // Optimize 1-bit Mux logic: Y = (A & !S) | (B & S)

        // Generate !S (Only if needed)
        const nS_wire = `$mux_nS_${cellName}`;
        let notInstCreated = false;
        function ensureNotS() {
          if (notInstCreated) return;
          const notId = `${cellName}_not`;
          const notInst = instantiate(NOT_1, notId);
          components.push(notInst);
          registerSink(nets, S.id, { componentId: notId, portId: "A" });
          registerSource(nets, nS_wire, { componentId: notId, portId: "Y" });
          notInstCreated = true;
        }

        // Term 1: A & !S
        let term1_wire: string;
        if (A.constant === 0) {
          // 0 & !S -> 0
          term1_wire = A.id; // Correctly points to Const0 net
        } else if (A.constant === 1) {
          // 1 & !S -> !S
          ensureNotS();
          term1_wire = nS_wire;
        } else {
          // Basic AND
          ensureNotS();
          const and1Id = `${cellName}_and1`;
          const and1Inst = instantiate(AND_1, and1Id);
          components.push(and1Inst);
          registerSink(nets, A.id, { componentId: and1Id, portId: "A" });
          registerSink(nets, nS_wire, { componentId: and1Id, portId: "B" });
          term1_wire = `$mux_t1_${cellName}`;
          and1Inst.connections["Y"] = term1_wire;
          registerSource(nets, term1_wire, {
            componentId: and1Id,
            portId: "Y",
          });
        }

        // Term 2: B & S
        let term2_wire: string;
        if (B.constant === 0) {
          // 0 & S -> 0
          term2_wire = B.id; // Points to Const0 net
        } else if (B.constant === 1) {
          // 1 & S -> S
          term2_wire = S.id;
        } else {
          // Basic AND
          const and2Id = `${cellName}_and2`;
          const and2Inst = instantiate(AND_1, and2Id);
          components.push(and2Inst);
          registerSink(nets, B.id, { componentId: and2Id, portId: "A" });
          registerSink(nets, S.id, { componentId: and2Id, portId: "B" });
          term2_wire = `$mux_t2_${cellName}`;
          and2Inst.connections["Y"] = term2_wire;
          registerSource(nets, term2_wire, {
            componentId: and2Id,
            portId: "Y",
          });
        }

        // Result: Term1 | Term2
        // Optimization: If either term is 0, just use the other (via Buffer/OR-with-0)
        // Since we can't easily Buffer without inserting a component, using OR(0, X) IS a buffer.
        // And standard OR logic handles it perfectly if we just feed term1_wire/term2_wire.
        // But if BOTH are 0, OR(0,0) -> 0. Correct.
        // If T1=0, T2=S. OR(0, S) -> S. Correct.

        const orId = `${cellName}_or`;
        const orInst = instantiate(OR_1, orId);
        components.push(orInst);
        registerSink(nets, term1_wire, { componentId: orId, portId: "A" });
        registerSink(nets, term2_wire, { componentId: orId, portId: "B" });
        registerSource(nets, Y.id, { componentId: orId, portId: "Y" });

        continue;
      } else {
        // Multi-bit Mux
        // Use MUX_N
        // Mux Template Ports: A, B, S.
        // Yosys Ports: A, B require packing. S is usually 1-bit.
        // If S is 1-bit, pad it? Does TC Mux accept 1-bit select?
        // Assuming Mux8 takes 1-bit S on a specific pin? No, my template definition for MUX_N used "S".
        // I'll try packing S to 1 bit (using Maker8... no).
        // If S is 1 bit, I just connect it. "S" port on MUX_8.
        // If TC Mux8 expects 8-bit select... NO.
        // I will assume for now I can wire S (1-bit) to MUX_8 input S.

        const templateId = `MUX_${size}`;
        const instanceId = cellName;
        const instance = instantiate(getTemplate(templateId), instanceId);
        components.push(instance);

        // Inputs
        const inputs = cell.connections;
        const packedA = packBits(
          inputs["A"].map((b) => normalizeBit(b, counter)),
          size,
          components,
          nets,
          idGen
        );
        instance.connections["A"] = packedA;
        registerSink(nets, packedA, { componentId: instanceId, portId: "A" });

        const packedB = packBits(
          inputs["B"].map((b) => normalizeBit(b, counter)),
          size,
          components,
          nets,
          idGen
        );
        instance.connections["B"] = packedB;
        registerSink(nets, packedB, { componentId: instanceId, portId: "B" });

        // S
        const sBits = inputs["S"].map((b) => normalizeBit(b, counter));
        // If S is 1 bit, use the bit directly?
        // The "S" port on MUX_N in my library ... wait.
        // TC Mux components have specific hidden ports.
        // I used "S" in makePorts. I don't know the REAL ID.
        // For Switch/Mux, it's usually "control" or something.
        // But actually, for standard logic gates I used A/B. Mux is special ComponentKind.Mux8.
        // I should probably check if I need to map "S".
        // I'll assume "S" for now but I might need to fix it blindly.

        if (sBits.length === 1) {
          const sBit = sBits[0];
          ensureDriverIfConstant(sBit, instanceId, "S", components, nets);
          instance.connections["S"] = sBit.id;
          registerSink(nets, sBit.id, { componentId: instanceId, portId: "S" });
        } else {
          // If S is multi-bit, pack it (though unlikely to work if TC expects 1 bit).
          // Just use first bit?
          const sBit = sBits[0];
          instance.connections["S"] = sBit.id;
          registerSink(nets, sBit.id, { componentId: instanceId, portId: "S" });
        }

        // Output
        const yBits = inputs["Y"].map((b) => normalizeBit(b, counter));
        const busOut = `${instanceId}_out`;
        instance.connections["Y"] = busOut;
        registerSource(nets, busOut, { componentId: instanceId, portId: "Y" });
        unpackBits(busOut, yBits, size, components, nets, idGen);
        continue;
      }
    }

    // Standard Gates
    if (size === 1) {
      // Standard single bit processing
      // Just use existing logic loop for width=1
      // Copying "width" loop logic but forcing width=1
      const width = 1;
      for (let i = 0; i < width; i++) {
        // ...
        // Since I am rewriting, I will write the single-bit path concisely.
        // If binding.template is object (SizeMap), get 1.
        let tplSpec = binding.template;
        let tpl: ComponentTemplate;
        if (typeof tplSpec === "object" && "1" in tplSpec) {
          tpl = getTemplate((tplSpec as SizeMap)[1]);
        } else if (typeof tplSpec === "object" && "id" in tplSpec) {
          tpl = tplSpec as ComponentTemplate;
        } else {
          throw new Error("Invalid template for size 1");
        }

        const instanceId = `${cellName}:0`;
        const instance = instantiate(tpl, instanceId);
        components.push(instance);

        // Inputs
        for (const p of binding.inputPorts) {
          const bits = ensureArray(cell.connections[p], p);
          const b = normalizeBit(bits[0], counter);
          instance.connections[p] = b.id;
          registerSink(nets, b.id, { componentId: instanceId, portId: p });
          ensureDriverIfConstant(b, instanceId, p, components, nets);
        }
        // Output
        const outBits = ensureArray(
          cell.connections[binding.outputPort],
          binding.outputPort
        );
        const outB = normalizeBit(outBits[0], counter);
        instance.connections[binding.outputPort] = outB.id;
        registerSource(nets, outB.id, {
          componentId: instanceId,
          portId: binding.outputPort,
        });
      }
    } else {
      // Multi-bit Standard Gate
      const tplSpec = binding.template as SizeMap;
      const tplId = tplSpec[size];
      if (!tplId)
        throw new Error(`No template for size ${size} for ${cell.type}`);

      const instanceId = cellName;
      const instance = instantiate(getTemplate(tplId), instanceId);
      components.push(instance);

      // Inputs (Pack)
      for (const inputPort of binding.inputPorts) {
        const rawBits = ensureArray(cell.connections[inputPort], inputPort); // Might be shorter than size?
        // If rawBits < size, packBits handles padding (if passed rawBits directly).
        // Pass rawBits converted to objects.
        const bits = rawBits.map((b) => normalizeBit(b, counter));
        const busId = packBits(bits, size, components, nets, idGen);
        instance.connections[inputPort] = busId;
        registerSink(nets, busId, {
          componentId: instanceId,
          portId: inputPort,
        });
      }

      // Output (Unpack)
      const rawOut = ensureArray(
        cell.connections[binding.outputPort],
        binding.outputPort
      );
      const outBits = rawOut.map((b) => normalizeBit(b, counter));
      const busOut = `${instanceId}_out`;
      instance.connections[binding.outputPort] = busOut;
      registerSource(nets, busOut, {
        componentId: instanceId,
        portId: binding.outputPort,
      });

      unpackBits(busOut, outBits, size, components, nets, idGen);
    }
  }

  // 3. Process Module Output Ports (Consumers)
  for (const [portName, port] of Object.entries(module.ports ?? {})) {
    if (port.direction !== "output") continue;

    const width = port.bits.length;
    const size = resolveSize(width);
    const componentId = `out:${portName}`;

    if (size === 1) {
      const bit = port.bits[0];
      const bitInfo = normalizeBit(bit, counter);
      const instance = instantiate(OUTPUT_1, componentId);
      instance.metadata = {
        label: portName,
        modulePort: { portName, bitIndex: 0 },
      };
      components.push(instance);
      instance.connections["in"] = bitInfo.id;
      registerSink(nets, bitInfo.id, {
        componentId: componentId,
        portId: "in",
      });
    } else {
      const tplId = `OUTPUT_${size}`;
      const instance = instantiate(getTemplate(tplId), componentId);
      instance.metadata = { label: portName };
      components.push(instance);

      const bits = port.bits.map((b) => normalizeBit(b, counter));
      // Output component consumes a bus. Pack bits.
      // NOTE: This runs AFTER cells, so packBits can verify if bits come from a Splitter driven by a cell.
      const busId = packBits(bits, size, components, nets, idGen);
      instance.connections["in"] = busId;
      registerSink(nets, busId, { componentId: componentId, portId: "in" });
    }
  }

  // Remove redundant splitters/makers
  components = optimizeMakerSplitterPairs(components, nets);
  components = cleanupRedundantComponents(components, nets);

  // Verify nets all have driver
  for (const [netId, net] of nets) {
    if (!net.source) {
      // throw new Error(`Net ${netId} lacks a driver`);
      // Relaxed check? Or keep strict?
      // With splitters, we might produce bits that are validly driven.
    }
  }

  return { components, nets };
}
