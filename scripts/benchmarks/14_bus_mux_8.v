// @top: bus_mux_8
// @category: new
module bus_mux_8(input wire [7:0] a, input wire [7:0] b, input wire s, output wire [7:0] y);
  assign y = s ? b : a;
endmodule
