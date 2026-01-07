import { promises as fs } from "node:fs";
import { join, resolve, parse } from "node:path";
import { convertVerilogToSave, ConvertOptions } from "../src/index.js";

interface Benchmark {
  name: string;
  verilog: string;
  top: string;
  category: string;
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
            
            const topMatch = content.match(/\/\/ @top:\s*(\w+)/);
            if (topMatch) top = topMatch[1];
            
            const catMatch = content.match(/\/\/ @category:\s*(\w+)/);
            if (catMatch) category = catMatch[1];
            
            benchmarks.push({
                name,
                verilog: content,
                top,
                category
            });
        }
    } catch (e) {
        console.error(`Error loading benchmarks from ${dir}:`, e);
        return [];
    }

    return benchmarks.sort((a,b) => a.name.localeCompare(b.name));
}

async function main() {
  const filter = process.argv[2];
  const allBenchmarks = await loadBenchmarks();
  
  if (allBenchmarks.length === 0) {
      console.error("No benchmarks found.");
      return;
  }

  let targets = allBenchmarks;
  if (filter) {
      targets = allBenchmarks.filter(b => b.name.includes(filter) || b.category == filter)
  }

  const outputBase = resolve("test_output");
  
  // Clean output directory
  try {
    if (!filter) await fs.rm(outputBase, { recursive: true, force: true });
  } catch (e) {}
  await fs.mkdir(outputBase, { recursive: true });

  console.log(`Generating ${targets.length} benchmarks...`);

  for (const bench of targets) {
    const folder = join(outputBase, bench.name);
    await fs.mkdir(folder, { recursive: true });
    
    console.log(`Processing ${bench.name}...`);
    try {
      const result = await convertVerilogToSave(
        { "bench.v": bench.verilog },
        { 
            topModule: bench.top, 
            description: `Benchmark: ${bench.name}`,
            debug: true 
        }
      );
      
      await fs.writeFile(join(folder, "circuit.data"), result.saveFile);
      if (result.debugInfo) {
          await fs.writeFile(join(folder, "layout.json"), JSON.stringify(result.debugInfo.layoutJson, null, 2));
          await fs.writeFile(join(folder, "yosys.json"), JSON.stringify(result.debugInfo.yosysJson, null, 2));
      }
      console.log(`  -> OK`);
    } catch (e) {
      console.error(`  -> Failed: ${e}`);
    }
  }
}

main().catch(console.error);
