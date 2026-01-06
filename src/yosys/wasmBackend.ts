import { YosysBackend, YosysRunRequest, YosysRunResult, YosysWasmInstance } from "./types.js";

export type YosysInstanceFactory = () => Promise<YosysWasmInstance>;

/**
 * Lazily instantiates the Yosys wasm module and forwards run requests.
 */
export class YosysWasmBackend implements YosysBackend {
  private instancePromise?: Promise<YosysWasmInstance>;

  constructor(private readonly factory: YosysInstanceFactory) {}

  async run(request: YosysRunRequest): Promise<YosysRunResult> {
    const instance = await this.acquireInstance();
    return instance.run(request);
  }

  async dispose(): Promise<void> {
    if (!this.instancePromise) {
      return;
    }
    const instance = await this.instancePromise;
    if (typeof instance.dispose === "function") {
      await instance.dispose();
    }
    this.instancePromise = undefined;
  }

  private acquireInstance(): Promise<YosysWasmInstance> {
    if (!this.instancePromise) {
      this.instancePromise = this.factory();
    }
    return this.instancePromise;
  }
}

export class MissingYosysBackend implements YosysBackend {
  constructor(private readonly hint = "Provide a Yosys wasm factory to YosysWasmBackend") {}

  async run(): Promise<never> {
    throw new Error(`Yosys backend not configured. ${this.hint}`);
  }
}
