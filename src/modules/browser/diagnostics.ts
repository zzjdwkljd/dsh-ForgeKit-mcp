import { z } from 'zod';
import type { ToolRegistrar } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';
import * as browser from '../../browser.js';

const ConsoleSchema = z.object({
  sinceSeq: z.number().int().min(0).optional().describe('只返回序号大于该值的条目（配合返回值里的 nextSeq 做增量拉取）'),
  levels: z.array(z.string()).optional().describe('只保留这些级别：log/warn/error/info/debug/uncaughterror/unhandledrejection'),
  search: z.string().optional().describe('子串过滤（不区分大小写，匹配文本与 URL）'),
  limit: z.number().int().min(1).max(1000).optional().describe('最多返回条数，默认 100'),
  newestFirst: z.boolean().optional().describe('true = 最新在前（默认最新在后）'),
});
type ConsoleArgs = z.infer<typeof ConsoleSchema>;

const NetworkSchema = z.object({
  sinceSeq: z.number().int().min(0).optional().describe('只返回序号大于该值的条目'),
  failedOnly: z.boolean().optional().describe('true = 只看失败请求（HTTP>=400 或网络层失败）'),
  method: z.string().optional().describe('按 HTTP 方法过滤（如 GET/POST）'),
  search: z.string().optional().describe('URL 子串过滤（不区分大小写）'),
  limit: z.number().int().min(1).max(1000).optional().describe('最多返回条数，默认 100'),
  newestFirst: z.boolean().optional().describe('true = 最新在前'),
});
type NetworkArgs = z.infer<typeof NetworkSchema>;

export function registerDiagnosticsTools(server: ToolRegistrar): void {
  server.registerTool(
    'browser_console',
    {
      title: '页面 console / 未捕获异常',
      description:
        'Read buffered console messages and uncaught page errors (pageerror / unhandledrejection) captured since the browser context opened. Ring buffer (default 200 entries) lives in memory only. Use sinceSeq+nextSeq for incremental pulls.',
      inputSchema: ConsoleSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async (args: ConsoleArgs) => ok([text(browser.consoleLogs(args))])),
  );

  server.registerTool(
    'browser_network',
    {
      title: '页面网络捕获',
      description:
        'Read buffered network exchanges (method/URL/status/type/duration; failed requests include a head-capped response-body preview). Ring buffer (default 200 entries), memory only. failedOnly=true keeps HTTP>=400 and aborted requests.',
      inputSchema: NetworkSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async (args: NetworkArgs) => ok([text(browser.networkRequests(args))])),
  );
}
