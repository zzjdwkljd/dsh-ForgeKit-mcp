// retention.ts - expiry sweep for tool-generated screenshots.
//
// Ownership must be provable before anything is deleted. This project writes
// `<base>-YYYYMMDD-HHMMSS[-N].png` through persistScreenshot(), so a file is
// only eligible when its name matches that format exactly (with a timestamp that
// decodes to a real, non-future date) and its first bytes are a PNG header.
// Anything else -- manual drops, exports, notes -- is left alone.
//
// Age uses max(filename timestamp, mtime): a genuine stale shot is old on both,
// while an image copied in with a preserved name but fresh mtime survives.
import fs from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';
import { dataPath, checkedDataPath } from '../core/data-paths.js';
import { pngSize } from './png.js';

/** Partitions the screenshot tools write into; nothing else is ever swept. */
export const SCREENSHOT_PARTITIONS = [
  'screenshot_screen',
  'screenshot_region',
  'screenshot_window',
  'browser_screenshot',
] as const;

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_DAYS = 3;
const DEFAULT_INTERVAL_HOURS = 6;
const HEADER_BYTES = 24;
/** Clock skew / future stamps a writer could not have produced. */
const FUTURE_TOLERANCE_MS = 60_000;

// `<base>-YYYYMMDD-HHMMSS[-N].png`; base is greedy so the last decodable
// timestamp wins, which is where persistScreenshot() appends it.
const GENERATED_NAME = /^(.+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?\.png$/i;

export interface RetentionConfig {
  /** Days to keep a generated screenshot. 0 disables the sweep entirely. */
  days: number;
  /** Periodic sweep interval in ms. 0 keeps only the startup sweep. */
  intervalMs: number;
}

export interface DeletedFile {
  path: string;
  sizeBytes: number;
}

export interface RetentionFailure {
  path: string;
  error: string;
}

export interface RetentionReport {
  enabled: boolean;
  days: number;
  /** Partitions that were inspected, including ones that did not exist. */
  directories: Array<{ path: string; existed: boolean }>;
  /** Files whose ownership was proven and whose age was evaluated. */
  considered: number;
  deleted: number;
  freedBytes: number;
  deletedFiles: DeletedFile[];
  failures: RetentionFailure[];
}

function warn(message: string): void {
  // stdout is reserved for MCP JSON-RPC; every log line goes to stderr.
  console.error(`[forgekit] screenshot retention: ${message}`);
}

function positiveInt(raw: string | undefined, fallback: number, unit: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    warn(`invalid ${unit} value "${raw}"; using default ${fallback}`);
    return fallback;
  }
  return value;
}

export function retentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const days = positiveInt(env.MCP_SCREENSHOT_RETENTION_DAYS, DEFAULT_DAYS, 'MCP_SCREENSHOT_RETENTION_DAYS (days)');
  const hours = positiveInt(env.MCP_SCREENSHOT_RETENTION_INTERVAL_HOURS, DEFAULT_INTERVAL_HOURS, 'MCP_SCREENSHOT_RETENTION_INTERVAL_HOURS (hours)');
  return { days, intervalMs: hours * MS_PER_HOUR };
}

export function describeRetention(config: RetentionConfig): string {
  if (config.days === 0) return 'disabled (MCP_SCREENSHOT_RETENTION_DAYS=0)';
  const cadence = config.intervalMs === 0 ? 'startup only' : `every ${config.intervalMs / MS_PER_HOUR}h`;
  return `keeping ${config.days} day(s), sweep ${cadence}`;
}

/** Decode the capture time a generated filename claims, or null if it does not. */
export function captureTimeFromName(name: string): number | null {
  const match = GENERATED_NAME.exec(name);
  if (!match) return null;
  const [, , year, month, day, hour, minute, second] = match;
  const stamp = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  // Reject impossible stamps such as 20260231 or 20260925-256101.
  if (
    stamp.getFullYear() !== Number(year) ||
    stamp.getMonth() !== Number(month) - 1 ||
    stamp.getDate() !== Number(day) ||
    stamp.getHours() !== Number(hour) ||
    stamp.getMinutes() !== Number(minute) ||
    stamp.getSeconds() !== Number(second)
  ) {
    return null;
  }
  if (stamp.getTime() > Date.now() + FUTURE_TOLERANCE_MS) return null;
  return stamp.getTime();
}

