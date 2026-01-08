#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { convertVerilogToSave } from "./pipeline/verilogToTc.js";
import { parseModules } from "./utils/verilogUtils.js";

function printUsage(): void {
  console.error("Usage: verilog2tc --top <top_module> [--compact] [--no-flatten] <input.v> <output_folder>");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let top: string | undefined;
  let compact = false;
  let flatten = true;
  const paths: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--top" && i + 1 < args.length) {
      top = args[i + 1];
      i += 1;
    } else if (arg === "--compact") {
      compact = true;
    } else if (arg === "--no-flatten") {
      flatten = false;
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
  const outputPath = resolve(process.cwd(), outputPathRaw); // This is now treated as a specific folder for the schematic
  const verilog = await readFile(inputPath, "utf-8");

  try {
    const virtualName = basename(inputPath);

    // 1. Create output directory (schematic folder)
    await mkdir(outputPath, { recursive: true });

    // 2. Parse modules to find Custom Component dependencies
    const modules = parseModules(verilog);
    
    // Auto-generate IDs for modules that don't have one, excluding the top module
    const topModuleName = top || modules[0]?.name; 
    
    // Helper to hash string to bigint (63-bit FNV-1a-like)
    // We use 63-bit to ensure the ID is interpreted as a positive number by Godot's signed 64-bit integers.
    // If we used 64-bit, the MSB might be interpreted as a sign bit, causing a mismatch between 
    // the folder name (JS BigInt.toString() is unsigned) and the in-game ID (signed).
    const hashStringId = (str: string): bigint => {
        let hash = 0xcbf29ce484222325n;
        for (let i = 0; i < str.length; i++) {
            hash ^= BigInt(str.charCodeAt(i));
            hash *= 0x100000001b3n;
            hash &= 0xffffffffffffffffn; 
        }
        return hash & 0x7fffffffffffffffn;
    };

    const deps = modules
        .filter(m => m.name !== topModuleName) // Exclude top module
        .map(m => {
            if (m.customId === undefined) {
                // Auto-assign ID from hash of name
                return { ...m, customId: hashStringId(m.name) };
            }
            return m;
        });
    
    // Create a mapping for the top module to resolve these blackboxes to IDs
    const customComponentMapping: Record<string, bigint> = {};
    for (const dep of deps) {
        if (dep.customId !== undefined) {
             customComponentMapping[dep.name] = dep.customId;
        }
    }

    // 3. Build Dependencies if any
    if (deps.length > 0) {
      const depsFolder = join(outputPath, "dependencies");
      await mkdir(depsFolder, { recursive: true });

      for (const dep of deps) {
        const depFolder = join(depsFolder, dep.customId!.toString());
        await mkdir(depFolder, { recursive: true });
        
        console.log(`Building Dependency: ${dep.name} (ID: ${dep.customId})`);
        
        const depResult = await convertVerilogToSave(
          { "dep.v": dep.body },
          { 
            topModule: dep.name, 
            description: `Submodule: ${dep.name}`,
            compact,
            flatten: true, // Dependencies themselves are valid to be flattened internally
            saveId: dep.customId
          }
        );
        await writeFile(join(depFolder, "circuit.data"), depResult.saveFile);
      }
    }

    // 4. Build Top Module
    // If we have dependencies, we need to mark them as blackboxes so Yosys (even with flatten) 
    // preserves them as component instances instead of dissolving them.
    let topSource = verilog;
    if (deps.length > 0) {
        for (const dep of deps) {
              // Inject (* blackbox *) to preserve hierarchy for these specific modules
              const moduleDeclRegex = new RegExp(`module\\s+${dep.name}\\b`);
              topSource = topSource.replace(moduleDeclRegex, `(* blackbox *) module ${dep.name}`);
        }
    }

    // NOTE: flatten is TRUE by default. 
    // Even if we have deps, we use (* blackbox *) to protect THEM, 
    // whilst allowing the rest of the logic to flatten (which is usually desired).
    // User can override with --no-flatten if they want full hierarchy preservation (risky for TC compatibility).
    
    const topSaveId = hashStringId(top || modules[0]?.name || "Circuit");

    const { saveFile } = await convertVerilogToSave(
      { [virtualName]: topSource },
      { 
          topModule: top, 
          description: `Generated from ${inputPathRaw}`, 
          compact, 
          flatten,
          customComponentMapping, // Pass mapping so adapter knows how to map blackboxed types to IDs
          saveId: topSaveId
      }, 
    );
    
    // outputPath/<topSaveId>/circuit.data
    const topFolder = join(outputPath, topSaveId.toString());
    await mkdir(topFolder, { recursive: true });
    await writeFile(join(topFolder, "circuit.data"), saveFile);
    console.log(`Wrote schematic to directory: ${join(outputPathRaw, topSaveId.toString())}`);

  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
