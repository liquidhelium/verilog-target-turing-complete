import type { ELK } from "elkjs";
import {
  ElkFacade,
  ElkGraph,
  ElkGraphEdge,
  ElkGraphEdgeSection,
  ElkGraphNode,
  ElkGraphPort,
  ElkRouterOptions,
  LayoutEdge,
  LayoutEdgeRoute,
  LayoutGraph,
  LayoutNode,
  LayoutNodePlacement,
  LayoutPoint,
  LayoutPort,
  LayoutResult,
  PortSide,
} from "./types.js";

export class ElkRouter {
  private readonly gridSize: number;
  private readonly epsilon: number;
  private readonly elkPromise: Promise<ElkFacade>;

  constructor(options: ElkRouterOptions = {}) {
    this.gridSize = options.gridSize ?? 8;
    this.epsilon = options.epsilon ?? 0.1;
    this.elkPromise = options.elk ? Promise.resolve(options.elk) : loadElkFacade();
  }

  async route(graph: LayoutGraph): Promise<LayoutResult> {
    const elk = await this.elkPromise;
    const elkGraph = this.toElkGraph(graph);
    const laidOut = await elk.layout(elkGraph);
    return this.fromElkGraph(laidOut);
  }

  private toElkGraph(graph: LayoutGraph): ElkGraph {
    const children = graph.nodes.map((node) => this.toElkNode(node));
    const edges = graph.edges.map((edge) => this.toElkEdge(edge));
    return {
      id: graph.id ?? "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.layered.mergeEdges": "true",
        "elk.spacing.nodeNode": "0",
        "elk.spacing.componentComponent": "0",
        "elk.spacing.portPort": "0.1",
        "elk.layered.spacing.nodeNodeBetweenLayers": "1.1",
        "elk.layered.spacing.edgeNodeBetweenLayers": "0.2",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "0.1",
        "elk.layered.compaction.connectedComponents": "true",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
        "elk.layered.wrapping.strategy": "MULTI_EDGE",
        "elk.aspectRatio": "1.6",
      },
      children,
      edges,
      width: 200,
      height: 200,
    };
  }

  private toElkNode(node: LayoutNode): ElkGraphNode {
    return {
      id: node.id,
      width: node.width,
      height: node.height,
      ports: node.ports.map((port) => this.toElkPort(node, port)),
      layoutOptions: {
        "elk.portConstraints": "FIXED_POS",
      },
      data: node.data,
    };
  }

  private toElkPort(node: LayoutNode, port: LayoutPort): ElkGraphPort {
    return {
      id: `${node.id}.${port.id}`,
      x: port.x,
      y: port.y,
      layoutOptions: {
        "elk.port.side": port.side,
      },
    };
  }

  private toElkEdge(edge: LayoutEdge): ElkGraphEdge {
    const sources = edge.sources.map((endpoint) => `${endpoint.node}.${endpoint.port}`);
    const targets = edge.targets.map((endpoint) => `${endpoint.node}.${endpoint.port}`);
    return {
      id: edge.id,
      sources,
      targets,
      layoutOptions: {
        "elk.layered.spacing.edgeEdgeBetweenLayers": "5",
        ...(edge.minLength ? { "elk.layered.edgeNodeSpacingFactor": String(edge.minLength) } : {}),
      },
    };
  }

  private fromElkGraph(graph: ElkGraph): LayoutResult {
    const nodes: LayoutNodePlacement[] = [];
    const edges: LayoutEdgeRoute[] = [];

    for (const child of graph.children ?? []) {
      if (child.x === undefined || child.y === undefined) {
        continue;
      }
      nodes.push({
        id: child.id,
        position: this.snapPoint({ x: child.x, y: child.y }),
        width: child.width,
        height: child.height,
        ports: this.collectPortPlacements(child),
        data: child.data,
      });
    }

    for (const edge of graph.edges ?? []) {
      edges.push({
        id: edge.id,
        points: this.collectEdgePoints(edge.sections ?? []),
      });
    }

    return { nodes, edges };
  }

  private collectPortPlacements(node: ElkGraphNode): Record<string, LayoutPoint> {
    const placements: Record<string, LayoutPoint> = {};
    for (const port of node.ports ?? []) {
      if (!port.id || port.x === undefined || port.y === undefined) {
        continue;
      }
      const prefix = `${node.id}.`;
      const shortId = port.id.startsWith(prefix) ? port.id.substring(prefix.length) : port.id;
      placements[shortId] = this.snapPoint({
        x: (node.x ?? 0) + port.x,
        y: (node.y ?? 0) + port.y,
      });
    }
    return placements;
  }

  private collectEdgePoints(sections: ElkGraphEdgeSection[]): LayoutPoint[] {
    const points: LayoutPoint[] = [];
    for (const section of sections) {
      if (section.startPoint) {
        points.push(this.snapPoint(section.startPoint));
      }
      for (const bend of section.bendPoints ?? []) {
        points.push(this.snapPoint(bend));
      }
      if (section.endPoint) {
        points.push(this.snapPoint(section.endPoint));
      }
    }
    return this.compactPolyline(points);
  }

  private snapPoint(point: LayoutPoint): LayoutPoint {
    return {
      x: this.snapCoordinate(point.x),
      y: this.snapCoordinate(point.y),
    };
  }

  private snapCoordinate(value: number): number {
    const snapped = Math.round(value / this.gridSize) * this.gridSize;
    if (Math.abs(snapped - value) <= this.epsilon) {
      return snapped;
    }
    return snapped;
  }

  private compactPolyline(points: LayoutPoint[]): LayoutPoint[] {
    if (points.length <= 2) {
      return points;
    }
    const result: LayoutPoint[] = [points[0]];
    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const next = points[i + 1];
      if (this.isColinear(prev, curr, next)) {
        continue;
      }
      result.push(curr);
    }
    result.push(points[points.length - 1]);
    return result;
  }

  private isColinear(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint): boolean {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    return abx * bcy === aby * bcx;
  }
}

async function loadElkFacade(): Promise<ElkFacade> {
  const ElkConstructor = (await import("elkjs/lib/elk.bundled.js")).default as unknown as { new (): ELK };
  const elkInstance = new ElkConstructor();
  return {
    async layout(graph: ElkGraph, options?: Record<string, unknown>) {
      const result = await elkInstance.layout(graph as unknown as Parameters<ELK["layout"]>[0], options);
      return result as unknown as ElkGraph;
    },
  };
}
