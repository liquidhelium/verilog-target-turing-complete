// @top: sv_always
// @category: systemverilog
module sv_always(
    input logic clk,
    input logic rst,
    input logic a,
    input logic b,
    output logic y_comb,
    output logic y_seq
);

    // SystemVerilog always_comb block
    always_comb begin
        y_comb = a ^ b;
    end

    // SystemVerilog always_ff block
    always_ff @(posedge clk or posedge rst) begin
        if (rst) begin
            y_seq <= 1'b0;
        end else begin
            y_seq <= a & b;
        end
    end

endmodule
