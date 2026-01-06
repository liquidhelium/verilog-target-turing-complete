// @top: test19_unpack
// @category: fpu_test
module test19_unpack(clk, func_in, val_out_1, val_out_2);
  input clk;
  input [31:0] func_in;
  output [26:0] val_out_1; // mimic a_m
  output [9:0] val_out_2;  // mimic a_e

  reg [31:0] a;
  reg [26:0] a_m;
  reg [9:0] a_e;

  always @(posedge clk) begin
      a <= func_in;
      
      // Mimicking logic: a_m <= {a[22 : 0], 3'd0};
      a_m <= {a[22 : 0], 3'd0};
      
      // Mimicking logic: a_e <= a[30 : 23] (Simplified from FPU's a[30:23] - 127)
      a_e <= {2'b00, a[30 : 23]}; 
  end

  assign val_out_1 = a_m;
  assign val_out_2 = a_e;

endmodule
