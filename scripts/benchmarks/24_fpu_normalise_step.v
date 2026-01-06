// @top: test24_normalise_step
// @category: fpu_test
module test24_normalise_step(
    input [9:0] z_e_in,
    input [26:0] z_m_in,
    input guard_in,
    input round_bit_in,
    output [9:0] z_e_out,
    output [26:0] z_m_out,
    output guard_out,
    output round_bit_out,
    output done
);

  reg [9:0] z_e;
  reg [26:0] z_m;
  reg guard;
  reg round_bit;
  reg is_done;

  always @(*) begin
        z_e = z_e_in;
        z_m = z_m_in;
        guard = guard_in;
        round_bit = round_bit_in;
        is_done = 0;

        if (z_m_in[23] == 0 && $signed(z_e_in) > -126) begin
          z_e = z_e_in - 1;
          z_m = z_m_in << 1;
          z_m[0] = guard_in;
          guard = round_bit_in;
          round_bit = 0;
        end else begin
          is_done = 1;
        end
  end

  assign z_e_out = z_e;
  assign z_m_out = z_m;
  assign guard_out = guard;
  assign round_bit_out = round_bit;
  assign done = is_done;

endmodule
