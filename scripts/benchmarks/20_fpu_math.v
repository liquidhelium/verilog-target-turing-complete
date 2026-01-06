// @top: test20_math
// @category: fpu_test
module test20_math(clk, a, b, z_out, s_out);
    input clk;
    input [31:0] a;
    input [31:0] b;
    output [31:0] z_out;
    output s_out;

    reg [31:0] z;
    reg s;

    always @(posedge clk) begin
        // basic math
        z <= a + b;
        
        // signed comparison
        if ($signed(a) > $signed(b)) begin
            s <= 1;
        end else begin
            s <= 0;
        end
    end
    
    assign z_out = z;
    assign s_out = s;
endmodule
