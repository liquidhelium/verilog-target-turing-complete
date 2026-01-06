// @top: test21b_align_step
// @category: fpu_test
module test21b_align_step(
    input [9:0] a_e_in,
    input [9:0] b_e_in,
    input [26:0] a_m_in,
    input [26:0] b_m_in,
    output [9:0] a_e_out,
    output [9:0] b_e_out,
    output [26:0] a_m_out,
    output [26:0] b_m_out,
    output done
);

  reg [9:0] a_e, b_e;
  reg [26:0] a_m, b_m;
  reg is_done;

  // Single Combinational Step of Align
  always @(*) begin
        // Default assignments
        a_e = a_e_in;
        b_e = b_e_in;
        a_m = a_m_in;
        b_m = b_m_in;
        is_done = 0;

        if ($signed(a_e_in) > $signed(b_e_in)) begin
            b_e = b_e_in + 1;
            b_m = b_m_in >> 1;
            b_m[0] = b_m_in[0] | b_m_in[1];
        end else if ($signed(a_e_in) < $signed(b_e_in)) begin
            a_e = a_e_in + 1;
            a_m = a_m_in >> 1;
            a_m[0] = a_m_in[0] | a_m_in[1];
        end else begin
            is_done = 1;
        end
  end

  assign a_e_out = a_e;
  assign b_e_out = b_e;
  assign a_m_out = a_m;
  assign b_m_out = b_m;
  assign done = is_done;

endmodule
