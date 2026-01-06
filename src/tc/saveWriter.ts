import { compress } from "snappy";
import {
  ComponentKind,
  ComponentRotation,
  SAVE_FORMAT_VERSION,
  TCComponent,
  TCPoint,
  TCSavePayload,
  TCSynced,
  TELEPORT_WIRE,
  WireKind,
  WireColor,
  TCWire,
} from "./types.js";

class BinarySink {
  private readonly bytes: number[] = [];

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  writeBoolean(value: boolean): void {
    this.writeUnsigned(value ? 1n : 0n, 1);
  }

  writeUnsigned(value: number | bigint, byteCount: number): void {
    let big = typeof value === "bigint" ? value : BigInt(value);
    if (big < 0n) {
      throw new RangeError("Unsigned value cannot be negative");
    }
    for (let i = 0; i < byteCount; i += 1) {
      this.bytes.push(Number(big & 0xffn));
      big >>= 8n;
    }
    if (big !== 0n) {
      throw new RangeError(`Unsigned value exceeds ${byteCount * 8} bits`);
    }
  }

  writeSigned(value: number | bigint, byteCount: number): void {
    let big = typeof value === "bigint" ? value : BigInt(value);
    const limit = 1n << BigInt(byteCount * 8);
    if (big < -(limit >> 1n) || big >= limit >> 1n) {
      throw new RangeError(`Signed value exceeds ${byteCount * 8} bits`);
    }
    if (big < 0n) {
      big = limit + big;
    }
    this.writeUnsigned(big, byteCount);
  }

  writeString(value: string): void {
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > 0xffff) {
      throw new RangeError("String exceeds 65535 bytes");
    }
    this.writeUnsigned(encoded.length, 2);
    for (const byte of encoded) {
      this.bytes.push(byte);
    }
  }

  writePoint(point: TCPoint): void {
    this.writeSigned(point.x, 2);
    this.writeSigned(point.y, 2);
  }
}

export interface TCSaveWriterResult {
  saveFile: Uint8Array;
  uncompressed: Uint8Array;
}

export class TCSaveWriter {
  constructor(private readonly payload: TCSavePayload) {}

  async build(): Promise<TCSaveWriterResult> {
    const sink = new BinarySink();
    this.writeHeader(sink);
    this.writeComponents(sink);
    this.writeWires(sink);

    const uncompressed = sink.toUint8Array();
    const compressedBuffer = await compress(uncompressed);
    const compressed = new Uint8Array(compressedBuffer);

    const saveFile = new Uint8Array(1 + compressed.length);
    saveFile[0] = SAVE_FORMAT_VERSION;
    saveFile.set(compressed, 1);

    return { saveFile, uncompressed };
  }

  private writeHeader(sink: BinarySink): void {
    const {
      saveId,
      hubId,
      gate,
      delay,
      menuVisible,
      clockSpeed,
      dependencies,
      description,
      cameraPosition,
      synced,
      campaignBound,
      playerData,
      hubDescription,
    } = this.payload;

    sink.writeUnsigned(saveId, 8);
    sink.writeUnsigned(hubId, 4);
    sink.writeUnsigned(gate, 8);
    sink.writeUnsigned(delay, 8);
    sink.writeBoolean(menuVisible);
    sink.writeUnsigned(clockSpeed, 4);

    sink.writeUnsigned(dependencies.length, 2);
    for (const dep of dependencies) {
      sink.writeUnsigned(dep, 8);
    }

    sink.writeString(description);
    sink.writePoint(cameraPosition);
    sink.writeUnsigned(synced, 1);
    sink.writeBoolean(campaignBound);

    sink.writeUnsigned(0, 2);

    sink.writeUnsigned(playerData.length, 2);
    for (const byte of playerData) {
      if (byte < 0 || byte > 255) {
        throw new RangeError("Player data byte must be 0-255");
      }
      sink.writeUnsigned(byte, 1);
    }

    sink.writeString(hubDescription);
  }

