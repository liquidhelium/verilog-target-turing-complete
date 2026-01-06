// @top: splitter_needed
// @category: bus
module splitter_needed(
    input wire [7:0] a,
    output wire [7:0] swapped,
    output wire single
);
    // Swapping halves: Should force Splitter + Maker because bit order is changed
    assign swapped = {a[3:0], a[7:4]};
    
    // Single bit access: Should force Splitter to remain to extract bit 2
    assign single = a[2];
endmodule
