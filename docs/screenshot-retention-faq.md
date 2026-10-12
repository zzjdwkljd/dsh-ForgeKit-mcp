# 截图保留期（自动清理）

## 问题：为什么需要这个功能？

答案：截图是只增不减的磁盘占用来源。一张整屏 PNG 可达约 0.8 MB，长期使用会持续累积。因此本项目对**自动生成的截图**实施保留期清理，默认保留 **3 天**。

清理只针对能证明由本工具生成的文件；任何无法证明归属的文件都不会被删除。

## 问题：清理哪些目录？

答案：只清理四个工具写入分区下的**顶层文件**：

| 分区 | 写入工具 |
| --- | --- |
| `screenshot_screen` | `screenshot_screen` |
| `screenshot_region` | `screenshot_region` |
| `screenshot_window` | `screenshot_window` |
| `browser_screenshot` | `browser_screenshot` |

根目录取自与截图写入完全相同的解析入口：`MCP_SCREENSHOT_DIR`（默认 `test/screenshot`），并经过 `core/data-paths.ts` 的边界校验。

不清理的内容：

- 任何子目录（`validation/`、`baseline-*`、`run-*`），因此历史证据与临时目录安全。
- `test/login-state/`、`test/contracts/`、`test/validation/` 等其他分区。

## 问题：凭什么判断一个文件「可以删」？

答案：必须同时满足三个条件，缺一不可。

1. **命名可证明归属**：文件名完全匹配 `<名称>-YYYYMMDD-HHMMSS[-N].png`，且时间戳能反解成真实日期。`20260230-120000`（2 月 30 日）这类不可能日期、以及晚于当前时间 60 秒以上的未来时间戳都会被拒绝。
2. **内容是 PNG**：文件头必须是 PNG 签名且 IHDR 宽高非零（复用 `src/screenshot/png.ts` 的 `pngSize`）。
3. **是普通文件**：目录、符号链接、硬链接一律跳过。

只按文件名匹配是不够的——手动重命名或复制进来的同格式图片也可能命中，因此再加 PNG 头校验。**年龄取「文件名时间戳」与「mtime」中的较大者**：真实过期截图两者都旧；而一张被复制进来、mtime 很新的图片会被保留。

## 问题：多久扫一次？

答案：

- 每次成功截图后触发一次，带 5 分钟节流与并发合并，不影响截图返回。
- 另有后台定时扫描，间隔由 `MCP_SCREENSHOT_RETENTION_INTERVAL_HOURS` 控制（默认 6 小时）；定时器在首次截图时惰性创建并 `unref()`，不会阻止进程退出。
- `MCP_SCREENSHOT_RETENTION_DAYS=0` 完全关闭；`..._INTERVAL_HOURS=0` 表示只在首次截图时扫一次。

单个文件删除失败（被占用、权限不足）只记入报告并继续，不会中断服务或影响截图结果。所有日志走 stderr，stdout 仍只用于 MCP JSON-RPC。

## 问题：怎么验证的？

答案：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 通过，退出码 0 |
| 构建 | `npm run build` | 通过，退出码 0 |
| 隔离夹具验证 | `node demo_code/retention-verify.mjs` | 通过：删除 3 个、评估 6 个、14 个夹具全部符合预期 |
| 真实端到端（stdio） | `node demo_code/retention-e2e.mjs` | 通过：真实截图保存成功、过期文件被清、手动文件保留、stderr 出现清理日志 |

`retention-verify.mjs` 的 14 个夹具覆盖：新鲜文件保留、三个分区各一个过期文件删除、`-2` 冲突后缀删除、自由命名保留、不可能日期保留、未来时间戳保留、非 PNG 保留、`.jpg` 保留、重命名但 mtime 新保留、`validation/` 与 `baseline-*` 与 `run-*` 子目录保留、以及「年龄恰好等于保留期保留 / 超过 1 秒删除」的精确边界（注入固定时钟，不依赖墙上时钟漂移）。

## 问题：有哪些已知边界？

答案：

- 清理按「保留天数」整日计算，不区分截图工具来源。
- 若把 `MCP_SCREENSHOT_DIR` 指向 `test/` 之外，写入与清理都会先被 `core/data-paths.ts` 拒绝，这是既有的边界约束。
