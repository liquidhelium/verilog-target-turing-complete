// @top: complex_logic
// @category: basic
module complex_logic(input wire a, input wire b, input wire c, output wire y);
  assign y = (a & b) | (~c);
endmodule
