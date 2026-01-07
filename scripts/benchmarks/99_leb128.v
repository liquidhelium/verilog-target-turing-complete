// @top: pack_u32
// @category: leb128

module pack_u32 (
    input  wire [31:0] data_in,
    output wire [39:0] packed_val,
    output wire [2:0]  byte_len
);

    wire m1 = (data_in[31:7]  != 0); 
    wire m2 = (data_in[31:14] != 0); 
    wire m3 = (data_in[31:21] != 0); 
    wire m4 = (data_in[31:28] != 0); 

    assign packed_val[7:0]   = {m1,   data_in[6:0]};
    assign packed_val[15:8]  = {m2,   data_in[13:7]};
    assign packed_val[23:16] = {m3,   data_in[20:14]};
    assign packed_val[31:24] = {m4,   data_in[27:21]};
    assign packed_val[39:32] = {1'b0, 4'b0, data_in[31:28]};

    assign byte_len = 3'd1 + m1 + m2 + m3 + m4;

endmodule