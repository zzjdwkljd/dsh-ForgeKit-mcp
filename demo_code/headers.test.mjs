// headers.test.mjs - the pure-function policy behind browser_headers.
// Every rule README.md promises lives here, so it is testable without a browser.
// Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateHeaders,
  getHeader,
  hasHeader,
  parseUserAgent,
  deriveConsistency,
  buildEffective,
  toBareLanguageList,
  localeToLanguageList,
} from '../dist/headers.js';

test('rejects CRLF / control-character injection', () => {
  const r = validateHeaders({ 'X-Trace': 'ok\r\nX-Evil: 1' });
  assert.equal(Object.keys(r.accepted).length, 0);
  assert.equal(r.rejected[0].name, 'X-Trace');
  assert.match(r.rejected[0].reason, /控制字符/);
});

test('rejects framing headers that would break HTTP', () => {
  for (const name of ['Host', 'Content-Length', 'Connection', 'Transfer-Encoding', 'TE', 'Upgrade']) {
    const r = validateHeaders({ [name]: 'x' });
    assert.equal(r.rejected.length, 1, `${name} must be rejected`);
    assert.equal(Object.keys(r.accepted).length, 0);
  }
});

test('rejects protocol pseudo-headers and websocket handshake headers', () => {
  for (const name of [':authority', 'proxy-authorization', 'sec-websocket-key']) {
    const r = validateHeaders({ [name]: 'x' });
    assert.equal(r.rejected.length, 1, `${name} must be rejected`);
  }
});

test('rejects a hand-set Cookie header', () => {
  const r = validateHeaders({ Cookie: 'session=abc' });
  assert.equal(Object.keys(r.accepted).length, 0);
  assert.match(r.rejected[0].reason, /browser_load_state/);
});

test('rejects invalid header names and duplicate names case-insensitively', () => {
  assert.equal(validateHeaders({ 'bad name': 'x' }).rejected.length, 1);
  const dup = validateHeaders({ 'X-A': '1', 'x-a': '2' });
  assert.equal(Object.keys(dup.accepted).length, 1);
  assert.match(dup.rejected[0].reason, /重复/);
});

test('rejects over-long names and values', () => {
  assert.equal(validateHeaders({ ['X'.repeat(129)]: 'v' }).rejected.length, 1);
  assert.equal(validateHeaders({ 'X-Long': 'v'.repeat(4097) }).rejected.length, 1);
});

test('accepts a normal header and preserves its casing', () => {
  const r = validateHeaders({ 'X-Trace-Id': 'abc' });
  assert.equal(r.rejected.length, 0);
  // `accepted` is a null-prototype map, so compare entries rather than prototypes.
  assert.deepEqual(Object.entries(r.accepted), [['X-Trace-Id', 'abc']]);
});

test('referer and origin are accepted but flagged', () => {
  const r = validateHeaders({ Referer: 'https://a.example', Origin: 'https://a.example' });
  assert.equal(Object.keys(r.accepted).length, 2);
  assert.equal(r.notes.length, 2);
});

test('case-insensitive lookup helpers work', () => {
  const map = { 'User-Agent': 'UA' };
  assert.equal(getHeader(map, 'user-agent'), 'UA');
  assert.equal(hasHeader(map, 'USER-AGENT'), true);
  assert.equal(hasHeader(map, 'accept'), false);
});

test('parseUserAgent identifies Chromium browsers and platforms', () => {
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const p = parseUserAgent(chromeWin);
  assert.equal(p.browser, 'chrome');
  assert.equal(p.chromeMajor, '126');
  assert.equal(p.platform, 'Windows');
  assert.equal(p.navigatorPlatform, 'Win32');

  const edge = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0');
  assert.equal(edge.browser, 'edge');

  const mac = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  assert.equal(mac.platform, 'macOS');
  assert.equal(mac.navigatorPlatform, 'MacIntel');

  const android = parseUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36');
  assert.equal(android.platform, 'Android');
  assert.equal(android.mobile, true);
});

test('parseUserAgent returns null for non-Chromium agents', () => {
  assert.equal(parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/128.0'), null);
  assert.equal(parseUserAgent('curl/8.0'), null);
});

test('deriveConsistency adds nothing when no UA is overridden', () => {
  const { derived, metadata } = deriveConsistency({ 'X-Trace-Id': 'a' }, 'zh-CN');
  assert.deepEqual(derived, {});
  assert.equal(metadata, null);
});

test('deriveConsistency derives the sec-ch-ua family from a custom UA', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const { derived, metadata } = deriveConsistency({ 'User-Agent': ua }, 'zh-CN');
  assert.match(derived['sec-ch-ua'], /Chromium";v="126"/);
  assert.equal(derived['sec-ch-ua-mobile'], '?0');
  assert.equal(derived['sec-ch-ua-platform'], '"Windows"');
  assert.ok(metadata);
  assert.equal(metadata.platform, 'Windows');
});

test('explicit sec-ch-ua values always win over derived ones', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const { derived } = deriveConsistency({ 'User-Agent': ua, 'sec-ch-ua': '"Custom";v="1"' }, 'zh-CN');
  assert.equal(derived['sec-ch-ua'], undefined);
});

test('deriveConsistency warns when sec-ch-ua is set without a UA', () => {
  const { derived, notes } = deriveConsistency({ 'sec-ch-ua': '"X";v="1"' }, 'zh-CN');
  assert.deepEqual(derived, {});
  assert.ok(notes.some((n) => n.includes('user-agent')));
});

test('buildEffective merges custom over derived over native', () => {
  const entries = buildEffective({ 'X-A': 'custom' }, { 'X-A': 'derived', 'X-B': 'derived' });
  const byName = new Map(entries.map((e) => [e.name, e]));
  assert.equal(byName.get('X-A').value, 'custom');
  assert.equal(byName.get('X-A').source, 'custom');
  assert.equal(byName.get('X-B').source, 'derived');
});

test('toBareLanguageList strips q-weights', () => {
  assert.equal(toBareLanguageList('zh-CN,zh;q=0.9,en;q=0.8'), 'zh-CN,zh,en');
  assert.equal(toBareLanguageList('en-US'), 'en-US');
});

test('localeToLanguageList expands a locale like a real browser', () => {
  assert.equal(localeToLanguageList('zh-CN'), 'zh-CN,zh');
  assert.equal(localeToLanguageList('en'), 'en');
  assert.equal(localeToLanguageList(''), 'en-US');
});
