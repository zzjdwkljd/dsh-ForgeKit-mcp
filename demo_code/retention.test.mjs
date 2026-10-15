// retention.test.mjs - expiry rules for tool-generated screenshots.
// Deleting the wrong file is the worst failure this project can have, so the
// ownership proof (name + PNG header + age) is pinned here.
// Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureTimeFromName, retentionConfig, describeRetention } from '../dist/screenshot/retention.js';

test('decodes a well-formed generated name', () => {
  const decoded = captureTimeFromName('screen-20260101-120000.png');
  assert.equal(decoded, new Date(2026, 0, 1, 12, 0, 0).getTime());
});

test('accepts the -N de-duplication suffix', () => {
  assert.notEqual(captureTimeFromName('region-20260101-120000-2.png'), null);
  assert.notEqual(captureTimeFromName('page-20260101-120000-17.png'), null);
});

test('rejects impossible calendar dates', () => {
  assert.equal(captureTimeFromName('screen-20260230-120000.png'), null, 'Feb 30 does not exist');
  assert.equal(captureTimeFromName('screen-20261301-120000.png'), null, 'month 13 does not exist');
  assert.equal(captureTimeFromName('screen-20260101-256101.png'), null, 'hour 25 / minute 61');
});

test('rejects stamps too far in the future', () => {
  const future = new Date(Date.now() + 365 * 86_400_000);
  const p = (v) => String(v).padStart(2, '0');
  const name = `screen-${future.getFullYear()}${p(future.getMonth() + 1)}${p(future.getDate())}-${p(future.getHours())}${p(future.getMinutes())}${p(future.getSeconds())}.png`;
  assert.equal(captureTimeFromName(name), null);
});

test('rejects names that were not written by the tool', () => {
  assert.equal(captureTimeFromName('meeting-notes.png'), null);
  assert.equal(captureTimeFromName('screen-20260101-120000.jpg'), null, 'wrong extension');
  assert.equal(captureTimeFromName('screen-2026-01-01.png'), null, 'dashed date');
  assert.equal(captureTimeFromName('my-image-20260101-120000.png.backup'), null);
});

test('retention config defaults to 3 days and honours overrides', () => {
  const def = retentionConfig({});
  assert.equal(def.days, 3);
  assert.equal(def.intervalMs, 6 * 3_600_000);
  assert.equal(retentionConfig({ MCP_SCREENSHOT_RETENTION_DAYS: '0' }).days, 0);
  assert.equal(retentionConfig({ MCP_SCREENSHOT_RETENTION_DAYS: '30' }).days, 30);
});

test('invalid retention values fall back to the default instead of crashing', () => {
  assert.equal(retentionConfig({ MCP_SCREENSHOT_RETENTION_DAYS: 'abc' }).days, 3);
  assert.equal(retentionConfig({ MCP_SCREENSHOT_RETENTION_DAYS: '-5' }).days, 3);
  assert.equal(retentionConfig({ MCP_SCREENSHOT_RETENTION_DAYS: '1.5' }).days, 3);
});

test('describeRetention reports the disabled and interval cases', () => {
  assert.match(describeRetention({ days: 0, intervalMs: 0 }), /disabled/);
  assert.match(describeRetention({ days: 3, intervalMs: 0 }), /startup only/);
  assert.match(describeRetention({ days: 3, intervalMs: 3_600_000 }), /every 1h/);
});
