export type PortSide = "NORTH" | "EAST" | "SOUTH" | "WEST";

export interface LayoutPort {
  id: string;
  x: number;
  y: number;
  side: PortSide;
}

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  ports: LayoutPort[];
  data?: Record<string, unknown>;
}

export interface LayoutEdgeEndpoint {
  node: string;
  port: string;
}

export interface LayoutEdge {
  id: string;
  sources: LayoutEdgeEndpoint[];
  targets: LayoutEdgeEndpoint[];
  minLength?: number;
  priority?: number;
}

export interface LayoutGraph {
  id?: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNodePlacement {
  id: string;
  position: LayoutPoint;
  width: number;
  height: number;
  ports: Record<string, LayoutPoint>;
  data?: Record<string, unknown>;
}

export interface LayoutEdgeRoute {
  id: string;
  points: LayoutPoint[];
}

export interface LayoutResult {
  nodes: LayoutNodePlacement[];
  edges: LayoutEdgeRoute[];
}

export interface SnapConfig {
  gridSize: number;
  epsilon?: number;
}

export interface ElkRouterOptions {
  gridSize?: number;
  epsilon?: number;
  elk?: ElkFacade;
}

export interface ElkFacade {
  layout(graph: ElkGraph, options?: Record<string, unknown>): Promise<ElkGraph>;
}

export interface ElkGraph {
  id: string;
  layoutOptions?: Record<string, unknown>;
  children?: ElkGraphNode[];
  edges?: ElkGraphEdge[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ElkGraphNode {
  id: string;
  width: number;
  height: number;
  ports?: ElkGraphPort[];
  layoutOptions?: Record<string, unknown>;
  x?: number;
  y?: number;
  data?: Record<string, unknown>;
}

export interface ElkGraphPort {
  id: string;
  x: number;
  y: number;
  properties?: Record<string, unknown>;
  layoutOptions?: Record<string, unknown>;
}

export interface ElkGraphEdgeSection {
  startPoint?: LayoutPoint;
  endPoint?: LayoutPoint;
  bendPoints?: LayoutPoint[];
}

export interface ElkGraphEdge {
  id: string;
  sources: string[];
  targets: string[];
  layoutOptions?: Record<string, unknown>;
  sections?: ElkGraphEdgeSection[];
}
