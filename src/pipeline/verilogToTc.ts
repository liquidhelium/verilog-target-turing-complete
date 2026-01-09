import { promises as fs } from "node:fs";
import { basename, dirname } from "node:path";
import { buildNetlistFromYosys } from "../netlist/adapter.js";
import { NetlistGraph, ComponentInstance, CustomComponentMeta } from "../netlist/types.js";
import { buildLayoutGraph } from "../layout/graphBuilder.js";
import { ElkRouter } from "../layout/elkRouter.js";
import { DefaultYosysBackend } from "../yosys/executor.js";
import { TCSaveWriter, defaultSavePayload, createTeleportWire } from "../tc/saveWriter.js";
import { ComponentKind, TCComponent, TCPoint, TCSavePayload, WireColor, WireKind } from "../tc/types.js";
import { ComponentPort, CONST_0 } from "../tc/componentLibrary.js";
import { LayoutResult } from "../layout/types.js";

const GRID_SIZE = 1;

const INPUT_KINDS = new Set([
  ComponentKind.Input1,
  ComponentKind.Input8,
  ComponentKind.Input16,
  ComponentKind.Input32,
  ComponentKind.Input64,
  ComponentKind.LevelInput1,
  ComponentKind.LevelInput8,
  ComponentKind.LevelInput2Pin,
  ComponentKind.LevelInput3Pin,
  ComponentKind.LevelInput4Pin,
  ComponentKind.LevelInputConditions,
  ComponentKind.LevelInputCode,
  ComponentKind.LevelInputArch,
]);

const OUTPUT_KINDS = new Set([
  ComponentKind.Output1,
  ComponentKind.Output8,
  ComponentKind.Output16,
  ComponentKind.Output32,
  ComponentKind.Output64,
  ComponentKind.Output1z,
  ComponentKind.Output8z,
  ComponentKind.Output16z,
  ComponentKind.Output32z,
  ComponentKind.Output64z,
  ComponentKind.LevelOutput1,
  ComponentKind.LevelOutput8,
  ComponentKind.LevelOutput1Sum,
  ComponentKind.LevelOutput1Car,
  ComponentKind.LevelOutput2Pin,
  ComponentKind.LevelOutput3Pin,
  ComponentKind.LevelOutput4Pin,
  ComponentKind.LevelOutput8z,
  ComponentKind.LevelOutputArch,
  ComponentKind.LevelOutputCounter,
]);

export interface VerilogSources {
  [path: string]: string;
}

export interface ConvertOptions {
  topModule: string;
  description?: string;
  debug?: boolean;
  compact?: boolean;
  flatten?: boolean;
  customComponentMapping?: Record<string, bigint>;
  customComponentDefinitions?: Record<string, CustomComponentMeta>;
  saveId?: bigint;
}

export interface ConvertResult {
  payload: TCSavePayload;
  saveFile: Uint8Array;
  uncompressed: Uint8Array;
  customMetadata?: CustomComponentMeta;
  debugInfo?: {
      layoutJson: any;
      yosysJson: any;
  };
}

const DIRECTIONS: TCPoint[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];

function buildYosysScript(sources: VerilogSources, topModule: string, flatten: boolean = true): string {
  const readCmds = Object.keys(sources)
    .map((path) => path.endsWith('.sv') ? `read_verilog -sv ${path}` : `read_verilog ${path}`)
    .join("; ");
  return [
    readCmds,
    `hierarchy -check -top ${topModule}`,
    "proc",
    flatten ? "flatten" : "",
    "opt",
    "clean",
    "write_json out.json",
  ]
    .filter(Boolean)
    .join("; ");
}

async function runSynthesis(sources: VerilogSources, options: ConvertOptions): Promise<any> {
  const backend = new DefaultYosysBackend();
  const script = buildYosysScript(sources, options.topModule, options.flatten !== false);
  const result = await backend.run({ script, files: sources });
  const out = result.files["out.json"];
  if (!out) {
    throw new Error("Yosys did not produce out.json");
  }
  return JSON.parse(Buffer.from(out).toString("utf-8"));
}

