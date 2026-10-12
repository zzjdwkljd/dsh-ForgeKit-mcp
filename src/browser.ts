// browser.ts - typed browser automation on playwright-core driving a locally
// installed Chrome/Edge (works on Windows, macOS and Linux; no browser download).
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core';
import { PROJECT_ROOT, dataPath, resolveDataPath, checkedDataPath, ensureDataDir, createDataRun, readDataFile, writeDataFile } from './core/data-paths.js';
import { defaultHumanize, mergeHumanize, randInt, scrollSteps } from './browser/humanize.js';
import type { HumanizeOptions, HumanizeUpdate } from './browser/humanize.js';
import { launchOwnedBrowser } from './browser/owned-process.js';
import { parseStorageState, restoreLocalStorage } from './browser/storage-state.js';
import { screenshotDirectory, persistScreenshot } from './screenshot/index.js';
import { requestRetentionSweep } from './screenshot/retention.js';
import { pngSize } from './screenshot/png.js';
import type { ShotResult } from './types.js';
export type { HumanizeOptions, HumanizeUpdate } from './browser/humanize.js';
import {
  buildEffective,
  deriveConsistency,
  getHeader,
  localeToLanguageList,
  parseUserAgent,
  toBareLanguageList,
  validateHeaders,
} from './headers.js';
import type {
  HeaderEntry,
  HeaderMap,
  RejectedHeader,
  UserAgentMetadata,
} from './headers.js';

// ---------- public types ----------

export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
export type MouseButton = 'left' | 'right' | 'middle';
export type SelectorState = 'attached' | 'detached' | 'visible' | 'hidden';
export type TabAction = 'list' | 'new' | 'close';
export type HistoryAction = 'back' | 'forward' | 'reload';



export interface LaunchOptions extends HumanizeUpdate {
  headless?: boolean | undefined;
  executablePath?: string | undefined;
  /** Use a persistent user profile so login state survives restarts (default true). */
  persistent?: boolean | undefined;
  /** Profile directory inside <project>/test/login-state; shared by browser tools. */
  userDataDir?: string | undefined;
  /** Hide common automation signals such as navigator.webdriver (default true). */
  stealth?: boolean | undefined;
  /** Custom User-Agent; also drives sec-ch-ua / navigator.userAgentData consistency. */
  userAgent?: string | undefined;
  /** Custom request headers applied on top of the browser's own defaults. */
  headers?: HeaderMap | undefined;
}

/** The effective request-header policy, with provenance for readability. */
export interface HeaderPolicy {
  /** User custom headers (validated). */
  custom: HeaderMap;
  /** Consistency headers derived from the custom User-Agent. */
  derived: HeaderMap;
  /** Every effective header with its source: custom > derived > browser-default. */
  effective: HeaderEntry[];
  /** Soft guidance from the validator. */
  notes: string[];
}

export interface HeaderPolicyResult extends HeaderPolicy {
  /** Headers the validator refused (never silently dropped). */
  rejected: RejectedHeader[];
}

export interface BrowserInfo {
  running: boolean;
  headless: boolean | null;
  persistent: boolean | null;
  stealth: boolean | null;
  userDataDir: string | null;
  executable: string | null;
  url: string | null;
  title: string | null;
  viewport: { width: number; height: number } | null;
  humanize: HumanizeOptions;
  userAgent: string | null;
  customHeaders: HeaderMap;
}

export interface StateFile {
  path: string;
  cookies: number;
  origins: number;
}

export interface StateLoadResult extends StateFile {
  applied: string[];
}

export interface NavigateResult {
  url: string;
  title: string;
  status: number | null;
  finalUrl: string;
}

