// @top: pack_u32
// @category: leb128

module leb128_encoder_u32_opt (
    input  wire [31:0] data_in,
    output wire [39:0] packed_val,
    output wire [2:0]  byte_len
);

    // 1. 判断每一层级是否需要继续编码 (MSB flag logic)
    // 只要当前位段之后还有非零数据，就需要设置 MSB 为 1
    wire m1 = (data_in[31:7]  != 0); // 第1字节需要继续
    wire m2 = (data_in[31:14] != 0); // 第2字节需要继续
    wire m3 = (data_in[31:21] != 0); // 第3字节需要继续
    wire m4 = (data_in[31:28] != 0); // 第4字节需要继续

    // 2. 并行构建字节流
    // 使用拼接运算符，逻辑层级仅为 1 层选择器或简单的门电路
    assign packed_val[7:0]   = {m1,   data_in[6:0]};
    assign packed_val[15:8]  = {m2,   data_in[13:7]};
    assign packed_val[23:16] = {m3,   data_in[20:14]};
    assign packed_val[31:24] = {m4,   data_in[27:21]};
    assign packed_val[39:32] = {1'b0, 4'b0, data_in[31:28]};

    // 3. 计算长度 (通过查找表或简单的加法逻辑)
    // 这里使用加法器逻辑，综合后通常会优化为极小的组合电路
    assign byte_len = 3'd1 + m1 + m2 + m3 + m4;

endmodule