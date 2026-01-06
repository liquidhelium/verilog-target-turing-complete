// @top: test26_round
// @category: fpu_test
module test26_round(
    input [9:0] z_e_in,
    input [26:0] z_m_in,
    input guard,
    input round_bit,
    input sticky,
    output [9:0] z_e_out,
    output [26:0] z_m_out
);

  reg [9:0] z_e;
  reg [26:0] z_m;

  always @(*) begin
        z_e = z_e_in;
        z_m = z_m_in;

        if (guard && (round_bit | sticky | z_m_in[0])) begin
          z_m = z_m_in + 1;
          if (z_m_in == 27'h0ffffff) begin // Using 27 bit constant for safety, original was 24'hffffff but z_m is larger
             // Original: if (z_m == 24'hffffff) -> This check seems to check if the mantissa is all ones in the 24 bits
             // But z_m is 27 bits.
             // If z_m overflows 24 bits magnitude?
             // Let's copy the logic exactly but careful about widths.
             // "if (z_m == 24'hffffff)" implies strictly 24 ones.
             // z_m is [26:0]. z_m[23] is the implicit bit usually.
             
             // If I look at 99_fpu.v:
             // if (z_m == 24'hffffff) begin z_e <= z_e + 1; end
             // This presumably handles the case where rounding up causes a carry into the exponent position?
             // 24'hffffff is 1111...1111 (24 ones).
             
             if (z_m_in[23:0] == 24'hffffff) begin
                z_e = z_e_in + 1;
             end
          end
        end
  end

  assign z_e_out = z_e;
  assign z_m_out = z_m;

endmodule