function decodeEdgeId(edgeId: string): { sourceComponent: string; sourcePort: string; targetComponent: string; targetPort: string } {
  const match = edgeId.match(/^(.*?)::(.*?)=>(.*?)::(.*?)$/);
  if (!match) {
    throw new Error(`Invalid edge id ${edgeId}`);
  }
  return {
    sourceComponent: match[1],
    sourcePort: match[2],
    targetComponent: match[3],
    targetPort: match[4],
  };
}

function alignIOComponents(layout: LayoutResult, netlist: NetlistGraph) {
  let minInputX = Number.POSITIVE_INFINITY;
  let maxOutputX = Number.NEGATIVE_INFINITY;

  const inputNodes: Array<{ node: (typeof layout.nodes)[0]; comp: ComponentInstance }> = [];
  const outputNodes: Array<{ node: (typeof layout.nodes)[0]; comp: ComponentInstance }> = [];

  for (const node of layout.nodes) {
    const comp = netlist.components.find((c) => c.id === node.id);
    if (!comp) continue;

    if (INPUT_KINDS.has(comp.template.kind)) {
      inputNodes.push({ node, comp });
      minInputX = Math.min(minInputX, node.position.x);
    } else if (OUTPUT_KINDS.has(comp.template.kind)) {
      outputNodes.push({ node, comp });
      maxOutputX = Math.max(maxOutputX, node.position.x + node.width);
    }
  }

  // Safety check
  if (!Number.isFinite(minInputX) || !Number.isFinite(maxOutputX)) {
    return;
  }

  // Apply padding. Move inputs left, outputs right.
  const inputTargetX = minInputX - 10;
  const outputTargetX = maxOutputX + 10;

  // Move Inputs
  for (const { node } of inputNodes) {
    const dx = inputTargetX - node.position.x;
    if (Math.abs(dx) < 0.01) continue;

    node.position.x += dx;
    for (const portKey in node.ports) {
      node.ports[portKey].x += dx;
    }

    // Update Edges originating from this node
    // Input component edges start from here.
    const prefix = `${node.id}::`;
    for (const edge of layout.edges) {
      if (edge.id.startsWith(prefix)) {
        if (edge.points.length > 0) {
          edge.points[0].x += dx;
        }
      }
    }
  }

  // Move Outputs
  for (const { node } of outputNodes) {
    const currentRight = node.position.x + node.width;
    const dx = outputTargetX - currentRight;
    if (Math.abs(dx) < 0.01) continue;

    node.position.x += dx;
    for (const portKey in node.ports) {
      node.ports[portKey].x += dx;
    }

    // Update Edges targeting this node
    // Output component edges end here.
    // Edge ID format: source::port=>target::port
    const suffix = `=>${node.id}::`;
    for (const edge of layout.edges) {
      // Since edge.id format contains target info
      // We can check if it contains "=>nodeId::"
      // But verify strictly.
      if (edge.id.includes(suffix)) {
        const parts = decodeEdgeId(edge.id);
        if (parts.targetComponent === node.id) {
          if (edge.points.length > 0) {
            edge.points[edge.points.length - 1].x += dx;
          }
        }
      }
    }
  }
}

function roundPoint(point: { x: number; y: number }): TCPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function densify(points: TCPoint[]): TCPoint[] {
  if (points.length < 2) {
    return points;
  }
  const result: TCPoint[] = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    let dx = next.x - current.x;
    let dy = next.y - current.y;
    if (dx !== 0 && dy !== 0) {
      // break diagonal into orthogonal moves
      const mid: TCPoint = { x: next.x, y: current.y };
      result.push(...densify([current, mid]).slice(1));
      result.push(...densify([mid, next]).slice(1));
      continue;
    }
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let s = 1; s <= steps; s += 1) {
      result.push({ x: current.x + stepX * s, y: current.y + stepY * s });
    }
  }
  return result;
}

