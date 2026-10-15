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

/**
 * Flatten nested AggregateErrors so every sub-cause stays visible: an
 * AggregateError's own `message` hides the real reasons (e.g. which of the two
 * browser launch modes failed, and why).
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const parts = error.errors.map((inner) => describeError(inner));
    return `${error.message} [${parts.join(' | ')}]`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Keep exceptions inside the MCP tool-result contract, including sync handlers. */
export function tool<A>(
  handler: (args: A) => CallToolResult | Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      return { content: [text(`Error: ${describeError(error)}`)], isError: true };
    }
  };
}
