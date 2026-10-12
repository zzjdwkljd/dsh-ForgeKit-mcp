import { z } from 'zod';
import type { ToolRegistrar } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';
import * as browser from '../../browser.js';


export function registerStateTools(server: ToolRegistrar): void {
  server.registerTool(
    'browser_save_state',
    {
      title: '保存登录态',
      description:
        'Save the current login state (cookies + localStorage) to a JSON file. Combined with browser_load_state this moves logins between machines/profiles; with persistent profiles it is an extra backup.',
      inputSchema: z.object({
        path: z.string().optional().describe('保存路径；仅允许 test/login-state/browser_save_state/ 内，默认 state.json'),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    tool(async (args: { path?: string }) => ok([text(await browser.saveState(args.path))])),
  );

  server.registerTool(
    'browser_load_state',
    {
      title: '加载登录态',
      description:
        'Load a previously saved login state into the running browser (cookies and a one-time localStorage merge) and reload the page. Future navigations do not replay stale state.',
      inputSchema: z.object({
        path: z.string().optional().describe('读取 test/login-state/ 内的状态文件；默认 browser_save_state/state.json，兼容旧 state.json'),
      }),
      annotations: { openWorldHint: true },
    },
    tool(async (args: { path?: string }) => ok([text(await browser.loadState(args.path))])),
  );
}
