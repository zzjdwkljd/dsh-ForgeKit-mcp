// browser-guards.test.mjs - the two boundaries a hostile page/model could push
// on: which URLs may be navigated to, and which binary may be launched.
// Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeUrl, resolveExecutable } from '../dist/browser.js';
import { dataPath, ensureDataDir } from '../dist/core/data-paths.js';

test('normalizeUrl adds https when the scheme is omitted', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('  example.com/path  '), 'https://example.com/path');
});

test('normalizeUrl accepts http, https, about and file (2026-10-15 explicit capability)', () => {
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com');
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeUrl('about:blank'), 'about:blank');
  assert.equal(normalizeUrl('file:///C:/tmp/page.html'), 'file:///C:/tmp/page.html');
  assert.equal(normalizeUrl('file:///etc/hosts'), 'file:///etc/hosts');
});

test('normalizeUrl refuses data, blob, chrome and javascript URLs', () => {
  for (const url of [
    'data:text/html,<script>1</script>',
    'blob:https://example.com/x',
    'chrome://settings',
    'javascript:alert(1)',
    'ftp://example.com/x',
  ]) {
    assert.throws(() => normalizeUrl(url), /Refusing to navigate/, `expected ${url} to be refused`);
  }
});

test('resolveExecutable refuses a non-browser binary', () => {
  // process.execPath is a real file (node.exe / node), so only the allowlist
  // can be what rejects it.
  assert.throws(() => resolveExecutable(process.execPath), /Refusing to launch/);
});

test('resolveExecutable refuses a non-existent path', () => {
  assert.throws(() => resolveExecutable('C:\\definitely\\not\\here\\chrome.exe'), /does not exist/);
});

test('resolveExecutable accepts a browser-named file', async () => {
  const dir = await ensureDataDir(dataPath('validation', 'exe-probe'));
  const fake = path.join(dir, 'chrome.exe');
  try {
    await fs.writeFile(fake, '');
    assert.equal(resolveExecutable(fake), path.resolve(fake));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
