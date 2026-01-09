// @top: advanced_cpu
// @category: systemverilog
// @flattening: true

/**
 * Module: ALU
 * Description: Arithmetic Logic Unit handling mathematical and logical operations.
 */
module alu (
    input  logic [15:0] a,
    input  logic [15:0] b,
    input  logic [2:0]  op, // 3-bit Opcode
    output logic [15:0] res,
    output logic        zero,
    output logic        neg
);
    always_comb begin
        case (op)
            3'b000: res = a + b;       // ADD
            3'b001: res = a - b;       // SUB
            3'b010: res = a & b;       // AND
            3'b011: res = a | b;       // OR
            3'b100: res = a ^ b;       // XOR
            3'b101: res = ~a;          // NOT A
            3'b110: res = a << 1;      // SHL
            3'b111: res = a >> 1;      // SHR
            default: res = 16'd0;
        endcase
        
        zero = (res == 16'd0);
        neg  = res[15]; // Sign bit check
    end
endmodule

/**
 * Module: Conditioner
 * Description: Determines if a branch should be taken based on flags and condition code.
 */
module conditioner (
    input  logic       zero_flag,
    input  logic       neg_flag,
    input  logic [2:0] cond_code, // Condition from instruction
    output logic       take_branch
);
    // Condition Codes:
    // 000: Always (Unconditional)
    // 001: Equal (Zero)
    // 010: Not Equal (!Zero)
    // 011: Less Than (Negative)
    // 100: Greater or Equal (!Negative)
    // Others: Never
    
    always_comb begin
        case (cond_code)
            3'b000: take_branch = 1'b1;
            3'b001: take_branch = zero_flag;
            3'b010: take_branch = !zero_flag;
            3'b011: take_branch = neg_flag;
            3'b100: take_branch = !neg_flag;
            default: take_branch = 1'b0;
        endcase
    end
endmodule

/**
 * Module: Registers
 * Description: 4 General Purpose Registers (R0-R3).
 */
module reg_file (
    input  logic        clk,
    input  logic        rst,
    input  logic        we,          // Write Enable
    input  logic [1:0]  rd_addr,     // Write Address
    input  logic [1:0]  rs1_addr,    // Read Address 1
    input  logic [1:0]  rs2_addr,    // Read Address 2
    input  logic [15:0] write_data,
    output logic [15:0] rs1_data,
    output logic [15:0] rs2_data
);
    logic [15:0] regs [3:0];

    // Read Logic (Async)
    assign rs1_data = regs[rs1_addr];
    assign rs2_data = regs[rs2_addr];

    // Write Logic (Sync)
    always_ff @(posedge clk or posedge rst) begin
        if (rst) begin
            regs[0] <= 16'd0;
            regs[1] <= 16'd0;
            regs[2] <= 16'd0;
            regs[3] <= 16'd0;
        end else if (we) begin
            regs[rd_addr] <= write_data;
        end
    end
endmodule


/**
 * Top Module: Advanced CPU
 * Description: A CPU with ALU, Registers, and Branching Logic.
 *              Internal Decoder handles 32-bit Instructions.
 * 
 * Instruction Format (32-bit):
 * [31:28] Opcode
 *         0000: ALU R-Type (Reg-Reg)
 *         0001: ALU I-Type (Reg-Imm)
 *         0010: Branch
 * [27:25] Func3 (ALU Op or Condition Code)
 * [24:23] Rd (Destination Register)
 * [22:21] Rs1 (Source Register 1)
 * [20:19] Rs2 (Source Register 2)
 * [15:0]  Immediate (16-bit)
 */
module advanced_cpu (
    input  logic        clk,
    input  logic        rst,
    input  logic [31:0] instruction, // Single instruction input
    
    // Outputs (for observation)
    output logic [15:0] pc_out,
    output logic [15:0] alu_result,
    output logic        branch_taken
);

    // --- Decoder Signals ---
    logic [3:0]  opcode;
    logic [2:0]  func3;
    logic [1:0]  rd_idx, rs1_idx, rs2_idx;
    logic [15:0] imm_val;

    // --- Control Signals (Internal) ---
    logic [2:0]  alu_op;
    logic        reg_we;
    logic        use_imm;
    logic        is_branch;
    logic [2:0]  branch_cond;

    // --- Datapath Signals ---
    logic [15:0] current_pc;
    logic [15:0] next_pc;
    logic [15:0] rs1_val;
    logic [15:0] rs2_val;
    logic [15:0] alu_in_b;
    logic [15:0] alu_out;
    logic        zero_flag, neg_flag;
    logic        do_branch;

    // --- Instruction Decoding ---
    assign opcode   = instruction[31:28];
    assign func3    = instruction[27:25];
    assign rd_idx   = instruction[24:23];
    assign rs1_idx  = instruction[22:21];
    assign rs2_idx  = instruction[20:19];
    assign imm_val  = instruction[15:0];

    always_comb begin
        // Default Control Signals
        reg_we      = 1'b0;
        use_imm     = 1'b0;
        is_branch   = 1'b0;
        alu_op      = 3'b000;
        branch_cond = 3'b000;

        case (opcode)
            4'b0000: begin // ALU R-Type (Reg = Reg op Reg)
                reg_we  = 1'b1;
                use_imm = 1'b0;
                alu_op  = func3;
            end
            4'b0001: begin // ALU I-Type (Reg = Reg op Imm)
                reg_we  = 1'b1;
                use_imm = 1'b1;
                alu_op  = func3;
            end
            4'b0010: begin // Branch
                is_branch   = 1'b1;
                branch_cond = func3;
            end
            default: begin
                // NOP or invalid
            end
        endcase
    end

    // --- PC Logic ---
    always_ff @(posedge clk or posedge rst) begin
        if (rst) begin
            current_pc <= 16'd0;
        end else begin
            current_pc <= next_pc;
        end
    end

    // --- Register File ---
    reg_file regs (
        .clk(clk),
        .rst(rst),
        .we(reg_we),
        .rd_addr(rd_idx),
        .rs1_addr(rs1_idx),
        .rs2_addr(rs2_idx),
        .write_data(alu_out),
        .rs1_data(rs1_val),
        .rs2_data(rs2_val)
    );

    // --- ALU Operand Mux ---
    assign alu_in_b = use_imm ? imm_val : rs2_val;

    // --- ALU Instance ---
    alu main_alu (
        .a(rs1_val),
        .b(alu_in_b),
        .op(alu_op),
        .res(alu_out),
        .zero(zero_flag),
        .neg(neg_flag)
    );

    // --- Conditioner Instance ---
    conditioner cond_unit (
        .zero_flag(zero_flag),
        .neg_flag(neg_flag),
        .cond_code(branch_cond),
        .take_branch(do_branch)
    );

    // --- Next PC Logic ---
    assign branch_taken = is_branch & do_branch;
    
    always_comb begin
        if (is_branch && do_branch) begin
            next_pc = current_pc + imm_val;
        end else begin
            next_pc = current_pc + 16'd1;
        end
    end

    // --- Outputs ---
    assign pc_out = current_pc;
    assign alu_result = alu_out;

endmodule
