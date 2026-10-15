// diagnostics.ts - in-memory page observability: console messages, uncaught
// page errors and network activity, captured from the shared browser context.
//
// Buffers are process-local ring buffers (newest last, capped per channel);
// nothing is persisted to disk so hostile pages cannot leak their logs into
// test/ artifacts. All listeners are attached per context; resetDiagnostics()
// drops buffers when the context changes.

import type { BrowserContext, CDPSession, Page } from 'playwright-core';

/** A captured console message or uncaught page error. */
export interface ConsoleEntry {
  seq: number;
  /** 'console' = console API call; 'pageerror' = uncaught exception / rejection. */
  kind: 'console' | 'pageerror';
  /** console type (log/warn/error/info/debug) or 'uncaughterror' / 'unhandledrejection'. */
  level: string;
  text: string;
  url: string | null;
  line: number | null;
  column: number | null;
  at: string;
}

/** A captured network exchange. */
export interface NetworkEntry {
  seq: number;
  method: string;
  url: string;
  status: number | null;
  statusText: string;
  resourceType: string;
  /** Response bytes captured for failed (>=400) requests, head-capped. */
  failedBodyPreview: string | null;
  startedAt: string;
  durationMs: number | null;
}

const CONSOLE_LIMIT = clampFromEnv('MCP_DIAG_CONSOLE_LIMIT', 200, 10, 2000);
const NETWORK_LIMIT = clampFromEnv('MCP_DIAG_NETWORK_LIMIT', 200, 10, 5000);
const FAILED_BODY_PREVIEW = 300;

function clampFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

interface DiagState {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  consoleSeq: number;
  networkSeq: number;
  attachedContext: BrowserContext | null;
}

const diag: DiagState = {
  console: [],
  network: [],
  consoleSeq: 0,
  networkSeq: 0,
  attachedContext: null,
};

function ringPush<T>(buffer: T[], item: T, limit: number): void {
  buffer.push(item);
  if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
}

function timeNow(): string {
  return new Date().toISOString();
}

/** Trim and flatten console call arguments the way DevTools does. */
function renderLocation(page: Page | null): { url: string | null; line: number | null; column: number | null } {
  const url = pageUrl(page);
  return { url, line: null, column: null };
}

function pageUrl(page: Page | null | undefined): string | null {
  try {
    if (!page || page.isClosed()) return null;
    const u = page.url();
    return u && u !== 'about:blank' ? u : null;
  } catch {
    return null;
  }
}

async function failedBodyPreview(response: { text(): Promise<string> } | null): Promise<string | null> {
  if (!response) return null;
  try {
    const text = await response.text();
    return text.slice(0, FAILED_BODY_PREVIEW);
  } catch {
    return null; // streams may already be consumed; never let capture break the page
  }
}

/**
 * Attach capture listeners to a context. Idempotent per context object; call
 * again when the shared browser launches a new context. Detaching happens
 * implicitly when the context closes (its listeners die with it).
 */
export function attachDiagnostics(context: BrowserContext): void {
  if (diag.attachedContext === context) return;
  diag.attachedContext = context;

  context.on('console', (message) => {
    const page = message.page() as Page | null;
    const loc = renderLocation(page);
    const entry: ConsoleEntry = {
      seq: ++diag.consoleSeq,
      kind: 'console',
      level: message.type(),
      text: message.text(),
      url: loc.url,
      line: loc.line,
      column: loc.column,
      at: timeNow(),
    };
    ringPush(diag.console, entry, CONSOLE_LIMIT);
  });

  context.on('weberror', (webError) => {
    const page = webError.page();
    const err = webError.error();
    const entry: ConsoleEntry = {
      seq: ++diag.consoleSeq,
      kind: 'pageerror',
      level: 'uncaughterror',
      text: err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err),
      url: pageUrl(page),
      line: null,
      column: null,
      at: timeNow(),
    };
    ringPush(diag.console, entry, CONSOLE_LIMIT);
  });

  // Unhandled promise rejections surface as pageerror in Playwright already on
  // Chromium; other channels keep the same event, so no extra listener is needed.

  const pending = new Map<import('playwright-core').Request, { started: number }>();

  context.on('request', (request) => {
    if (request.isNavigationRequest() && request.url().startsWith('data:')) return;
    pending.set(request, { started: Date.now() });
  });

  context.on('response', (response) => {
    const request = response.request();
    const started = pending.get(request);
    pending.delete(request);
    const failed = response.status() >= 400;
    const entry: NetworkEntry = {
      seq: ++diag.networkSeq,
      method: request.method(),
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      resourceType: request.resourceType(),
      failedBodyPreview: null,
      startedAt: new Date(started?.started ?? Date.now()).toISOString(),
      durationMs: started ? Date.now() - started.started : null,
    };
    if (failed) {
      // Captured asynchronously; the preview fills in once the body settles.
      void failedBodyPreview(response).then((preview) => {
        entry.failedBodyPreview = preview;
      });
      ringPush(diag.network, entry, NETWORK_LIMIT);
    } else {
      ringPush(diag.network, entry, NETWORK_LIMIT);
    }
  });

  context.on('requestfailed', (request) => {
    const started = pending.get(request);
    pending.delete(request);
    const entry: NetworkEntry = {
      seq: ++diag.networkSeq,
      method: request.method(),
      url: request.url(),
      status: null,
      statusText: request.failure()?.errorText ?? 'failed',
      resourceType: request.resourceType(),
      failedBodyPreview: null,
      startedAt: new Date(started?.started ?? Date.now()).toISOString(),
      durationMs: started ? Date.now() - started.started : null,
    };
    ringPush(diag.network, entry, NETWORK_LIMIT);
  });
}