export interface ClickOptions {
  button?: MouseButton | undefined;
  clickCount?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface ClickResult {
  clicked: string;
  url: string;
}

export interface TypeOptions {
  clear?: boolean | undefined;
  submit?: boolean | undefined;
  delay?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface TypeResult {
  typed: number;
  submitted: boolean;
  url: string;
}

export interface PressResult {
  pressed: string;
  url: string;
}

export interface SelectOptions {
  value?: string | undefined;
  label?: string | undefined;
  index?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface SelectResult {
  selected: Array<{ value: string; text: string }>;
}

export interface ScrollOptions {
  selector?: string | undefined;
  deltaX?: number | undefined;
  deltaY?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface ScrollResult {
  scrolled: { deltaX: number; deltaY: number; selector: string };
  url: string;
}

export interface WaitOptions {
  selector?: string | undefined;
  state?: SelectorState | undefined;
  timeoutMs?: number | undefined;
  sleepMs?: number | undefined;
}

export interface WaitResult {
  waited: 'selector' | 'time';
  selector?: string;
  state?: SelectorState;
  ms?: number;
}

export interface EvaluateResult {
  result: string;
}

export interface TextOutput {
  text: string;
  truncated: boolean;
  totalLength: number;
  source: string;
}

export interface HistoryResult {
  url: string;
  title: string;
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
  closed: boolean;
}

export type TabsResult =
  | { tabs: TabInfo[]; activeIndex: number }
  | { opened: true; url: string; tabCount: number }
  | { closed: boolean; reason?: string; tabCount?: number };

// ---------- internal state ----------

interface BrowserState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  headless: boolean | null;
  executable: string | null;
}

const EXECUTABLE_CANDIDATES: readonly (string | undefined)[] = [
  process.env.MCP_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const DEFAULT_TIMEOUT_MS = clampInt(process.env.MCP_BROWSER_TIMEOUT_MS, 30000, 1000, 300000);
const MAX_TEXT_CHARS = 50000;
const LOGIN_ROOT = dataPath('login-state');
const DEFAULT_USER_DATA_DIR = dataPath('login-state', 'browser-profile');
const DEFAULT_STATE_FILE = dataPath('login-state', 'browser_save_state', 'state.json');
const LEGACY_STATE_FILE = dataPath('login-state', 'state.json');
const EXPORT_ROOT = path.dirname(DEFAULT_STATE_FILE);
const SESSION_COOKIE_BACKUP = 'mcp-session-state.json';

const state: BrowserState & {
  persistent: boolean | null;
  userDataDir: string | null;
  stealth: boolean | null;
  humanize: HumanizeOptions | null;
  customHeaders: HeaderMap;
  userAgent: string | null;
  nativeUserAgent: string | null;
} = {
  browser: null,
  context: null,
  page: null,
  headless: null,
  executable: null,
  persistent: null,
  userDataDir: null,
  stealth: null,
  humanize: null,
  customHeaders: {},
  userAgent: null,
  nativeUserAgent: null,
};

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveExecutable(custom: string | undefined): string {
  if (custom !== undefined) {
    const candidate = path.resolve(PROJECT_ROOT, custom);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error('The requested browser executable does not exist');
    return candidate;
  }
  for (const candidate of EXECUTABLE_CANDIDATES) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error('No Chrome/Edge executable found. Install a Chromium-based browser or set MCP_BROWSER_EXECUTABLE / executablePath.');
}

function normalizeHeadless(v: boolean | undefined): boolean {
  if (v === undefined || v === null) {
    return String(process.env.MCP_BROWSER_HEADLESS ?? 'true').toLowerCase() !== 'false';
  }
  return v;
}

function normalizePersistent(v: boolean | undefined): boolean {
  if (v === undefined || v === null) {
    return String(process.env.MCP_BROWSER_PERSISTENT ?? 'true').toLowerCase() !== 'false';
  }
  return v;
}

function normalizeStealth(v: boolean | undefined): boolean {
  if (v === undefined || v === null) {
    return String(process.env.MCP_BROWSER_STEALTH ?? 'true').toLowerCase() !== 'false';
  }
  return v;
}

async function defaultUserDataDir(): Promise<string> {
  return checkedDataPath(process.env.MCP_BROWSER_USER_DATA_DIR ?? DEFAULT_USER_DATA_DIR, LOGIN_ROOT);
}

// ---------- humanize config ----------

export function currentHumanize(): HumanizeOptions {
  return { ...(state.humanize ?? defaultHumanize()) };
}

export function updateHumanize(update: HumanizeUpdate): HumanizeOptions {
  const candidate = mergeHumanize(currentHumanize(), update);
  state.humanize = candidate;
  return { ...candidate };
}

// Serialize lifecycle/configuration mutations without holding a lock around page actions.
let lifecycleTail: Promise<void> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycleTail.then(operation);
  lifecycleTail = result.then(() => undefined, () => undefined);
  return result;
}

// ---------- request-header policy ----------
// Three layers: browser-native defaults (fallback) < derived consistency
// headers < user custom headers. The native layer is never fabricated --
// where the user overrides nothing, Chrome's own headers stay untouched.

/** Current custom headers + the derived consistency layer. */
export function headerPolicy(): HeaderPolicy {
  const custom = { ...state.customHeaders };
  const { derived, notes } = deriveConsistency(custom, currentLocale());
  return {
    custom,
    derived,
    effective: buildEffective(custom, derived),
    notes,
  };
}

/** Read-only view including validator feedback. */
export function headerPolicyResult(rejected: RejectedHeader[] = []): HeaderPolicyResult {
  const base = headerPolicy();
  return {
    ...base,
    notes: [...base.notes, ...lastUaSyncErrors.map((e) => `UA 指纹同步失败: ${e}`)],
    rejected,
  };
}

function currentLocale(): string {
  return process.env.MCP_BROWSER_LOCALE || 'zh-CN';
}

function validatedHeaders(input: HeaderMap, userAgent?: string): HeaderMap {
  const merged = { ...input };
  if (userAgent !== undefined) {
    for (const key of Object.keys(merged)) if (key.trim().toLowerCase() === 'user-agent') delete merged[key];
    merged['User-Agent'] = userAgent;
  }
  const { accepted, rejected } = validateHeaders(merged);
  if (rejected.length) throw new Error('请求头校验失败，本次未应用任何修改：\n' + rejected.map((item) => `  - ${item.name}: ${item.reason}`).join('\n'));
  return { ...accepted };
}

async function replaceHeaders(next: HeaderMap): Promise<HeaderPolicyResult> {
  const previous = state.customHeaders;
  state.customHeaders = { ...next };
  state.userAgent = getHeader(next, 'user-agent') ?? null;
  try {
    await applyHeaderPolicy();
  } catch (error) {
    state.customHeaders = previous;
    state.userAgent = getHeader(previous, 'user-agent') ?? null;
    try { await applyHeaderPolicy(); }
    catch (rollback) { throw new AggregateError([error, rollback], 'Header update and rollback failed; inspect the browser before continuing'); }
    throw error;
  }
  return headerPolicyResult();
}

export function setHeaders(input: HeaderMap, opts: { userAgent?: string | undefined } = {}): Promise<HeaderPolicyResult> {
  return serialized(() => replaceHeaders(validatedHeaders(input, opts.userAgent)));
}

export function clearHeaders(): Promise<HeaderPolicyResult> {
  return serialized(() => replaceHeaders({}));
}

/** Single request-header layer map handed to Playwright (custom + derived). */
function mergedHeaderLayer(): HeaderMap {
  const { derived } = deriveConsistency(state.customHeaders, currentLocale());
  return { ...derived, ...state.customHeaders };
}

/** Diagnostics for the last UA-surface sync; surfaced in headerPolicy(). */
let lastUaSyncErrors: string[] = [];

/**
 * Apply explicit header overrides. Do not touch native UA/Client Hints by default.
 * Remote protocol failures are reported; rollback is attempted by replaceHeaders.
 */
async function applyHeaderPolicy(): Promise<void> {
  const context = state.context;
  if (!context) { lastUaSyncErrors = []; return; }

  await context.setExtraHTTPHeaders(mergedHeaderLayer());
  lastUaSyncErrors = await syncUserAgentSurface(context);
  if (lastUaSyncErrors.length) throw new Error('Header application failed: ' + lastUaSyncErrors.join('; '));
}

/**
 * Apply the requested UA override to live pages. Derived metadata is best-effort,
 * not proof of a complete or undetectable browser identity.
 */
async function syncUserAgentSurface(context: BrowserContext): Promise<string[]> {
  const customUa = getHeader(state.customHeaders, 'user-agent');
  const { metadata } = deriveConsistency(state.customHeaders, currentLocale());
  const errors: string[] = [];
  const pages = context.pages().filter((p) => !p.isClosed());
  for (const page of pages) {
    await applyUserAgentOverride(page, customUa, metadata).catch((e: unknown) => {
      errors.push(e instanceof Error ? e.message : String(e));
    });
  }
  return errors;
}

/** Live CDP sessions kept per page: Emulation overrides are session-scoped,
 *  so detaching the session would silently roll the UA override back. */
const cdpSessions = new WeakMap<Page, CDPSession>();
const overriddenPages = new WeakSet<Page>();
const pageSetup = new WeakMap<Page, Promise<void>>();

async function cdpSessionFor(page: Page): Promise<CDPSession> {
  const existing = cdpSessions.get(page);
  if (existing) return existing;
  const session = await page.context().newCDPSession(page);
  cdpSessions.set(page, session);
  return session;
}

async function applyUserAgentOverride(page: Page, ua: string | undefined, metadata: UserAgentMetadata | null): Promise<void> {
  const customLanguage = getHeader(state.customHeaders, 'accept-language');
  if (!ua && !customLanguage && !overriddenPages.has(page)) return;
  const session = await cdpSessionFor(page);
  await session.send('Emulation.setUserAgentOverride', {
    // Empty UA really clears the override; copying the native UA without metadata erases native Client Hints.
    userAgent: ua ?? '',
    ...(customLanguage || ua ? { acceptLanguage: customLanguage ? toBareLanguageList(customLanguage) : localeToLanguageList(currentLocale()) } : {}),
    ...(ua ? { platform: parseUserAgent(ua)?.navigatorPlatform, userAgentMetadata: metadata ?? undefined } : {}),
  });
  if (ua || customLanguage) overriddenPages.add(page);
  else overriddenPages.delete(page);
}

function preparePage(page: Page): Promise<void> {
  applyTimeouts(page);
  const { metadata } = deriveConsistency(state.customHeaders, currentLocale());
  const prepared = applyUserAgentOverride(page, getHeader(state.customHeaders, 'user-agent'), metadata);
  pageSetup.set(page, prepared);
  return prepared;
}

// ---------- owned browser startup ----------

type LaunchMode = 'direct' | 'cdp';
let stopOwnedProcess: (() => Promise<void>) | null = null;
let ephemeralProfile: string | null = null;

function launchModeMarkerPath(dir: string): string {
  const host = os.hostname().replace(/[^\w-]/g, '_') || 'unknown';
  return path.join(dir, `.mcp-launch-mode.${host}`);
}

async function preferredLaunchMode(dir: string): Promise<{ mode: LaunchMode; fallback: boolean }> {
  const configured = String(process.env.MCP_BROWSER_LAUNCH_MODE ?? 'auto').toLowerCase();
  if (configured === 'direct' || configured === 'cdp') return { mode: configured, fallback: false };
  if (configured !== 'auto' && configured !== '') throw new Error('MCP_BROWSER_LAUNCH_MODE must be auto, direct or cdp');
  try {
    const saved = (await readDataFile(launchModeMarkerPath(dir))).trim();
    return { mode: saved === 'cdp' ? 'cdp' : 'direct', fallback: true };
  } catch { return { mode: 'direct', fallback: true }; }
}

async function rememberLaunchMode(dir: string, mode: LaunchMode): Promise<void> {
  try { await writeDataFile(launchModeMarkerPath(dir), mode); }
  catch { console.error('[browser] Could not save the launch-mode preference inside test/'); }
}

/** Random "thinking" pause before an action. */
async function humanPause(page: Page): Promise<void> {
  const cfg = currentHumanize();
  if (!cfg.enabled) return;
  await page.waitForTimeout(randInt(cfg.actionDelayMinMs, cfg.actionDelayMaxMs));
}

/** Type with per-keystroke random delays (or an explicit fixed delay). */
async function humanType(page: Page, value: string, fixedDelay?: number | undefined): Promise<void> {
  const cfg = currentHumanize();
  if (fixedDelay !== undefined) {
    await page.keyboard.type(value, { delay: fixedDelay });
    return;
  }
  if (!cfg.enabled) {
    await page.keyboard.type(value);
    return;
  }
  for (const ch of value) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(randInt(cfg.typingDelayMinMs, cfg.typingDelayMaxMs));
  }
}

/**
 * Click with humanization: a small random pause and a jittered click position
 * inside the element (instead of always the exact center).
 */
async function humanClick(
  loc: ReturnType<Page['locator']>,
  opts: { button?: MouseButton | undefined; clickCount?: number | undefined },
  timeout: number,
): Promise<void> {
  const cfg = currentHumanize();
  let position: { x: number; y: number } | undefined;
  if (cfg.enabled) {
    await humanPause(loc.page());
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width > 1 && box.height > 1) {
      const padX = box.width * 0.25;
      const padY = box.height * 0.25;
      position = {
        x: padX + Math.random() * (box.width - 2 * padX),
        y: padY + Math.random() * (box.height - 2 * padY),
      };
    }
  }
  await loc.click({
    button: opts.button ?? 'left',
    clickCount: opts.clickCount ?? 1,
    position,
    timeout,
  });
}

function applyTimeouts(page: Page): void {
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
}

function normalizeUrl(url: string): string {
  const s = String(url).trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s; // already has a scheme
  return `https://${s}`;
}

function truncate(text: string, label: string): TextOutput {
  if (text.length > MAX_TEXT_CHARS) {
    return { text: text.slice(0, MAX_TEXT_CHARS), truncated: true, totalLength: text.length, source: label };
  }
  return { text, truncated: false, totalLength: text.length, source: label };
}

// stealth retains the existing launch-level compatibility flags only.
// Do not fabricate PermissionStatus, PluginArray, window.chrome, GPU values or navigator own properties.

// ---------- lifecycle ----------

function resetState(): void {
  state.browser = null;
  state.context = null;
  state.page = null;
  state.headless = null;
  state.executable = null;
  state.persistent = null;
  state.userDataDir = null;
  state.stealth = null;
  state.nativeUserAgent = null;
  // customHeaders / userAgent / humanize survive restarts like session config.
}

export function isRunning(): boolean {
  if (!state.context) return false;
  return state.browser ? state.browser.isConnected() : true;
}

function samePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const left = path.resolve(a); const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function launchBrowser(opts: LaunchOptions = {}): Promise<BrowserInfo> {
  return serialized(() => launchBrowserUnlocked(opts));
}

async function launchBrowserUnlocked(opts: LaunchOptions): Promise<BrowserInfo> {
  const running = isRunning();
  const headless = opts.headless ?? (running ? state.headless : null) ?? normalizeHeadless(undefined);
  const persistent = opts.persistent ?? (running ? state.persistent : null) ?? normalizePersistent(undefined);
  const stealth = opts.stealth ?? (running ? state.stealth : null) ?? normalizeStealth(undefined);
  const executable = resolveExecutable(opts.executablePath ?? (running ? state.executable ?? undefined : undefined));
  const userDataDir = persistent
    ? await checkedDataPath(opts.userDataDir ?? (running ? state.userDataDir : null) ?? await defaultUserDataDir(), LOGIN_ROOT)
    : null;
  if (!persistent && opts.userDataDir !== undefined) throw new Error('userDataDir only applies when persistent=true');
  const humanize = mergeHumanize(currentHumanize(), opts);
  const headers = opts.headers !== undefined || opts.userAgent !== undefined ? validatedHeaders(opts.headers ?? {}, opts.userAgent) : null;
  const locale = Intl.getCanonicalLocales(currentLocale())[0] ?? 'zh-CN';
  const modeDir = userDataDir ?? dataPath('browser', 'browser_launch');
  const preferred = await preferredLaunchMode(modeDir);

  if (running && headless === state.headless && persistent === state.persistent && stealth === state.stealth && samePath(executable, state.executable) && samePath(userDataDir, state.userDataDir)) {
    if (headers) await replaceHeaders(headers);
    state.humanize = humanize;
    return browserInfo();
  }
  if (state.context || state.browser || stopOwnedProcess || ephemeralProfile) await closeBrowserUnlocked();
  state.humanize = humanize;
  if (headers) await replaceHeaders(headers);

  const run = await createDataRun('browser', 'browser_launch');
  const artifacts = await ensureDataDir(path.join(run, 'artifacts'));
  const profile = await ensureDataDir(userDataDir ?? path.join(run, 'ephemeral-profile'));
  if (!persistent) ephemeralProfile = profile;
  const args = [...(stealth ? ['--disable-blink-features=AutomationControlled'] : []), ...(!headless ? ['--start-maximized'] : [])];
  const startDirect = async (): Promise<{ browser: Browser | null; context: BrowserContext }> => {
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: executable, headless, viewport: headless ? { width: 1440, height: 900 } : null,
      acceptDownloads: true, locale, artifactsDir: artifacts, chromiumSandbox: true, args,
      env: { ...process.env, TMP: artifacts, TEMP: artifacts, TMPDIR: artifacts },
      ...(stealth ? { ignoreDefaultArgs: ['--enable-automation'] } : {}),
    });
    return { browser: context.browser(), context };
  };
  const startCdp = async (): Promise<{ browser: Browser | null; context: BrowserContext }> => {
    const attached = await launchOwnedBrowser({ profile, executable, headless, stealth, artifacts, locale });
    stopOwnedProcess = attached.stopProcess;
    return attached;
  };

  let context: BrowserContext | undefined;
  let browser: Browser | null = null;
  try {
    const primary = preferred.mode === 'direct' ? startDirect : startCdp;
    const secondary = preferred.mode === 'direct' ? startCdp : startDirect;
    try { ({ browser, context } = await primary()); }
    catch (primaryError) {
      if (!preferred.fallback) throw primaryError;
      try {
        ({ browser, context } = await secondary());
        await rememberLaunchMode(modeDir, preferred.mode === 'direct' ? 'cdp' : 'direct');
      } catch (secondaryError) {
        throw new AggregateError([primaryError, secondaryError], 'Both owned browser launch modes failed; external browsers were not terminated');
      }
    }
    const first = context.pages().find((page) => !page.isClosed()) ?? await context.newPage();
    state.browser = browser; state.context = context; state.page = first;
    state.headless = headless; state.executable = executable; state.persistent = persistent;
    state.userDataDir = userDataDir; state.stealth = stealth;
    state.nativeUserAgent = await first.evaluate(() => navigator.userAgent);
    if (userDataDir) {
      try {
        const backup = parseStorageState(await readDataFile(path.join(userDataDir, SESSION_COOKIE_BACKUP), LOGIN_ROOT));
        const sessionCookies = backup.cookies.filter((cookie) => cookie.expires === -1);
        if (sessionCookies.length) await context.addCookies(sessionCookies);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[browser] Session-cookie backup was not restored: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
    const activeContext = context;
    browser?.on('disconnected', () => { if (state.browser === browser) resetState(); });
    context.on('close', () => { if (state.context === activeContext) resetState(); });
    context.on('page', (page) => {
      if (state.context !== activeContext) return;
      void preparePage(page).catch((error: unknown) => { lastUaSyncErrors.push(error instanceof Error ? error.message : String(error)); });
    });
    await applyHeaderPolicy();
    await preparePage(first);
    return browserInfo();
  } catch (error) {
    // Every partial startup path closes only the resources allocated by this attempt.
    resetState();
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    const cleanup = stopOwnedProcess; stopOwnedProcess = null;
    await cleanup?.();
    if (ephemeralProfile) {
      const temporary = ephemeralProfile; ephemeralProfile = null;
      await fsPromises.rm(await checkedDataPath(temporary), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
    throw error;
  }
}

export function closeBrowser(): Promise<{ closed: boolean }> {
  return serialized(closeBrowserUnlocked);
}

async function closeBrowserUnlocked(): Promise<{ closed: boolean }> {
  const { browser, context, persistent, userDataDir } = state;
  const cleanup = stopOwnedProcess; const temporary = ephemeralProfile;
  const closed = Boolean(context || browser || cleanup || temporary);
  const errors: unknown[] = [];
  if (persistent && userDataDir && context) {
    try { await writeDataFile(path.join(userDataDir, SESSION_COOKIE_BACKUP), JSON.stringify(await context.storageState(), null, 2) + '\n'); }
    catch (error) { errors.push(error); }
  }
  resetState(); stopOwnedProcess = null; ephemeralProfile = null; lastUaSyncErrors = [];
  try { if (!cleanup) await context?.close(); } catch (error) { errors.push(error); }
  try { if (browser?.isConnected()) await browser.close(); } catch (error) { errors.push(error); }
  try { await cleanup?.(); } catch (error) { errors.push(error); }
  if (temporary) {
    try { await fsPromises.rm(await checkedDataPath(temporary), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Browser stopped with backup/cleanup errors; inspect data before continuing');
  return { closed };
}

/** Get the active page, launching the browser lazily on first use. */
async function ensurePage(opts: LaunchOptions = {}): Promise<Page> {
  if (!isRunning()) await launchBrowser(opts);
  const context = state.context;
  if (!context) throw new Error('Browser context is not available.');

  if (state.page && !state.page.isClosed()) { await pageSetup.get(state.page); return state.page; }
  const pages = context.pages().filter((p) => !p.isClosed());
  const fallback = pages[pages.length - 1];
  if (fallback) {
    applyTimeouts(fallback);
    state.page = fallback;
    await pageSetup.get(fallback);
    return fallback;
  }
  const page = await context.newPage();
  applyTimeouts(page);
  state.page = page;
  await pageSetup.get(page);
  return page;
}

export async function browserInfo(): Promise<BrowserInfo> {
  const page = state.page && !state.page.isClosed() ? state.page : null;
  return {
    running: isRunning(),
    headless: state.headless,
    persistent: state.persistent,
    stealth: state.stealth,
    userDataDir: state.userDataDir,
    executable: state.executable,
    url: page ? page.url() : null,
    title: page ? await page.title().catch(() => '') : null,
    viewport: page ? page.viewportSize() : null,
    humanize: currentHumanize(),
    userAgent: state.userAgent ?? state.nativeUserAgent,
    customHeaders: { ...state.customHeaders },
  };
}

// ---------- page actions ----------

export async function navigate(url: string, waitUntil: WaitUntil = 'load'): Promise<NavigateResult> {
  const page = await ensurePage();
  const response = await page.goto(normalizeUrl(url), { waitUntil });
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    status: response ? response.status() : null,
    finalUrl: response ? response.url() : page.url(),
  };
}

export async function goHistory(action: HistoryAction): Promise<HistoryResult> {
  const page = await ensurePage();
  if (action === 'back') {
    await page.goBack({ waitUntil: 'load' }).catch((e: Error) => {
      throw new Error(`go back failed: ${e.message}`);
    });
  } else if (action === 'forward') {
    await page.goForward({ waitUntil: 'load' }).catch((e: Error) => {
      throw new Error(`go forward failed: ${e.message}`);
    });
  } else {
    await page.reload({ waitUntil: 'load' });
  }
  return { url: page.url(), title: await page.title().catch(() => '') };
}

export async function screenshotPageWithPath(opts: { fullPage?: boolean | undefined } = {}): Promise<ShotResult> {
  const directory = await screenshotDirectory('browser_screenshot');
  const page = await ensurePage();
  const png = await page.screenshot({ type: 'png', fullPage: opts.fullPage ?? false });
  const shot = await persistScreenshot(directory, { png, ...pngSize(png), name: 'page', label: 'browser page' });
  requestRetentionSweep('browser capture');
  return shot;
}

/** Preserve the existing library API while also saving the generated image. */
export async function screenshotPage(opts: { fullPage?: boolean | undefined } = {}): Promise<string> {
  return (await screenshotPageWithPath(opts)).base64;
}

export async function click(selector: string, opts: ClickOptions = {}): Promise<ClickResult> {
  const page = await ensurePage();
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout });
  await humanClick(loc, { button: opts.button, clickCount: opts.clickCount }, timeout);
  return { clicked: selector, url: page.url() };
}

export async function typeText(selector: string, value: string, opts: TypeOptions = {}): Promise<TypeResult> {
  const page = await ensurePage();
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout });

  const cfg = currentHumanize();
  if ((opts.clear ?? false) && !cfg.enabled && opts.delay === undefined) {
    await loc.fill(value, { timeout });
  } else {
    await humanClick(loc, {}, timeout);
    if (opts.clear ?? false) {
      await loc.press('ControlOrMeta+A');
      await loc.press('Backspace');
    }
    await humanType(page, value, opts.delay);
  }

  if (opts.submit ?? false) {
    if (cfg.enabled) await humanPause(page);
    await page.keyboard.press('Enter');
  }
  return { typed: value.length, submitted: opts.submit ?? false, url: page.url() };
}

export async function pressKey(key: string, selector?: string | undefined): Promise<PressResult> {
  const page = await ensurePage();
  if (selector) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
    await loc.focus();
  }
  await humanPause(page);
  await page.keyboard.press(key);
  return { pressed: key, url: page.url() };
}

