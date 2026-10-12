import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { disposeModules, registerModules } from './core/module.js';
import type { ToolModule } from './core/module.js';
import { serverInfo } from './metadata.js';
import { builtinModules } from './modules/index.js';

export interface ServerOptions {
  /** Replace the manifest for embedding/tests; omit to load all built-in modules. */
  modules?: readonly ToolModule[];
}

export interface ServerRuntime {
  readonly server: McpServer;
  readonly moduleIds: readonly string[];
  /** Idempotent shutdown of the MCP transport and module-owned resources. */
  close(): Promise<void>;
}

/** Construct a server without starting a transport or installing process handlers. */
export function createServer(options: ServerOptions = {}): ServerRuntime {
  const modules = [...(options.modules ?? builtinModules)];
  const server = new McpServer(serverInfo);
  registerModules(server, modules);
  let closing: Promise<void> | undefined;

  return {
    server,
    moduleIds: Object.freeze(modules.map((module) => module.id)),
    close() {
      closing ??= Promise.resolve().then(async () => {
        const errors: unknown[] = [];
        try {
          await server.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          await disposeModules(modules);
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 0) throw new AggregateError(errors, 'Failed to close ForgeKit MCP');
      });
      return closing;
    },
  };
}
