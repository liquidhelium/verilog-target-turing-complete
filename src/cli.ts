#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename, join, extname } from "node:path";
import { convertVerilogToSave } from "./pipeline/verilogToTc.js";
import { parseModules } from "./utils/verilogUtils.js";
import { CustomComponentMeta } from "./netlist/types.js";

function printUsage(): void {
  console.error("Usage: verilog2tc --top <top_module> [--compact] [--no-flatten] <input.v> <output_folder>");
}


export async function runCli(args: string[]): Promise<void> {
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
    throw new Error("Invalid arguments: expected --top <name> <input> <output>");
  }

  const [inputPathRaw, outputPathRaw] = paths;
  const inputPath = resolve(process.cwd(), inputPathRaw);
  const outputPath = resolve(process.cwd(), outputPathRaw); 
  const verilog = await readFile(inputPath, "utf-8");

  try {
    const virtualName = basename(inputPath);

    // 1. Create output directory
    await mkdir(outputPath, { recursive: true });

    // 2. Parse modules
    const modules = parseModules(verilog);
    const topModuleName = top || modules[0]?.name; 
    
    // Helper to hash string to bigint
    const hashStringId = (str: string): bigint => {
        let hash = 0xcbf29ce484222325n;
        for (let i = 0; i < str.length; i++) {
            hash ^= BigInt(str.charCodeAt(i));
            hash *= 0x100000001b3n;
            hash &= 0xffffffffffffffffn; 
        }
        return hash & 0x7fffffffffffffffn;
    };

    const depsRaw = modules
        .filter(m => m.name !== topModuleName) 
        .map(m => {
            if (m.customId === undefined) {
                return { ...m, customId: hashStringId(m.name) };
            }
            return m;
        });
    
    const customComponentMapping: Record<string, bigint> = {};
    for (const dep of depsRaw) {
        if (dep.customId !== undefined) {
             customComponentMapping[dep.name] = dep.customId;
        }
    }

    // Sort dependencies
    const moduleMap = new Map(depsRaw.map(m => [m.name, m]));
    const graph = new Map<string, string[]>();

    for (const mod of depsRaw) {
        const d: string[] = [];
        for (const potentialDep of depsRaw) {
            if (mod.name === potentialDep.name) continue;
            // Simple heuristic: check if module name appears as a word in body
            const re = new RegExp(`\\b${potentialDep.name}\\b`);
            if (re.test(mod.body)) {
                d.push(potentialDep.name);
            }
        }
        graph.set(mod.name, d);
    }

    const visited = new Set<string>();
    const temp = new Set<string>();
    const sortedDeps: typeof depsRaw = [];

    const visit = (name: string, path: string[]) => {
        if (temp.has(name)) {
             throw new Error(`Circular dependency detected: ${path.join(" -> ")} -> ${name}`);
        }
        if (visited.has(name)) return;
        
        temp.add(name);
        const myDeps = graph.get(name) || [];
        for (const depName of myDeps) {
            visit(depName, [...path, name]);
        }
        temp.delete(name);
        visited.add(name);
        sortedDeps.push(moduleMap.get(name)!);
    };

    for (const mod of depsRaw) {
        if (!visited.has(mod.name)) {
             visit(mod.name, []);
        }
    }

    const customComponentDefinitions: Record<string, CustomComponentMeta> = {};

    // 3. Build Dependencies
    if (sortedDeps.length > 0) {
      const depsFolder = join(outputPath, "dependencies");
      await mkdir(depsFolder, { recursive: true });

      for (const dep of sortedDeps) {
        const depFolder = join(depsFolder, dep.name);
        await mkdir(depFolder, { recursive: true });
        
        console.log(`Building Dependency: ${dep.name}`);
        
        const isSv = extname(inputPath).toLowerCase() === ".sv";
        const depFilename = isSv ? "dep.sv" : "dep.v";

        const depResult = await convertVerilogToSave(
          { [depFilename]: dep.body },
          { 
            topModule: dep.name, 
            description: `Submodule: ${dep.name}`,
            compact,
            flatten: true, 
            saveId: dep.customId,
            customComponentMapping,
            customComponentDefinitions
          }
        );
        await writeFile(join(depFolder, "circuit.data"), depResult.saveFile);
        
        if (depResult.customMetadata) {
            customComponentDefinitions[dep.name] = depResult.customMetadata;
        }
      }
    }

    // 4. Build Top Module
    let topSource = verilog;
    if (sortedDeps.length > 0) {
        for (const dep of sortedDeps) {
              const moduleDeclRegex = new RegExp(`module\\s+${dep.name}\\b`);
              topSource = topSource.replace(moduleDeclRegex, `(* blackbox *) module ${dep.name}`);
        }
    }
    
    const topSaveId = hashStringId(top || modules[0]?.name || "Circuit");

    const { saveFile } = await convertVerilogToSave(
      { [virtualName]: topSource },
      { 
          topModule: top, 
          description: `Generated from ${inputPathRaw}`, 
          compact, 
          flatten,
          customComponentMapping,
          customComponentDefinitions,
          saveId: topSaveId
      }, 
    );

    if (sortedDeps.length > 0) {
        const topFolder = join(outputPath, topModuleName);
        await mkdir(topFolder, { recursive: true });
        await writeFile(join(topFolder, "circuit.data"), saveFile);
        console.log(`Wrote schematic to directory: ${join(outputPathRaw, topModuleName)}`);
    } else {
        await writeFile(join(outputPath, "circuit.data"), saveFile);
        console.log(`Wrote schematic to directory: ${outputPathRaw}`);
    }

  } catch (error) {
     throw error;
  }
}

async function main(): Promise<void> {
  await runCli(process.argv.slice(2));
}

