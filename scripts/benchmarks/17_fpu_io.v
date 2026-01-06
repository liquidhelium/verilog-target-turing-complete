// @top: test17_io
// @category: fpu_test
module test17_io(
        input_a,
        input_a_stb,
        input_a_ack,
        output_z
    );

  input     [31:0] input_a;
  input     input_a_stb;
  output    input_a_ack;
  output    [31:0] output_z;

  assign input_a_ack = input_a_stb;
  assign output_z = input_a;

endmodule