export async function selectOption(selector: string, opts: SelectOptions = {}): Promise<SelectResult> {
  const page = await ensurePage();
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout });
  await humanPause(page);

  if (opts.value !== undefined) await loc.selectOption({ value: opts.value }, { timeout });
  else if (opts.label !== undefined) await loc.selectOption({ label: opts.label }, { timeout });
  else if (opts.index !== undefined) await loc.selectOption({ index: opts.index }, { timeout });
  else throw new Error('Provide exactly one of value / label / index.');

  const selected = await loc.evaluate((el) => {
    const select = el as unknown as HTMLSelectElement;
    return Array.from(select.selectedOptions).map((o) => ({
      value: o.value,
      text: o.textContent ?? '',
    }));
  });
  return { selected };
}

export async function scroll(opts: ScrollOptions = {}): Promise<ScrollResult> {
  const page = await ensurePage();
  const deltaX = opts.deltaX ?? 0;
  const deltaY = opts.deltaY ?? 600;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const step = async (x: number, y: number): Promise<void> => {
    if (opts.selector) {
      const loc = page.locator(opts.selector).first();
      await loc.evaluate((el, d) => el.scrollBy(d.x, d.y), { x, y });
    } else {
      await page.evaluate(([dx, dy]) => window.scrollBy(dx, dy), [x, y] as const);
    }
  };

  if (opts.selector) {
    const loc = page.locator(opts.selector).first();
    await loc.waitFor({ state: 'visible', timeout });
  }

  const cfg = currentHumanize();
  if (cfg.enabled) {
    // Smooth scroll: split into a few steps with tiny random pauses.
    await humanPause(page);
    const steps = randInt(3, 6);
    for (const delta of scrollSteps(deltaX, deltaY, steps)) {
      await step(delta.x, delta.y);
      await page.waitForTimeout(randInt(25, 75));
    }
  } else {
    await step(deltaX, deltaY);
  }

  return {
    scrolled: { deltaX, deltaY, selector: opts.selector ?? '(window)' },
    url: page.url(),
  };
}

