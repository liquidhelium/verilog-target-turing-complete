# Verilog to Turing Complete Save Converter

This is a tool that converts Verilog HDL code into save files for the game [Turing Complete](https://store.steampowered.com/app/1444480/Turing_Complete/).

It utilizes **Yosys** to synthesize Verilog code into a netlist, and uses **ELK (Eclipse Layout Kernel)** algorithms to automatically layout components on the game canvas, finally generating a `.tcsav` save file that the game can read directly. This allows you to write Verilog in a professional IDE and then import it into the game for simulation or integration.

## Core Features

*   **Verilog Support**: Powered by the robust open-source synthesis tool [Yosys](https://yosyshq.net/yosys/), supporting standard Verilog syntax.
*   **Automatic Layout**: Uses ELK algorithms to automatically calculate component coordinates and wire routing, eliminating the need for manual placement.
*   **Component Mapping**: Automatically maps synthesized logic gates (AND, OR, NOT, XOR, etc.) and complex components (Adders, Multiplexers, etc.) to their corresponding in-game components.
*   **Input/Output Handling**: Automatically identifies Verilog module I/O ports and generates the corresponding port components in the game.

## Installation

This project is built with Node.js. Please ensure you have Node.js installed (v18+ recommended).

1.  **Clone the repository**
    ```bash
    git clone <repository_url>
    cd verilog2tc/js
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Build the project**
    ```bash
    npm run build
    ```

## Usage

After compiling, you can perform conversions using the command-line tool `verilog2tc` (located at `dist/cli.js`).

### Command Line Arguments

```bash
node dist/cli.js [options] <input_file.v> <output_file.tcsav>
```

#### Parameters

*   `--top <module_name>` **(Required)**
    Specifies the name of the top-level module in your Verilog file. This is the entry point for synthesis.

*   `--compact` **(Optional)**
    Enables compact layout mode. This significantly reduces the size of the generated schematic by compressing the spacing between components.
    *   **Recommended for large designs** to avoid generating maps that are too large for the game to handle.

*   `--no-flatten` **(Optional)**
    Prevents the Yosys synthesizer from flattening the design hierarchy.
    *   **Advanced usage**: Use this only if you want to strictly control the netlist structure.
    *   Note: Known `CUSTOM_ID` dependencies are automatically preserved (blackboxed) even if this is not set.

*   `<input_file.v>`
    Path to the source Verilog file.

*   `<output_folder>`
    **Directory path** where the generated schematic will be saved.
    *   The tool will create `circuit.data` (the schematic file) inside this directory.
    *   If any submodules with `CUSTOM_ID` are detected, a `dependencies/` subfolder will also be created containing the compiled submodules, ready for use as Custom Components in the game.

### Example

Suppose you have a file named `counter.v` with a top-level module named `counter_8bit`:

```bash
# Standard conversion (outputs to folder 'counter_schematic')
node dist/cli.js --top counter_8bit counter.v counter_schematic/
```
The output structure will be:
```
counter_schematic/
  circuit.data
  dependencies/ (if custom custom modules exist)
     ...
```

## Limitations & Known Issues

1.  **Embedded Custom Components**
    The game may not correctly recognize or link "Custom" components (user-defined sub-circuits) that are embedded directly within the generated schematic. It is safer to flatten your design or use standard primitives where possible.

2.  **Map Size & Game Stability**
    Without the `--compact` flag, complex designs may result in an extremely large map.
    *   **Crash Risk**: Large maps can cause the game to crash upon loading.
    *   **Startup Lockout**: Since the game attempts to load the last opened map on startup, a corrupted or oversized map can prevent the game from opening.
    *   **Fix**: If you get stuck, manually replace the problematic `circuit.data` file in your save directory with a known good (small) save file to restore access to the game.

3.  **Redundant Logic**
    The generated circuits may contain redundant logic gates or sub-optimal structures. This is because the mapping from Verilog netlist to game components involves manual lowering of cells, which might not always capture every possible optimization that a human designer would see.

## Development

Project structure:

*   `src/pipeline/`: Core conversion flow control.
*   `src/yosys/`: Yosys WASM interface and executor, handling Verilog -> JSON netlist.
*   `src/netlist/`: Netlist adapter, processing data structures output by Yosys.
*   `src/layout/`: Layout engine interface, calling `elkjs` for coordinate calculation.
*   `src/tc/`: Game save format (circuit.data) reader/writer and component definitions.

### Common Commands

*   `npm run build`: Compile TypeScript code to `dist/` directory.
*   `npm run lint`: Run ESLint for code style checking.
*   `npm test`: Run Vitest test suite.

## How it Works

1.  **Synthesis**: Calls `@yowasp/yosys` to synthesize Verilog code into a logical netlist.
2.  **Translation**: Parses the JSON netlist generated by Yosys, converts it into a graph data structure, and matches internal game component IDs.
3.  **Layout**: Sends the graph data to `elkjs` to calculate optimal positions and routing for each node (component) and edge (wire).
4.  **Serialization**: Writes the layout results into the binary format, compresses with snappy, and generates the `.tcsav` file.