// Screenshot facade: capture through a backend, then save into a tool-owned test/ partition.
import path from 'node:path';
import type { MonitorMode, RegionRect, ShotImage, ShotResult, WindowInfo } from '../types.js';
import type { ScreenshotBackend, WindowTarget } from './backend.js';
import type { NativeBackend } from './native.js';
import { dataPath, checkedDataPath, ensureDataDir, writeDataFile } from '../core/data-paths.js';
import { requestRetentionSweep } from './retention.js';

type ScreenshotTool = 'screenshot_screen' | 'screenshot_region' | 'screenshot_window' | 'browser_screenshot';
let nativeInstance: Promise<NativeBackend> | null = null;

function nativeBackend(): Promise<NativeBackend> {
  nativeInstance ??= import('./native.js').then(({ NativeBackend }) => new NativeBackend()).catch((error: unknown) => {
    nativeInstance = null;
    throw error;
  });
  return nativeInstance;
}

export async function screenshotDirectory(tool: ScreenshotTool): Promise<string> {
  const root = dataPath('screenshot');
  const configured = await checkedDataPath(process.env.MCP_SCREENSHOT_DIR ?? root, root);
  return ensureDataDir(path.join(configured, tool), root);
}

async function withFallback<T>(operation: (backend: ScreenshotBackend) => Promise<T>): Promise<T> {
  try {
    return await operation(await nativeBackend());
  } catch (primary) {
    if (process.platform !== 'win32') throw primary;
    try {
      const { Win32Backend } = await import('./win32.js');
      return await operation(new Win32Backend());
    } catch (fallback) {
      const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
      throw new Error(`Screenshot failed (native: ${message(primary)}; Windows fallback: ${message(fallback)})`);
    }
  }
}

export async function captureScreens(mode: MonitorMode): Promise<ShotResult[]> {
  const directory = await screenshotDirectory('screenshot_screen');
  const shots = await withFallback((backend) => backend.captureScreen(mode));
  requestRetentionSweep('screen capture');
  return Promise.all(shots.map((shot) => persistScreenshot(directory, shot)));
}

export async function captureRegion(rect: RegionRect): Promise<ShotResult[]> {
  const directory = await screenshotDirectory('screenshot_region');
  const shots = await withFallback((backend) => backend.captureRegion(rect));
  requestRetentionSweep('region capture');
  return Promise.all(shots.map((shot) => persistScreenshot(directory, shot)));
}

export async function captureWindow(target: WindowTarget = {}): Promise<ShotResult> {
  const directory = await screenshotDirectory('screenshot_window');
  const shot = await withFallback((backend) => backend.captureWindow(target));
  requestRetentionSweep('window capture');
  return persistScreenshot(directory, shot);
}

export function listWindows(): Promise<WindowInfo[]> {
  return withFallback((backend) => backend.listWindows());
}

export async function persistScreenshot(directory: string, shot: ShotImage): Promise<ShotResult> {
  const base = sanitizeName(shot.name);
  const stamp = timestamp();
  // Exclusive creation, not exists-then-write: concurrent captures cannot overwrite each other.
  for (let index = 0; index < 10000; index++) {
    const file = path.join(directory, `${base}-${stamp}${index ? `-${index + 1}` : ''}.png`);
    try {
      await writeDataFile(file, shot.png, true);
      return { path: file, base64: shot.png.toString('base64'), label: shot.label, width: shot.width, height: shot.height };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many screenshots with the same name; no existing data was overwritten');
}

function sanitizeName(raw: string): string {
  return raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60).trim() || 'shot';
}

function timestamp(): string {
  const now = new Date();
  const part = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

// Expiry of generated files is handled by retention.ts (3-day sweep over the
// four tool partitions). persistScreenshot() itself never deletes anything.
