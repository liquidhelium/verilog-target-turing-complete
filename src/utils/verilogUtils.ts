
export function parseModules(content: string): { name: string; body: string; customId?: bigint }[] {
  const modules: { name: string; body: string; customId?: bigint }[] = [];
  // Regex to match module declaration block. Matches "module name(...)...endmodule"
  // Handles newlines and nested blocks loosely (assumes endmodule is at top level matching module)
  // Non-greedy capture for body.
  const moduleRegex = /module\s+(\w+)\s*[\s\S]*?;([\s\S]*?)endmodule/g;
  let match;
  while ((match = moduleRegex.exec(content)) !== null) {
      const name = match[1];
      const body = match[2];
      const fullText = match[0];
      
      let customId: bigint | undefined;
      // Search for parameter CUSTOM_ID = 64'd... or numbers
      const paramMatch = fullText.match(/parameter\s+CUSTOM_ID\s*=\s*(?:64'd)?(\d+)/) || 
                         fullText.match(/parameter\s+CUSTOM_ID\s*=\s*([0-9]+)/);
      if (paramMatch) {
          customId = BigInt(paramMatch[1]);
      }
      
      modules.push({ name, body: fullText, customId });
  }
  return modules;
}
