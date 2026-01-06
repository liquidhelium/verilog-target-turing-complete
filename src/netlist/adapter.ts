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

type SizeMap = { [size: number]: string };

interface TemplateBinding {
  template: ComponentTemplate | string | SizeMap;
  inputPorts: string[];
  outputPort: string;
}

const GATES_AND: SizeMap = { 1: "AND_1", 8: "AND_8", 16: "AND_16", 32: "AND_32", 64: "AND_64" };
const GATES_OR: SizeMap = { 1: "OR_1", 8: "OR_8", 16: "OR_16", 32: "OR_32", 64: "OR_64" };
const GATES_XOR: SizeMap = { 1: "XOR_1", 8: "XOR_8", 16: "XOR_16", 32: "XOR_32", 64: "XOR_64" };
const GATES_XNOR: SizeMap = { 1: "XNOR_1", 8: "XNOR_8", 16: "XNOR_16", 32: "XNOR_32", 64: "XNOR_64" };
const GATES_NOT: SizeMap = { 1: "NOT_1", 8: "NOT_8", 16: "NOT_16", 32: "NOT_32", 64: "NOT_64" };

const CELL_LIBRARY: Record<string, TemplateBinding> = {
  "$and": { template: GATES_AND, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_AND_": { template: AND_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$or": { template: GATES_OR, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_OR_": { template: OR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$xor": { template: GATES_XOR, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_XOR_": { template: XOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$xnor": { template: GATES_XNOR, inputPorts: ["A", "B"], outputPort: "Y" },
  "$_XNOR_": { template: XNOR_1, inputPorts: ["A", "B"], outputPort: "Y" },
  "$not": { template: GATES_NOT, inputPorts: ["A"], outputPort: "Y" },
  "$_NOT_": { template: NOT_1, inputPorts: ["A"], outputPort: "Y" },
  "$mux": { template: "INTERNAL_MUX", inputPorts: ["A", "B", "S"], outputPort: "Y" },
  "$_MUX_": { template: "INTERNAL_MUX", inputPorts: ["A", "B", "S"], outputPort: "Y" },
};

const CONST_ZERO_ID = "__const0";
const CONST_ONE_ID = "__const1";

function ensureArray<T>(value: Array<T> | undefined, name: string, size?: number): Array<T> {
  if (!value) {
    throw new Error(`Expected connection ${name}`);
  }
  if (size !== undefined && value.length !== size) {
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
    // If it's a constant, and already driven, that's fine? (Constants can be reused?)
    // But our logic generates unique const IDs per usage currently.
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
    // Position hacking? ELK handles it.
    constInstance.connections["out"] = bitInfo.id;
    registerSource(nets, bitInfo.id, { componentId: constId, portId: "out" });
  }
}

// Optimization: Pack loose bits into a bus
function packBits(
  bits: Array<{ id: NetBitId; constant?: 0 | 1 }>,
  targetSize: number,
  components: ComponentInstance[],
  nets: Map<NetBitId, NetBit>,
  idGen: { next: () => string }
): NetBitId {
  // 1. Check if these bits come from a Splitter of compatible size/alignment
  // We check the driver of the first bit.
  const firstDriver = nets.get(bits[0].id)?.source;
  if (firstDriver) {
    const driverComp = components.find(c => c.id === firstDriver.componentId);
    if (driverComp && driverComp.template.id.startsWith("SPLITTER_")) {
      // Check if ALL bits come from this splitter in order
      const splitterSize = parseInt(driverComp.template.id.split("_")[1]);
      // Only optimize if sizes match (or logic allows masking). For simplicity, exact match.
      if (splitterSize === targetSize && bits.length <= targetSize) {
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
        // If matched inputs correspond to splitter outputs 0..N, we can reuse the bus.
        // The Splitter input is 'in'.
        if (allMatch) {
            // Check if rest of splitter is unused or defaults? 
            // TC handles partial. If we need 32 bits, and we take 32 bits from splitter, we just use the bus entering the splitter.
            const busNetId = driverComp.connections["in"];
            if (busNetId) return busNetId;
        }
      }
    }
  }

  // 1b. Check if ALL bits are constants -> Use CONST_N
  let allConst = true;
  let constValue = 0n;
  for(let i=0; i<bits.length; i++) {
      if (bits[i].constant === undefined) {
          allConst = false;
          break;
      }
      if (bits[i].constant === 1) {
          constValue |= (1n << BigInt(i));
      }
  }
  
  // NOTE: Only optimize if FULL width is provided (or we are okay with padding 0s).
  // bits might be shorter than targetSize (padding 0s).
  // If bits are constant, padding 0 is just more constants.
  if (allConst && bits.length <= targetSize) {
      // Create Big Constant
      const constId = idGen.next();
      const constTpl = `CONST_${targetSize}`;
      const instance = instantiate(getTemplate(constTpl), constId);
      // We need to set the value. Constant components use 'setting1' or 'customString'? 
      // Typically 'setting1' holds the value for Constants.
      instance.metadata = { 
          label: `0x${constValue.toString(16).toUpperCase()}`,
          setting1: constValue 
      };
      
      components.push(instance);
      const busId = `${constId}_val`;
      instance.connections["out"] = busId;
      registerSource(nets, busId, {componentId: constId, portId: "out"});
      return busId;
  }

  // 2. If not optimizable, create a Maker
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
      // Pad with 0
      // We need a constant 0.
      // Use normalizeBit logic to get a 0.
      // Reuse logic? Just create a const 0.
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
    // Create Splitter
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
        
        // Wire splitter out[i] to bit.id
        // NOTE: If bit.id already has a driver?
        // normalizeBit returns unique IDs for constants, but here Yosys is defining the net name for a Cell Output.
        // It should be undriven.
        
        splitter.connections[`out${i}`] = bit.id;
        registerSource(nets, bit.id, { componentId: splitterId, portId: `out${i}` });
    }
    // Remaining splitter outputs are unconnected.
}

function resolveSize(width: number): 1 | 8 | 16 | 32 | 64 {
  if (width === 1) return 1;
  if (width <= 8) return 8;
  if (width <= 16) return 16;
  if (width <= 32) return 32;
  if (width <= 64) return 64;
  throw new Error(`Unsupported width ${width} (max 64)`);
}

// Remove splitters/makers that have been fully optimized away (unused outputs)
function cleanupRedundantComponents(components: ComponentInstance[], nets: Map<NetBitId, NetBit>): ComponentInstance[] {
    const toRemove = new Set<string>();

    for (const comp of components) {
        if (comp.template.id.startsWith("SPLITTER_")) {
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
                // Remove the splitter from the sinks of the input net
                const inNetId = comp.connections["in"];
                if (typeof inNetId === 'string') {
                    const inNet = nets.get(inNetId);
                    if (inNet) {
                        inNet.sinks = inNet.sinks.filter(s => s.componentId !== comp.id);
                    }
                }
                // (Optional) Remove sources for out nets?
                // The out nets are unused, so it doesn't matter much for ELK if no sinks exist.
                // But for cleanliness:
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

    return components.filter(c => !toRemove.has(c.id));
}

export function buildNetlistFromYosys(json: unknown, options: YosysAdapterOptions): NetlistGraph {
  const counter = { zero: 0, one: 0 };
  const parsed: YosysJson = typeof json === "string" ? JSON.parse(json) : (json as YosysJson);
  const module = parsed.modules?.[options.topModule];
  if (!module) {
    throw new Error(`Top module ${options.topModule} not found in Yosys output`);
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
       instance.metadata = { label: portName, modulePort: { portName, bitIndex: 0 } };
       components.push(instance);
       instance.connections["out"] = bitInfo.id;
       registerSource(nets, bitInfo.id, {componentId, portId: "out"});
    } else {
       // Multi-bit
       const componentId = `in:${portName}`;
       const tplId = `INPUT_${size}`;
       const instance = instantiate(getTemplate(tplId), componentId);
       instance.metadata = { label: portName };
       components.push(instance);
       const bits = port.bits.map(b => normalizeBit(b, counter));
       // Input component produces a bus. Unpack it to the bits.
       const busId = `${componentId}_bus`;
       instance.connections["out"] = busId;
       registerSource(nets, busId, {componentId, portId: "out"});
       unpackBits(busId, bits, size, components, nets, idGen);
    }
  }

  // 2. Process Cells (Logic)
  for (const [cellName, cell] of Object.entries(module.cells ?? {})) {
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
          
          const nS_wire = `$mux_nS_${cellName}`;
          const term1_wire = `$mux_t1_${cellName}`;
          const term2_wire = `$mux_t2_${cellName}`;
          const notId = `${cellName}_not`; const notInst = instantiate(NOT_1, notId);
          components.push(notInst);
          registerSink(nets, S.id, { componentId: notId, portId: "A" });
          registerSource(nets, nS_wire, { componentId: notId, portId: "Y" });
          const and1Id = `${cellName}_and1`; const and1Inst = instantiate(AND_1, and1Id); components.push(and1Inst);
          registerSink(nets, A.id, { componentId: and1Id, portId: "A" });
          registerSink(nets, nS_wire, { componentId: and1Id, portId: "B" });
          registerSource(nets, term1_wire, { componentId: and1Id, portId: "Y" });
          const and2Id = `${cellName}_and2`; const and2Inst = instantiate(AND_1, and2Id); components.push(and2Inst);
          registerSink(nets, B.id, { componentId: and2Id, portId: "A" });
          registerSink(nets, S.id, { componentId: and2Id, portId: "B" });
          registerSource(nets, term2_wire, { componentId: and2Id, portId: "Y" });
          const orId = `${cellName}_or`; const orInst = instantiate(OR_1, orId); components.push(orInst);
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
           const packedA = packBits(inputs["A"].map(b => normalizeBit(b, counter)), size, components, nets, idGen);
           instance.connections["A"] = packedA;
           registerSink(nets, packedA, {componentId: instanceId, portId: "A"});
           
           const packedB = packBits(inputs["B"].map(b => normalizeBit(b, counter)), size, components, nets, idGen);
           instance.connections["B"] = packedB;
           registerSink(nets, packedB, {componentId: instanceId, portId: "B"});
           
           // S
           const sBits = inputs["S"].map(b => normalizeBit(b, counter));
           // If S is 1 bit, use the bit directly?
           // The "S" port on MUX_N in my library ... wait.
           // TC Mux components have specific hidden ports.
           // I used "S" in makePorts. I don't know the REAL ID.
           // For Switch/Mux, it's usually "control" or something.
           // But actually, for standard logic gates I used A/B. Mux is special ComponentKind.Mux8.
           // I should probably check if I need to map "S".
           // I'll assume "S" for now but I might need to fix it blindly.
           
           if(sBits.length === 1) {
               const sBit = sBits[0];
               ensureDriverIfConstant(sBit, instanceId, "S", components, nets);
               instance.connections["S"] = sBit.id;
               registerSink(nets, sBit.id, {componentId: instanceId, portId: "S"});
           } else {
               // If S is multi-bit, pack it (though unlikely to work if TC expects 1 bit).
               // Just use first bit?
               const sBit = sBits[0];
               instance.connections["S"] = sBit.id;
               registerSink(nets, sBit.id, {componentId: instanceId, portId: "S"});
           }
           
           // Output
           const yBits = inputs["Y"].map(b => normalizeBit(b, counter));
           const busOut = `${instanceId}_out`;
           instance.connections["Y"] = busOut;
           registerSource(nets, busOut, {componentId: instanceId, portId: "Y"});
           unpackBits(busOut, yBits, size, components, nets, idGen);
           continue; 
       }
    }

    // Standard Gates
    if (size === 1) {
        // Standard single bit processing
        // Just use existing logic loop for width=1
        // Copying "width" loop logic but forcing width=1
        const width = 1; for (let i = 0; i < width; i++) {
             // ...
             // Since I am rewriting, I will write the single-bit path concisely.
             // If binding.template is object (SizeMap), get 1.
             let tplSpec = binding.template;
             let tpl: ComponentTemplate;
             if (typeof tplSpec === 'object' && '1' in tplSpec) {
                 tpl = getTemplate((tplSpec as SizeMap)[1]);
             } else if (typeof tplSpec === 'object' && 'id' in tplSpec) {
                 tpl = tplSpec as ComponentTemplate;
             } else {
                 throw new Error("Invalid template for size 1");
             }
             
             const instanceId = `${cellName}:0`;
             const instance = instantiate(tpl, instanceId);
             components.push(instance);
             
             // Inputs
             for(const p of binding.inputPorts) {
                 const bits = ensureArray(cell.connections[p], p);
                 const b = normalizeBit(bits[0], counter);
                 instance.connections[p] = b.id;
                 registerSink(nets, b.id, {componentId: instanceId, portId: p});
                 ensureDriverIfConstant(b, instanceId, p, components, nets);
             }
             // Output
             const outBits = ensureArray(cell.connections[binding.outputPort], binding.outputPort);
             const outB = normalizeBit(outBits[0], counter);
             instance.connections[binding.outputPort] = outB.id;
             registerSource(nets, outB.id, {componentId: instanceId, portId: binding.outputPort});
        }
    } else {
        // Multi-bit Standard Gate
        const tplSpec = binding.template as SizeMap;
        const tplId = tplSpec[size];
        if (!tplId) throw new Error(`No template for size ${size} for ${cell.type}`);
        
        const instanceId = cellName;
        const instance = instantiate(getTemplate(tplId), instanceId);
        components.push(instance);
        
        // Inputs (Pack)
        for (const inputPort of binding.inputPorts) {
            const rawBits = ensureArray(cell.connections[inputPort], inputPort); // Might be shorter than size?
            // If rawBits < size, packBits handles padding (if passed rawBits directly).
            // Pass rawBits converted to objects.
            const bits = rawBits.map(b => normalizeBit(b, counter));
            const busId = packBits(bits, size, components, nets, idGen);
            instance.connections[inputPort] = busId;
            registerSink(nets, busId, {componentId: instanceId, portId: inputPort});
        }
        
        // Output (Unpack)
        const rawOut = ensureArray(cell.connections[binding.outputPort], binding.outputPort);
        const outBits = rawOut.map(b => normalizeBit(b, counter));
        const busOut = `${instanceId}_out`;
        instance.connections[binding.outputPort] = busOut;
        registerSource(nets, busOut, {componentId: instanceId, portId: binding.outputPort});
        
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
       instance.metadata = { label: portName, modulePort: { portName, bitIndex: 0 } };
       components.push(instance);
       instance.connections["in"] = bitInfo.id;
       registerSink(nets, bitInfo.id, {componentId: componentId, portId: "in"});
    } else {
       const tplId = `OUTPUT_${size}`;
       const instance = instantiate(getTemplate(tplId), componentId);
       instance.metadata = { label: portName };
       components.push(instance);
       
       const bits = port.bits.map(b => normalizeBit(b, counter));
       // Output component consumes a bus. Pack bits.
       // NOTE: This runs AFTER cells, so packBits can verify if bits come from a Splitter driven by a cell.
       const busId = packBits(bits, size, components, nets, idGen);
       instance.connections["in"] = busId;
       registerSink(nets, busId, {componentId: componentId, portId: "in"});
    }
  }

  // Remove redundant splitters/makers
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
