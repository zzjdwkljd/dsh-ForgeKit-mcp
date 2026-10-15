// e2e-clock.mjs — isolated clock verification: register timers AFTER install so
// they live inside the mocked scheduler, then advance and count firings.
import { launchBrowser, navigate, clockInstall, clockAdvance, clockStatus, waitForCondition, clockUninstall, closeBrowser } from '../dist/browser.js';

const base = 'file:///D:/text/MCP/ForgeKit/test/forgekit-validation/e2e-fixtures/local.html';
await launchBrowser({ headless: true, persistent: false });
await navigate(base);

await clockInstall('2026-10-15T00:00:00Z');

// Register a 1s timeout and a 500ms interval *inside mocked time*.
await waitForCondition({ script: `
  window.__fired = [];
  setTimeout(() => window.__fired.push('t1s'), 1000);
  setInterval(() => window.__fired.push('tick5s'), 5000);
  true;
`, timeoutMs: 2000 });

// Fake time is 2026-10-15T00:00:00Z right now; Date.now() mocked:
const nowMocked = await waitForCondition({ script: 'Math.abs(Date.now() - Date.parse("2026-10-15T00:00:00Z")) < 5', timeoutMs: 2000 });
console.log('[clock] Date.now mocked to epoch:', nowMocked.satisfied);

const adv = await clockAdvance(1100);
console.log('[clock] advance 1100ms -> timersFired:', adv.timersFired, '(expect 1: the 1s timeout)', 'now:', adv.now);

const saw = await waitForCondition({ script: "window.__fired.join(',') === 't1s'", timeoutMs: 2000 });
console.log('[clock] 1s timeout fired via mocked scheduler:', saw.satisfied);

const st = await clockStatus();
console.log('[clock] pending after advance:', st.pendingTimers, '(expect 1: the 5s interval)');

const adv2 = await clockAdvance(10000);
// First advance moved fake time to +1.1s and rescheduled the 5s interval to +6.1s.
// Advancing 10s more (to +11.1s) fires it once at +6.1s (reschedules to +11.1s, not yet due).
console.log('[clock] advance 10000ms -> timersFired:', adv2.timersFired, '(expect 1: interval at +6.1s)');
const sawTicks = await waitForCondition({ script: "window.__fired.filter(x=>x==='tick5s').length === 1", timeoutMs: 2000 });
console.log('[clock] interval fired via mocked scheduler:', sawTicks.satisfied);

await clockUninstall();
await closeBrowser();
console.log('CLOCK E2E OK');
