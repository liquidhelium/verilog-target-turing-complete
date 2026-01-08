import { ComponentTemplate, ComponentPort } from "../tc/componentLibrary.js";

export type NetBitId = string;

export interface CustomComponentMeta {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  ports: ComponentPort[];
}

export interface PortRef {
  componentId: string;
  portId: string;
}

export interface NetBit {
  id: NetBitId;
  source?: PortRef;
  sinks: PortRef[];
}

export interface ComponentInstance {
  id: string;
  template: ComponentTemplate;
  connections: Record<string, NetBitId>;
  metadata?: ComponentMetadata;
}

export interface NetlistGraph {
  components: ComponentInstance[];
  nets: Map<NetBitId, NetBit>;
}

export interface ModulePortMeta {
  portName: string;
  bitIndex: number;
}

export interface ComponentMetadata extends Record<string, unknown> {
  label?: string;
  modulePort?: ModulePortMeta;
  setting1?: bigint;
  customId?: bigint;
  portWidths?: Record<string, number>;
}
