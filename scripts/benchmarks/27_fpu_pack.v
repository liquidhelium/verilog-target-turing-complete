// @top: test27_pack
// @category: fpu_test
module test27_pack(
    input [9:0] z_e_in,
    input [26:0] z_m_in,
    input z_s_in,
    output [31:0] z_out
);

  reg [31:0] z;

  always @(*) begin
        z[22:0] = z_m_in[22:0];
        z[30:23] = z_e_in[7:0] + 127;
        z[31] = z_s_in;
        
        if ($signed(z_e_in) == -126 && z_m_in[23] == 0) begin
          z[30:23] = 0;
        end
        
        if ($signed(z_e_in) == -126 && z_m_in[23:0] == 24'h0) begin
          z[31] = 1'b0; // FIX SIGN BUG: -a + a = +0.
        end
        
        //if overflow occurs, return inf
        if ($signed(z_e_in) > 127) begin
          z[22:0] = 0;
          z[30:23] = 255;
          z[31] = z_s_in;
        end
  end

  assign z_out = z;

endmodule
