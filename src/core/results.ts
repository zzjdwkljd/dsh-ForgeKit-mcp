import type { CallToolResult, ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js';

export function text(value: unknown): TextContent {
  if (typeof value === 'string') return { type: 'text', text: value };
  const json = JSON.stringify(value, null, 2);
  return { type: 'text', text: json ?? String(value) };
}

export function pngImage(base64: string): ImageContent {
  return { type: 'image', data: base64, mimeType: 'image/png' };
}

export function ok(content: Array<TextContent | ImageContent>): CallToolResult {
  return { content };
}

/** Keep exceptions inside the MCP tool-result contract, including sync handlers. */
export function tool<A>(
  handler: (args: A) => CallToolResult | Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [text(`Error: ${message}`)], isError: true };
    }
  };
}