/** PNG signature plus IHDR, reusing the existing reader. */
async function hasPngHeader(file: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return pngSize(buffer.subarray(0, bytesRead)).width > 0;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function readDirSafe(directory: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function sweepPartition(directory: string, retentionMs: number, now: number, report: RetentionReport): Promise<void> {
  const existed = await fs
    .stat(directory)
    .then(() => true)
    .catch(() => false);
  report.directories.push({ path: directory, existed });

  for (const entry of await readDirSafe(directory)) {
    // Only top-level regular files: validation runs, baselines and run-* scratch
    // directories stay untouched, and so does anything a person placed here.
    if (!entry.isFile()) continue;
    const claimed = captureTimeFromName(entry.name);
    if (claimed === null) continue;
    const file = path.join(directory, entry.name);
    let stat: Stats;
    try {
      stat = await fs.lstat(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (!(await hasPngHeader(file))) continue;

    report.considered += 1;
    const age = now - Math.max(claimed, stat.mtimeMs);
    if (age <= retentionMs) continue;

    try {
      await fs.rm(file, { force: true });
      report.deleted += 1;
      report.freedBytes += stat.size;
      report.deletedFiles.push({ path: file, sizeBytes: stat.size });
    } catch (error) {
      report.failures.push({ path: file, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** Same root resolution as the capture path, but read-only: nothing is created. */
async function screenshotRoot(): Promise<string> {
  const root = dataPath('screenshot');
  return checkedDataPath(process.env.MCP_SCREENSHOT_DIR ?? root, root);
}

export async function runScreenshotRetention(now = Date.now()): Promise<RetentionReport> {
  const config = retentionConfig();
  const report: RetentionReport = {
    enabled: config.days > 0,
    days: config.days,
    directories: [],
    considered: 0,
    deleted: 0,
    freedBytes: 0,
    deletedFiles: [],
    failures: [],
  };
  if (!report.enabled) return report;

  const root = await screenshotRoot();
  const retentionMs = config.days * MS_PER_DAY;
  for (const partition of SCREENSHOT_PARTITIONS) {
    await sweepPartition(path.join(root, partition), retentionMs, now, report);
  }
  return report;
}

function reportOutcome(report: RetentionReport): void {
  if (report.deleted > 0) {
    warn(`deleted ${report.deleted} expired screenshot(s), freed ${report.freedBytes} byte(s)`);
  }
  for (const failure of report.failures) warn(`could not delete ${failure.path}: ${failure.error}`);
}

/** Coalesce concurrent captures and avoid re-scanning on every single shot. */
const MIN_SWEEP_GAP_MS = 5 * 60_000;
let lastSweepStartedAt = 0;
let sweepInFlight: Promise<void> | undefined;

/** Fire-and-forget sweep for the capture path; never blocks or fails a capture. */
export function requestRetentionSweep(reason: string): void {
  const config = retentionConfig();
  // Announce once on first use, including the disabled case, so the effective
  // policy is visible without adding per-capture noise.
  announcePolicyOnce(config);
  if (config.days === 0) return;
  ensureRetentionTimer(config);
  if (sweepInFlight) return;
  if (Date.now() - lastSweepStartedAt < MIN_SWEEP_GAP_MS) return;
  lastSweepStartedAt = Date.now();
  sweepInFlight = runScreenshotRetention()
    .then((report) => reportOutcome(report))
    .catch((error: unknown) => warn(`sweep after ${reason} failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      sweepInFlight = undefined;
    });
}

let sweepTimer: NodeJS.Timeout | undefined;
let timerScheduled = false;
let policyAnnounced = false;

/** Announce the retention policy once, when the sweep is first armed. */
function announcePolicyOnce(config: RetentionConfig): void {
  if (policyAnnounced) return;
  policyAnnounced = true;
  warn(describeRetention(config));
}

/** Interval is created lazily on first activity so module register() stays side-effect free. */
function ensureRetentionTimer(config: RetentionConfig): void {
  if (config.intervalMs === 0 || timerScheduled) return;
  timerScheduled = true;
  // unref so a retention timer never keeps a host process alive.
  sweepTimer = setInterval(() => requestRetentionSweep('interval'), config.intervalMs);
  sweepTimer.unref();
}

/** Clear the interval; an in-flight sweep is awaited by callers that care. */
export function stopScreenshotRetention(): void {
  if (sweepTimer !== undefined) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
  timerScheduled = false;
  lastSweepStartedAt = 0;
}
