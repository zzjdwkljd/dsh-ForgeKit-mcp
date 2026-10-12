// backend.ts - platform-agnostic screenshot backend contract.
import type { MonitorMode, RegionRect, ShotImage, WindowInfo } from '../types.js';

/**
 * A screenshot backend produces PNG images for screens, regions and windows.
 *
 * Implementations must be pure code (no interactive shell prompts) so the same
 * behaviour is available on Windows and macOS (and Linux where supported).
 */
export interface ScreenshotBackend {
  /** Backend name, e.g. "node-screenshots" or "win32-powershell". */
  readonly name: string;

  /** Capture one image per requested monitor. */
  captureScreen(mode: MonitorMode): Promise<ShotImage[]>;

  /**
   * Capture a rectangular region in virtual-screen coordinates.
   * When the region spans several monitors, one shot per monitor part is returned.
   */
  captureRegion(rect: RegionRect): Promise<ShotImage[]>;

  /**
   * Capture a single window located by title/app/pid filters (see WindowTarget).
   * Without any filter the focused window is captured.
   */
  captureWindow(target?: WindowTarget | undefined): Promise<ShotImage>;

  /** List capturable top-level windows. */
  listWindows(): Promise<WindowInfo[]>;
}

/** How to locate a window for capture. Fields combine as AND filters. */
export interface WindowTarget {
  /** Case-insensitive substring of the window title. */
  title?: string | undefined;
  /** Case-insensitive substring of the app/process name (e.g. "chrome", "QQ"). */
  app?: string | undefined;
  /** Exact process id. */
  pid?: number | undefined;
}

function describeTarget(target: WindowTarget): string {
  const parts: string[] = [];
  if (target.title) parts.push(`title~"${target.title}"`);
  if (target.app) parts.push(`app~"${target.app}"`);
  if (target.pid !== undefined) parts.push(`pid=${target.pid}`);
  return parts.length > 0 ? parts.join(' AND ') : '(focused window)';
}

/** Find a window matching the target, preferring the focused window. */
export function pickWindow(windows: WindowInfo[], target: WindowTarget = {}): WindowInfo {
  const titled = windows.filter((w) => w.title.length > 0);
  if (titled.length === 0) {
    throw new Error('No capturable windows found.');
  }

  const hasFilter = Boolean(target.title) || Boolean(target.app) || target.pid !== undefined;
  if (!hasFilter) {
    const focused = titled.find((w) => w.focused);
    if (focused) return focused;
    const first = titled[0];
    if (first) return first;
    throw new Error('No capturable windows found.');
  }

  const titleNeedle = target.title?.toLowerCase();
  const appNeedle = target.app?.toLowerCase();
  const matches = titled.filter(
    (w) =>
      (titleNeedle ? w.title.toLowerCase().includes(titleNeedle) : true) &&
      (appNeedle ? w.appName.toLowerCase().includes(appNeedle) : true) &&
      (target.pid !== undefined ? w.pid === target.pid : true),
  );
  if (matches.length === 0) {
    throw new Error(
      `No window found matching ${describeTarget(target)}. Use list_windows to discover titles, app names and pids.`,
    );
  }
  const focused = matches.find((w) => w.focused);
  const picked = focused ?? matches[0];
  if (!picked) throw new Error(`No window found matching ${describeTarget(target)}.`);
  return picked;
}
