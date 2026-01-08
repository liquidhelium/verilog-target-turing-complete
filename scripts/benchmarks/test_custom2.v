// @top: test_custom
// @category: test
// @flatten: false
module tc_custom_8  (
    input [7:0] in1,
    input [7:0] in2,
    output [7:0] out
);
  assign out = ~in1 & in2;
endmodule

module test_custom(input [7:0] A, input [7:0] B,output [7:0] C);
    tc_custom_8 c1 (
        .in1(A),
        .in2(B),
        .out(C)
    );
endmodule
