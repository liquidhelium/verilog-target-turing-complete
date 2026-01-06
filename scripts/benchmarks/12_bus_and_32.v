// @top: bus_and_32
// @category: new
module bus_and_32(input wire [31:0] a, input wire [31:0] b, output wire [31:0] y);
  assign y = a & b;
endmodule
