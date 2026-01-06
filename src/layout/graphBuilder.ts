import { ComponentInstance, NetlistGraph, PortRef } from "../netlist/types.js";
import { LayoutEdge, LayoutEdgeEndpoint, LayoutGraph, LayoutNode, LayoutPort } from "./types.js";

const GRID_SIZE = 1;

interface NodePortPlacement {
  id: string;
  layoutPort: LayoutPort;
}

function buildNode(component: ComponentInstance): { node: LayoutNode; portIndex: Record<string, LayoutPort> } {
  const { template } = component;
  const width = (template.bounds.maxX - template.bounds.minX + 1) * GRID_SIZE;
  const height = (template.bounds.maxY - template.bounds.minY + 1) * GRID_SIZE;

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
    },
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
