import { promises as fs } from "node:fs";
import { join, resolve, parse } from "node:path";
import { runCli } from "../src/cli.js";

interface Benchmark {
  name: string;
  verilog: string;
  top: string;
  category: string;
  compact: boolean;
  flatten: boolean;
}

async function loadBenchmarks(): Promise<Benchmark[]> {
  // Expect benchmarks in scripts/benchmarks relative to CWD
  const dir = resolve(process.cwd(), "scripts/benchmarks");

  const benchmarks: Benchmark[] = [];
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".v")) continue;
      const name = parse(file).name;
      const content = await fs.readFile(join(dir, file), "utf-8");

      let top = name;
      let category = "unknown";
      let compact = false;
      let flatten = true; // Default strategy is to enable flattening unless specified otherwise

      const topMatch = content.match(/\/\/ @top:\s*(\w+)/);
      if (topMatch) top = topMatch[1];

      const catMatch = content.match(/\/\/ @category:\s*(\w+)/);
      if (catMatch) category = catMatch[1];

      const compactMatch = content.match(/\/\/ @compact:\s*(true|false)/i);
      if (compactMatch) compact = compactMatch[1].toLowerCase() === "true";

      const flattenMatch = content.match(/\/\/ @flattening:\s*(true|false)/i);
      if (flattenMatch) flatten = flattenMatch[1].toLowerCase() === "true";

      benchmarks.push({
        name,
        verilog: content,
        top,
        category,
        compact,
        flatten,
      });
    }
  } catch (e) {
    console.error(`Error loading benchmarks from ${dir}:`, e);
    return [];
  }

  return benchmarks.sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith("--"));

  const allBenchmarks = await loadBenchmarks();

  if (allBenchmarks.length === 0) {
    console.error("No benchmarks found.");
    return;
  }

  let targets = allBenchmarks;
  if (filter) {
    targets = allBenchmarks.filter(
      (b) => b.name.includes(filter) || b.category == filter
    );
  }

  const outputBase = resolve("test_output");
  await fs.mkdir(outputBase, { recursive: true });

  console.log(`Generating ${targets.length} benchmarks...`);

  for (const bench of targets) {
    const folder = join(outputBase, bench.name);
    // runCli expects: --top <top> [--compact] [--no-flatten] <input> <output>
    // But we don't have an input file on disk for some benchmarks (in-memory content? Wait, loadBenchmarks reads files.)
    // loadBenchmarks reads content. But CLI reads file from disk.
    // We should point CLI to the benchmark file: scripts/benchmarks/<file>
    
    // We need the original filename. loadBenchmarks parses it from directory traversal.
    // But loadBenchmarks returns 'name' (filename without extension).
    // Let's assume we can reconstruct path or pass it.
    // Actually, passing content to CLI is not supported. CLI reads file.
    // We can just call CLI with the path.
    const benchPath = join("scripts/benchmarks", `${bench.name}.v`);
    
    console.log(`Processing ${bench.name}...`);
    try {
        const cliArgs = ["--top", bench.top, benchPath, folder];
        if (bench.compact) cliArgs.push("--compact");
        if (!bench.flatten) cliArgs.push("--no-flatten");
        
        await runCli(cliArgs);
        console.log(`  -> OK`);
    } catch(e) {
        console.error(`  -> Failed: ${e}`);
    }
  }
}

main().catch(console.error);