/** Drop captured entries and the context binding (called when a context closes). */
export function resetDiagnostics(): void {
  diag.console = [];
  diag.network = [];
  diag.consoleSeq = 0;
  diag.networkSeq = 0;
  diag.attachedContext = null;
}

export interface ConsoleQuery {
  /** Only entries at/after this sequence number. */
  sinceSeq?: number | undefined;
  /** Keep only these console levels (console types + 'uncaughterror'/'unhandledrejection'). */
  levels?: string[] | undefined;
  /** Substring filter, case-insensitive, applied to text and URL. */
  search?: string | undefined;
  limit?: number | undefined;
  /** newest last (default) or newest first. */
  newestFirst?: boolean | undefined;
}

export interface ConsoleResult {
  entries: ConsoleEntry[];
  totalBuffered: number;
  droppedFromBuffer: number;
  nextSeq: number;
  truncated: boolean;
}

export function consoleEntries(query: ConsoleQuery = {}): ConsoleResult {
  const dropped = Math.max(0, diag.consoleSeq - diag.console.length);
  let items = diag.console;
  if (query.sinceSeq !== undefined) items = items.filter((e) => e.seq > (query.sinceSeq as number));
  if (query.levels?.length) {
    const wanted = new Set(query.levels.map((l) => l.toLowerCase()));
    items = items.filter((e) => wanted.has(e.level.toLowerCase()));
  }
  if (query.search) {
    const needle = query.search.toLowerCase();
    items = items.filter((e) => e.text.toLowerCase().includes(needle) || (e.url ?? '').toLowerCase().includes(needle));
  }
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
  const truncated = items.length > limit;
  items = query.newestFirst ? items.slice(-limit).reverse() : items.slice(-limit);
  return {
    entries: items,
    totalBuffered: diag.console.length,
    droppedFromBuffer: dropped,
    nextSeq: diag.consoleSeq + 1,
    truncated,
  };
}

export interface NetworkQuery {
  sinceSeq?: number | undefined;
  /** Keep only failed exchanges (HTTP >= 400 or requestfailed). */
  failedOnly?: boolean | undefined;
  method?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  newestFirst?: boolean | undefined;
}

export interface NetworkResult {
  entries: NetworkEntry[];
  totalBuffered: number;
  droppedFromBuffer: number;
  nextSeq: number;
  truncated: boolean;
}

export function networkEntries(query: NetworkQuery = {}): NetworkResult {
  const dropped = Math.max(0, diag.networkSeq - diag.network.length);
  let items = diag.network;
  if (query.sinceSeq !== undefined) items = items.filter((e) => e.seq > (query.sinceSeq as number));
  if (query.failedOnly) items = items.filter((e) => e.status === null || e.status >= 400);
  if (query.method) items = items.filter((e) => e.method.toUpperCase() === query.method!.toUpperCase());
  if (query.search) {
    const needle = query.search.toLowerCase();
    items = items.filter((e) => e.url.toLowerCase().includes(needle));
  }
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
  const truncated = items.length > limit;
  items = query.newestFirst ? items.slice(-limit).reverse() : items.slice(-limit);
  return {
    entries: items,
    totalBuffered: diag.network.length,
    droppedFromBuffer: dropped,
    nextSeq: diag.networkSeq + 1,
    truncated,
  };
}

export function diagnosticsInfo(): { consoleBuffered: number; networkBuffered: number; attached: boolean } {
  return {
    consoleBuffered: diag.console.length,
    networkBuffered: diag.network.length,
    attached: diag.attachedContext !== null,
  };
}
