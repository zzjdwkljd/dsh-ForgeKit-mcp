import { z } from 'zod';
import type { ToolRegistrar } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';
import * as browser from '../../browser.js';
import type { ClickOptions, SelectOptions, ScrollOptions, TypeOptions, WaitOptions } from '../../browser.js';

const ClickSchema = z.object({
  selector: z.string().describe('Playwright 选择器：CSS / text=登录 / xpath=//button / role=button[name="OK"]'),
  button: z.enum(['left', 'right', 'middle']).default('left').describe('鼠标按键'),
  clickCount: z.number().int().min(1).max(3).default(1).describe('点击次数(2=双击)'),
  timeoutMs: z.number().int().positive().optional().describe('超时(毫秒)'),
});
type ClickArgs = z.infer<typeof ClickSchema>;

const TypeSchema = z.object({
  selector: z.string().describe('Playwright 选择器'),
  text: z.string().describe('要输入的文本'),
  clear: z.boolean().default(false).describe('true = 清空后填写; false = 逐字输入(append)'),
  submit: z.boolean().default(false).describe('输入后按 Enter'),
  delay: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('固定打字间隔(毫秒); 设置后覆盖拟人化随机间隔，0 = 机器速度'),
  timeoutMs: z.number().int().positive().optional(),
});
type TypeArgs = z.infer<typeof TypeSchema>;

const SelectSchema = z.object({
  selector: z.string().describe('<select> 元素选择器'),
  value: z.string().optional().describe('option 的 value'),
  label: z.string().optional().describe('option 的显示文本'),
  index: z.number().int().min(0).optional().describe('option 序号(从 0 开始)'),
  timeoutMs: z.number().int().positive().optional(),
});
type SelectArgs = z.infer<typeof SelectSchema>;

const ScrollSchema = z.object({
  selector: z.string().optional().describe('要滚动的元素; 留空滚动整个窗口'),
  deltaX: z.number().int().default(0).describe('水平滚动量'),
  deltaY: z.number().int().default(600).describe('垂直滚动量(正数向下)'),
  timeoutMs: z.number().int().positive().optional(),
});
type ScrollArgs = z.infer<typeof ScrollSchema>;

const WaitSchema = z.object({
  selector: z.string().optional().describe('要等待的选择器; 留空按时间等待'),
  state: z
    .enum(['attached', 'detached', 'visible', 'hidden'])
    .default('visible')
    .describe('选择器目标状态'),
  timeoutMs: z.number().int().positive().optional().describe('选择器等待超时(毫秒)'),
  sleepMs: z.number().int().min(0).max(60000).optional().describe('无选择器时的睡眠(毫秒, 默认 1000)'),
});
type WaitArgs = z.infer<typeof WaitSchema>;

export function registerInteractionTools(server: ToolRegistrar): void {
  server.registerTool(
    'browser_click',
    {
      title: '点击元素',
      description: 'Click an element located by a Playwright selector.',
      inputSchema: ClickSchema,
      annotations: { openWorldHint: true },
    },
    tool(async (args: ClickArgs) => {
      const opts: ClickOptions = {
        button: args.button,
        clickCount: args.clickCount,
        timeoutMs: args.timeoutMs,
      };
      return ok([text(await browser.click(args.selector, opts))]);
    }),
  );

  server.registerTool(
    'browser_type',
    {
      title: '输入文本',
      description: 'Type text into an input/textarea/contenteditable element.',
      inputSchema: TypeSchema,
      annotations: { openWorldHint: true },
    },
    tool(async (args: TypeArgs) => {
      const opts: TypeOptions = {
        clear: args.clear,
        submit: args.submit,
        delay: args.delay,
        timeoutMs: args.timeoutMs,
      };
      return ok([text(await browser.typeText(args.selector, args.text, opts))]);
    }),
  );

  server.registerTool(
    'browser_press',
    {
      title: '按键',
      description: 'Press a keyboard key (Enter, Tab, Escape, Control+A...). Optionally focus a selector first.',
      inputSchema: z.object({
        key: z.string().describe('按键名'),
        selector: z.string().optional().describe('先聚焦该元素再按键'),
      }),
      annotations: { openWorldHint: true },
    },
    tool(async (args: { key: string; selector?: string }) =>
      ok([text(await browser.pressKey(args.key, args.selector))]),
    ),
  );

  server.registerTool(
    'browser_select',
    {
      title: '下拉框选择',
      description: 'Select an option in a <select> element. Provide exactly one of value / label / index.',
      inputSchema: SelectSchema,
      annotations: { openWorldHint: true },
    },
    tool(async (args: SelectArgs) => {
      const provided = (['value', 'label', 'index'] as const).filter((k) => args[k] !== undefined);
      if (provided.length !== 1) {
        throw new Error(`Provide exactly one of value / label / index (got: ${provided.join(', ') || 'none'}).`);
      }
      const opts: SelectOptions = {
        value: args.value,
        label: args.label,
        index: args.index,
        timeoutMs: args.timeoutMs,
      };
      return ok([text(await browser.selectOption(args.selector, opts))]);
    }),
  );

  server.registerTool(
    'browser_scroll',
    {
      title: '滚动页面',
      description: 'Scroll the window or a specific element.',
      inputSchema: ScrollSchema,
      annotations: { openWorldHint: true },
    },
    tool(async (args: ScrollArgs) => {
      const opts: ScrollOptions = {
        selector: args.selector,
        deltaX: args.deltaX,
        deltaY: args.deltaY,
        timeoutMs: args.timeoutMs,
      };
      return ok([text(await browser.scroll(opts))]);
    }),
  );

  server.registerTool(
    'browser_wait',
    {
      title: '等待',
      description: 'Wait for a selector to reach a state, or sleep for a number of milliseconds.',
      inputSchema: WaitSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async (args: WaitArgs) => {
      const opts: WaitOptions = {
        selector: args.selector,
        state: args.state,
        timeoutMs: args.timeoutMs,
        sleepMs: args.sleepMs,
      };
      return ok([text(await browser.wait(opts))]);
    }),
  );

  server.registerTool(
    'browser_scroll_all',
    {
      title: '滚动到底（触发懒加载）',
      description:
        'Auto-scroll to the page bottom in smooth steps until the height stops growing, triggering lazy-loading content (infinite scroll, lazy images). Then use browser_get_text / browser_get_html / browser_screenshot to collect the fully loaded content.',
      inputSchema: z.object({
        maxScrolls: z.number().int().min(1).max(200).default(30).describe('最多滚动次数（防止死循环）'),
        delayMs: z.number().int().min(0).max(5000).optional().describe('每次滚动间隔(毫秒)；不传用拟人化随机间隔'),
        stepPx: z.number().int().min(50).max(2000).default(600).describe('每次滚动的像素'),
      }),
      annotations: { openWorldHint: false },
    },
    tool(async (args: { maxScrolls: number; delayMs?: number; stepPx: number }) =>
      ok([text(await browser.scrollAll({ maxScrolls: args.maxScrolls, delayMs: args.delayMs, stepPx: args.stepPx }))]),
    ),
  );
}
