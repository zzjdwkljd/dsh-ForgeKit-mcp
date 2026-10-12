# Changelog

遵循语义化版本：兼容修复升 PATCH，兼容功能扩展升 MINOR，不兼容工具契约变化升 MAJOR。

## [Unreleased]

### Added

- 截图保留期自动清理（`src/screenshot/retention.ts`）：默认删除 3 天前的自动生成截图，修复此前 README 承诺但代码未实现的行为。
- 新增环境变量 `MCP_SCREENSHOT_RETENTION_DAYS`（默认 `3`，`0` 关闭）与 `MCP_SCREENSHOT_RETENTION_INTERVAL_HOURS`（默认 `6`，`0` 表示仅首次截图时扫一次）。
- 截图保留期的隔离夹具验证与真实 stdio 端到端验证（本地测试脚本，不随仓库发布）。
- 文档 `docs/screenshot-retention-faq.md` 记录清理范围、可证明归属的判定与验证方式。
- 文档 `docs/dsh-install.md` 说明在 DeepSeek Harness 中通过 profile patch 层注册本服务器的完整步骤与排错要点。

### Changed

- `README.md` 截图保留期描述由 7 天更正为 3 天，并补全清理边界与环境变量。
- 截图模块 `dispose()` 停止保留期定时器；定时器在首次截图时惰性创建，`register()` 仍无副作用。

### Fixed

- 过期截图此前只累积不清理，整屏 PNG 长期占用磁盘；现在只清理能证明归属的文件。

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
