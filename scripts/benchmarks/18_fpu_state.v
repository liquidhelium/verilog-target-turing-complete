// @top: test18_state
// @category: fpu_test
module test18_state(clk, rst, state_out);
  input clk;
  input rst;
  output [3:0] state_out;

  reg       [3:0] state;
  parameter get_a         = 4'd0,
            get_b         = 4'd1,
            unpack        = 4'd2;

  always @(posedge clk)
  begin
    if (rst) begin
        state <= get_a;
    end else begin
        case(state)
            get_a: state <= get_b;
            get_b: state <= unpack;
            unpack: state <= get_a;
            default: state <= get_a;
        endcase
    end
  end
  
  assign state_out = state;
endmodule
