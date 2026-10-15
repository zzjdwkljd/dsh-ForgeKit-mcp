# Changelog

遵循语义化版本：兼容修复升 PATCH，兼容功能扩展升 MINOR，不兼容工具契约变化升 MAJOR。

## [Unreleased]

### Changed

- `demo_code/` 退出仓库版本控制（`.gitignore` 重新排除，`package.json` 删除 `test` / `test:retention` / `contract:update` 三个指向它的 script）。这些脚本只 import `dist/`，与 `src/` 单向解耦，删除后构建、启动和发布均不受影响（已实测：移走该目录后 `npm run build` 通过，服务器经 MCP 协议往返仍注册全部 29 个工具）。这是对 1.1.0 把 `demo_code/` 纳入版本控制之决定的回退——那会让干净克隆依赖一份与发布服务无关的本地脚本。`test/contracts/tools.v1.json` 仍在仓库中，作为 29 工具的声明基线；重新生成它需本地自备该目录。

## [1.2.0] - 2026-10-15

### Added

- **页面诊断**（`browser_console` / `browser_network`，`src/browser/diagnostics.ts`）：从共享浏览器上下文捕获 console 输出、未捕获异常（weberror）与网络交换（方法/URL/状态/资源类型/耗时），失败请求带响应体预览（≤300 字符）。环形缓冲只在内存（console 默认 200 条、network 默认 200 条，`MCP_DIAG_*_LIMIT` 可调），不落盘，上下文关闭即清空。条目带自增 `seq`，配合返回值 `nextSeq` 做增量拉取。
- **file: 导航**：`browser_navigate` 白名单放开 `file:`（本地测试页面、已保存快照）；`data:` / `blob:` / `chrome:` / `javascript:` 仍然拒绝，且拒绝信息改为给出等价替代（如用 `browser_evaluate`）。
- **条件等待**：`browser_wait` 新增 `script` 模式——轮询执行 JS 表达式直到返回 truthy，返回 `{satisfied, value, elapsedMs, polls}`；表达式抛错按该轮 falsy 处理（不中断等待）。与 `selector` 互斥。
- **确定性时间控制**（`browser_clock`，`src/browser/clock.ts`）：mock 页面的 `Date` / `setTimeout` / `setInterval` / `performance.now`，手动快进假时间按 (时间, 插入序) 顺序触发到期定时器，返回本次触发的定时器数。`install` 经 init script 跨导航存活；`uninstall` 恢复真实时间。
- **PowerShell 持久会话**（`shell` 工具，`src/modules/shell/`，初版名为 `pwsh`）：命名会话（默认 `main`）跨调用保留变量/工作目录/函数；子进程 prologue 强制 UTF-8（zh-CN Windows 控制台默认 GBK 会乱码中文输出）；输出截尾 200k 字符；`$LASTEXITCODE` 逐命令返回；超时不杀会话。会话是活进程，随 MCP 服务器退出，不落 `test/`。
- **PowerShell 后端移除，shell 工具只保留 Git Bash**（2026-10-15 用户决定）：Windows PowerShell 5.1 管道输出的代码页怪癖无法从外部修复（实测 prologue 设置 `[Console]::OutputEncoding=UTF8` 后子进程仍写 GBK 字节），且运行本工具的机器（node/npm/git）必然有 Git Bash。`shell` 工具为持久 bash 会话：bash 经 git on PATH 推导安装根（`D:\Git` 这类非标准路径也能找到）+ 标准布局 + `MCP_SHELL_BASH` 覆盖；MSYS2 UTF-8 原生，无需编码 prologue（仅固定 `LANG/LC_ALL=C.UTF-8`）。
- `shell` 修复超时竞态：超时命令仍在运行时，其迟到输出与结束标记会污染下一条命令（实测 `still-alive` 结果混入上一条的 `late` 与标记行）。现记录 stale marker，下一条命令执行前先吞掉上一条的残留输出直到其标记出现（上限 60s）。
- `shell` 修复 spawn 失败崩溃：子进程 `error` 事件（ENOENT 等）此前未处理会打崩进程，现在转为会话关闭 + 可读错误返回。
- 环境变量 `MCP_PWSH_TIMEOUT_MS` 更名 `MCP_SHELL_TIMEOUT_MS`。
- 端到端验证脚本 `demo_code/e2e-shell.mjs`（会话持久化/UTF-8/退出码/退出后重建/超时存活）。
- 环境变量 `MCP_DIAG_CONSOLE_LIMIT` / `MCP_DIAG_NETWORK_LIMIT`（默认 200/200）。
- 端到端验证脚本 `demo_code/e2e-diagnostics.mjs`、`demo_code/e2e-clock.mjs`（本地 fixture 页面，不依赖外网）。

### Changed

- 工具契约从 25 升到 29 个工具（`npm run contract:update` 重新生成 `test/contracts/tools.v1.json`）。
- 架构测试的清单/只读断言同步新增模块与工具。

## [1.1.0] - 2026-10-14

### Added