function encodeWire(points: TCPoint[]): number[] {
  if (points.length < 2) {
    throw new Error("Wire must contain at least two points");
  }
  const path = densify(points);
  const body: number[] = [];
  let offset = 0;
  while (offset < path.length - 1) {
    const dirVec = {
      x: path[offset + 1].x - path[offset].x,
      y: path[offset + 1].y - path[offset].y,
    };
    const direction = DIRECTIONS.findIndex((d) => d.x === dirVec.x && d.y === dirVec.y);
    if (direction === -1) {
      throw new Error(`Invalid wire segment direction ${JSON.stringify(dirVec)}`);
    }
    let length = 1;
    const maxLength = Math.min(0b0001_1111, path.length - 1 - offset);
    while (length < maxLength) {
      const nextVec = {
        x: path[offset + length + 1].x - path[offset + length].x,
        y: path[offset + length + 1].y - path[offset + length].y,
      };
      if (nextVec.x !== dirVec.x || nextVec.y !== dirVec.y) {
        break;
      }
      length += 1;
    }
    body.push((direction << 5) | length);
    offset += length;
  }
  body.push(0);
  return body;
}

function mapNodePositions(layout: LayoutResult, netlist: NetlistGraph): Map<string, { position: TCPoint }> {
  const map = new Map<string, { position: TCPoint }>();
  for (const node of layout.nodes) {
    map.set(node.id, {
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    });
  }
  return map;
}

function toTcComponents(layout: LayoutResult, netlist: NetlistGraph): TCComponent[] {
  const nodePositions = mapNodePositions(layout, netlist);
  return netlist.components.map((component, index) => {
    const node = layout.nodes.find(
      (n: LayoutResult["nodes"][number]) => n.id === component.id,
    );
    if (!node) {
      throw new Error(`Missing layout node for component ${component.id}`);
    }
    const placement = nodePositions.get(component.id);
    if (!placement) {
      throw new Error(`Missing placement for component ${component.id}`);
    }
    const pos = {
      x: placement.position.x - component.template.bounds.minX,
      y: placement.position.y - component.template.bounds.minY,
    };

    if (component.template.kind === ComponentKind.Custom) {
        // Offset custom components by -16 to match TC's coordinate system
        pos.x -= 32;
        pos.y -= 32;
    }

    return {
      kind: component.template.kind,
      position: pos,
      rotation: component.template.rotation,
      permanentId: BigInt(index + 1),
      customString: typeof component.metadata?.label === "string" ? component.metadata.label : "",
      setting1: typeof component.metadata?.setting1 === "bigint" ? component.metadata.setting1 : 0n,
      setting2: 0n,
      uiOrder: 0,
      customId: typeof component.metadata?.customId === "bigint" ? component.metadata.customId : undefined,
      customDisplacement: { x: 0, y: 0 },
      selectedPrograms: [],
    };
  });
}

function findComponent(netlist: NetlistGraph, id: string): ComponentInstance {
  const component = netlist.components.find((c) => c.id === id);
  if (!component) {
    throw new Error(`Component ${id} not found`);
  }
  return component;
}

function findPortPosition(
  layout: LayoutResult,
  netlist: NetlistGraph,
  componentId: string,
  portId: string,
): TCPoint {
  const node = layout.nodes.find((n: LayoutResult["nodes"][number]) => n.id === componentId);
  if (!node) {
    throw new Error(`Layout node ${componentId} missing`);
  }
  const component = netlist.components.find((c) => c.id === componentId);
  if (!component) {
    throw new Error(`Component ${componentId} missing`);
  }
  const port = component.template.ports.find((p) => p.id === portId);
  if (!port) {
    throw new Error(`Port ${portId} missing on component ${componentId}`);
  }

  // Calculate position based on strict component definition
  // Node position (top-left of bounds) + relative port position + (0 - bounds.min) offset correction
  // Wait, toTcComponents uses: pos = node.x - minX.
  // Actually simpler:
  // Component Position in World = (node.x - minX * GRID, node.y - minY * GRID) ??
  // Let's re-verify `toTcComponents`:
  // pos = { x: placement.x - bounds.minX, y: placement.y - bounds.minY }
  // This is the component's "center" or "origin" in world space.
  
  // Port in World = ComponentPos + PortRelativePos.
  // = (placement.x - bounds.minX) + port.position.x
  
  const componentX = Math.round(node.position.x) - component.template.bounds.minX;
  const componentY = Math.round(node.position.y) - component.template.bounds.minY;
  
  return {
    x: componentX + port.position.x,
    y: componentY + port.position.y
  };
}

