// @top: test21_align
// @category: fpu_test
module test21_align(
    input clk,
    input rst,
    input [9:0] ae_in,
    input [9:0] be_in,
    input [26:0] am_in,
    input [26:0] bm_in,
    output [9:0] ae_out,
    output [9:0] be_out,
    output [26:0] am_out,
    output [26:0] bm_out,
    output done
);

  reg [9:0] a_e, b_e;
  reg [26:0] a_m, b_m;
  reg is_done;
  
  // Minimal state machine to load and run
  reg state; 
  // 0: Load
  // 1: Align Loop

  always @(posedge clk) begin
    if (rst) begin
        state <= 0;
        is_done <= 0;
    end else begin
        case(state) 
            0: begin
                a_e <= ae_in;
                b_e <= be_in;
                a_m <= am_in;
                b_m <= bm_in;
                state <= 1;
                is_done <= 0;
            end
            1: begin
                if ($signed(a_e) > $signed(b_e)) begin
                  b_e <= b_e + 1;
                  b_m <= b_m >> 1;
                  b_m[0] <= b_m[0] | b_m[1];
                end else if ($signed(a_e) < $signed(b_e)) begin
                  a_e <= a_e + 1;
                  a_m <= a_m >> 1;
                  a_m[0] <= a_m[0] | a_m[1];
                end else begin
                  is_done <= 1;
                  state <= 0; // Reset to load next
                end
            end
        endcase
    end
  end

  assign ae_out = a_e;
  assign be_out = b_e;
  assign am_out = a_m;
  assign bm_out = b_m;
  assign done = is_done;

endmodule
