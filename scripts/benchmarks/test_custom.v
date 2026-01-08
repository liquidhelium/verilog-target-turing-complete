module tc_custom_8_8 #(
    parameter CUSTOM_ID = 64'd12345
) (
    input [7:0] in,
    output [7:0] out
);
  assign out = ~in;
endmodule

module test_custom(input [7:0] A, output [7:0] B);
    tc_custom_8_8 #(.CUSTOM_ID(64'd12345)) c1 (
        .in(A),
        .out(B)
    );
endmodule
