// @top: test23_add
// @category: fpu_test
module test23_add(
    input clk,
    input [9:0] a_e_in,
    input [26:0] a_m_in,
    input [26:0] b_m_in,
    input a_s_in,
    input b_s_in,
    output [27:0] sum_out,
    output [9:0] z_e_out,
    output [3:0] next_state_out
);

  reg [27:0] sum;
  reg [9:0] z_e;
  reg [3:0] next_state;

  parameter state_normalise_1 = 4'd6;

  always @(posedge clk) begin
      z_e <= a_e_in;
      if (a_s_in == b_s_in) begin
        sum <= a_m_in + b_m_in;
        // if a_m + b_m overflow
        if (a_m_in[24] | b_m_in[24] | (a_m_in + b_m_in > 27'h1FFFFFF)) begin 
            // This condition is simplified from original potentially, but testing the logic flow
            // Actually in original:
            // sum <= {1'b0, a_m} + {1'b0, b_m};
        end
      end else begin
        if (a_m_in >= b_m_in) begin
          sum <= a_m_in - b_m_in;
        end else begin
          sum <= b_m_in - a_m_in;
        end
      end
      
      next_state <= state_normalise_1;
  end

  assign sum_out = sum;
  assign z_e_out = z_e;
  assign next_state_out = next_state;

endmodule
