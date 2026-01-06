import { ComponentKind, ComponentRotation, TCPoint } from "./types.js";

export type PortDirection = "in" | "out";

export interface ComponentPort {
  id: string;
  direction: PortDirection;
  position: TCPoint;
}

export interface ComponentTemplateBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ComponentTemplate {
  id: string;
  name: string;
  kind: ComponentKind;
  rotation: ComponentRotation;
  ports: ComponentPort[];
  bounds: ComponentTemplateBounds;
}

function createBounds(ports: ComponentPort[], extra?: Partial<ComponentTemplateBounds>): ComponentTemplateBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const port of ports) {
    if (port.position.x < minX) minX = port.position.x;
    if (port.position.y < minY) minY = port.position.y;
    if (port.position.x > maxX) maxX = port.position.x;
    if (port.position.y > maxY) maxY = port.position.y;
  }
  if (extra?.minX !== undefined) minX = Math.min(minX, extra.minX);
  if (extra?.minY !== undefined) minY = Math.min(minY, extra.minY);
  if (extra?.maxX !== undefined) maxX = Math.max(maxX, extra.maxX);
  if (extra?.maxY !== undefined) maxY = Math.max(maxY, extra.maxY);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    throw new Error("Component template must define at least one port");
  }
  return { minX, minY, maxX, maxY };
}

function template(id: string, name: string, kind: ComponentKind, ports: ComponentPort[], extraBounds?: Partial<ComponentTemplateBounds>): ComponentTemplate {
  return {
    id,
    name,
    kind,
    rotation: ComponentRotation.Rot0,
    ports,
    bounds: createBounds(ports, extraBounds),
  };
}

const templates: Record<string, ComponentTemplate> = {};

function register(t: ComponentTemplate): ComponentTemplate {
  templates[t.id] = t;
  return t;
}

export const INPUT_1 = register(
  template(
    "INPUT_1",
    "Input1",
    ComponentKind.Input1,
    [
      { id: "out", direction: "out", position: { x: 1, y: 0 } },
    ],
    { minX: 0, maxX: 2, minY: -1, maxY: 1 },
  ),
);

export const OUTPUT_1 = register(
  template(
    "OUTPUT_1",
    "Output1",
    ComponentKind.Output1,
    [
      { id: "in", direction: "in", position: { x: -1, y: 0 } },
    ],
    { minX: -2, maxX: 0, minY: -1, maxY: 1 },
  ),
);

export const CONST_0 = register(
  template(
    "CONST_0",
    "Off",
    ComponentKind.Off,
    [
      { id: "out", direction: "out", position: { x: 1, y: 0 } },
    ],
    { minX: 0, maxX: 2, minY: -1, maxY: 1 },
  ),
);

export const CONST_1 = register(
  template(
    "CONST_1",
    "On",
    ComponentKind.On,
    [
      { id: "out", direction: "out", position: { x: 1, y: 0 } },
    ],
    { minX: 0, maxX: 2, minY: -1, maxY: 1 },
  ),
);

export const NOT_1 = register(
  template(
    "NOT_1",
    "Not",
    ComponentKind.Not,
    [
      { id: "A", direction: "in", position: { x: -1, y: 0 } },
      { id: "Y", direction: "out", position: { x: 1, y: 0 } },
    ],
  ),
);

export const AND_1 = register(
  template(
    "AND_1",
    "And",
    ComponentKind.And,
    [
      { id: "A", direction: "in", position: { x: -1, y: 1 } },
      { id: "B", direction: "in", position: { x: -1, y: -1 } },
      { id: "Y", direction: "out", position: { x: 2, y: 0 } },
    ],
  ),
);

export const OR_1 = register(
  template(
    "OR_1",
    "Or",
    ComponentKind.Or,
    [
      { id: "A", direction: "in", position: { x: -1, y: 1 } },
      { id: "B", direction: "in", position: { x: -1, y: -1 } },
      { id: "Y", direction: "out", position: { x: 2, y: 0 } },
    ],
  ),
);

export const XOR_1 = register(
  template(
    "XOR_1",
    "Xor",
    ComponentKind.Xor,
    [
      { id: "A", direction: "in", position: { x: -1, y: 1 } },
      { id: "B", direction: "in", position: { x: -1, y: -1 } },
      { id: "Y", direction: "out", position: { x: 2, y: 0 } },
    ],
  ),
);

export type TemplateId = keyof typeof templates;

export function getTemplate(id: TemplateId): ComponentTemplate;
export function getTemplate(id: string): ComponentTemplate;
export function getTemplate(id: string): ComponentTemplate {
  const tpl = templates[id];
  if (!tpl) {
    throw new Error(`Unknown component template ${id}`);
  }
  return tpl;
}

export function listTemplates(): ComponentTemplate[] {
  return Object.values(templates);
}
