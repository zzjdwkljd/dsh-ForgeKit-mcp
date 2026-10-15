import { z } from 'zod';
import type { ToolModule } from '../../core/module.js';
import { ok, pngImage, text, tool } from '../../core/results.js';
import * as shot from '../../screenshot/index.js';
import { stopScreenshotRetention } from '../../screenshot/retention.js';
import type { MonitorMode, RegionRect } from '../../types.js';

const ScreenSchema = z.object({
  monitor: z
    .enum(['all', 'primary'])
    .default('all')
    .describe('all = 所有显示器(每个显示器一张图); primary = 仅主显示器'),
});
type ScreenArgs = z.infer<typeof ScreenSchema>;

const RegionSchema = z.object({
  x: z.number().int().describe('区域左上角 X（虚拟屏幕坐标，物理像素）'),
  y: z.number().int().describe('区域左上角 Y'),
  width: z.number().int().positive().describe('区域宽度'),
  height: z.number().int().positive().describe('区域高度'),
});
type RegionArgs = z.infer<typeof RegionSchema>;

const WindowSchema = z.object({
  title: z
    .string()
    .optional()
    .describe('窗口标题子串(不区分大小写); 留空且不指定 app/pid 则截取当前聚焦窗口'),
  app: z
    .string()
    .optional()
    .describe('应用/进程名子串(不区分大小写)，如 chrome、QQ、Weixin、Code'),
  pid: z.number().int().positive().optional().describe('精确指定进程 PID'),
});
type WindowArgs = z.infer<typeof WindowSchema>;

export const screenshotModule: ToolModule = {
  id: 'screenshot',
  description: 'Cross-platform screen, region and window capture.',
  register(server) {
    // Retention timer starts lazily on first capture inside requestRetentionSweep()
    // to keep registration itself free of timers and background work.
    server.registerTool(
      'screenshot_screen',
      {
        title: '截取整个屏幕',
        description:
          'Capture screen(s) as PNG image(s). With monitor=all every display is captured and returned as a separate image.',
        inputSchema: ScreenSchema,
        // Writes a PNG into test/ (and may sweep expired screenshots), so it is not read-only.
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      tool(async (args: ScreenArgs) => {
        const mode: MonitorMode = args.monitor;
        const shots = await shot.captureScreens(mode);
        return ok([
          text(shots.map((s) => `Saved: ${s.path} | ${s.label} (${s.width}x${s.height})`).join('\n')),
          ...shots.map((s) => pngImage(s.base64)),
        ]);
      }),
    );

    server.registerTool(
      'screenshot_region',
      {
        title: '截取屏幕区域',
        description:
          'Capture a rectangular region (physical pixels of the virtual screen; negative coords allowed for monitors left/above primary).',
        inputSchema: RegionSchema,
        // Writes a PNG into test/ (and may sweep expired screenshots), so it is not read-only.
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      tool(async (args: RegionArgs) => {
        const rect: RegionRect = args;
        const shots = await shot.captureRegion(rect);
        return ok([
          text(shots.map((s) => `Saved: ${s.path} | ${s.label}`).join('\n')),
          ...shots.map((s) => pngImage(s.base64)),
        ]);
      }),
    );

    server.registerTool(
      'screenshot_window',
      {
        title: '截取窗口/软件',
        description:
          'Capture a specific application window. Locate it by title substring, app name substring and/or pid (AND combined); with no filter the focused window is captured. Use list_windows to discover targets.',
        inputSchema: WindowSchema,
        // Writes a PNG into test/ (and may sweep expired screenshots), so it is not read-only.
        annotations: { readOnlyHint: false, openWorldHint: true },
      },
      tool(async (args: WindowArgs) => {
        const s = await shot.captureWindow({ title: args.title, app: args.app, pid: args.pid });
        return ok([text(`Saved: ${s.path} | ${s.label} (${s.width}x${s.height})`), pngImage(s.base64)]);
      }),
    );

    server.registerTool(
      'list_windows',
      {
        title: '列出可见窗口',
        description:
          'List top-level windows with title, app name, pid, bounds and focus state. Useful to pick a target for screenshot_window.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      tool(async () => ok([text(await shot.listWindows())])),
    );
  },
  dispose() {
    stopScreenshotRetention();
  },
};
