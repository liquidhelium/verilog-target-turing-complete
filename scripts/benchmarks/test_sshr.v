// @top: test_sshr
// @category: test
module test_sshr (
    input signed [7:0] a,
    input [2:0] b,
    output signed [7:0] y
);
    assign y = a >>> b;
endmodule
