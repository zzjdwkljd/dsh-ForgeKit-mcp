#!/usr/bin/env node
// CLI only. Tool registration lives in modules; other transports can reuse createServer.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { serverInfo } from './metadata.js';
import { createServer } from './server.js';

const runtime = createServer();
let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await runtime.close();
  } catch (error) {
    console.error('ForgeKit MCP shutdown failed:', error);
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.stdin.once('end', () => void shutdown());

try {
  await runtime.server.connect(new StdioServerTransport());
  // stdout is reserved exclusively for MCP JSON-RPC messages.
  console.error(`${serverInfo.title} v${serverInfo.version} ready (stdio)`);
} catch (error) {
  console.error('ForgeKit MCP startup failed:', error);
  await shutdown(1);
}
