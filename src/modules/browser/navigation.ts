import { z } from 'zod';
import type { ToolRegistrar } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';
import * as browser from '../../browser.js';
import type { HistoryAction } from '../../browser.js';

const NavigateSchema = z.object({
  url: z.string().describe('目标 URL，例如 https://example.com 或 example.com'),
  waitUntil: z
    .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
    .default('load')
    .describe('导航完成条件'),
});
type NavigateArgs = z.infer<typeof NavigateSchema>;

const TabsSchema = z.object({
  action: z.enum(['list', 'new', 'close']).describe('list=列出; new=新建(可用 url 打开); close=关闭当前'),
  url: z.string().optional().describe('action=new 时打开的 URL'),
});
type TabsArgs = z.infer<typeof TabsSchema>;

export function registerNavigationTools(server: ToolRegistrar): void {
  server.registerTool(
    'browser_navigate',
    {
      title: '导航到 URL',
      description: 'Navigate the active tab to a URL. https:// is added automatically when the scheme is omitted.',
      inputSchema: NavigateSchema,
      annotations: { openWorldHint: true },
    },
    tool(async (args: NavigateArgs) => ok([text(await browser.navigate(args.url, args.waitUntil))])),
  );

  server.registerTool(
    'browser_history',
    {
      title: '历史前进/后退/刷新',
      description: 'Navigate back, forward, or reload the current page.',
      inputSchema: z.object({
        action: z.enum(['back', 'forward', 'reload']).describe('导航动作'),
      }),
      annotations: { openWorldHint: true },
    },
    tool(async (args: { action: HistoryAction }) => ok([text(await browser.goHistory(args.action))])),
  );

  server.registerTool(
    'browser_tabs',
    {
      title: '标签页管理',
      description: 'List, open, or close browser tabs.',
      inputSchema: TabsSchema,
      annotations: { openWorldHint: true },
    },
    tool(async (args: TabsArgs) => ok([text(await browser.tabs(args.action, args.url))])),
  );
}
