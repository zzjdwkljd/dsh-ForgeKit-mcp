import { z } from 'zod';
import type { ToolRegistrar } from '../../core/module.js';
import { ok, pngImage, text, tool } from '../../core/results.js';
import * as browser from '../../browser.js';


export function registerContentTools(server: ToolRegistrar): void {
  server.registerTool(
    'browser_screenshot',
    {
      title: '网页截图',
      description: 'Take a PNG screenshot of the current page, save it in the screenshot/browser_screenshot data partition under test/, and return the image and saved path.',
      inputSchema: z.object({
        fullPage: z.boolean().default(false).describe('true = 整页; false = 仅当前视口'),
      }),
      // Writes a PNG into test/screenshot/browser_screenshot, so it is not read-only.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    tool(async (args: { fullPage: boolean }) => {
      const shot = await browser.screenshotPageWithPath({ fullPage: args.fullPage });
      return ok([
        text(`Page screenshot (${args.fullPage ? 'full page' : 'viewport'}) saved to ${shot.path}`),
        pngImage(shot.base64),
      ]);
    }),
  );

  server.registerTool(
    'browser_evaluate',
    {
      title: '执行页面脚本',
      description: 'Run a JavaScript expression in the page context and return its JSON-serializable result.',
      inputSchema: z.object({
        script: z.string().describe('页面内执行的 JS 表达式，如 document.title'),
      }),
      annotations: { openWorldHint: true },
    },
    tool(async (args: { script: string }) => ok([text(await browser.evaluate(args.script))])),
  );

  server.registerTool(
    'browser_get_text',
    {
      title: '提取页面文本',
      description:
        'Get the visible innerText of an element (default: body), truncated to 50k chars. With autoScroll=true the page is scrolled to the bottom first to trigger lazy-loading.',
      inputSchema: z.object({
        selector: z.string().optional().describe('Playwright 选择器; 默认 body'),
        autoScroll: z.boolean().default(false).describe('提取前自动滚动到底，触发懒加载内容'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async (args: { selector?: string; autoScroll: boolean }) =>
      ok([text(await browser.getText(args.selector ?? 'body', { autoScroll: args.autoScroll }))]),
    ),
  );

  server.registerTool(
    'browser_get_html',
    {
      title: '提取页面 HTML',
      description:
        'Get the outerHTML of an element, or the whole document when omitted. Truncated to 50k chars. With autoScroll=true the page is scrolled to the bottom first to trigger lazy-loading.',
      inputSchema: z.object({
        selector: z.string().optional().describe('留空返回整个文档'),
        autoScroll: z.boolean().default(false).describe('提取前自动滚动到底，触发懒加载内容'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async (args: { selector?: string; autoScroll: boolean }) =>
      ok([text(await browser.getHtml(args.selector, { autoScroll: args.autoScroll }))]),
    ),
  );
}
