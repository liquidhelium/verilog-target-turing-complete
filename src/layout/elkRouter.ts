import type { ELK } from "elkjs";
import { ComponentKind } from "../tc/types.js";
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

const LAYOUT_INPUT_KINDS = new Set([
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

const LAYOUT_OUTPUT_KINDS = new Set([
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
    
    // Separate into Input, Logic, Output
    const inputNodes: LayoutNodePlacement[] = [];
    const logicNodes: LayoutNodePlacement[] = [];
    const outputNodes: LayoutNodePlacement[] = [];

    for (const node of nodes) {
      if (node.data && typeof node.data.kind === 'number') {
        const kind = node.data.kind as ComponentKind;
        if (LAYOUT_INPUT_KINDS.has(kind)) {
          inputNodes.push(node);
          continue;
        }
        if (LAYOUT_OUTPUT_KINDS.has(kind)) {
          outputNodes.push(node);
          continue;
        }
      }
      logicNodes.push(node);
    }

    // Reassemble: inputs -> logic -> outputs
    // We process them as a single stream but they are now grouped.
    // The previous sorting by rawX inside each group is strictly preserved?
    // Yes, because `nodes` was sorted by rawX, and we pushed sequentially.
    
    // Logic for packing:
    // Inputs: One column (or more if too tall)
    // Logic: Packed in square
    // Outputs: One column (or more if too tall)
    
    const GAP = 1;
    const COL_GAP = 2; // Tighter column spacing
    const IO_SLOT_HEIGHT = 10;

    const getNodeHeight = (node: LayoutNodePlacement) => {
        if (node.data && typeof node.data.kind === 'number') {
            const kind = node.data.kind as ComponentKind;
            if (LAYOUT_INPUT_KINDS.has(kind) || LAYOUT_OUTPUT_KINDS.has(kind)) {
                return IO_SLOT_HEIGHT;
            }
        }
        return node.height + GAP;
    };

    const logicArea = logicNodes.reduce((sum, n) => sum + (n.width + COL_GAP) * (n.height + GAP), 0);
    let maxLogicHeight = 0;
    for (const n of logicNodes) maxLogicHeight = Math.max(maxLogicHeight, n.height + GAP);
    
    // Target height based PRIMARILY on logic block squareness
    // But constrained by input/output columns if they are huge?
    // Let's aim for square logic block first.
    let targetHeight = Math.max(Math.ceil(Math.sqrt(logicArea)), maxLogicHeight);
    
    // Ensure target height is at least as tall as the tallest single input/output column if possible?
    // Or let inputs/outputs wrap if they exceed target height.
    // Let's let them wrap.

    const columns: LayoutNodePlacement[][] = [];
    
    const packToColumns = (list: LayoutNodePlacement[]) => {
       let col: LayoutNodePlacement[] = [];
       let h = 0;
       for (const node of list) {
         const nodeH = getNodeHeight(node);
         if (col.length > 0 && h + nodeH > targetHeight) {
            columns.push(col);
            col = [];
            h = 0;
         }
         col.push(node);
         h += nodeH;
       }
       if (col.length > 0) columns.push(col);
    };

    packToColumns(inputNodes);
    
    // Force a new column for logic start if previous column wasn't empty? 
    // packToColumns pushes the last partial column.
    // So logic starts in a fresh column.
    
    packToColumns(logicNodes);
    packToColumns(outputNodes);

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
        
        // Calculate vertical position
        const totalH = getNodeHeight(node);
        let offsetY = 0;
        
        if (totalH === IO_SLOT_HEIGHT) {
            // Center within the IO slot
            offsetY = Math.floor((IO_SLOT_HEIGHT - node.height) / 2);
        } else {
            // Logic node
            offsetY = 0;
        }

        this.shiftNode(node, currentX + offsetX, currentY + offsetY);
        currentY += totalH;
      }
      currentX += colWidth + COL_GAP;
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
