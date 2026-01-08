import { runYosys } from "@yowasp/yosys";
import { YosysBackend, YosysRunRequest, YosysRunResult } from "./types.js";

type YosysTree = { [name: string]: string | Uint8Array | YosysTree };

function isYosysTree(value: unknown): value is YosysTree {
  return typeof value === "object" && value !== null && !(value instanceof Uint8Array);
}

export class DefaultYosysBackend implements YosysBackend {
  async run(request: YosysRunRequest): Promise<YosysRunResult> {
    const files: YosysTree = {};
    if (request.files) {
      for (const [name, content] of Object.entries(request.files)) {
        files[name] = typeof content === "string" ? content : new Uint8Array(content);
      }
    }

    const args = ["-q", "-p", request.script];
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];

    const decoder = new TextDecoder();
    const concat = (chunks: Uint8Array[]): string => {
      if (chunks.length === 0) return "";
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return decoder.decode(merged);
    };

    try {
      const output = (await runYosys(args, files, {
        stdout: (chunk) => {
          if (chunk) stdoutChunks.push(chunk);
        },
        stderr: (chunk) => {
          if (chunk) stderrChunks.push(chunk);
        },
      })) as YosysTree | undefined;
      const resultFiles: Record<string, Uint8Array> = {};
      for (const [name, value] of Object.entries(output ?? {})) {
        if (typeof value === "string") {
          resultFiles[name] = new TextEncoder().encode(value);
        } else if (value instanceof Uint8Array) {
          resultFiles[name] = value;
        } else if (!isYosysTree(value)) {
          continue;
        }
      }
      return { stdout: concat(stdoutChunks), stderr: concat(stderrChunks), exitCode: 0, files: resultFiles };
    } catch (e: any) {
        const stdout = concat(stdoutChunks);
        const stderr = concat(stderrChunks);
        e.message += `\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
        throw e;
    }
  }
}