function getPortWidth(component: ComponentInstance, portId: string): number {
  if (component.metadata?.portWidths && typeof component.metadata.portWidths[portId] === "number") {
    return component.metadata.portWidths[portId];
  }

  const match = component.template.id.match(/_(\d+)$/);
  if (!match) return 1;
  const size = parseInt(match[1], 10);
  
  if (component.template.id.startsWith("SPLITTER_")) {
    // Splitter outputs are single bits
    return 1;
  }
  
  // Maker: outputs are Bus (size)
  // Gates/IO: outputs are Bus (size)
  return size;
}

function widthToWireKind(width: number): WireKind {
  switch (width) {
    case 1: return WireKind.Wk1;
    case 8: return WireKind.Wk8;
    case 16: return WireKind.Wk16;
    case 32: return WireKind.Wk32;
    case 64: return WireKind.Wk64;
    default: return WireKind.Wk1;
  }
}

function wiresFromLayout(layout: LayoutResult, netlist: NetlistGraph): { start: TCPoint; body: number[]; kind: WireKind }[] {
  const result: { start: TCPoint; body: number[]; end?: TCPoint; kind: WireKind }[] = [];
  for (const edge of layout.edges) {
    const info = decodeEdgeId(edge.id);
    const sourceComponent = findComponent(netlist, info.sourceComponent);
    const targetComponent = findComponent(netlist, info.targetComponent);
    const sourcePort = sourceComponent.template.ports.find(
      (port: ComponentPort) => port.id === info.sourcePort,
    );
    const targetPort = targetComponent.template.ports.find(
      (port: ComponentPort) => port.id === info.targetPort,
    );
    if (!sourcePort || !targetPort) {
      throw new Error(`Missing ports for edge ${edge.id}`);
    }

    const sourceStart = findPortPosition(layout, netlist, sourceComponent.id, sourcePort.id);
    const targetEnd = findPortPosition(layout, netlist, targetComponent.id, targetPort.id);

    let points: TCPoint[] = edge.points.map(roundPoint);
    if (points.length === 0) {
      points = [sourceStart, targetEnd];
    } else {
      // Force start and end to match precise port locations
      points[0] = sourceStart;
      points[points.length - 1] = targetEnd;
    }

    const width = getPortWidth(sourceComponent, sourcePort.id);
    const kind = widthToWireKind(width);

    const body = encodeWire(points);
    result.push({ start: sourceStart, body, kind });
  }
  return result;
}

function createPayload(
  layout: LayoutResult,
  netlist: NetlistGraph,
  description?: string,
  saveId: bigint = 0n,
  compact: boolean = false,
): TCSavePayload {
  const components = toTcComponents(layout, netlist);
  const wires: TCSavePayload["wires"] = [];

  if (compact) {
    for (const net of netlist.nets.values()) {
       if (!net.source) continue;
       
       const sourceComp = netlist.components.find(c => c.id === net.source!.componentId);
       if (!sourceComp) continue;
       const width = getPortWidth(sourceComp, net.source.portId);
       
       const kind = widthToWireKind(width);
       
       try {
           const start = findPortPosition(layout, netlist, net.source.componentId, net.source.portId);
           for (const sink of net.sinks) {
               try {
                   const end = findPortPosition(layout, netlist, sink.componentId, sink.portId);
                   wires.push(createTeleportWire(start, end, kind, WireColor.Default));
               } catch(e) {}
           }
       } catch(e) {}
    }
  } else {
    const wiresData = wiresFromLayout(layout, netlist);
    wires.push(...wiresData.map((wireData) => ({
      kind: wireData.kind,
      color: WireColor.Default,
      comment: "",
      path: {
        start: wireData.start,
        body: wireData.body,
      },
    })));
  }

  const dependenciesSet = new Set<bigint>();
  for (const c of components) {
    if (c.kind === ComponentKind.Custom && c.customId !== undefined) {
      dependenciesSet.add(c.customId);
    }
  }
  const dependencies = Array.from(dependenciesSet);

  const payload = defaultSavePayload({
    description: description ?? "Generated from Verilog",
    components,
    wires,
    saveId,
    dependencies,
  });
  return payload;
}

