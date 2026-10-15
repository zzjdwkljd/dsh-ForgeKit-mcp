// architecture.test.mjs - the guardrails the repo was missing:
//   1. the committed contract must match what the server really registers
//   2. a tool with side effects must never claim readOnlyHint
//   3. the module manifest must reject bad ids and dispose idempotently
//
// Run: npm test   (or: node --test demo_code/architecture.test.mjs)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTools, normalizeTools } from './update-tool-contract.mjs';
import { disposeModules, registerModules } from '../dist/core/module.js';
import { builtinModules } from '../dist/modules/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const CONTRACT = path.join(PROJECT, 'test', 'contracts', 'tools.v1.json');

/**
 * Tools whose handler writes to disk, spawns/kills a process, or otherwise
 * mutates the host. Every name here must exist, and none of them may claim
 * readOnlyHint -- that is exactly the class of bug this file exists to catch.
 */
const SIDE_EFFECTING = new Map([
  ['screenshot_screen', 'writes a PNG into test/screenshot/screenshot_screen'],
  ['screenshot_region', 'writes a PNG into test/screenshot/screenshot_region'],
  ['screenshot_window', 'writes a PNG into test/screenshot/screenshot_window'],
  ['browser_screenshot', 'writes a PNG into test/screenshot/browser_screenshot'],
  ['browser_save_state', 'writes a login-state JSON file'],
  ['browser_launch', 'spawns a browser process and creates a profile directory'],
  ['browser_close', 'terminates the owned browser process and writes a session backup'],
]);

test('committed contract matches the registered tools exactly', async () => {
  const committed = JSON.parse(await fs.readFile(CONTRACT, 'utf8'));
  const actual = { tools: normalizeTools(await collectTools()) };
  assert.deepEqual(
    actual,
    committed,
    'test/contracts/tools.v1.json is stale; run: node demo_code/update-tool-contract.mjs',
  );
});

test('the contract covers all 29 built-in tools', async () => {
  const committed = JSON.parse(await fs.readFile(CONTRACT, 'utf8'));
  assert.equal(committed.tools.length, 29);
  const names = committed.tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'tool names must be unique');
  assert.deepEqual(names, [...names].sort(), 'contract must be sorted by name');
});

test('side-effecting tools must not declare readOnlyHint', async () => {
  const tools = await collectTools();
  const byName = new Map(tools.map((t) => [t.name, t]));

  // Guard against typos drifting the table away from reality.
  for (const [name, why] of SIDE_EFFECTING) {
    assert.ok(byName.has(name), `SIDE_EFFECTING lists unknown tool "${name}" (${why})`);
  }

  for (const [name, why] of SIDE_EFFECTING) {
    const tool = byName.get(name);
    assert.notEqual(
      tool.annotations?.readOnlyHint,
      true,
      `${name} ${why}, so it must not set readOnlyHint: true`,
    );
  }
});

test('read-only tools are exactly the ones with no side effects', async () => {
  const tools = await collectTools();
  const readOnly = tools
    .filter((t) => t.annotations?.readOnlyHint === true)
    .map((t) => t.name)
    .sort();
  const expected = [
    'browser_console',
    'browser_get_html',
    'browser_get_text',
    'browser_info',
    'browser_network',
    'browser_wait',
    'list_windows',
  ];
  assert.deepEqual(readOnly, expected);
});

test('module manifest rejects invalid and duplicate ids before registering', () => {
  const calls = [];
  const registrar = { registerTool: (name) => calls.push(name) };

  assert.throws(
    () => registerModules(registrar, [{ id: 'Bad_Id', description: '', register: () => {} }]),
    /Invalid module id/,
  );
  assert.equal(calls.length, 0, 'nothing may register when the manifest is invalid');

  assert.throws(
    () =>
      registerModules(registrar, [
        { id: 'dup', description: '', register: () => calls.push('a') },
        { id: 'dup', description: '', register: () => calls.push('b') },
      ]),
    /Duplicate module id/,
  );
  assert.equal(calls.length, 0, 'validation must complete before any module registers');
});

test('modules dispose in reverse order and one failure does not skip the rest', async () => {
  const order = [];
  const modules = [
    { id: 'first', description: '', register: () => {}, dispose: () => order.push('first') },
    { id: 'second', description: '', register: () => {}, dispose: () => order.push('second') },
    {
      id: 'third',
      description: '',
      register: () => {},
      dispose: () => {
        order.push('third');
        throw new Error('third failed');
      },
    },
  ];
  await assert.rejects(() => disposeModules(modules), /Failed to dispose tool modules/);
  assert.deepEqual(order, ['third', 'second', 'first']);
});

test('builtin manifest exposes screenshot, browser and shell modules', () => {
  assert.deepEqual(
    builtinModules.map((m) => m.id),
    ['screenshot', 'browser', 'shell'],
  );
});
