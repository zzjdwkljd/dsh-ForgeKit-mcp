# ForgeKit MCP 模块开发指南

## 设计目标

新增一种能力时，增加一个功能模块并接入模块清单；不向启动入口继续堆叠工具定义。当前内置 `screenshot`、`browser` 和 `shell`，现有 29 个工具的名称、参数、描述与注解保持兼容。

这是一套编译期显式注册的模块架构，不是动态加载任意第三方代码的插件市场。暂不增加依赖注入框架、自动扫描目录或插件安装器。

## 各层职责

| 层 | 路径 | 职责 |
| --- | --- | --- |
| 进程与传输 | `src/index.ts` | stdio、启动日志、信号和 stdin 关闭处理 |
| 服务器工厂 | `src/server.ts` | 组合模块、创建 MCP server、统一关闭资源 |
| 项目标识 | `src/metadata.ts` | 从 `package.json` 读取名称、展示名和版本 |
| 公共契约 | `src/core/module.ts` | `ToolModule`、`ToolRegistrar`、模块校验与回收 |
| 公共结果 | `src/core/results.ts` | 文本、图片、成功结果及异常转换 |
| 功能模块 | `src/modules/<feature>/` | 工具 schema、注册、参数转换与模块生命周期 |
| 业务实现 | 当前 `src/browser.ts`、`src/screenshot/` 等 | 不依赖具体传输的业务能力 |
| 模块清单 | `src/modules/index.ts` | 唯一默认模块装配点 |

已有浏览器工具按会话、导航、交互、内容、登录态分组。添加属于现有分组的工具时修改相应小文件；增加新领域时创建新模块。业务逻辑复杂后可在模块旁增加 `service.ts` 等实现文件，避免把业务实现塞进注册函数。

## 示例：增加一个无副作用的 `system_ping` 工具

### 1. 创建模块

新建 `src/modules/system/index.ts`：

```ts
import { z } from 'zod';
import type { ToolModule } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';

const PingSchema = z.object({
  message: z.string().default('pong').describe('要返回的消息'),
});
type PingArgs = z.infer<typeof PingSchema>;

export const systemModule: ToolModule = {
  id: 'system',
  description: 'System utility tools.',
  register(server) {
    server.registerTool(
      'system_ping',
      {
        title: '连通性检查',
        description: 'Return a message without touching the local system.',
        inputSchema: PingSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      tool(async (args: PingArgs) => ok([text({ message: args.message })])),
    );
  },
};
```

这段示例只出现在文档中，默认服务器没有增加 `system_ping`，工具总数仍为 25。

### 2. 接入默认清单

在 `src/modules/index.ts` 中增加导入和数组项：

```ts
import { systemModule } from './system/index.js';

export const builtinModules: readonly ToolModule[] = Object.freeze([
  screenshotModule,
  browserModule,
  systemModule,
]);
```

无需修改 `src/index.ts` 或 `src/server.ts`。

### 3. 补测试并更新版本

1. 为新增工具补正常输入、非法输入和异常路径测试（`demo_code/*.test.mjs`，本地脚本，不随仓库发布）。
2. 运行 `npm run typecheck`；本地如有 `demo_code/`，再运行其中的测试。
3. 工具清单变化会使契约对比测试失败，这是有意的保护，而不是应当删除的断言。
4. 用契约生成脚本重新生成 `test/contracts/tools.v1.json`（派生产物，禁止手工编辑），并审查差异，避免意外接受旧工具参数变更。
5. 按 SemVer 更新版本与 `CHANGELOG.md`。增加兼容的新工具通常使用 `npm version minor --no-git-tag-version`。

`tools.v1.json` 中的 `v1` 表示第一代基线文件；在 1.x 兼容扩展时更新同一文件，不为每个 PATCH/MINOR 复制一份快照。该文件由契约生成脚本从真实注册结果生成，请勿手工编辑。

## 生命周期与资源

- `register()` 必须同步完成，且只注册 schema 和 handler，不启动浏览器、打开文件监听或建立网络连接。
- 资源应在工具真正执行时懒创建，并由模块的可选 `dispose()` 释放。
- 服务器的 `close()` 是幂等的：重复调用共享同一个 Promise，资源只释放一次。
- 模块按注册顺序的逆序释放。一个模块释放失败不会跳过其他模块，最终以聚合错误报告。
- 嵌入其他宿主时必须在 `finally` 中调用 runtime 的 `close()`，不能只关闭底层 `server` 或客户端 transport。
- CLI 处理 SIGINT、SIGTERM 和 stdin EOF；协议 stdout 不得混入日志，调试信息写 stderr。

```ts
const runtime = createServer({ modules: [screenshotModule, myModule] });
try {
  await runtime.server.connect(myTransport);
  // 宿主负责等待业务生命周期结束。
} finally {
  await runtime.close();
}
```

`createServer({ modules })` 支持替换清单；若要追加，请传入 `[...builtinModules, myModule]`。这使测试和宿主组合不必依赖固定入口。

**当前边界：**原有 `src/browser.ts` 仍采用进程级单例。模块化工厂解决组合、注册和可测试性，不等于浏览器多租户隔离；需要多个独立真实浏览器会话时，应先采用独立服务进程，或另行设计实例化的浏览器服务。本次没有重写已工作的业务后端。

## 命名与兼容规则

- 模块 ID：小写字母开头，其后为小写字母、数字或连字符，例如 `file-system`。
- 新工具名：使用稳定的领域前缀，例如 `filesystem_read`、`system_info`；不要把发行版本写进工具名。
- 模块 ID 和工具名必须全局唯一。重复模块会在注册前拒绝，重复工具由 MCP SDK 拒绝。
- 参数类型从 Zod 推导，不新增 `any`；显式描述默认值与边界。
- 使用 `tool()` 把抛出的异常转为 `{ isError: true, content: [...] }`。`ok()`、`text()`、`pngImage()` 保持现有 MCP 内容块形状。
- 注解必须如实反映读写、幂等和外部访问；注解不替代权限控制。
- 文件、网络、进程等新能力应有明确作用域和输入校验，不以“可扩展”为由开放任意代码执行。

## 测试与发布边界

- `npm run typecheck`：类型检查，不产出文件。`npm run build` 编译到 `dist/`。
- 测试与验证脚本位于 `demo_code/`，**不随仓库版本控制**（`.gitignore` 已排除）：它们只 import `dist/`，与 `src/` 单向解耦，因此仓库不含它们也不影响构建、启动或发布；本地需要跑测试或重新生成契约时须自行提供该目录。`src/`、正式启动、构建和发布产物不依赖它们；删除后正式服务仍可构建、启动并调用工具。
- 契约数据放在 `test/contracts/`；不要把日志或基线 JSON 放进 `docs/`。
- npm 发布文件通过 `package.json.files` 白名单控制。发布前运行 `npm pack --dry-run --ignore-scripts`，确认未包含 `test/login-state/`、截图、环境文件或日志。
- 新增依赖按实际使用引入。