export async function wait(opts: WaitOptions = {}): Promise<WaitResult> {
  const page = await ensurePage();
  if (opts.selector) {
    await page.waitForSelector(opts.selector, {
      state: opts.state ?? 'visible',
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return { waited: 'selector', selector: opts.selector, state: opts.state ?? 'visible' };
  }
  const ms = Math.min(opts.sleepMs ?? opts.timeoutMs ?? 1000, 60000);
  await page.waitForTimeout(ms);
  return { waited: 'time', ms };
}

export async function evaluate(script: string): Promise<EvaluateResult> {
  const page = await ensurePage();
  const result: unknown = await page.evaluate(script);
  if (result === undefined) return { result: 'undefined' };
  try {
    return { result: JSON.stringify(result, null, 2) ?? String(result) };
  } catch {
    return { result: String(result) };
  }
}

export interface ScrollAllOptions {
  maxScrolls?: number | undefined;
  delayMs?: number | undefined;
  stepPx?: number | undefined;
}

export interface ScrollAllResult {
  scrolls: number;
  finalHeight: number;
  reachedBottom: boolean;
  url: string;
}

export interface ExtractOptions {
  autoScroll?: boolean | undefined;
  scrollAll?: ScrollAllOptions | undefined;
}

/**
 * Auto-scroll to the bottom in steps until the page height stops growing.
 * This triggers lazy-loading (infinite scroll, loading="lazy" images) so the
 * content can be extracted afterwards.
 */
export async function scrollAll(opts: ScrollAllOptions = {}): Promise<ScrollAllResult> {
  const page = await ensurePage();
  const maxScrolls = Math.min(Math.max(opts.maxScrolls ?? 30, 1), 200);
  const step = Math.min(Math.max(opts.stepPx ?? 600, 50), 2000);
  const cfg = currentHumanize();

  let scrolls = 0;
  let lastHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  let reachedBottom = false;

  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate((y) => window.scrollBy(0, y), step);
    scrolls++;
    const wait = opts.delayMs ?? (cfg.enabled ? randInt(250, 600) : 150);
    await page.waitForTimeout(wait);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const atBottom = await page.evaluate(
      () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 5,
    );
    if (atBottom && height === lastHeight) {
      // give late lazy-load requests one more chance to grow the page
      await page.waitForTimeout(wait);
      const finalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      reachedBottom = finalHeight === height;
      lastHeight = finalHeight;
      if (reachedBottom) break;
      continue;
    }
    lastHeight = height;
  }

  return { scrolls, finalHeight: lastHeight, reachedBottom, url: page.url() };
}

export async function getText(selector = 'body', opts: ExtractOptions = {}): Promise<TextOutput> {
  const page = await ensurePage();
  if (opts.autoScroll ?? false) await scrollAll(opts.scrollAll);
  const loc = page.locator(selector).first();
  const value = await loc.innerText({ timeout: DEFAULT_TIMEOUT_MS });
  return truncate(value ?? '', selector);
}

export async function getHtml(selector?: string | undefined, opts: ExtractOptions = {}): Promise<TextOutput> {
  const page = await ensurePage();
  if (opts.autoScroll ?? false) await scrollAll(opts.scrollAll);
  if (!selector) return truncate(await page.content(), '(document)');
  const loc = page.locator(selector).first();
  const html = await loc.evaluate((el) => el.outerHTML);
  return truncate(html ?? '', selector);
}

export async function tabs(action: TabAction, url?: string | undefined): Promise<TabsResult> {
  const page = await ensurePage();
  const context = page.context();

  if (action === 'list') {
    const pages = context.pages();
    const items: TabInfo[] = await Promise.all(
      pages.map(async (p, i) => ({
        index: i,
        url: p.url(),
        title: await p.title().catch(() => ''),
        active: p === state.page,
        closed: p.isClosed(),
      })),
    );
    return { tabs: items, activeIndex: items.findIndex((t) => t.active) };
  }

  if (action === 'new') {
    const created = await context.newPage();
    applyTimeouts(created);
    state.page = created;
    await pageSetup.get(created);
    if (url) await navigate(url);
    return { opened: true, url: created.url(), tabCount: context.pages().length };
  }

  const closing = state.page && !state.page.isClosed() ? state.page : null;
  if (!closing) return { closed: false, reason: 'no active tab' };
  await closing.close();
  const remaining = context.pages().filter((p) => !p.isClosed());
  state.page = remaining[remaining.length - 1] ?? null;
  return { closed: true, tabCount: remaining.length };
}

// ---------- login state (cookies + localStorage) ----------

async function stateFileTarget(file: string | undefined, reading: boolean): Promise<string> {
  if (file) {
    const absoluteOrProjectRelative = path.isAbsolute(file) || /^test[\\/]/i.test(file);
    return checkedDataPath(absoluteOrProjectRelative ? file : path.join(EXPORT_ROOT, file), reading ? LOGIN_ROOT : EXPORT_ROOT);
  }
  if (reading && !fs.existsSync(DEFAULT_STATE_FILE) && fs.existsSync(LEGACY_STATE_FILE)) {
    return checkedDataPath(LEGACY_STATE_FILE, LOGIN_ROOT); // read-only compatibility; never migrate or overwrite it implicitly
  }
  return checkedDataPath(DEFAULT_STATE_FILE, LOGIN_ROOT);
}

export async function saveState(file?: string | undefined): Promise<StateFile> {
  const target = await stateFileTarget(file, false);
  const page = await ensurePage();
  const snapshot = await page.context().storageState();
  await writeDataFile(target, JSON.stringify(snapshot, null, 2) + '\n');
  return { path: target, cookies: snapshot.cookies.length, origins: snapshot.origins.length };
}

export async function loadState(file?: string | undefined): Promise<StateLoadResult> {
  const target = await stateFileTarget(file, true);
  const raw = parseStorageState(await readDataFile(target, LOGIN_ROOT));
  const page = await ensurePage();
  const context = page.context();
  const applied: string[] = [];
  if (raw.cookies.length) { await context.addCookies(raw.cookies); applied.push('cookies'); }
  if (raw.origins.length) { await restoreLocalStorage(context, raw.origins); applied.push('localStorage'); }
  await page.reload({ waitUntil: 'load' });
  return { path: target, cookies: raw.cookies.length, origins: raw.origins.length, applied };
}
