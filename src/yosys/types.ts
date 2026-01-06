export interface YosysRunFiles {
  [name: string]: string | Uint8Array;
}

export interface YosysRunRequest {
  script: string;
  files?: YosysRunFiles;
  timeoutMs?: number;
}

export interface YosysRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  files: Record<string, Uint8Array>;
}

export interface YosysBackend {
  run(request: YosysRunRequest): Promise<YosysRunResult>;
}

export interface YosysWasmInstance {
  run(request: YosysRunRequest): Promise<YosysRunResult>;
  dispose?(): void | Promise<void>;
}
