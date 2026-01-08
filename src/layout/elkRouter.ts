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

const GRAPH_SCALE = 10;

export class ElkRouter {
  private readonly gridSize: number;
  private readonly epsilon: number;
  private readonly elkPromise: Promise<ElkFacade>;
  private readonly compact: boolean;

  constructor(options: ElkRouterOptions = {}) {
    this.gridSize = options.gridSize ?? 8;
    this.epsilon = options.epsilon ?? 0.1;
    this.compact = options.compact ?? false;
    this.elkPromise = options.elk
      ? Promise.resolve(options.elk)
      : loadElkFacade();
  }

  async route(graph: LayoutGraph): Promise<LayoutResult> {
    const elk = await this.elkPromise;
    const elkGraph = this.toElkGraph(graph);
    const laidOut = await elk.layout(elkGraph);
    if (this.compact) {
      return this.compactLayout(laidOut);
    }
    return this.fromElkGraph(laidOut);
  }

  private compactLayout(graph: ElkGraph): LayoutResult {
    const nodes: LayoutNodePlacement[] = [];

    for (const child of graph.children ?? []) {
      if (child.x === undefined || child.y === undefined) {
        continue;
      }

      const rawX = child.x / GRAPH_SCALE;
      const rawY = child.y / GRAPH_SCALE;

      const node: LayoutNodePlacement = {
        id: child.id,
        position: this.snapPoint({ x: rawX, y: rawY }),
        width: child.width / GRAPH_SCALE,
        height: child.height / GRAPH_SCALE,
        ports: this.collectPortPlacements(child),
        data: child.data,
      };
      (node as any)._rawX = rawX;
      nodes.push(node);
    }

    nodes.sort((a, b) => (a as any)._rawX - (b as any)._rawX);

    // Calculate total area and target side length for a square approximation
    const GAP = 1;
    let totalArea = 0;
    let maxNodeHeight = 0;
    for (const node of nodes) {
      // Area including gap spacing overhead
      const w = node.width + GAP;
      const h = node.height + GAP;
      totalArea += w * h;
      maxNodeHeight = Math.max(maxNodeHeight, h);
    }
    
    // Determine target height. 
    // Usually H = Sqrt(Area). We ensure it's at least as tall as the tallest component.
    const targetHeight = Math.max(Math.ceil(Math.sqrt(totalArea)), maxNodeHeight);

    const columns: LayoutNodePlacement[][] = [];
    let currentCol: LayoutNodePlacement[] = [];
    let currentHeight = 0;
    let maxColH = 0;

    for (const node of nodes) {
      if (currentCol.length > 0 && currentHeight + node.height + GAP > targetHeight) {
          // If adding this node exceeds target height significantly 
          // (check if just slightly over is ok? For now strict cut)
          columns.push(currentCol);
          currentCol = [];
          currentHeight = 0;
      }
      currentCol.push(node);
      currentHeight += node.height + GAP;
      maxColH = Math.max(maxColH, currentHeight);
    }
    
    if (currentCol.length > 0) {
      columns.push(currentCol);
    }

    let currentX = 0;

    for (const col of columns) {
      // Sort vertically? No, preserve ELK relative Y order?
      // Actually sorting by _rawX already linearized them.
      // Top to bottom in column corresponds to left-to-right in linearization.
      // This is "Snake" or just wrapping.
      
      let currentY = 0;
      let colWidth = 0;
      for (const node of col) {
        colWidth = Math.max(colWidth, node.width);
      }
      
      // Center vertically in square? or Center relative to row?
      // Just start from 0. Offset will be handled by global centering.

      for (const node of col) {
        // Horizontally center in column
        const offsetX = Math.floor((colWidth - node.width) / 2);
        this.shiftNode(node, currentX + offsetX, currentY);
        currentY += node.height + GAP;
      }
      currentX += colWidth + GAP;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (nodes.length > 0) {
      minX = nodes[0].position.x;
      maxX = nodes[0].position.x + nodes[0].width;
      minY = nodes[0].position.y;
      maxY = nodes[0].position.y + nodes[0].height;

      for (const node of nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + node.width);
        maxY = Math.max(maxY, node.position.y + node.height);
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      for (const node of nodes) {
        this.shiftNode(
          node,
          Math.round(node.position.x - centerX),
          Math.round(node.position.y - centerY)
        );
        delete (node as any)._rawX;
      }
    }

    return { nodes, edges: [] };
  }

  private shiftNode(node: LayoutNodePlacement, x: number, y: number) {
    const dx = x - node.position.x;
    const dy = y - node.position.y;
    node.position.x = x;
    node.position.y = y;
    for (const key in node.ports) {
      node.ports[key].x += dx;
      node.ports[key].y += dy;
    }
  }

  private toElkGraph(graph: LayoutGraph): ElkGraph {
    const children = graph.nodes.map((node) => this.toElkNode(node));
    const edges = graph.edges.map((edge) => this.toElkEdge(edge));
    return {
      id: graph.id ?? "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.separateConnectedComponents": "false",
        "elk.layered.mergeEdges": "true",
        "elk.spacing.nodeNode": "20",
        "elk.layered.spacing.nodeNodeBetweenLayers": "40",
        "elk.layered.spacing.edgeNodeBetweenLayers": "20",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
        "elk.layered.compaction.connectedComponents": "true",
        "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.layerUnzipping.strategy": "ALTERNATING",
        "elk.layered.nodePlacement.bk.edgeStraightening": "IMPROVE_STRAIGHTNESS",
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
      width: node.width * GRAPH_SCALE,
      height: node.height * GRAPH_SCALE,
      ports: node.ports.map((port) => this.toElkPort(node, port)),
      layoutOptions: {
        "elk.portConstraints": "FIXED_POS",
        ...node.layoutOptions,
      },
      data: node.data,
    };
  }

  private toElkPort(node: LayoutNode, port: LayoutPort): ElkGraphPort {
    return {
      id: `${node.id}.${port.id}`,
      x: port.x * GRAPH_SCALE,
      y: port.y * GRAPH_SCALE,
      layoutOptions: {
        "elk.port.side": port.side,
      },
    };
  }

  private toElkEdge(edge: LayoutEdge): ElkGraphEdge {
    const sources = edge.sources.map(
      (endpoint) => `${endpoint.node}.${endpoint.port}`
    );
    const targets = edge.targets.map(
      (endpoint) => `${endpoint.node}.${endpoint.port}`
    );
    return {
      id: edge.id,
      sources,
      targets,
      layoutOptions: {
        "elk.layered.spacing.edgeEdgeBetweenLayers": "50",
        ...(edge.minLength
          ? { "elk.layered.edgeNodeSpacingFactor": String(edge.minLength) }
          : {}),
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
        position: this.snapPoint({ x: child.x / GRAPH_SCALE, y: child.y / GRAPH_SCALE }),
        width: child.width / GRAPH_SCALE,
        height: child.height / GRAPH_SCALE,
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

  private collectPortPlacements(
    node: ElkGraphNode
  ): Record<string, LayoutPoint> {
    const placements: Record<string, LayoutPoint> = {};
    for (const port of node.ports ?? []) {
      if (!port.id || port.x === undefined || port.y === undefined) {
        continue;
      }
      const prefix = `${node.id}.`;
      const shortId = port.id.startsWith(prefix)
        ? port.id.substring(prefix.length)
        : port.id;
      placements[shortId] = this.snapPoint({
        x: (node.x ?? 0) / GRAPH_SCALE + port.x / GRAPH_SCALE,
        y: (node.y ?? 0) / GRAPH_SCALE + port.y / GRAPH_SCALE,
      });
    }
    return placements;
  }

  private collectEdgePoints(sections: ElkGraphEdgeSection[]): LayoutPoint[] {
    const points: LayoutPoint[] = [];
    for (const section of sections) {
      if (section.startPoint) {
        points.push(this.snapPoint({ x: section.startPoint.x / GRAPH_SCALE, y: section.startPoint.y / GRAPH_SCALE }));
      }
      for (const bend of section.bendPoints ?? []) {
        points.push(this.snapPoint({ x: bend.x / GRAPH_SCALE, y: bend.y / GRAPH_SCALE }));
      }
      if (section.endPoint) {
        points.push(this.snapPoint({ x: section.endPoint.x / GRAPH_SCALE, y: section.endPoint.y / GRAPH_SCALE }));
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
  const ElkConstructor = (await import("elkjs/lib/elk.bundled.js"))
    .default as unknown as { new (): ELK };
  const elkInstance = new ElkConstructor();
  return {
    async layout(graph: ElkGraph, options?: Record<string, unknown>) {
      const result = await elkInstance.layout(
        graph as unknown as Parameters<ELK["layout"]>[0],
        options
      );
      return result as unknown as ElkGraph;
    },
  };
}
