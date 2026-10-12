// win32.ts - Windows-only fallback backend using the PowerShell helper in
// scripts/capture.ps1 (CopyFromScreen / PrintWindow). Kept as a safety net in
// case the native backend fails; the primary path is pure code (native.ts).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MonitorMode, RegionRect, ShotImage, WindowInfo } from '../types.js';
import type { ScreenshotBackend, WindowTarget } from './backend.js';
import { pickWindow } from './backend.js';
import { pngSize } from './png.js';
import { dataPath, checkedDataPath, createDataRun } from '../core/data-paths.js';

const PS_SCRIPT = fileURLToPath(new URL('../../scripts/capture.ps1', import.meta.url));

async function runCapture(extraEnv: Record<string, string>): Promise<string> {
  const temporary = extraEnv.MCPS_OUT ? null : await createDataRun('screenshot', 'list_windows');
  const scratch = temporary ?? await checkedDataPath(path.dirname(extraEnv.MCPS_OUT!));
  try {
    return await new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      { env: { ...process.env, ...extraEnv, TMP: scratch, TEMP: scratch, TMPDIR: scratch }, encoding: 'utf8', windowsHide: true, timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || '').trim() || (stdout || '').trim() || err.message;
          reject(new Error(detail.replace(/^\s*At line.*$/m, '').trim() || 'capture failed'));
        } else {
          resolve((stdout || '').trim());
        }
      },
    );
    });
  } finally {
    if (temporary) await fs.rm(await checkedDataPath(temporary), { recursive: true, force: true });
  }
}

async function shotFromFile(file: string, label: string, name: string): Promise<ShotImage> {
  const png = await fs.readFile(await checkedDataPath(file));
  const size = pngSize(png);
  return { png, label, name, width: size.width, height: size.height };
}

export class Win32Backend implements ScreenshotBackend {
  readonly name = 'win32-powershell';

  async captureScreen(mode: MonitorMode): Promise<ShotImage[]> {
    return [await temporaryCapture('screenshot_screen', { MCPS_MODE: 'full', MCPS_MONITOR: mode }, `screen (${mode})`, 'screen')];
  }

  async captureRegion(rect: RegionRect): Promise<ShotImage[]> {
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Region width and height must be positive.');
    }
    return [await temporaryCapture('screenshot_region', {
      MCPS_MODE: 'region',
      MCPS_X: String(rect.x),
      MCPS_Y: String(rect.y),
      MCPS_W: String(rect.width),
      MCPS_H: String(rect.height),
    }, `region ${rect.width}x${rect.height} at ${rect.x},${rect.y}`, 'region')];
  }

  async captureWindow(target: WindowTarget = {}): Promise<ShotImage> {
    // Resolve the exact window first (title/app/pid filters), then let the
    // PowerShell helper capture it by its exact title.
    let title = target.title ?? '';
    if (target.title || target.app !== undefined || target.pid !== undefined) {
      title = pickWindow(await this.listWindows(), target).title;
    }
    return temporaryCapture('screenshot_window', { MCPS_MODE: 'window', MCPS_TITLE: title }, title ? `window "${title}"` : 'foreground window', title || 'window');
  }

  async listWindows(): Promise<WindowInfo[]> {
    const stdout = await runCapture({ MCPS_MODE: 'list' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      throw new Error(`Failed to parse window list: ${(e as Error).message}`);
    }
    const rows: unknown[] = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return rows.map((row) => normalizeWindow(row));
  }
}

function normalizeWindow(row: unknown): WindowInfo {
  const r = row as Record<string, unknown>;
  return {
    id: typeof r.handle === 'string' ? Number.parseInt(r.handle, 16) : Number(r.id ?? 0),
    title: String(r.title ?? ''),
    appName: String(r.appName ?? ''),
    pid: Number(r.pid ?? 0),
    x: Number(r.left ?? r.x ?? 0),
    y: Number(r.top ?? r.y ?? 0),
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    minimized: false,
    maximized: false,
    focused: Boolean(r.foreground),
  };
}

async function temporaryCapture(tool: string, env: Record<string, string>, label: string, name: string): Promise<ShotImage> {
  const directory = await createDataRun('screenshot', tool);
  const file = path.join(directory, 'capture.png');
  try {
    await runCapture({ ...env, MCPS_OUT: await checkedDataPath(file, dataPath('screenshot', tool)) });
    return await shotFromFile(file, label, name);
  } finally {
    await fs.rm(await checkedDataPath(directory), { recursive: true, force: true });
  }
}
