// shell-backend.test.mjs - bash resolution for the shell tool (single backend).
// Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bashCandidates, resolveShellExecutable, gitRootFromPath } from '../dist/modules/shell/index.js';

test('bashCandidates puts MCP_SHELL_BASH first when set, then Git layouts', () => {
  const list = bashCandidates('D:\\Git');
  if (process.env.MCP_SHELL_BASH) assert.equal(list[0], process.env.MCP_SHELL_BASH);
  else assert.equal(list[0], 'D:\\Git\\bin\\bash.exe');
  assert.ok(list.some((p) => p === 'D:\\Git\\bin\\bash.exe'));
  assert.ok(list.includes('C:\\Program Files\\Git\\bin\\bash.exe'));
  // dedup: the same path never appears twice
  assert.equal(new Set(list).size, list.length);
});

test('gitRootFromPath derives the install root from git on PATH (or null)', () => {
  const root = gitRootFromPath();
  if (root === null) return; // git not on PATH in this environment
  assert.ok(!/\\cmd$|\\bin$/i.test(root), `root should strip cmd/bin, got ${root}`);
});

test('resolveShellExecutable returns an existing bash on this machine or throws clearly', () => {
  try {
    const exe = resolveShellExecutable();
    assert.ok(/bash(\.exe)?$/i.test(exe), `expected a bash path, got ${exe}`);
  } catch (e) {
    assert.match(e.message, /Git Bash/);
  }
});
