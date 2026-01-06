// @top: half_adder
// @category: basic
module half_adder(input wire a, input wire b, output wire sum, output wire carry);
  assign sum = a ^ b;
  assign carry = a & b;
endmodule
