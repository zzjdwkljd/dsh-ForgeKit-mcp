// update-tool-contract.mjs - regenerate test/contracts/tools.v1.json from the
// tools the server actually registers, over a real MCP client<->server round
// trip. The contract must never be hand-edited: it is a derived artifact.
//
// Run: node demo_code/update-tool-contract.mjs   (requires a fresh `npm run build`)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const CONTRACT = path.join(PROJECT, 'test', 'contracts', 'tools.v1.json');

/** Fetch the tool declarations the way a real MCP client sees them. */
export async function collectTools() {
  const runtime = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'forgekit-contract', version: '1.0.0' });
  try {
    await Promise.all([
      client.connect(clientTransport),
      runtime.server.connect(serverTransport),
    ]);
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close().catch(() => {});
    await runtime.close().catch(() => {});
  }
}

/** Stable, reviewable shape: only serializable protocol fields, sorted by name. */
export function normalizeTools(tools) {
  return [...tools]
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      ...(tool.execution ? { execution: tool.execution } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function renderContract() {
  const tools = normalizeTools(await collectTools());
  return JSON.stringify({ tools }, null, 2) + '\n';
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('update-tool-contract.mjs')) {
  const rendered = await renderContract();
  await fs.mkdir(path.dirname(CONTRACT), { recursive: true });
  await fs.writeFile(CONTRACT, rendered);
  const count = JSON.parse(rendered).tools.length;
  console.log(`update-tool-contract: wrote ${count} tools to ${path.relative(PROJECT, CONTRACT)}`);
}