function centerLayout(layout: LayoutResult) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Check Nodes
  for (const node of layout.nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.width);
    maxY = Math.max(maxY, node.position.y + node.height);
  }

  // Check Edges
  for (const edge of layout.edges) {
    for (const point of edge.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }
  }
  
  if (!Number.isFinite(minX)) return;

  const currentCenterX = (minX + maxX) / 2;
  const currentCenterY = (minY + maxY) / 2;
  
  // Round to integer to maintain grid alignment
  const offsetX = Math.round(-currentCenterX);
  const offsetY = Math.round(-currentCenterY);
  
  // Apply Offset
  for (const node of layout.nodes) {
      node.position.x += offsetX;
      node.position.y += offsetY;
  }
  
  for (const edge of layout.edges) {
      for (const point of edge.points) {
          point.x += offsetX;
          point.y += offsetY;
      }
  }
}

function optimizeNetlist(netlist: NetlistGraph) {
  const componentsToRemove = new Set<string>();
  const netsToRemove = new Set<string>();
  const componentMap = new Map<string, ComponentInstance>();
  for (const c of netlist.components) {
    componentMap.set(c.id, c);
  }

  // 1. Identify Zero/Off Constants
  const zeroNetIds = new Set<string>();
  const CONST_MULTI_IDS = new Set(["CONST_8", "CONST_16", "CONST_32", "CONST_64"]);

  for (const component of netlist.components) {
    let isZero = false;
    if (component.template.id === CONST_0.id) {
       isZero = true;
    } 
    else if (CONST_MULTI_IDS.has(component.template.id)) {
       const val = component.metadata?.setting1;
       if (val === 0n) {
           isZero = true; 
       }
    }

    if (isZero) {
       const outNetId = component.connections["out"];
       if (outNetId) {
         zeroNetIds.add(outNetId);
         netsToRemove.add(outNetId);
       }
       componentsToRemove.add(component.id);
    }
  }

  // 2. Identify AND gates with a Zero Input -> Remove gate, output is Zero
  //    (This propagates the Zero signal)
  //    However, simply removing the AND gate leaves its output net floating (which is 0).
  //    So we can just remove the AND gate and its output net driver.
  //    This logic can be iterative, but one pass catches immediate ANDs connected to constants.
  
  for (const component of netlist.components) {
      if (component.template.id === "AND_1") {
          const netA = component.connections["A"];
          const netB = component.connections["B"];
          // If any input is connected to a net that is known to be Zero (or floating/removed)
          // Actually, if we marked the net for removal, we consider it 0.
          
          const isInputZero = (netA && netsToRemove.has(netA)) || (netB && netsToRemove.has(netB));
          
          if (isInputZero || !netA || !netB) { // !netA implies floating input -> 0
              // AND with 0 is 0.
              // Remove this AND gate.
              componentsToRemove.add(component.id);
              
              // Its output is also effectively 0.
              const outNetId = component.connections["Y"];
              if (outNetId) {
                  netsToRemove.add(outNetId);
              }
          }
      }
  }

  if (componentsToRemove.size > 0) {
      // 1. Disconnect removed components from the nets that drive them (inputs)
      for (const compId of componentsToRemove) {
        const comp = componentMap.get(compId);
        if (!comp) continue;
        
        for (const netId of Object.values(comp.connections)) {
            if (typeof netId !== 'string') continue;
            const net = netlist.nets.get(netId);
            if (net) {
                // Remove as sink
                net.sinks = net.sinks.filter(s => s.componentId !== compId);
                // Remove as source (just in case)
                if (net.source?.componentId === compId) {
                    net.source = undefined;
                }
            }
        }
      }

      // 2. Remove components
      netlist.components = netlist.components.filter(c => !componentsToRemove.has(c.id));
      
      // 3. Remove nets marked for removal
      for (const netId of netsToRemove) {
          const net = netlist.nets.get(netId);
           if (net) {
               for (const sink of net.sinks) {
                   const sinkComp = componentMap.get(sink.componentId);
                   if (sinkComp) {
                       delete sinkComp.connections[sink.portId];
                   }
               }
           }
          netlist.nets.delete(netId);
      }
  }
}