  private writeComponents(sink: BinarySink): void {
    const { components } = this.payload;
    sink.writeUnsigned(components.length, 8);

    for (const component of components) {
      const {
        kind,
        position,
        rotation,
        permanentId,
        customString,
        setting1,
        setting2,
        uiOrder,
        customId,
        customDisplacement,
        selectedPrograms,
      } = component;

      sink.writeUnsigned(kind, 2);
      sink.writePoint(position);
      sink.writeUnsigned(rotation, 1);
      sink.writeUnsigned(permanentId, 8);
      sink.writeString(customString);
      sink.writeUnsigned(setting1, 8);
      sink.writeUnsigned(setting2, 8);
      sink.writeSigned(uiOrder, 2);

      if (kind === ComponentKind.Custom) {
        sink.writeUnsigned(customId ?? 0n, 8);
        sink.writePoint(customDisplacement ?? { x: 0, y: 0 });
      } else if (
        kind === ComponentKind.Program8_1 ||
        kind === ComponentKind.Program8_4 ||
        kind === ComponentKind.Program
      ) {
        this.writeSelectedPrograms(sink, selectedPrograms ?? []);
      }
    }
  }

  private writeSelectedPrograms(
    sink: BinarySink,
    selected: Array<{ programId: bigint; name: string }>,
  ): void {
    const stable = [...selected].sort((a, b) => (a.programId < b.programId ? -1 : a.programId > b.programId ? 1 : 0));
    sink.writeUnsigned(stable.length, 2);
    for (const { programId, name } of stable) {
      sink.writeUnsigned(programId, 8);
      sink.writeString(name);
    }
  }

  private writeWires(sink: BinarySink): void {
    const { wires } = this.payload;
    sink.writeUnsigned(wires.length, 8);

    for (const wire of wires) {
      const { kind, color, comment, path } = wire;

      sink.writeUnsigned(kind, 1);
      sink.writeUnsigned(color, 1);
      sink.writeString(comment);
      sink.writePoint(path.start);

      if (path.body.length === 0) {
        throw new RangeError("Wire body must contain at least one segment byte");
      }

      for (const segment of path.body) {
        if (segment < 0 || segment > 255) {
          throw new RangeError("Wire segment must be 0-255");
        }
        sink.writeUnsigned(segment, 1);
      }

      const last = path.body[path.body.length - 1];
      if (last === TELEPORT_WIRE) {
        if (!path.end) {
          throw new Error("Teleport wire requires an end point");
        }
        sink.writePoint(path.end);
      }
    }
  }
}

export function createTeleportWire(
  start: TCPoint,
  end: TCPoint,
  kind: WireKind = WireKind.Wk1,
  color: WireColor = WireColor.Default,
  comment = "",
): TCWire {
  return {
    kind,
    color,
    comment,
    path: { start, body: [TELEPORT_WIRE], end },
  };
}

export function defaultComponent(partial: Partial<TCComponent> & Pick<TCComponent, "kind" | "position">): TCComponent {
  return {
    kind: partial.kind,
    position: partial.position,
    rotation: partial.rotation ?? ComponentRotation.Rot0,
    permanentId: partial.permanentId ?? 0n,
    customString: partial.customString ?? "",
    setting1: partial.setting1 ?? 0n,
    setting2: partial.setting2 ?? 0n,
    uiOrder: partial.uiOrder ?? 0,
    customId: partial.customId,
    customDisplacement: partial.customDisplacement,
    selectedPrograms: partial.selectedPrograms,
  };
}

export function defaultSavePayload(partial: Partial<TCSavePayload>): TCSavePayload {
  return {
    saveId: partial.saveId ?? 0n,
    hubId: partial.hubId ?? 0,
    gate: partial.gate ?? 0n,
    delay: partial.delay ?? 0n,
    menuVisible: partial.menuVisible ?? false,
    clockSpeed: partial.clockSpeed ?? 0,
    dependencies: partial.dependencies ?? [],
    description: partial.description ?? "",
    cameraPosition: partial.cameraPosition ?? { x: 0, y: 0 },
    synced: partial.synced ?? TCSynced.Unsynced,
    campaignBound: partial.campaignBound ?? false,
    playerData: partial.playerData ?? [],
    hubDescription: partial.hubDescription ?? "",
    components: partial.components ?? [],
    wires: partial.wires ?? [],
  };
}
