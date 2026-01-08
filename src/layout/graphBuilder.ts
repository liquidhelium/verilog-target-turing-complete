import { ComponentInstance, NetlistGraph, PortRef } from "../netlist/types.js";
import { ComponentKind } from "../tc/types.js";
import { LayoutEdge, LayoutEdgeEndpoint, LayoutGraph, LayoutNode, LayoutPort } from "./types.js";

const GRID_SIZE = 1;

interface NodePortPlacement {
  id: string;
  layoutPort: LayoutPort;
}

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

function buildNode(component: ComponentInstance): { node: LayoutNode; portIndex: Record<string, LayoutPort> } {
  const { template } = component;
  let width = (template.bounds.maxX - template.bounds.minX + 1) * GRID_SIZE;
  let height = (template.bounds.maxY - template.bounds.minY + 1) * GRID_SIZE;
  const layoutOptions: Record<string, string> = {};

  const isInput = INPUT_KINDS.has(template.kind);
  const isOutput = OUTPUT_KINDS.has(template.kind);

  if (isInput) {
    layoutOptions["elk.layered.layering.layerConstraint"] = "FIRST";
    layoutOptions["elk.layered.compaction.postCompaction.strategy"] = "NONE";
  } else if (isOutput) {
    layoutOptions["elk.layered.layering.layerConstraint"] = "LAST";
    layoutOptions["elk.layered.compaction.postCompaction.strategy"] = "NONE";
  }

  if (isInput || isOutput) {
    const margin = 2;
    height += margin * 2;
  }

  const ports: LayoutPort[] = template.ports.map((port) => ({
    id: port.id,
    x: (port.position.x - template.bounds.minX) * GRID_SIZE,
    y: (port.position.y - template.bounds.minY) * GRID_SIZE,
    side: port.direction === "in" ? "WEST" : "EAST",
  }));

  const portIndex: Record<string, LayoutPort> = {};
  for (const port of ports) {
    portIndex[port.id] = port;
  }

  const node: LayoutNode = {
    id: component.id,
    width,
    height,
    ports,
    data: {
      templateId: template.id,
      kind: template.kind,
    },
    layoutOptions,
  };

  return { node, portIndex };
}

function buildEdgeEndpoint(port: PortRef): LayoutEdgeEndpoint {
  return { node: port.componentId, port: port.portId };
}

function buildEdgeId(source: PortRef, target: PortRef): string {
  return `${source.componentId}::${source.portId}=>${target.componentId}::${target.portId}`;
}

export function buildLayoutGraph(graph: NetlistGraph): LayoutGraph {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  for (const component of graph.components) {
    const { node } = buildNode(component);
    nodes.push(node);
  }

  for (const net of graph.nets.values()) {
    const source = net.source;
    if (!source) {
      continue;
    }
    for (const sink of net.sinks) {
      edges.push({
        id: buildEdgeId(source, sink),
        sources: [buildEdgeEndpoint(source)],
        targets: [buildEdgeEndpoint(sink)],
      });
    }
  }

  return { id: "tc-net", nodes, edges };
}
