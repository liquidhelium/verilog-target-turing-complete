// @top: demux2
// @category: basic
module demux2(input wire d, input wire sel, output wire y0, output wire y1);
  assign y0 = sel ? 1'b0 : d;
  assign y1 = sel ? d : 1'b0;
endmodule
