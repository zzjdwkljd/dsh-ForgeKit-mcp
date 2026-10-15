// retention-e2e.mjs - real stdio end-to-end check: a genuine screenshot call must
// (a) still save its own file and (b) sweep a stale generated file in the same
// partition, while leaving manual files alone.
//
// Run: node demo_code/retention-e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const ENTRY = path.join(PROJECT, 'dist', 'index.js');
const DAY = 86_400_000;
const ROOT = path.join(PROJECT, 'test', 'screenshot', 'validation', `retention-e2e-${Date.now().toString(36)}`);

const stamp = (t) => {
  const d = new Date(t);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function put(rel, content, mtime) {
  const file = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  await fs.utimes(file, new Date(mtime), new Date(mtime));
}

// Drive the real server over stdio and wait for a specific tool result.
function rpc(proc, messages, until) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('timed out waiting for MCP response')), 60_000);
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (until(msg)) {
          clearTimeout(timer);
          resolve(msg);
        }
      }
    });
    for (const m of messages) proc.stdin.write(`${JSON.stringify(m)}\n`);
  });
}

const stale = `screenshot_screen/stale-${stamp(Date.now() - 5 * DAY)}.png`;
const manual = 'screenshot_screen/keep-my-manual-image.png';
// 1x1 transparent PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

await put(stale, png, Date.now() - 5 * DAY);
await put(manual, png, Date.now() - 30 * DAY);

const proc = spawn(process.execPath, [ENTRY], {
  env: { ...process.env, MCP_SCREENSHOT_DIR: ROOT },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });

try {
  await rpc(proc, [{
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'retention-e2e', version: '1' } },
  }], (m) => m.id === 1);
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const result = await rpc(proc, [{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'screenshot_screen', arguments: { monitor: 'primary' } } }], (m) => m.id === 2);
  assert.ok(!result.error, `tools/call failed: ${JSON.stringify(result.error)}`);
  const text = (result.result.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  assert.match(text, /Saved: /, `unexpected tool text: ${text}`);
  const saved = text.split('\n').map((l) => l.match(/^Saved: (.+?) \|/)?.[1]).filter(Boolean);
  assert.ok(saved.length >= 1, `no saved path in: ${text}`);

  // Let the fire-and-forget sweep settle.
  await new Promise((r) => setTimeout(r, 2500));

  for (const file of saved) {
    assert.equal(await fs.stat(file).then(() => true).catch(() => false), true, `new screenshot must survive: ${file}`);
  }
  assert.equal(await fs.stat(path.join(ROOT, stale)).then(() => true).catch(() => false), false, 'stale generated file must be swept');
  assert.equal(await fs.stat(path.join(ROOT, manual)).then(() => true).catch(() => false), true, 'manual file must be kept');

  assert.match(stderr, /screenshot retention: deleted 1 expired screenshot/, `retention log missing; stderr:\n${stderr}`);
  console.log('retention-e2e: OK (capture saved, stale swept, manual kept, startup+post-capture sweep observed)');
} finally {
  proc.kill();
  await new Promise((r) => setTimeout(r, 300));
  await fs.rm(ROOT, { recursive: true, force: true });
}
