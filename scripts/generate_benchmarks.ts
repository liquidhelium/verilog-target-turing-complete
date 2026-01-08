import { promises as fs } from "node:fs";
import { join, resolve, parse } from "node:path";
import { convertVerilogToSave, ConvertOptions } from "../src/index.js";

interface Benchmark {
  name: string;
  verilog: string;
  top: string;
  category: string;
  compact: boolean;
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
            
            const topMatch = content.match(/\/\/ @top:\s*(\w+)/);
            if (topMatch) top = topMatch[1];
            
            const catMatch = content.match(/\/\/ @category:\s*(\w+)/);
            if (catMatch) category = catMatch[1];

            const compactMatch = content.match(/\/\/ @compact:\s*(true|false)/i);
            if (compactMatch) compact = compactMatch[1].toLowerCase() === "true";
            
            benchmarks.push({
                name,
                verilog: content,
                top,
                category,
                compact
            });
        }
    } catch (e) {
        console.error(`Error loading benchmarks from ${dir}:`, e);
        return [];
    }

    return benchmarks.sort((a,b) => a.name.localeCompare(b.name));
}

// Helper to identify modules
function parseModules(content: string): { name: string; body: string; customId?: bigint }[] {
  const modules: { name: string; body: string; customId?: bigint }[] = [];
  // Regex to match module declaration block. Simplified: matches "module name()...endmodule"
  const moduleRegex = /module\s+(\w+)\s*[\s\S]*?;([\s\S]*?)endmodule/g;
  let match;
  while ((match = moduleRegex.exec(content)) !== null) {
      const name = match[1];
      const body = match[2];
      const fullText = match[0];
      
      let customId: bigint | undefined;
      // Search for parameter CUSTOM_ID = 64'd... or numbers
      // Search in fullText to support ANSI style parameter ports
      const paramMatch = fullText.match(/parameter\s+CUSTOM_ID\s*=\s*(?:64'd)?(\d+)/) || 
                         fullText.match(/parameter\s+CUSTOM_ID\s*=\s*([0-9]+)/);
      if (paramMatch) {
          customId = BigInt(paramMatch[1]);
      }
      
      modules.push({ name, body: fullText, customId });
  }
  return modules;
}

function createBlackbox(moduleName: string, originalBody: string): string {
    // Keep port definition, empty body, add blackbox attribute
    // Extract header "module name(...);"
    const headerMatch = originalBody.match(/module\s+\w+\s*\(.*?\)\s*;/s);
    if (!headerMatch) return originalBody; // Fallback
    
    // We retain parameters just in case, but usually for blackbox we just need ports. 
    // TC requires ports to match.
    // If we replace body with empty, Yosys sees it as empty module. 
    // To identify it as a "known" component to preserve hierarchy, 
    // `(* blackbox *)` is useful but `verilogToTc` logic with `flatten` usually ignores attributes unless we change Yosys script.
    // BUT, if we modify `verilogToTc` Yosys script logic to `hierarchy -check -top ...` it still processes down.
    // The key is: we want `adapter` to see an INSTANCE of `moduleName`.
    // If the module is empty (assigns removed), `flatten` keeps the empty module instantiated? 
    // No, `flatten` usually dissolves hierarchy.
    // We need `(* blackbox *)`.
    
    return `(* blackbox *) ${headerMatch[0]} endmodule`;
}

async function main() {
  const args = process.argv.slice(2);
  const splitMode = args.includes("--split");
  const filter = args.find(a => !a.startsWith("--"));

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
  
  // Clean output directory for filtered run? Or just overwrite.
  // try {
  //   if (!filter) await fs.rm(outputBase, { recursive: true, force: true });
  // } catch (e) {}
  await fs.mkdir(outputBase, { recursive: true });

  console.log(`Generating ${targets.length} benchmarks...`);

  for (const bench of targets) {
    const folder = join(outputBase, bench.name);
    await fs.mkdir(folder, { recursive: true });
    
    console.log(`Processing ${bench.name}...`);
    try {
      const modules = parseModules(bench.verilog);
      // Identify custom modules (dep) and top module
      // If bench.top is specified, us it. Else use bench.name.
      // If multiple modules, we assume modules WITH CUSTOM_ID are deps.

      const deps = modules.filter(m => m.customId !== undefined);
      
      const doSplit = splitMode && deps.length > 0;

      let topOutputDir = folder;
      if (doSplit) {
          topOutputDir = join(folder, "top");
      }
      await fs.mkdir(topOutputDir, { recursive: true });

      // 1. Build Dependencies
      if (doSplit) {
          const depsBaseFolder = join(folder, "dependencies");
          
          for (const dep of deps) {
             const depFolder = join(depsBaseFolder, dep.customId!.toString());
             await fs.mkdir(depFolder, { recursive: true });
             
             console.log(`  -> Building Submodule ${dep.name} (ID: ${dep.customId})`);

             // Isolate the source for the dependency to avoid Yosys confusion with other modules
             const depSource = dep.body; // Assuming parsing captured full module text correctly

             // We compile the submodule using the Full Verilog content, picking it as TOP.
             const depResult = await convertVerilogToSave(
                { "bench.v": depSource },
                { 
                    topModule: dep.name, 
                    description: `Submodule: ${dep.name}`,
                    debug: true,
                    compact: bench.compact
                }
             );
             await fs.writeFile(join(depFolder, "circuit.data"), depResult.saveFile);
          }
      }

      // 2. Build Top
      // If we have deps, we should modify the verilog passed to Top build
      // so that deps are blackboxed to prevent flattening logic from optimizing them away
      // OR rely on Yosys `flatten` behavior.
      // If we add `(* blackbox *)` to the dep modules in source, Yosys `flatten` preserves them as cells.
      
      let topSource = bench.verilog;
      if (doSplit) {
          // Replace dep modules with blackboxes in the source text
          for (const dep of deps) {
              // We inject (* blackbox *) attribute before the module definition
              // This tells Yosys to preserve the module as a cell
              const moduleDeclRegex = new RegExp(`module\\s+${dep.name}\\b`);
              topSource = topSource.replace(moduleDeclRegex, `(* blackbox *) module ${dep.name}`);
          }
      }

      const result = await convertVerilogToSave(
        { "bench.v": topSource },
        { 
            topModule: bench.top, 
            description: `Benchmark: ${bench.name}`,
            debug: true,
            compact: bench.compact
        }
      );
      
      await fs.writeFile(join(topOutputDir, "circuit.data"), result.saveFile);
      if (result.debugInfo) {
          await fs.writeFile(join(topOutputDir, "layout.json"), JSON.stringify(result.debugInfo.layoutJson, null, 2));
          await fs.writeFile(join(topOutputDir, "yosys.json"), JSON.stringify(result.debugInfo.yosysJson, null, 2));
      }
      console.log(`  -> OK`);
    } catch (e: any) {
      console.error(`  -> Failed: ${e}`);
      if (e.stdout) console.log("STDOUT:", e.stdout.toString());
      if (e.stderr) console.error("STDERR:", e.stderr.toString());
    }
  }
}

main().catch(console.error);
