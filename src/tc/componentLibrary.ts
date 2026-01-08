import { ComponentKind, ComponentRotation, TCPoint } from "./types.js";
export { ComponentKind, ComponentRotation, TCPoint } from "./types.js";

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
    { minX: 0, maxX: 2, minY: 0, maxY: 0 },
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
    { minX: -2, maxX: 0, minY: 0, maxY: 0 },
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
    { minX: 0, maxX: 2, minY: 0, maxY: 0 },
  ),
);

export const CUSTOM_GENERIC = register(
  template(
     "CUSTOM_GENERIC",
     "Custom",
     ComponentKind.Custom,
     [
       { id: "in", direction: "in", position: { x: -1, y: 0 } },
       { id: "out", direction: "out", position: { x: 1, y: 0 } },
     ],
     { minX: -2, maxX: 2, minY: -1, maxY: 1 }
  )
);

export const CONST_1 = register(
  template(
    "CONST_1",
    "On",
    ComponentKind.On,
    [
      { id: "out", direction: "out", position: { x: 1, y: 0 } },
    ],
    { minX: 0, maxX: 2, minY: 0, maxY: 0 },
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
  size: number,
  outputX: number = 2,
  outputY: number = 0
): ComponentPort[] {
  const ports: ComponentPort[] = [];
  // Reverted input spacing change per user instruction "input is correct"
  // y logic: n=2 -> 0. Ports at 0, -1.
  let y = Math.floor((inputs.length - 1) / 2);

  inputs.forEach((id, i) => {
    ports.push({
      id,
      direction: "in",
      position: { x: -1, y: inputs.length > 1 ? y - i : 0 },
    });
  });
  if (output) {
    ports.push({ id: output, direction: "out", position: { x: outputX, y: outputY } });
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
  register(template(`AND_${size}`, `And${size}`, GATES.AND[size], makePorts(["A", "B"], "Y", size, 1)));
  // @ts-ignore
  register(template(`OR_${size}`, `Or${size}`, GATES.OR[size], makePorts(["A", "B"], "Y", size, 1)));
  // @ts-ignore
  register(template(`XOR_${size}`, `Xor${size}`, GATES.XOR[size], makePorts(["A", "B"], "Y", size, 1)));
  // @ts-ignore
  register(template(`XNOR_${size}`, `Xnor${size}`, GATES.XNOR[size], makePorts(["A", "B"], "Y", size, 1)));
  // @ts-ignore
  register(template(`NOT_${size}`, `Not${size}`, GATES.NOT[size], makePorts(["A"], "Y", size, 1)));
  // @ts-ignore
  register(template(`MUX_${size}`, `Mux${size}`, GATES.MUX[size], makePorts(["A", "B", "S"], "Y", size, 1)));
});

// IO
const IOS = {
  INPUT: { 8: ComponentKind.Input8, 16: ComponentKind.Input16, 32: ComponentKind.Input32, 64: ComponentKind.Input64 },
  OUTPUT: { 8: ComponentKind.Output8, 16: ComponentKind.Output16, 32: ComponentKind.Output32, 64: ComponentKind.Output64 },
};

SIZES.forEach((size) => {
  // @ts-ignore
  register(template(`INPUT_${size}`, `Input${size}`, IOS.INPUT[size], [{ id: "out", direction: "out", position: { x: size === 8 ? 1 : 2, y: 0 } }]));
  // @ts-ignore
  register(template(`OUTPUT_${size}`, `Output${size}`, IOS.OUTPUT[size], [{ id: "in", direction: "in", position: { x: size === 8 ? -1 : -2, y: 0 } }]));
});

// Constants
const CONSTS = {
  8: ComponentKind.Constant8, 16: ComponentKind.Constant16, 32: ComponentKind.Constant32, 64: ComponentKind.Constant64,
};
SIZES.forEach((size) => {
  // Use 1 for 8-bit, 2 for others.
  const x = size === 8 ? 1 : 2;
  // Explicitly set bounds to anchor at x=0, so x=2 creates a valid body width.
  register(template(
    `CONST_${size}`, 
    `Const${size}`, 
    // @ts-ignore
    CONSTS[size], 
    [{ id: "out", direction: "out", position: { x, y: 0 } }],
    { minX: 0, maxX: x, minY: 0, maxY: 0 }
  ));
});

// Math Components
const SHIFTS = {
    SHR: { 8: ComponentKind.Shr8, 16: ComponentKind.Shr16, 32: ComponentKind.Shr32, 64: ComponentKind.Shr64 },
    SHL: { 8: ComponentKind.Shl8, 16: ComponentKind.Shl16, 32: ComponentKind.Shl32, 64: ComponentKind.Shl64 },
    ASHR: { 8: ComponentKind.Ashr8, 16: ComponentKind.Ashr16, 32: ComponentKind.Ashr32, 64: ComponentKind.Ashr64 },
  };

SIZES.forEach((size) => {
    // @ts-ignore
    register(template(`SHR_${size}`, `Shr${size}`, SHIFTS.SHR[size], makePorts(["A", "shift"], "out", size, 1, -1)));
    // @ts-ignore
    register(template(`SHL_${size}`, `Shl${size}`, SHIFTS.SHL[size], makePorts(["A", "shift"], "out", size, 1, -1)));
    // @ts-ignore
    register(template(`ASHR_${size}`, `Ashr${size}`, SHIFTS.ASHR[size], makePorts(["A", "shift"], "out", size, 1, -1)));
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
  
  if (size === 8) {
      for (let i = 0; i < size; i++) {
        makerPorts.push({ id: `in${i}`, direction: "in", position: { x: -1, y: i - Math.floor((size - 1) / 2) } });
      }
  } else {
      // For 16, 32, 64: Split into 8-bit chunks.
      const chunks = size / 8;
      // Fix: 16-bit maker needs adjustment (y-1) because logic implies it.
      // Actually user asked for "Calculation result - 1" for 16-bit maker.
      const adj = size === 16 ? -1 : 0;
      for (let i = 0; i < chunks; i++) {
          makerPorts.push({ id: `in${i}`, direction: "in", position: { x: -1, y: i - Math.floor((chunks - 1) / 2) + adj } });
      }
  }
  
  makerPorts.push({ id: "out", direction: "out", position: { x: 1, y: 0 } });
  register(template(`MAKER_${size}`, `Maker${size}`, makerKind, makerPorts));

  // Splitter: Input in. Outputs 0..size-1.
  // @ts-ignore
  const splitterKind = SPLITMAKERS.SPLITTER[size];
  const splitterPorts: ComponentPort[] = [];
  splitterPorts.push({ id: "in", direction: "in", position: { x: -1, y: 0 } });
  
  if (size === 8) {
      for (let i = 0; i < size; i++) {
        splitterPorts.push({ id: `out${i}`, direction: "out", position: { x: 1, y: i - Math.floor((size - 1) / 2) } });
      }
  } else {
      const chunks = size / 8;
      const adj = size === 16 ? -1 : 0;
      for (let i = 0; i < chunks; i++) {
        splitterPorts.push({ id: `out${i}`, direction: "out", position: { x: 1, y: i - Math.floor((chunks - 1) / 2) + adj } });
      }
  }

  register(template(`SPLITTER_${size}`, `Splitter${size}`, splitterKind, splitterPorts));
});

// Comparisons
const COMPS = {
  EQUAL: { 8: ComponentKind.Equal8, 16: ComponentKind.Equal16, 32: ComponentKind.Equal32, 64: ComponentKind.Equal64 },
  LESSU: { 8: ComponentKind.LessU8, 16: ComponentKind.LessU16, 32: ComponentKind.LessU32, 64: ComponentKind.LessU64 },
  LESSI: { 8: ComponentKind.LessI8, 16: ComponentKind.LessI16, 32: ComponentKind.LessI32, 64: ComponentKind.LessI64 },
};

// Explicit EQUAL_1 alias to XNOR_1
register(template(
  "EQUAL_1",
  "Equal1",
  ComponentKind.Xnor, // Use basic XNOR gate matching A==B logic?
  // XNOR A,B -> Y. (A==B)
  [
    { id: "A", direction: "in", position: { x: -1, y: 1 } },
    { id: "B", direction: "in", position: { x: -1, y: -1 } },
    { id: "out", direction: "out", position: { x: 2, y: 0 } }, // Rename Y to out
  ]
));

SIZES.forEach((size) => {
  // Equal
  // @ts-ignore
  register(template(`EQUAL_${size}`, `Equal${size}`, COMPS.EQUAL[size], makePorts(["A", "B"], "out", size, 1)));
  // Less Unsigned
  // @ts-ignore
  register(template(`LESSU_${size}`, `LessU${size}`, COMPS.LESSU[size], makePorts(["A", "B"], "out", size, 1)));
  // Less Signed
  // @ts-ignore
  register(template(`LESSI_${size}`, `LessI${size}`, COMPS.LESSI[size], makePorts(["A", "B"], "out", size, 1)));
});

// Registers
const REGISTERS = {
  8: ComponentKind.Register8, 16: ComponentKind.Register16, 32: ComponentKind.Register32, 64: ComponentKind.Register64,
};

// Bit Register (Size 1)
register(template(
  "REG_1",
  "Reg1",
  ComponentKind.BitMemory,
  [
     { id: "save", direction: "in", position: { x: -1, y: -1 } }, // Top: Enable Write
     // Middle (y=0) is empty
     { id: "value", direction: "in", position: { x: -1, y: 1 } }, // Bottom: Value
     { id: "out", direction: "out", position: { x: 1, y: 0 } },    // Output
  ]
));

SIZES.forEach((size) => {
  const x = size === 8 ? 1 : 2;
  // @ts-ignore
  register(template(
    `REG_${size}`,
    `Reg${size}`,
    // @ts-ignore
    REGISTERS[size],
    [
      { id: "load", direction: "in", position: { x: -x, y: -1 } }, // Read/Enable Output (1 bit)
      { id: "save", direction: "in", position: { x: -x, y: 0 } },  // Write/Clock (1 bit)
      { id: "value", direction: "in", position: { x: -x, y: 1 } }, // Data In (N bits)
      { id: "out", direction: "out", position: { x: x, y: 0 } },   // Data Out (N bits)
    ]
  ));
});

// Math
const MATH = {
  ADD: { 8: ComponentKind.Add8, 16: ComponentKind.Add16, 32: ComponentKind.Add32, 64: ComponentKind.Add64 },
  MUL: { 8: ComponentKind.Mul8, 16: ComponentKind.Mul16, 32: ComponentKind.Mul32, 64: ComponentKind.Mul64 },
  SHL: { 8: ComponentKind.Shl8, 16: ComponentKind.Shl16, 32: ComponentKind.Shl32, 64: ComponentKind.Shl64 },
  SHR: { 8: ComponentKind.Shr8, 16: ComponentKind.Shr16, 32: ComponentKind.Shr32, 64: ComponentKind.Shr64 },
  NEG: { 8: ComponentKind.Neg8, 16: ComponentKind.Neg16, 32: ComponentKind.Neg32, 64: ComponentKind.Neg64 },
  DIVMOD: { 8: ComponentKind.DivMod8, 16: ComponentKind.DivMod16, 32: ComponentKind.DivMod32, 64: ComponentKind.DivMod64 },
};

SIZES.forEach((size) => {
  // Adder Ports:
  // In: CarryIn (y=-1), A (y=0), B (y=1) -> But makePorts uses center logic.
  // Actually TC Adder layout:
  // Inputs (Left):
  //  Top (y=-1): Carry In
  //  Mid (y=0):  Operand 1
  //  Bot (y=1):  Operand 2
  // Outputs (Right):
  //  Top (y=-1): Carry Out
  //  Mid (y=0):  Sum
  //
  // Our makePorts centers inputs. 3 inputs -> y indices: -1, 0, 1.
  // "A", "B" are usually operands.
  // So we map: "carry_in", "A", "B".
  // And outputs: "carry_out", "sum".
  // Note: Yosys adapter currently maps to "A", "B" and "sum".
  // We need to define ports such that "A" ends up at y=0, "B" at y=1.
  // "carry_in" at y=-1.
  
  const addPorts: ComponentPort[] = [
      { id: "carry_in", direction: "in", position: { x: -1, y: -1 } },
      { id: "A", direction: "in", position: { x: -1, y: 0 } },
      { id: "B", direction: "in", position: { x: -1, y: 1 } },
      { id: "sum", direction: "out", position: { x: 1, y: -1 } },
      { id: "carry_out", direction: "out", position: { x: 1, y: 0 } },
    ];
  // @ts-ignore
  register(template(`ADD_${size}`, `Add${size}`, MATH.ADD[size], addPorts));
  
  // @ts-ignore
  register(template(`MUL_${size}`, `Mul${size}`, MATH.MUL[size], makePorts(["A", "B"], "pro", size, 1)));
  // @ts-ignore
  register(template(`SHL_${size}`, `Shl${size}`, MATH.SHL[size], makePorts(["A", "shift"], "out", size, 1, -1)));
  // @ts-ignore
  register(template(`SHR_${size}`, `Shr${size}`, MATH.SHR[size], makePorts(["A", "shift"], "out", size, 1, -1)));
  // @ts-ignore
  register(template(`NEG_${size}`, `Neg${size}`, MATH.NEG[size], makePorts(["A"], "out", size, 1)));
  // DivMod has 2 outputs.
});

// Comparisons
// Removed duplicate COMPS declaration and array that caused TS Error


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
