import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Modules register tools; transports and process signals belong to the host. */
export type ToolRegistrar = Pick<McpServer, 'registerTool'>;

export interface ToolModule {
  readonly id: string;
  readonly description: string;
  /** Registration must be synchronous and must not acquire external resources. */
  register(server: ToolRegistrar): void;
  /** Release resources lazily acquired by this module's tool handlers. */
  dispose?(): void | Promise<void>;
}

export function registerModules(server: ToolRegistrar, modules: readonly ToolModule[]): void {
  const ids = new Set<string>();
  // Validate the entire manifest before any module is registered.
  for (const module of modules) {
    if (!/^[a-z][a-z0-9-]*$/.test(module.id)) {
      throw new Error(`Invalid module id: ${module.id}`);
    }
    if (ids.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    ids.add(module.id);
  }
  // The SDK additionally rejects duplicate tool names across all modules.
  for (const module of modules) module.register(server);
}

/** Reverse registration order, attempting every disposer even if one fails. */
export async function disposeModules(modules: readonly ToolModule[]): Promise<void> {
  const errors: unknown[] = [];
  for (const module of [...modules].reverse()) {
    try {
      await module.dispose?.();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Failed to dispose tool modules');
}
