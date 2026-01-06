#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { convertVerilogToSave } from "./pipeline/verilogToTc.js";

function printUsage(): void {
  console.error("Usage: verilog2tc --top <top_module> <input.v> <output.tcsav>");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let top: string | undefined;
  const paths: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--top" && i + 1 < args.length) {
      top = args[i + 1];
      i += 1;
    } else {
      paths.push(arg);
    }
  }

  if (!top || paths.length !== 2) {
    printUsage();
    process.exit(1);
  }

  const [inputPathRaw, outputPathRaw] = paths;
  const inputPath = resolve(process.cwd(), inputPathRaw);
  const outputPath = resolve(process.cwd(), outputPathRaw);
  const verilog = await readFile(inputPath, "utf-8");

  try {
    const virtualName = basename(inputPath);
    const { saveFile } = await convertVerilogToSave(
      { [virtualName]: verilog },
      { topModule: top, description: `Generated from ${inputPathRaw}` },
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, saveFile);
    console.log(`Wrote ${outputPathRaw}`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
