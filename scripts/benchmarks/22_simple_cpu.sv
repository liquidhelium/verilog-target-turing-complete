// @top: simple_cpu
// @category: systemverilog
// @flattening: true

/**
 * Module: Program Counter Register
 * Description: Stores the current instruction address. Updates on clock edge (game tick).
 */
module pc_reg (
    input  logic        clk,
    input  logic        rst,
    input  logic [15:0] next_pc,
    output logic [15:0] pc
);
    always_ff @(posedge clk or posedge rst) begin
        if (rst) begin
            pc <= 16'd0;
        end else begin
            pc <= next_pc;
        end
    end
endmodule

/**
 * Module: Next Address Logic
 * Description: Calculates the next instruction address based on opcode and flags.
 *              Pure combinational logic.
 */
module next_pc_logic (
    input  logic [15:0] current_pc,
    input  logic [7:0]  opcode,
    input  logic [15:0] imm,
    input  logic        zero_flag,
    output logic [15:0] next_pc
);
    // Simple Instruction Set Encodings
    // Using simple consts instead of enum for better compatibility with limited parsers if needed,
    // though Yosys supports enums fine usually.
    localparam OP_NOP   = 8'h00; // Next = PC + 1
    localparam OP_JMP   = 8'h01; // Absolute Jump: Next = Immediate
    localparam OP_BREQ  = 8'h02; // Branch if Equal: if (zero) Next = PC + Imm (Rel); else Next = PC + 1
    localparam OP_HALT  = 8'hFF; // Halt: Next = PC

    always_comb begin
        case (opcode)
            OP_JMP: begin
                next_pc = imm;
            end
            OP_BREQ: begin
                if (zero_flag)
                    next_pc = current_pc + imm; // Relative jump
                else
                    next_pc = current_pc + 16'd1;
            end
            OP_HALT: begin
                next_pc = current_pc; // Loop forever
            end
            default: begin
                // Normal increment (OP_NOP and others)
                next_pc = current_pc + 16'd1;
            end
        endcase
    end
endmodule

/**
 * Top Module: Simple CPU Benchmark
 * Description: A simplified CPU frontend that calculates the next instruction address.
 */
module simple_cpu (
    input  logic        clk,
    input  logic        rst,
    input  logic [7:0]  opcode,
    input  logic [15:0] imm,      // Immediate value or Jump target
    input  logic        condition, // Condition flag (e.g., Zero result from previous ALU op)
    output logic [15:0] pc_out    // The address to fetch instruction from
);

    logic [15:0] current_pc_wire;
    logic [15:0] next_pc_wire;

    // Instantiate PC Register
    pc_reg pc_inst (
        .clk(clk),
        .rst(rst),
        .next_pc(next_pc_wire),
        .pc(current_pc_wire)
    );

    // Instantiate Next Address Logic
    next_pc_logic logic_inst (
        .current_pc(current_pc_wire),
        .opcode(opcode),
        .imm(imm),
        .zero_flag(condition),
        .next_pc(next_pc_wire)
    );

    // Output the address to fetch
    assign pc_out = current_pc_wire;

endmodule