- 测试护栏（`demo_code/*.test.mjs`，`npm test`）：契约一致性、副作用注解、模块注册与资源回收，以及 `headers` / `data-paths` / `retention` / `humanize` 纯函数回归，共 50 项断言。此前仓库没有任何可运行的自动化测试。
- `npm run contract:update`（`demo_code/update-tool-contract.mjs`）：`test/contracts/tools.v1.json` 改为从真实注册结果（经 MCP 协议往返）生成，是派生产物，不再手工维护。
- 截图保留期自动清理（`src/screenshot/retention.ts`）：默认删除 3 天前的自动生成截图，修复此前 README 承诺但代码未实现的行为。
- 新增环境变量 `MCP_SCREENSHOT_RETENTION_DAYS`（默认 `3`，`0` 关闭）与 `MCP_SCREENSHOT_RETENTION_INTERVAL_HOURS`（默认 `6`，`0` 表示仅首次截图时扫一次）。
- 截图保留期的隔离夹具验证与真实 stdio 端到端验证（`demo_code/retention-verify.mjs`、`demo_code/retention-e2e.mjs`）。
- 文档 `docs/screenshot-retention-faq.md` 记录清理范围、可证明归属的判定与验证方式。
- 文档 `docs/dsh-install.md` 说明在 DeepSeek Harness 中通过 profile patch 层注册本服务器的完整步骤与排错要点。
- 发布白名单补充 `docs/dsh-install.md` 与 `docs/screenshot-retention-faq.md`（此前 README 正文链接它们，但发布包内缺失，形成死链）。

### Changed

- **页面操作全部串行化**（`src/browser.ts`）：`serialized()` 改为可重入锁（`AsyncLocalStorage`），并覆盖全部页面操作与登录态工具。浏览器后端是进程级单例，此前并发 MCP 工具调用会在共享的 `state.page` 上交错，导致 "Target closed" 或操作落到错误页面；可重入保证嵌套调用（`navigate` → `ensurePage` → `launchBrowser`）不会自锁。
- `browser_navigate` 默认只允许 `http` / `https` / `about` 协议；`file:` / `data:` / `chrome:` 被拒绝（此前可读取本地文件或访问内网/元数据端点）。
- `executablePath` 限定为 Chromium 系浏览器可执行文件（Chrome / Edge / Chromium）；`MCP_BROWSER_EXECUTABLE` 环境变量作为运维配置不受限制。
- `Cookie` 请求头由"接受并提示"改为**拒绝**：`setExtraHTTPHeaders` 作用于所有域，手工设置会把同一凭据发给每个站点。导入登录态请用 `browser_load_state`。
- `browser_evaluate` 增加执行超时与 50k 输出上限，避免恶意页面永久挂起调用或撑大响应。
- 工具错误信息展开 `AggregateError` 的子原因（此前只显示聚合串，例如"两种启动模式都失败"看不到各自原因）。
- 版本由 `1.0.0` 升为 `1.1.0`；`package.json` 增加 `pretest` / `test` / `test:retention` / `contract:update` 脚本。
- 截图模块 `dispose()` 停止保留期定时器；定时器在首次截图时惰性创建，`register()` 仍无副作用。
- `README.md` 截图保留期描述由 7 天更正为 3 天，并补全清理边界与环境变量。
- `demo_code/` 改为随仓库版本控制（`npm test` 依赖它），仍不进入 npm 发布包。

### Fixed

- 4 个**会写盘**的截图工具（`screenshot_screen`、`screenshot_region`、`screenshot_window`、`browser_screenshot`）此前误标 `readOnlyHint: true`，现改为 `false`，契约同步更新。`list_windows` 主路径纯只读，其 `readOnlyHint: true` 保持不变。
- 过期截图此前只累积不清理，整屏 PNG 长期占用磁盘；现在只清理能证明归属的文件。
- 删除 `src/browser.ts` 未使用的 `resolveDataPath` 导入；移除 `src/modules/browser/navigation.ts` 中冗余的 `as WaitUntil` / `as TabAction` 断言（zod 输出的枚举已与类型兼容，断言会静默屏蔽未来的类型分叉）。

### Known issues

- 本机（D: 盘）无法运行 `typescript@7` 的原生编译器 `tsgo`：其二进制加载 `bcrypt.dll` 返回 `winapi error #5`（ACCESS_DENIED）。`npm run typecheck` / `npm run build` 因此在本机不可执行；这是机器级策略问题，与仓库代码无关——把同一二进制放到 C: 盘可正常运行，类型检查 0 错误。

## [1.0.0] - 2026-09-26

### Changed

- 项目命名为 **ForgeKit MCP**，包名与 MCP 服务名统一为 `forgekit-mcp`。
- 旧 `2.0.0` 尚未发布，经确认重置为首个模块化基线 `1.0.0`；本记录不表示已向 npm 发布。
- 服务器标识从 `package.json` 统一读取，避免握手、日志和包版本分散维护。
- 将入口中的工具注册拆分为截图模块和浏览器模块；浏览器工具按会话、导航、交互、内容、登录态组织。
- 保留现有 25 个工具的名称、schema、描述、注解和业务行为；工具清单的展示顺序随分组调整。

### Added

- `ToolModule` / `ToolRegistrar` 扩展契约、显式模块清单和可组合服务器工厂。
- 幂等关闭、逆序资源回收、单个清理失败不阻断其他模块，以及 stdin EOF 退出处理。
- 现有工具完整声明快照、自定义模块组合及 stdio 回归测试。
- `npm run typecheck`、显式契约更新命令和模块开发指南。
- `forgekit-mcp` CLI 映射、npm 发布白名单与运行数据忽略规则，避免把登录态、截图或日志打入发布包。
