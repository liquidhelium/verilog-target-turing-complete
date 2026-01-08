// @top: test_custom9
// @category: test
// @flatten: false
module tc_custom_8_9  (
    input [7:0] in,
    output [7:0] out
);
  assign out = ~in;
endmodule

module test_custom9(input [7:0] A, output [7:0] B);
    tc_custom_8_9 c1 (
        .in(A),
        .out(B)
    );
endmodule
