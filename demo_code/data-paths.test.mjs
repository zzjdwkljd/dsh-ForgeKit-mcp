// data-paths.test.mjs - the security foundation every write and delete rests on.
// Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { dataPath, resolveDataPath, checkedDataPath, writeDataFile, PROJECT_ROOT, DATA_ROOT } from '../dist/core/data-paths.js';

test('rejects parent-directory traversal', () => {
  assert.throws(() => resolveDataPath('test/../src'), /must remain inside/);
  assert.throws(() => resolveDataPath('../outside'), /must remain inside/);
  assert.throws(() => resolveDataPath('screenshot/../../etc'), /must remain inside/);
});

test('rejects absolute paths outside test/', () => {
  const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers' : '/etc/passwd';
  assert.throws(() => resolveDataPath(outside), /must remain inside/);
});

test('rejects UNC and extended-length Windows paths', () => {
  assert.throws(() => resolveDataPath('\\\\server\\share\\x.png'), /must remain inside/);
  assert.throws(() => resolveDataPath('\\\\?\\C:\\Windows\\x.png'), /must remain inside/);
});

test('rejects Windows reserved device names', () => {
  for (const name of ['con', 'prn', 'aux', 'nul', 'com1', 'lpt9', 'CON.txt', 'nul.png']) {
    assert.throws(() => dataPath(name), /Invalid data path component/, `expected ${name} to be rejected`);
  }
});

test('rejects control characters and NUL bytes', () => {
  assert.throws(() => resolveDataPath('a\u0000b'), /non-empty data path/);
  assert.throws(() => dataPath('bad\u001fname'), /Invalid data path component/);
});

test('rejects components with trailing dot or space', () => {
  assert.throws(() => dataPath('name.'), /Invalid data path component/);
  assert.throws(() => dataPath('name '), /Invalid data path component/);
});

test('accepts a normal nested path inside test/', () => {
  const target = resolveDataPath('screenshot/demo/x.png');
  assert.ok(target.startsWith(DATA_ROOT), 'resolved path must stay inside test/');
  assert.ok(target.endsWith('x.png'));
});

test('a scope outside test/ is refused', () => {
  assert.throws(() => resolveDataPath('x.png', PROJECT_ROOT), /Data scope must remain inside test/);
});

test('writeDataFile never leaves a temp file outside test/', async () => {
  // 'test' resolves to DATA_ROOT itself, whose parent is the project root: the
  // exclusive-rename path must fail closed and clean up after itself.
  await assert.rejects(() => writeDataFile('test', 'payload'));
  const leftovers = (await fs.readdir(PROJECT_ROOT)).filter((f) => f.startsWith('.forgekit-'));
  assert.deepEqual(leftovers, [], 'no .forgekit-*.tmp may survive in the project root');
});

test('writeDataFile round-trips inside a temp partition and cleans up', async () => {
  const run = `data-paths-${Date.now().toString(36)}`;
  const rel = `validation/${run}/probe.txt`;
  const target = await checkedDataPath(rel);
  try {
    await writeDataFile(rel, 'hello');
    assert.equal(await fs.readFile(target, 'utf8'), 'hello');
  } finally {
    await fs.rm(dataPath('validation', run), { recursive: true, force: true });
  }
});
