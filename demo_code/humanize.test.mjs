// humanize.test.mjs - validation and pacing helpers for the humanize feature.
// Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultHumanize, mergeHumanize, randInt, scrollSteps } from '../dist/browser/humanize.js';

test('defaults match the documented ranges', () => {
  const d = defaultHumanize({});
  assert.deepEqual(d, {
    enabled: true,
    typingDelayMinMs: 40,
    typingDelayMaxMs: 120,
    actionDelayMinMs: 150,
    actionDelayMaxMs: 600,
  });
});

test('environment overrides are honoured, and "false" disables', () => {
  const d = defaultHumanize({
    MCP_BROWSER_HUMANIZE: 'false',
    MCP_BROWSER_TYPING_MIN_MS: '80',
    MCP_BROWSER_TYPING_MAX_MS: '200',
  });
  assert.equal(d.enabled, false);
  assert.equal(d.typingDelayMinMs, 80);
  assert.equal(d.typingDelayMaxMs, 200);
});

test('mergeHumanize keeps base values for omitted fields', () => {
  const base = defaultHumanize({});
  const merged = mergeHumanize(base, { humanize: false });
  assert.equal(merged.enabled, false);
  assert.equal(merged.typingDelayMinMs, base.typingDelayMinMs);
  assert.equal(merged.actionDelayMaxMs, base.actionDelayMaxMs);
});

test('mergeHumanize rejects out-of-range and inverted ranges', () => {
  const base = defaultHumanize({});
  assert.throws(() => mergeHumanize(base, { typingDelayMinMs: -1 }), /between 0 and 5000/);
  assert.throws(() => mergeHumanize(base, { typingDelayMinMs: 99999 }), /between 0 and 5000/);
  assert.throws(() => mergeHumanize(base, { actionDelayMaxMs: 99999 }), /between 0 and 10000/);
  assert.throws(() => mergeHumanize(base, { typingDelayMinMs: 500, typingDelayMaxMs: 100 }), /must not exceed/);
  assert.throws(() => mergeHumanize(base, { typingDelayMinMs: 1.5 }), /integer/);
});

test('randInt stays within the inclusive range', () => {
  for (let i = 0; i < 200; i++) {
    const v = randInt(5, 9);
    assert.ok(v >= 5 && v <= 9, `out of range: ${v}`);
  }
  assert.equal(randInt(3, 3), 3);
});

test('scrollSteps sums to the requested total', () => {
  for (const total of [600, -600, 7, -13, 0]) {
    const steps = scrollSteps(0, total, 5);
    assert.equal(steps.reduce((sum, s) => sum + s.y, 0), total, `y sum for ${total}`);
    assert.equal(steps.length, 5);
  }
});

test('scrollSteps splits both axes and rejects a bad count', () => {
  const steps = scrollSteps(100, 0, 4);
  assert.equal(steps.reduce((sum, s) => sum + s.x, 0), 100);
  assert.throws(() => scrollSteps(0, 10, 0), /positive/);
  assert.throws(() => scrollSteps(0, 10, -1), /positive/);
});
