// native.ts - cross-platform screenshot backend built on node-screenshots
// (Rust/NAPI; identical code path on Windows, macOS and Linux).
import { Monitor, Window } from 'node-screenshots';
import type { Image } from 'node-screenshots';
import type { MonitorInfo, MonitorMode, RegionRect, ShotImage, WindowInfo } from '../types.js';
import { pickWindow, type ScreenshotBackend, type WindowTarget } from './backend.js';

function toShotImage(img: Image, label: string, name: string): ShotImage {
  return { png: img.toPngSync(), label, name, width: img.width, height: img.height };
}

function toMonitorInfo(m: Monitor): MonitorInfo {
  return {
    id: m.id(),
    name: m.name(),
    x: m.x(),
    y: m.y(),
    width: m.width(),
    height: m.height(),
    scaleFactor: m.scaleFactor(),
    primary: m.isPrimary(),
  };
}

function toWindowInfo(w: Window): WindowInfo {
  return {
    id: w.id(),
    title: w.title(),
    appName: w.appName(),
    pid: w.pid(),
    x: w.x(),
    y: w.y(),
    width: w.width(),
    height: w.height(),
    minimized: w.isMinimized(),
    maximized: w.isMaximized(),
    focused: w.isFocused(),
  };
}

function overlapsMonitor(m: Monitor, r: RegionRect): boolean {
  return (
    r.x < m.x() + m.width() &&
    r.x + r.width > m.x() &&
    r.y < m.y() + m.height() &&
    r.y + r.height > m.y()
  );
}

export class NativeBackend implements ScreenshotBackend {
  readonly name = 'node-screenshots';

  async captureScreen(mode: MonitorMode): Promise<ShotImage[]> {
    const monitors = Monitor.all();
    if (monitors.length === 0) throw new Error('No monitors found.');

    const targets =
      mode === 'primary'
        ? [monitors.find((m) => m.isPrimary()) ?? monitors[0]].filter((m): m is Monitor => m != null)
        : monitors;

    return Promise.all(
      targets.map(async (m) => {
        const info = toMonitorInfo(m);
        const img = await m.captureImage();
        return toShotImage(
          img,
          `monitor ${info.primary ? '(primary) ' : ''}${info.name} ${info.width}x${info.height} at ${info.x},${info.y}`,
          `screen-${info.name}`,
        );
      }),
    );
  }

  async captureRegion(rect: RegionRect): Promise<ShotImage[]> {
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Region width and height must be positive.');
    }
    const parts = Monitor.all().filter((m) => overlapsMonitor(m, rect));
    if (parts.length === 0) {
      throw new Error(
        `Region (${rect.x},${rect.y} ${rect.width}x${rect.height}) is outside all monitors.`,
      );
    }

    const shots: ShotImage[] = [];
    for (const m of parts) {
      const x = Math.max(rect.x, m.x());
      const y = Math.max(rect.y, m.y());
      const x2 = Math.min(rect.x + rect.width, m.x() + m.width());
      const y2 = Math.min(rect.y + rect.height, m.y() + m.height());
      const w = x2 - x;
      const h = y2 - y;
      if (w <= 0 || h <= 0) continue;

      const full = await m.captureImage();
      const cropped = await full.crop(x - m.x(), y - m.y(), w, h);
      shots.push(toShotImage(cropped, `region ${w}x${h} at ${x},${y} (monitor ${m.name()})`, 'region'));
    }
    if (shots.length === 0) throw new Error('Region produced no capturable area.');
    return shots;
  }

  async captureWindow(target: WindowTarget = {}): Promise<ShotImage> {
    const entries = Window.all()
      .map((win) => ({ win, info: toWindowInfo(win) }))
      .filter((e) => e.info.title.length > 0);
    const picked = pickWindow(
      entries.map((e) => e.info),
      target,
    );
    const entry = entries.find((e) => e.info.id === picked.id);
    if (!entry) throw new Error('Window disappeared before capture.');

    const img = await entry.win.captureImage();
    return toShotImage(
      img,
      `window "${entry.info.title}" (${entry.info.appName})`,
      entry.info.appName || entry.info.title || 'window',
    );
  }

  async listWindows(): Promise<WindowInfo[]> {
    return Window.all()
      .map(toWindowInfo)
      .filter((w) => w.title.length > 0);
  }
}
