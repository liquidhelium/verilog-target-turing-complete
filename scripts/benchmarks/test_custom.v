// @top: test_custom
// @category: test
// @flatten: false
module tc_custom_8_8  (
    input [7:0] in,
    output [7:0] out
);
  assign out = ~in;
endmodule

module test_custom(input [7:0] A, output [7:0] B);
    tc_custom_8_8 c1 (
        .in(A),
        .out(B)
    );
endmodule
