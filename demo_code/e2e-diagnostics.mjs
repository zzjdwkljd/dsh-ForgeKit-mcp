// e2e-diagnostics.mjs — in-process E2E of the four new capabilities
// (console/pageerror capture, network capture, file: navigation,
// conditional wait, deterministic clock). Local fixtures only, no external net.
import { launchBrowser, navigate, consoleLogs, networkRequests, waitForCondition, clockInstall, clockAdvance, clockStatus, clockUninstall, closeBrowser } from '../dist/browser.js';

const base = 'file:///D:/text/MCP/ForgeKit/test/forgekit-validation/e2e-fixtures';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await launchBrowser({ headless: true, persistent: false });

// -- console + network capture on the fixture page (console.log/warn/error, failed fetch)
await navigate(`${base}/clock.html`);
await sleep(1200);
const con = consoleLogs({});
console.log('[console] buffered:', con.totalBuffered);
for (const e of con.entries) console.log(`  [${e.level}]`, e.text.split('\n')[0].slice(0, 70));
const net = networkRequests({ failedOnly: true });
console.log('[network] failed entries:', net.totalBuffered);
for (const e of net.entries) console.log('  ', e.method, e.status, e.url.slice(0, 80));

// -- pageerror capture
await navigate(`${base}/local.html`);
await sleep(400);
const errs = consoleLogs({ levels: ['uncaughterror'] });
console.log('[pageerror] after pageerror.html visit:', errs.totalBuffered);

// -- conditional wait (element text already present)
const cond = await waitForCondition({ script: "document.getElementById('h') !== null", timeoutMs: 3000 });
console.log('[wait] condition satisfied:', cond.satisfied, 'polls:', cond.polls);
const neg = await waitForCondition({ script: 'window.__nope === true', timeoutMs: 600, pollMs: 200 });
console.log('[wait] unsatisfied returns:', neg.satisfied, 'elapsed>=600:', neg.elapsedMs >= 600);

// -- deterministic clock: install -> advance 1.1s -> 1s setTimeout has fired without real waiting
await navigate(`${base}/clock.html`);
await sleep(300);
await clockInstall('2026-10-15T00:00:00Z');
const st1 = await clockStatus();
console.log('[clock] installed, fake now:', st1.now, 'pending:', st1.pendingTimers);
const adv = await clockAdvance(1100);
console.log('[clock] advanced', adv.advancedMs, 'ms, timersFired:', adv.timersFired, 'now:', adv.now);
const fired = await waitForCondition({ script: "document.getElementById('h').textContent === 'fired'", timeoutMs: 2000 });
console.log('[clock] 1s timeout observed fired:', fired.satisfied);
const un = await clockUninstall();
console.log('[clock] uninstalled, realNow:', un.realNow);

await closeBrowser();
console.log('E2E ALL OK');
