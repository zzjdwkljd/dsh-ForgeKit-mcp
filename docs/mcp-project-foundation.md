# ForgeKit MCP 项目基线

## 定位

- 展示名：**ForgeKit MCP**。
- 包名及 MCP server name：`forgekit-mcp`。
- 中文定位：**可扩展的本地 MCP 工具集**。
- 含义：Forge 表示锻造能力，Kit 表示组合式工具集；品牌不限定在截图或浏览器，后续功能以独立模块接入。

命名时 npm 注册表对该包名返回 404；这不代表包名已预留，也不构成商标或全网唯一性保证。

## 版本决策

**1.0.0** 是首个模块化基线：现有功能加模块化架构。

| 变化 | 版本规则 | 示例 |
| --- | --- | --- |
| 兼容性修复、内部改进 | PATCH | `1.0.1` |
| 向后兼容的新模块、新工具或可选参数 | MINOR | `1.1.0` |
| 移除/重命名工具、不兼容参数或返回语义变化 | MAJOR | `2.0.0` |

`package.json` 为标识和版本的单一来源；`src/metadata.ts` 在运行时读取它，服务器握手与启动日志不再各自写死版本。`package-lock.json` 的根包信息同步更新。后续可使用 `npm version <patch|minor|major> --no-git-tag-version` 同步元数据，再更新 `CHANGELOG.md`。

## 架构方案

1. **薄入口**：`src/index.ts` 只负责 stdio 和进程生命周期。
2. **独立服务器工厂**：`src/server.ts` 暴露 `createServer({ modules })`，不在导入时启动协议或安装进程信号处理器。
3. **模块契约**：`src/core/module.ts` 定义注册与可选资源回收接口，预检模块 ID，统一执行清理。
4. **公共结果封装**：`src/core/results.ts` 保留文本、PNG、成功及异常结果形状。
5. **按域组织工具**：`src/modules/screenshot/` 和 `src/modules/browser/`；浏览器进一步按会话、导航、交互、内容、登录态分组。
6. **显式模块清单**：`src/modules/index.ts` 为默认装配点。新增功能通常只需新模块、清单项和测试，不修改启动入口。
7. **可审查的兼容性测试**：`test/contracts/tools.v1.json` 保存工具完整声明；测试按工具名排序对比完整声明，注册分组引起的列表顺序变化不视为协议破坏。
8. **发布数据隔离**：npm 文件白名单与 `.gitignore` 排除登录态、截图、日志、依赖和生成目录。

`src/browser.ts`、`src/headers.ts` 与 `src/screenshot/` 是业务后端实现，不依赖具体传输层。

## 兼容与已知边界

- 29 个工具：截图/窗口 4 个，浏览器 24 个，Git Bash 会话 1 个。保留工具名称、参数 schema、描述、注解及 handler 业务逻辑。
- 浏览器后端是进程级单例，不宣称多个工厂实例间已实现浏览器会话隔离；需要多个独立真实浏览器会话时，应先采用独立服务进程。
- 完整桌面功能回归需在合适环境另行运行端到端测试。

## 验证记录

验证环境：Windows，Node.js `v22.22.2`、npm `10.9.7`。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 本机因 tsgo 环境问题不可执行（见下方排错）；在 C: 盘用同一编译器运行项目 tsconfig 通过，0 错误 |
| `npm run build` | 同上，C: 盘执行通过，产出 `dist/` |
| `npm test` | 50 项断言全部通过（契约一致性、副作用注解、模块回收、headers/data-paths/retention/humanize 纯函数） |
| 契约一致性 | `test/contracts/tools.v1.json` 由 `npm run contract:update` 生成，与注册结果逐字段一致 |
| 真实 stdio 客户端握手 | 返回 `forgekit-mcp` / `ForgeKit MCP` / 当前版本 |
| `npm pack --dry-run --json --ignore-scripts` | 未包含登录态、截图、测试数据、日志或依赖目录；README 链接的两份文档已入白名单 |
| 文档格式 | 使用 LF，无行尾空白 |

### 排错：本机 typecheck 不可执行

`typescript@7` 是 Go 原生编译器（tsgo），其平台二进制 `@typescript/typescript-win32-x64/lib/tsc.exe` 在 **D: 盘**加载 `bcrypt.dll` 时返回 `winapi error #5`（ACCESS_DENIED），进程在 `crypto/internal/backend/fips140.init()` 阶段 panic，`tsc --version` 亦失败。`node_modules/typescript/lib/tsc.js` 只是转发到该二进制，**没有 JS 回退路径**。

- 这是机器级策略/环境问题，不是仓库缺陷：把同一二进制复制到 C: 盘运行，`-p tsconfig.json --noEmit` 退出码 0、覆盖 26 个 `.ts`、无任何诊断。
- 规避方式：在 C: 盘或容器内执行 typecheck/build；或把 `typescript` 固定到 JS 实现的 5.x。

内存传输会保留某些值为 `undefined` 的属性，契约测试按实际 JSON-RPC 的 JSON 形态进行对比，不忽略任何可序列化字段；同时运行真实 stdio 对比，以避免只靠内存测试得出结论。

原始日志和机器可读校验记录保存在 `test/` 下的验证分区，不放入文档目录。

## 后续入口

- 新增功能：`docs/mcp-extending.md`。
- DSH 安装：`docs/dsh-install.md`。
- 版本记录：`CHANGELOG.md`。
- 模块装配：`src/modules/index.ts`。