function extractCustomMetadata(layout: LayoutResult, netlist: NetlistGraph): CustomComponentMeta {
  const nodePositions = mapNodePositions(layout, netlist);
  let minGridX = Infinity, maxGridX = -Infinity, minGridY = Infinity, maxGridY = -Infinity;

  // Mark occupied grids
  for (const node of layout.nodes) {
    const x1 = Math.round(node.position.x);
    const y1 = Math.round(node.position.y);
    const x2 = x1 + Math.max(1, Math.round(node.width)) - 1;
    const y2 = y1 + Math.max(1, Math.round(node.height)) - 1;

    const startGx = Math.floor(x1 / 8);
    const endGx = Math.floor(x2 / 8);
    const startGy = Math.floor(y1 / 8);
    const endGy = Math.floor(y2 / 8);

    if (startGx < minGridX) minGridX = startGx;
    if (endGx > maxGridX) maxGridX = endGx;
    if (startGy < minGridY) minGridY = startGy;
    if (endGy > maxGridY) maxGridY = endGy;
  }
  
  if (minGridX === Infinity) { minGridX=0; maxGridX=0; minGridY=0; maxGridY=0; }

  const ports: ComponentPort[] = [];
  for (const comp of netlist.components) {
      if (INPUT_KINDS.has(comp.template.kind) || OUTPUT_KINDS.has(comp.template.kind)) {
          const pos = nodePositions.get(comp.id);
          const portName = comp.metadata?.modulePort?.portName || comp.metadata?.label || comp.id;
          if (pos) {
             const gx = Math.floor(pos.position.x / 8);
             const gy = Math.floor(pos.position.y / 8);
             ports.push({
                 id: portName,
                 position: { x: gx, y: gy },
                 direction: INPUT_KINDS.has(comp.template.kind) ? "in" : "out"
             });
          }
      }
  }

  return { bounds: { minX: minGridX, maxX: maxGridX, minY: minGridY, maxY: maxGridY }, ports };
}

export async function convertVerilogToSave(
  sources: VerilogSources,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const yosysJson = await runSynthesis(sources, options);
  const netlist = buildNetlistFromYosys(yosysJson, { 
    topModule: options.topModule, 
    customComponentMapping: options.customComponentMapping,
    customComponentDefinitions: options.customComponentDefinitions
  });
  optimizeNetlist(netlist);
  const layoutGraph = buildLayoutGraph(netlist);
  const router = new ElkRouter({ gridSize: GRID_SIZE, compact: options.compact });
  const layout = await router.route(layoutGraph);
  
  if (!options.compact) {
    alignIOComponents(layout, netlist);
  }

  centerLayout(layout);
  const customMetadata = extractCustomMetadata(layout, netlist);
  
  // Adjust metadata for TC coordinate system mismatch
  // The internal layout is centered correctly for viewing the circuit.
  // However, when this circuit is used as a Custom Component, TC expects the 
  // Custom Component's grid coordinates to be relative to a different origin.
  // User specifies we need to subtract 16 grids from the calculated bounding box/port positions using the layout.
  if (customMetadata) {
      const GRID_OFFSET = 16;
      customMetadata.bounds.minX -= GRID_OFFSET;
      customMetadata.bounds.maxX -= GRID_OFFSET;
      customMetadata.bounds.minY -= GRID_OFFSET;
      customMetadata.bounds.maxY -= GRID_OFFSET;
      
      for (const port of customMetadata.ports) {
          port.position.x -= GRID_OFFSET;
          port.position.y -= GRID_OFFSET;
      }
  }

  const payload = createPayload(layout, netlist, options.description, options.saveId, options.compact);
  const writer = new TCSaveWriter(payload);
  const { saveFile, uncompressed } = await writer.build();
  return { 
      payload, 
      saveFile, 
      uncompressed,
      customMetadata,
      debugInfo: options.debug ? { layoutJson: layout, yosysJson } : undefined
  };
}

export async function convertFilesToSave(
  inputPath: string,
  outputPath: string,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const content = await fs.readFile(inputPath, "utf-8");
  const virtualName = basename(inputPath);
  const sources: VerilogSources = { [virtualName]: content };
  const result = await convertVerilogToSave(sources, options);
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, result.saveFile);
  return result;
}
