// types.ts - shared domain types for the screenshot & browser MCP server.

/** A captured image ready to be saved / returned. */
export interface ShotImage {
  /** PNG-encoded pixels. */
  png: Buffer;
  /** Human-readable label for the shot (monitor name, window title, ...). */
  label: string;
  /** File-name base (e.g. "QQ", "screen-CG322K", "region"); timestamp is appended on save. */
  name: string;
  width: number;
  height: number;
}

/** A shot persisted to disk. */
export interface ShotResult {
  path: string;
  base64: string;
  label: string;
  width: number;
  height: number;
}

/** Which monitor(s) to capture. */
export type MonitorMode = 'all' | 'primary';

/** A rectangle in virtual-screen coordinates (physical pixels). */
export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Description of a capturable top-level window. */
export interface WindowInfo {
  /** Platform window id (HWND on Windows, CGWindowID on macOS). */
  id: number;
  title: string;
  appName: string;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
}

/** Description of a display/monitor. */
export interface MonitorInfo {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}
