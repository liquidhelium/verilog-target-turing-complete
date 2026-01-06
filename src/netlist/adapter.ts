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
} from "../tc/componentLibrary.js";
import { ComponentInstance, NetBit, NetBitId, NetlistGraph, PortRef } from "./types.js";

interface YosysPort {
  direction: "input" | "output" | "inout";
  bits: Array<number | string>;
}

interface YosysCell {
  type: string;
  connections: Record<string, Array<number | string>>;
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

interface TemplateBinding {
  template: ComponentTemplate;
  inputPorts: string[];
  outputPort: string;
}

const CELL_LIBRARY: Record<string, TemplateBinding> = {
  "$and": { template: AND_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_AND_": { template: AND_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$or": { template: OR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_OR_": { template: OR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$xor": { template: XOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_XOR_": { template: XOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$xnor": { template: XOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_XNOR_": { template: XOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$not": { template: NOT_1, inputPorts: ["A"], outputPort: "Y" },
  "$_NOT_": { template: NOT_1, inputPorts: ["A"], outputPort: "Y" },
  "$mux": { template: "INTERNAL_MUX", inputPorts: ["A", "B", "S"], outputPort: "Y" } as any,
  "$_MUX_": { template: "INTERNAL_MUX", inputPorts: ["A", "B", "S"], outputPort: "Y" } as any,
};

const CONST_ZERO_ID = "__const0";
const CONST_ONE_ID = "__const1";

function ensureArray<T>(value: Array<T> | undefined, name: string, size: number): Array<T> {
  if (!value) {
    throw new Error(`Expected connection ${name}`);
  }
  if (value.length !== size) {
    throw new Error(`Connection ${name} has unexpected width ${value.length}, expected ${size}`);
  }
  return value;
}

function normalizeBit(bit: number | string, counter: { zero: number; one: number }): { id: NetBitId; constant?: 0 | 1 } {
  if (typeof bit === "number") {
    return { id: String(bit) };
  }
  if (bit === "0" || bit === "1") {
    if (bit === "0") {
      return { id: `${CONST_ZERO_ID}_${counter.zero++}`, constant: 0 };
    }
    return { id: `${CONST_ONE_ID}_${counter.one++}`, constant: 1 };
  }
  if (/^\d+$/.test(bit)) {
    return { id: bit };
  }
  throw new Error(`Unsupported bit reference ${bit}`);
}

function registerSource(nets: Map<NetBitId, NetBit>, bitId: NetBitId, ref: PortRef): void {
  const net = nets.get(bitId) ?? { id: bitId, sinks: [] };
  if (net.source) {
    throw new Error(`Net ${bitId} already has a driver`);
  }
  net.source = ref;
  nets.set(bitId, net);
}

function registerSink(nets: Map<NetBitId, NetBit>, bitId: NetBitId, ref: PortRef): void {
  const net = nets.get(bitId) ?? { id: bitId, sinks: [] };
  net.sinks.push(ref);
  nets.set(bitId, net);
}

function instantiate(template: ComponentTemplate, id: string): ComponentInstance {
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
    const constId = `${destinationId}:${portName}:const`;
    const constTemplate = bitInfo.constant === 0 ? CONST_0 : CONST_1;
    const constInstance = instantiate(constTemplate, constId);
    components.push(constInstance);
    constInstance.connections["out"] = bitInfo.id;
    // Only register source if it doesn't exist (constants might be shared or unique? 
    // normalizeBit returns unique IDs for constants so we are safe to always register)
    registerSource(nets, bitInfo.id, { componentId: constId, portId: "out" });
  }
}

export function buildNetlistFromYosys(json: unknown, options: YosysAdapterOptions): NetlistGraph {
  const counter = { zero: 0, one: 0 };
  const parsed: YosysJson = typeof json === "string" ? JSON.parse(json) : (json as YosysJson);
  const module = parsed.modules?.[options.topModule];
  if (!module) {
    throw new Error(`Top module ${options.topModule} not found in Yosys output`);
  }

  const components: ComponentInstance[] = [];
  const nets: Map<NetBitId, NetBit> = new Map();

  // Module ports
  for (const [portName, port] of Object.entries(module.ports ?? {})) {
    const isInput = port.direction === "input";
    const isOutput = port.direction === "output";
    if (!isInput && !isOutput) {
      throw new Error(`Unsupported port direction ${port.direction} for ${portName}`);
    }
    port.bits.forEach((bit, index) => {
      const bitInfo = normalizeBit(bit, counter);
      if (bitInfo.constant !== undefined) {
        throw new Error(`Module port ${portName}[${index}] is tied to constant ${bitInfo.constant}`);
      }
      const componentId = `${isInput ? "in" : "out"}:${portName}:${index}`;
      const instance = instantiate(isInput ? INPUT_1 : OUTPUT_1, componentId);
      instance.metadata = { label: `${portName}[${index}]`, modulePort: { portName, bitIndex: index } };
      components.push(instance);
      instance.connections[isInput ? "out" : "in"] = bitInfo.id;
      if (isInput) {
        registerSource(nets, bitInfo.id, { componentId, portId: "out" });
      } else {
        registerSink(nets, bitInfo.id, { componentId, portId: "in" });
      }
    });
  }

  // Cells
  for (const [cellName, cell] of Object.entries(module.cells ?? {})) {
    const binding = CELL_LIBRARY[cell.type];
    if (!binding) {
      throw new Error(`Unsupported cell type ${cell.type}`);
    }

    if ((binding.template as any) === "INTERNAL_MUX") {
      // Yosys $mux: Y = S ? B : A
      // Implementation: Y = (A & !S) | (B & S)
      const inputs = cell.connections;
      const A = normalizeBit(ensureArray(inputs["A"], "A", 1)[0], counter);
      const B = normalizeBit(ensureArray(inputs["B"], "B", 1)[0], counter);
      const S = normalizeBit(ensureArray(inputs["S"], "S", 1)[0], counter);
      const Y = normalizeBit(ensureArray(inputs["Y"], "Y", 1)[0], counter);

      // Ensure drivers if inputs are constants
      // We associate the constant driver with the 'cellName' generally, 
      // even though we are decomposing it.
      ensureDriverIfConstant(A, cellName, "A", components, nets);
      ensureDriverIfConstant(B, cellName, "B", components, nets);
      ensureDriverIfConstant(S, cellName, "S", components, nets);

      // Create internal wires
      const nS_wire = `$mux_nS_${cellName}`; // Wire for !S
      const term1_wire = `$mux_t1_${cellName}`; // Wire for (A & !S)
      const term2_wire = `$mux_t2_${cellName}`; // Wire for (B & S)

      // 1. NOT gate: nS = !S
      const notId = `${cellName}_not`;
      const notInst = instantiate(NOT_1, notId);
      components.push(notInst);
      registerSink(nets, S.id, { componentId: notId, portId: "A" });
      registerSource(nets, nS_wire, { componentId: notId, portId: "Y" });

      // 2. AND gate 1: term1 = A & nS
      const and1Id = `${cellName}_and1`;
      const and1Inst = instantiate(AND_1, and1Id);
      components.push(and1Inst);
      registerSink(nets, A.id, { componentId: and1Id, portId: "A" });
      registerSink(nets, nS_wire, { componentId: and1Id, portId: "B" });
      registerSource(nets, term1_wire, { componentId: and1Id, portId: "Y" });

      // 3. AND gate 2: term2 = B & S
      const and2Id = `${cellName}_and2`;
      const and2Inst = instantiate(AND_1, and2Id);
      components.push(and2Inst);
      registerSink(nets, B.id, { componentId: and2Id, portId: "A" });
      registerSink(nets, S.id, { componentId: and2Id, portId: "B" });
      registerSource(nets, term2_wire, { componentId: and2Id, portId: "Y" });

      // 4. OR gate: Y = term1 | term2
      const orId = `${cellName}_or`;
      const orInst = instantiate(OR_1, orId);
      components.push(orInst);
      registerSink(nets, term1_wire, { componentId: orId, portId: "A" });
      registerSink(nets, term2_wire, { componentId: orId, portId: "B" });
      registerSource(nets, Y.id, { componentId: orId, portId: "Y" });

      continue;
    }
    const outputBits = cell.connections[binding.outputPort];
    if (!outputBits || outputBits.length === 0) {
      throw new Error(`Cell ${cellName} missing output connection`);
    }
    const width = outputBits.length;

    for (let i = 0; i < width; i += 1) {
      const instanceId = `${cellName}:${i}`;
      const instance = instantiate(binding.template, instanceId);
      components.push(instance);

      // Inputs
      for (const inputPort of binding.inputPorts) {
        const portBits = ensureArray(cell.connections[inputPort], inputPort, width);
        const bitInfo = normalizeBit(portBits[i], counter);
        instance.connections[inputPort === "A" ? "A" : inputPort === "B" ? "B" : inputPort] = bitInfo.id;
        registerSink(nets, bitInfo.id, { componentId: instanceId, portId: inputPort });
        ensureDriverIfConstant(bitInfo, instanceId, inputPort, components, nets);
      }

      const outBitInfo = normalizeBit(outputBits[i], counter);
      instance.connections[binding.outputPort] = outBitInfo.id;
      registerSource(nets, outBitInfo.id, { componentId: instanceId, portId: binding.outputPort });
      if (outBitInfo.constant !== undefined) {
        throw new Error(`Unexpected constant on cell output for ${cellName}`);
      }
    }
  }

  // Verify nets all have driver
  for (const [netId, net] of nets) {
    if (!net.source) {
      throw new Error(`Net ${netId} lacks a driver`);
    }
  }

  return { components, nets };
}
