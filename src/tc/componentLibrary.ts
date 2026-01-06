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

export const XNOR_1 = register(
  template(
    "XNOR_1",
    "Xnor",
    ComponentKind.Xnor,
    [
      { id: "A", direction: "in", position: { x: -1, y: 1 } },
      { id: "B", direction: "in", position: { x: -1, y: -1 } },
      { id: "Y", direction: "out", position: { x: 2, y: 0 } },
    ],
  ),
);

// --- Multi-bit Component Definitions ---

const SIZES = [8, 16, 32, 64];

function makePorts(
  inputs: string[],
  output: string | null,
  size: number
): ComponentPort[] {
  const ports: ComponentPort[] = [];
  let y = Math.floor((inputs.length - 1) / 2);
  inputs.forEach((id, i) => {
    ports.push({
      id,
      direction: "in",
      position: { x: -1, y: inputs.length > 1 ? y - i : 0 },
    });
  });
  if (output) {
    ports.push({ id: output, direction: "out", position: { x: 2, y: 0 } });
  }
  return ports;
}

// Logic Gates
const GATES = {
  AND: { 8: ComponentKind.And8, 16: ComponentKind.And16, 32: ComponentKind.And32, 64: ComponentKind.And64 },
  OR: { 8: ComponentKind.Or8, 16: ComponentKind.Or16, 32: ComponentKind.Or32, 64: ComponentKind.Or64 },
  XOR: { 8: ComponentKind.Xor8, 16: ComponentKind.Xor16, 32: ComponentKind.Xor32, 64: ComponentKind.Xor64 },
  XNOR: { 8: ComponentKind.Xnor8, 16: ComponentKind.Xnor16, 32: ComponentKind.Xnor32, 64: ComponentKind.Xnor64 },
  NOT: { 8: ComponentKind.Not8, 16: ComponentKind.Not16, 32: ComponentKind.Not32, 64: ComponentKind.Not64 },
  MUX: { 8: ComponentKind.Mux8, 16: ComponentKind.Mux16, 32: ComponentKind.Mux32, 64: ComponentKind.Mux64 },
};

SIZES.forEach((size) => {
  // @ts-ignore
  register(template(`AND_${size}`, `And${size}`, GATES.AND[size], makePorts(["A", "B"], "Y", size)));
  // @ts-ignore
  register(template(`OR_${size}`, `Or${size}`, GATES.OR[size], makePorts(["A", "B"], "Y", size)));
  // @ts-ignore
  register(template(`XOR_${size}`, `Xor${size}`, GATES.XOR[size], makePorts(["A", "B"], "Y", size)));
  // @ts-ignore
  register(template(`XNOR_${size}`, `Xnor${size}`, GATES.XNOR[size], makePorts(["A", "B"], "Y", size)));
  // @ts-ignore
  register(template(`NOT_${size}`, `Not${size}`, GATES.NOT[size], makePorts(["A"], "Y", size)));
  
  // Mux ports: A (0), B (1), S (Select). In TC Mux, top is input 0, bottom input 1? Or other way?
  // Usually Mux has Data inputs and Control. We'll verify ports later.
  // Assuming A, B, S. S is the control. 
  // TC Mux commonly has 3 input pins on left? No, usually Control is on side or bottom.
  // Let's assume standard layout for now: A, B, S.
  // @ts-ignore
  register(template(`MUX_${size}`, `Mux${size}`, GATES.MUX[size], makePorts(["A", "B", "S"], "Y", size)));
});

// IO
const IOS = {
  INPUT: { 8: ComponentKind.Input8, 16: ComponentKind.Input16, 32: ComponentKind.Input32, 64: ComponentKind.Input64 },
  OUTPUT: { 8: ComponentKind.Output8, 16: ComponentKind.Output16, 32: ComponentKind.Output32, 64: ComponentKind.Output64 },
};

SIZES.forEach((size) => {
  // @ts-ignore
  register(template(`INPUT_${size}`, `Input${size}`, IOS.INPUT[size], [{ id: "out", direction: "out", position: { x: 1, y: 0 } }]));
  // @ts-ignore
  register(template(`OUTPUT_${size}`, `Output${size}`, IOS.OUTPUT[size], [{ id: "in", direction: "in", position: { x: -1, y: 0 } }]));
});

// Constants
const CONSTS = {
  8: ComponentKind.Constant8, 16: ComponentKind.Constant16, 32: ComponentKind.Constant32, 64: ComponentKind.Constant64,
};
SIZES.forEach((size) => {
  // @ts-ignore
  register(template(`CONST_${size}`, `Const${size}`, CONSTS[size], [{ id: "out", direction: "out", position: { x: 1, y: 0 } }]));
});

// Splitters and Makers
const SPLITMAKERS = {
  MAKER: { 8: ComponentKind.Maker8, 16: ComponentKind.Maker16, 32: ComponentKind.Maker32, 64: ComponentKind.Maker64 },
  SPLITTER: { 8: ComponentKind.Splitter8, 16: ComponentKind.Splitter16, 32: ComponentKind.Splitter32, 64: ComponentKind.Splitter64 },
};

SIZES.forEach((size) => {
  // Maker: Inputs 0..size-1. Output out.
  // @ts-ignore
  const makerKind = SPLITMAKERS.MAKER[size];
  const makerPorts: ComponentPort[] = [];
  for (let i = 0; i < size; i++) {
    // Stagger inputs vertically
    // User requested LSB (0) at Top.
    // i=0 -> Top (Negative Y). i=size-1 -> Bottom (Positive Y).
    // Centering: (size-1)/2. For 8: 3.5. i=0->-3.5 ~ -3. i=7->3.5 ~ 4.
    makerPorts.push({ id: `in${i}`, direction: "in", position: { x: -1, y: i - Math.floor((size - 1) / 2) } });
  }
  makerPorts.push({ id: "out", direction: "out", position: { x: 1, y: 0 } });
  register(template(`MAKER_${size}`, `Maker${size}`, makerKind, makerPorts));

  // Splitter: Input in. Outputs 0..size-1.
  // @ts-ignore
  const splitterKind = SPLITMAKERS.SPLITTER[size];
  const splitterPorts: ComponentPort[] = [];
  splitterPorts.push({ id: "in", direction: "in", position: { x: -1, y: 0 } });
  for (let i = 0; i < size; i++) {
     // User requested LSB (0) at Top.
    splitterPorts.push({ id: `out${i}`, direction: "out", position: { x: 1, y: i - Math.floor((size - 1) / 2) } });
  }
  register(template(`SPLITTER_${size}`, `Splitter${size}`, splitterKind, splitterPorts));
});

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
