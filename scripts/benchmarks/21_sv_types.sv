// @top: sv_types
// @category: systemverilog
module sv_types(
    input logic [1:0] op,
    input logic [7:0] a,
    input logic [7:0] b,
    output logic [7:0] res
);

    // Enum definition
    typedef enum logic [1:0] {
        OP_ADD = 2'b00,
        OP_SUB = 2'b01,
        OP_AND = 2'b10,
        OP_OR  = 2'b11
    } opcode_t;

    // opcode_t operation;
    // assign operation = opcode_t'(op);

    always_comb begin
        case (op) // Use op directly to avoid cast issues in Yosys
            OP_ADD: res = a + b;
            OP_SUB: res = a - b;
            OP_AND: res = a & b;
            OP_OR:  res = a | b;
            default: res = 8'h00;
        endcase
    end

endmodule
