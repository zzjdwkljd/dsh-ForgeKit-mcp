import { z } from 'zod';
import type { ToolRegistrar } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';
import * as browser from '../../browser.js';

const HeadersSchema = z.object({
  action: z.enum(['get', 'set', 'clear']).describe('get=查看当前请求头策略; set=设置自定义头; clear=清空自定义头(回到浏览器原生)'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('action=set 时的自定义请求头(键值对)，整体替换旧的自定义层'),
  userAgent: z
    .string()
    .optional()
    .describe('action=set 时可同时设置 User-Agent；尽力派生 Client Hints，不保证完整浏览器身份一致'),
});
type HeadersArgs = z.infer<typeof HeadersSchema>;

export function registerSessionTools(server: ToolRegistrar): void {
  server.registerTool(
    'browser_launch',
    {
      title: '启动浏览器',
      description:
        'Explicitly launch the browser (optional; other browser_* tools launch it lazily). Reuses a running instance unless headless/persistent/stealth mode, executable or profile differs. With persistent=true (default) local browser state is retained in the user profile; website authentication may still expire.',
      inputSchema: z.object({
        headless: z.boolean().optional().describe('无头模式(默认 true); false = 显示可见窗口(如扫码登录)'),
        executablePath: z.string().optional().describe('自定义 Chrome/Edge 路径'),
        persistent: z
          .boolean()
          .optional()
          .describe('持久化用户配置(默认 true)，保留 cookie/登录态/本地存储'),
        userDataDir: z
          .string()
          .optional()
          .describe('持久化 profile；必须在 test/login-state/ 内，默认 browser-profile；切换目录会重启浏览器'),
        stealth: z
          .boolean()
          .optional()
          .describe('兼容启动选项(默认 true)；不伪造页面 API，也不保证免验证'),
        humanize: z
          .boolean()
          .optional()
          .describe('拟人化模式(默认 true)：随机打字间隔、操作前停顿、点击抖动'),
        typingDelayMinMs: z.number().int().min(0).max(5000).optional().describe('打字间隔下限(毫秒, 默认 40)'),
        typingDelayMaxMs: z.number().int().min(0).max(5000).optional().describe('打字间隔上限(毫秒, 默认 120)'),
        actionDelayMinMs: z.number().int().min(0).max(10000).optional().describe('操作前停顿下限(毫秒, 默认 150)'),
        actionDelayMaxMs: z.number().int().min(0).max(10000).optional().describe('操作前停顿上限(毫秒, 默认 600)'),
        userAgent: z
          .string()
          .optional()
          .describe('自定义 User-Agent；尽力派生 Client Hints，并非完整浏览器身份模拟'),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe('自定义请求头(键值对)，按 custom > derived > 浏览器原生 的优先级合并；留空则用浏览器原生默认头'),
      }),
      annotations: { openWorldHint: true },
    },
    tool(async (args: browser.LaunchOptions) => ok([text(await browser.launchBrowser(args))])),
  );

  server.registerTool(
    'browser_close',
    {
      title: '关闭浏览器',
      description: 'Close the browser instance opened by this server.',
      inputSchema: z.object({}),
      annotations: { openWorldHint: true },
    },
    tool(async () => ok([text(await browser.closeBrowser())])),
  );

  server.registerTool(
    'browser_info',
    {
      title: '获取浏览器状态',
      description: 'Get current browser/page state: URL, title, viewport, headless mode, executable path.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async () => ok([text(await browser.browserInfo())])),
  );

  server.registerTool(
    'browser_humanize',
    {
      title: '拟人化设置',
      description:
        'View or update humanization settings at runtime without restarting the browser. Omit all fields to just read the current config. Humanization adds random typing delays, pauses before actions, click-position jitter and incremental scrolling; it is pacing, not proof of human interaction.',
      inputSchema: z.object({
        humanize: z.boolean().optional().describe('开启/关闭拟人化'),
        typingDelayMinMs: z.number().int().min(0).max(5000).optional().describe('打字间隔下限(毫秒)'),
        typingDelayMaxMs: z.number().int().min(0).max(5000).optional().describe('打字间隔上限(毫秒)'),
        actionDelayMinMs: z.number().int().min(0).max(10000).optional().describe('操作前停顿下限(毫秒)'),
        actionDelayMaxMs: z.number().int().min(0).max(10000).optional().describe('操作前停顿上限(毫秒)'),
      }),
      annotations: { openWorldHint: false },
    },
    tool(async (args: browser.HumanizeUpdate) => ok([text(browser.updateHumanize(args))])),
  );

  server.registerTool(
    'browser_headers',
    {
      title: '请求头管理',
      description:
        'Manage request headers in three layers: browser-native defaults (fallback) < derived consistency headers (sec-ch-ua family, generated from a custom User-Agent) < custom headers. get shows every effective header with its source; set validates then replaces the custom layer (aborts on any invalid entry); clear reverts to native headers.',
      inputSchema: HeadersSchema,
      annotations: { openWorldHint: true },
    },
    tool(async (args: HeadersArgs) => {
      if (args.action === 'get') return ok([text(browser.headerPolicyResult())]);
      if (args.action === 'clear') return ok([text(await browser.clearHeaders())]);
      if (args.headers === undefined && args.userAgent === undefined) {
        throw new Error('action=set 需要提供 headers 或 userAgent 之一。');
      }
      return ok([text(await browser.setHeaders(args.headers ?? {}, { userAgent: args.userAgent }))]);
    }),
  );
}
