// @top: test25_denormalise_step
// @category: fpu_test
module test25_denormalise_step(
    input [9:0] z_e_in,
    input [26:0] z_m_in,
    input guard_in,
    input round_bit_in,
    input sticky_in,
    output [9:0] z_e_out,
    output [26:0] z_m_out,
    output guard_out,
    output round_bit_out,
    output sticky_out,
    output done
);

  reg [9:0] z_e;
  reg [26:0] z_m;
  reg guard;
  reg round_bit;
  reg sticky;
  reg is_done;

  always @(*) begin
        z_e = z_e_in;
        z_m = z_m_in;
        guard = guard_in;
        round_bit = round_bit_in;
        sticky = sticky_in;
        is_done = 0;

        if ($signed(z_e_in) < -126) begin
          z_e = z_e_in + 1;
          z_m = z_m_in >> 1;
          guard = z_m_in[0];
          round_bit = guard_in;
          sticky = sticky_in | round_bit_in;
        end else begin
          is_done = 1;
        end
  end

  assign z_e_out = z_e;
  assign z_m_out = z_m;
  assign guard_out = guard;
  assign round_bit_out = round_bit;
  assign sticky_out = sticky;
  assign done = is_done;

endmodule
