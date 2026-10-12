import { execFile, spawn } from 'node:child_process';
import type { Browser, BrowserContext } from 'playwright-core';
import { chromium } from 'playwright-core';
import { checkedDataPath, ensureDataDir } from '../core/data-paths.js';

export interface AttachedBrowser {
  browser: Browser;
  context: BrowserContext;
  stopProcess(): Promise<void>;
}

/** Attach only to an endpoint emitted by the child this function actually spawned. */
export async function launchOwnedBrowser(options: {
  profile: string;
  executable: string;
  headless: boolean;
  stealth: boolean;
  artifacts: string;
  locale: string;
}): Promise<AttachedBrowser> {
  const profile = await ensureDataDir(options.profile);
  const artifacts = await ensureDataDir(options.artifacts);
  const child = spawn(options.executable, [
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    `--lang=${options.locale}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(options.stealth ? ['--disable-blink-features=AutomationControlled'] : []),
    ...(options.headless ? ['--headless=new'] : ['--start-maximized']),
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: options.headless,
    detached: process.platform !== 'win32',
    env: { ...process.env, TMP: artifacts, TEMP: artifacts, TMPDIR: artifacts },
  });

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let stopping: Promise<void> | undefined;
  const stopProcess = (): Promise<void> => stopping ??= (async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    // No process-name search, profile substring matching, or ownership guesswork.
    await new Promise<void>((resolve) => {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, () => resolve());
      } else {
        try { process.kill(-child.pid!, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already exited */ } }
        resolve();
      }
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Owned browser process did not exit after shutdown')), 5000); }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  })();

  let browser: Browser | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let stderr = '';
      const timeout = setTimeout(() => reject(new Error('Owned browser did not expose a DevTools endpoint within 15 seconds; the profile may be in use')), 15000);
      const fail = (error: Error): void => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', (code) => fail(new Error(`Owned browser exited before connection (code=${code}); no external browser was terminated`)));
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-65536);
        const match = /DevTools listening on (ws:\/\/[^\s]+)\s/.exec(stderr);
        if (!match?.[1]) return;
        const url = new URL(match[1]);
        if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/devtools/browser/')) {
          fail(new Error('Unexpected DevTools endpoint from owned browser'));
          return;
        }
        clearTimeout(timeout);
        resolve(url.href);
      });
    });
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned browser exited before CDP attachment');
    await checkedDataPath(profile);
    browser = await chromium.connectOverCDP(endpoint, { artifactsDir: artifacts, isLocal: true, timeout: 15000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Owned browser has no default context');
    return { browser, context, stopProcess };
  } catch (error) {
    await browser?.close().catch(() => {});
    await stopProcess();
    throw error;
  }
}
