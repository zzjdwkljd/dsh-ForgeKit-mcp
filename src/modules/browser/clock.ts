import { z } from 'zod';
import type { ToolRegistrar } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';
import * as browser from '../../browser.js';

const ClockSchema = z.object({
  action: z
    .enum(['install', 'advance', 'status', 'uninstall'])
    .describe("install=开始 mock 时间(必传 epoch); advance=快进假时间并触发到期定时器(必传 ms); status=查看当前假时间与待触发定时器; uninstall=恢复真实时间"),
  epoch: z
    .string()
    .optional()
    .describe("action=install 必填：假时间起点，ISO 字符串如 '2026-10-15T00:00:00Z'（解析结果按本地时区展示）"),
  ms: z.number().int().min(1).max(3.154e10).optional().describe('action=advance 必填：快进毫秒数（如 60000 = 1 分钟）'),
});
type ClockArgs = z.infer<typeof ClockSchema>;

export function registerClockTools(server: ToolRegistrar): void {
  server.registerTool(
    'browser_clock',
    {
      title: '页面时间控制',
      description:
        'Deterministic time control for the page: mock Date / setTimeout / setInterval / performance.now, then advance fake time manually to fire due timers (tests timeouts, polling loops, countdowns without real waiting). install persists across navigations via init script; uninstall restores real time on the current document.',
      inputSchema: ClockSchema,
      annotations: { openWorldHint: false },
    },
    tool(async (args: ClockArgs) => {
      if (args.action === 'install') {
        if (!args.epoch) throw new Error("action=install 需要提供 epoch（ISO 时间字符串）");
        return ok([text(await browser.clockInstall(args.epoch))]);
      }
      if (args.action === 'advance') {
        if (args.ms === undefined) throw new Error('action=advance 需要提供 ms（快进毫秒数）');
        return ok([text(await browser.clockAdvance(args.ms))]);
      }
      if (args.action === 'uninstall') return ok([text(await browser.clockUninstall())]);
      return ok([text(await browser.clockStatus())]);
    }),
  );
}
