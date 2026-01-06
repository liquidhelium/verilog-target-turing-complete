// @top: test22_special
// @category: fpu_test
module test22_special(
    input clk,
    input [9:0] a_e,
    input [9:0] b_e,
    input [26:0] a_m,
    input [26:0] b_m,
    input a_s,
    input b_s,
    output [31:0] z_out,
    output [3:0] next_state_out
);

  reg [31:0] z;
  reg [3:0] next_state;

  parameter state_put_z = 4'd11,
            state_align = 4'd4,
            state_normal = 4'd0;

  always @(posedge clk) begin
      // Default
      next_state <= state_normal;
      z <= 0;

        //if a is NaN or b is NaN return NaN 
        if ((a_e == 128 && a_m != 0) || (b_e == 128 && b_m != 0)) begin
          z[31] <= 1;
          z[30:23] <= 255;
          z[22] <= 1;
          z[21:0] <= 0;
          next_state <= state_put_z;
        //if a is inf return inf
        end else if (a_e == 128) begin
          z[31] <= a_s;
          z[30:23] <= 255;
          z[22:0] <= 0;
          //if a is inf and signs don't match return nan
          if ((b_e == 128) && (a_s != b_s)) begin
              z[31] <= b_s;
              z[30:23] <= 255;
              z[22] <= 1;
              z[21:0] <= 0;
          end
          next_state <= state_put_z;
        //if b is inf return inf
        end else if (b_e == 128) begin
          z[31] <= b_s;
          z[30:23] <= 255;
          z[22:0] <= 0;
          next_state <= state_put_z;
        //if a is zero return b
        end else if ((($signed(a_e) == -127) && (a_m == 0)) && (($signed(b_e) == -127) && (b_m == 0))) begin
          z[31] <= a_s & b_s;
          z[30:23] <= b_e[7:0] + 127;
          z[22:0] <= b_m[26:3];
          next_state <= state_put_z;
        //if a is zero return b
        end else if (($signed(a_e) == -127) && (a_m == 0)) begin
          z[31] <= b_s;
          z[30:23] <= b_e[7:0] + 127;
          z[22:0] <= b_m[26:3];
          next_state <= state_put_z;
        //if b is zero return a
        end else if (($signed(b_e) == -127) && (b_m == 0)) begin
          z[31] <= a_s;
          z[30:23] <= a_e[7:0] + 127;
          z[22:0] <= a_m[26:3];
          next_state <= state_put_z;
        end else begin
          // Normal case -> Align
          next_state <= state_align;
        end
  end

  assign z_out = z;
  assign next_state_out = next_state;

endmodule
