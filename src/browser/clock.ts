// clock.ts - deterministic time control for pages: mock Date/setTimeout/
// setInterval/queueMicrotask timers, then advance them manually.
//
// Implementation notes:
// - The mock runs inside the page (init script + a page-world controller), so
//   it survives navigations within the session and works on any frame.
// - Timers are the well-known synthetic-async hazards, so advance() drains
//   timers in strict (time, insertion) order and reports how many fired.
// - uninstall() removes the override on the CURRENT document only; a reload or
//   navigation re-runs the init script and time starts at real Date again
//   unless install() is called once more. This is deliberate: never fake time
//   without an explicit tool call.

// window.__forgekitClock is injected at runtime by INSTALL_SCRIPT.
declare global {
  interface Window {
    __forgekitClock?: {
      setEpoch(iso: string): string;
      advance(ms: number): { advancedMs: number; timersFired: number; now: string };
      status(): { installed: boolean; now: string; realNow: string; pendingTimers: number };
      uninstall(): { installed: boolean };
    };
  }
}

export interface ClockInstallResult {
  installed: true;
  /** The fake epoch the clock starts at (ISO). */
  now: string;
  /** Monotonic counter for timer ordering. */
  note: string;
}

export interface ClockAdvanceResult {
  /** How much fake time moved forward, ms. */
  advancedMs: number;
  /** Timers that fired during the advance. */
  timersFired: number;
  /** Fake time after the advance (ISO). */
  now: string;
}

export interface ClockStatus {
  installed: boolean;
  now: string | null;
  realNow: string;
  pendingTimers: number | null;
}

const INSTALL_SCRIPT = /* js */ `
(() => {
  if (window.__forgekitClock) return;
  const realDate = Date;
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);

  const state = {
    offset: 0,
    realStart: Date.now(),
    seq: 0,
    timers: new Map(), // id -> { at, interval, fn, args }
    perfStart: performance.now(),
  };

  class MockDate extends realDate {
    constructor(...args) {
      if (args.length === 0) super(state.realStart + state.offset);
      else super(...args);
    }
    static now() { return state.realStart + state.offset; }
  }
  MockDate.parse = realDate.parse;
  MockDate.UTC = realDate.UTC;
  window.Date = MockDate;

  // performance.now() follows fake time so "elapsed" checks stay consistent.
  const realPerf = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => state.perfStart + state.offset,
  });

  function schedule(fn, delay, args, interval) {
    const id = ++state.seq;
    state.timers.set(id, { at: state.offset + Math.max(0, delay | 0), interval: interval ? Math.max(0, delay | 0) : null, fn, args });
    return id;
  }
  window.setTimeout = (fn, delay, ...args) => schedule(fn, delay ?? 0, args, false);
  window.setInterval = (fn, delay, ...args) => schedule(fn, delay ?? 0, args, true);
  window.clearTimeout = (id) => { state.timers.delete(id); };
  window.clearInterval = (id) => { state.timers.delete(id); };

  function fireDue() {
    // Drain strictly in (time, insertion) order; intervals reschedule themselves.
    let fired = 0;
    for (;;) {
      let nextId = null;
      let nextAt = Infinity;
      for (const [id, t] of state.timers) {
        if (t.at <= state.offset && t.at < nextAt) { nextAt = t.at; nextId = id; }
      }
      if (nextId === null) break;
      const t = state.timers.get(nextId);
      if (t.interval !== null) t.at = state.offset + t.interval;
      else state.timers.delete(nextId);
      fired++;
      try { t.fn(...t.args); } catch (e) { console.error('forgekitClock timer error', e); }
    }
    return fired;
  }

  window.__forgekitClock = {
    setEpoch(iso) {
      const ms = new realDate(iso).getTime();
      if (!Number.isFinite(ms)) throw new Error('invalid epoch: ' + iso);
      state.offset = ms - state.realStart;
      state.timers.clear();
      return new Date().toISOString();
    },
    advance(ms) {
      state.offset += ms;
      const fired = fireDue();
      return { advancedMs: ms, timersFired: fired, now: new Date().toISOString() };
    },
    status() {
      return {
        installed: true,
        now: new Date().toISOString(),
        realNow: new realDate().toISOString(),
        pendingTimers: state.timers.size,
      };
    },
    uninstall() {
      window.Date = realDate;
      window.setTimeout = realSetTimeout;
      window.clearInterval = realClearInterval;
      window.clearTimeout = realClearTimeout;
      window.setInterval = realSetInterval;
      Object.defineProperty(performance, 'now', { configurable: true, value: realPerf });
      delete window.__forgekitClock;
      return { installed: false };
    },
  };
})();
`;

const CONTROLLER = '__forgekitClock';

export interface ClockController {
  /** Current page used for the controller bridge. */
  pageUrl: string | null;
}

export type ClockInstaller = {
  install(context: import('playwright-core').BrowserContext, epochIso: string): Promise<ClockInstallResult>;
  advance(ms: number): Promise<ClockAdvanceResult>;
  status(): Promise<ClockStatus>;
  uninstall(): Promise<{ uninstalled: boolean; realNow: string }>;
};

/** Build a controller bound to the given ensurePage-style page accessor. */
export function createClockController(ensurePage: () => Promise<import('playwright-core').Page>): ClockInstaller {
  async function hasController(page: import('playwright-core').Page): Promise<boolean> {
    return page.evaluate(() => typeof window.__forgekitClock === 'object' && window.__forgekitClock !== null).catch(() => false);
  }
  return {
    async install(context, epochIso) {
      const page = await ensurePage();
      await context.addInitScript(INSTALL_SCRIPT);
      // Current document: main-world execution of the same script.
      await page.evaluate(INSTALL_SCRIPT);
      const now: string = await page.evaluate((iso) => window.__forgekitClock!.setEpoch(iso), epochIso);
      return { installed: true, now, note: 'Date/setTimeout/setInterval/performance.now are mocked; survives navigation via init script.' };
    },
    async advance(ms) {
      const page = await ensurePage();
      if (!(await hasController(page))) throw new Error('Clock is not installed on this page; call browser_clock install first.');
      return page.evaluate((delta) => window.__forgekitClock!.advance(delta), ms);
    },
    async status() {
      const page = await ensurePage();
      if (!(await hasController(page))) return { installed: false, now: null, realNow: new Date().toISOString(), pendingTimers: null };
      return page.evaluate(() => window.__forgekitClock!.status());
    },
    async uninstall() {
      const page = await ensurePage();
      if (!(await hasController(page))) return { uninstalled: false, realNow: new Date().toISOString() };
      await page.evaluate(() => window.__forgekitClock!.uninstall());
      // Keep the init script from re-installing on the next navigation.
      await page.context().addInitScript('window.__forgekitClockDisabled = true;');
      return { uninstalled: true, realNow: new Date().toISOString() };
    },
  };
}
