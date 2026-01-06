// @top: full_adder
// @category: basic
module full_adder(input wire a, input wire b, input wire cin, output wire sum, output wire cout);
  assign sum = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule
