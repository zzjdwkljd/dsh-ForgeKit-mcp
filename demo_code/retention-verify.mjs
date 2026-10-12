// retention-verify.mjs - isolated check for the 3-day screenshot sweep.
//
// The sandbox must live inside the project test/ tree: MCP_SCREENSHOT_DIR is
// validated by core/data-paths.ts, which rejects paths outside test/ by design.
// Layout mirrors production: <root>/<partition>/<generated-file>.png
//
// Run: node demo_code/retention-verify.mjs
// Exit 0 = all expectations met; the sandbox directory is removed afterwards.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const DIST = path.join(PROJECT, 'dist', 'screenshot', 'retention.js');
// Unique sandbox under the existing validation partition; never reuses audit data.
const ROOT = path.join(PROJECT, 'test', 'screenshot', 'validation', `retention-verify-${Date.now().toString(36)}`);

const DAY = 86_400_000;
const NOW = Date.now();

const stamp = (t) => {
  const d = new Date(t);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Minimal valid PNG: signature + IHDR carrying nonzero width/height.
function tinyPng(width = 2, height = 2) {
  const buf = Buffer.alloc(33);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function execFileAsync(file, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

async function put(rel, content, mtime = NOW) {
  const file = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  await fs.utimes(file, new Date(mtime), new Date(mtime));
  return file;
}

const old = NOW - 4 * DAY, older = NOW - 5 * DAY, oldest = NOW - 10 * DAY, fresh = NOW - 1 * DAY;

const fixtures = [
  // [relative path, content, mtime, expectedAfter ('kept' | 'gone')]
  [`screenshot_screen/screen-fresh-${stamp(fresh)}.png`, tinyPng(), fresh, 'kept'],
  [`screenshot_screen/screen-old-${stamp(old)}.png`, tinyPng(), old, 'gone'],
  [`screenshot_region/region-old-${stamp(older)}-2.png`, tinyPng(), older, 'gone'],
  [`browser_screenshot/page-old-${stamp(oldest)}.png`, tinyPng(), oldest, 'gone'],
  // Manual / unprovable ownership: all kept.
  ['screenshot_screen/meeting-notes.png', tinyPng(), oldest, 'kept'],
  ['screenshot_screen/screen-20260230-120000.png', tinyPng(), oldest, 'kept'],
  ['screenshot_screen/screen-20990101-000000.png', tinyPng(), NOW, 'kept'],
  ['screenshot_screen/screen-20200101-000000.png', Buffer.from('not a png at all'), oldest, 'kept'],
  [`screenshot_screen/old-shot-${stamp(oldest)}.jpg`, tinyPng(), oldest, 'kept'],
  // Expired stamp but fresh mtime (renamed copy) -> kept.
  [`screenshot_window/renamed-copy-${stamp(oldest)}.png`, tinyPng(), NOW, 'kept'],
  // Nested structure and non-partition dirs: never swept.
  [`validation/run-1/page-${stamp(oldest)}.png`, tinyPng(), oldest, 'kept'],
  [`screenshot_screen/baseline-x/page-${stamp(oldest)}.png`, tinyPng(), oldest, 'kept'],
  [`screenshot_screen/run-abc123/page-${stamp(oldest)}.png`, tinyPng(), oldest, 'kept'],
  [`screenshot_window/screen-old-${stamp(oldest)}.png`, tinyPng(), NOW, 'kept'],
];

// Files whose ownership is proven (name + PNG header) and whose age is evaluated:
// the fresh shot, the three expired shots, the renamed copy and the mtime-fresh one.
const EXPECTED_CONSIDERED = 6;
const EXPECTED_DELETED = 3;

const shim = (extraEnv = {}, nowMs) =>
  execFileAsync('node', ['-e', `
import(${JSON.stringify(`file:///${DIST.replace(/\\/g, '/')}`)}).then(async (m) => {
  console.log(JSON.stringify(await m.runScreenshotRetention(${nowMs ?? 'undefined'})));
});`], { env: { ...process.env, MCP_SCREENSHOT_DIR: ROOT, ...extraEnv } });

try {
  for (const [rel, content, mtime] of fixtures) await put(rel, content, mtime);

  const report = JSON.parse((await shim()).trim());
  assert.equal(report.days, 3, 'default retention must be 3 days');
  assert.equal(report.deleted, EXPECTED_DELETED, `deleted ${report.deleted}: ${JSON.stringify(report.deletedFiles)}`);
  assert.equal(report.considered, EXPECTED_CONSIDERED, `considered ${report.considered}`);
  assert.equal(report.failures.length, 0, `failures: ${JSON.stringify(report.failures)}`);

  for (const [rel, , , expected] of fixtures) {
    const exists = await fs.stat(path.join(ROOT, rel)).then(() => true).catch(() => false);
    assert.equal(exists, expected === 'kept', `${rel}: expected ${expected}, got ${exists ? 'kept' : 'gone'}`);
  }

  // Disabled mode must delete nothing, even with an expired file present.
  await put(`screenshot_screen/screen-old-${stamp(oldest)}.png`, tinyPng(), oldest);
  const disabled = JSON.parse((await shim({ MCP_SCREENSHOT_RETENTION_DAYS: '0' })).trim());
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.deleted, 0);
  assert.equal(await fs.stat(path.join(ROOT, 'screenshot_screen', `screen-old-${stamp(oldest)}.png`)).then(() => true), true);

  // A custom window is honoured: 30 days keeps what 3 days removed.
  const wide = JSON.parse((await shim({ MCP_SCREENSHOT_RETENTION_DAYS: '30' })).trim());
  assert.equal(wide.days, 30);
  assert.equal(wide.deleted, 0);

  // Exact boundary with an injected clock (no dependence on wall-clock drift):
  // age == retention is kept, age > retention by one second is deleted.
  // Clear the leftover from the disabled check so the count is unambiguous.
  await fs.rm(path.join(ROOT, 'screenshot_screen', `screen-old-${stamp(oldest)}.png`), { force: true });
  const CLOCK = NOW;
  const exactly = `screenshot_screen/screen-exact-${stamp(CLOCK - 3 * DAY)}.png`;
  const over = `screenshot_screen/screen-over-${stamp(CLOCK - 3 * DAY - 1000)}.png`;
  await put(exactly, tinyPng(), CLOCK - 3 * DAY);
  await put(over, tinyPng(), CLOCK - 3 * DAY - 1000);
  const boundary = JSON.parse((await shim({}, CLOCK)).trim());
  assert.equal(boundary.deleted, 1, `boundary deleted ${boundary.deleted}: ${JSON.stringify(boundary.deletedFiles)}`);
  assert.equal(await fs.stat(path.join(ROOT, exactly)).then(() => true), true, 'age == retention must be kept');
  assert.equal(await fs.stat(path.join(ROOT, over)).then(() => false).catch(() => true), true, 'age > retention must be deleted');

  console.log(`retention-verify: OK (deleted=${report.deleted}, considered=${report.considered}, fixtures=${fixtures.length})`);
} finally {
  await fs.rm(ROOT, { recursive: true, force: true });
}
