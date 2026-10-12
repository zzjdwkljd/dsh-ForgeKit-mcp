# ForgeKit MCP

**可扩展的本地 MCP 工具集 · v1.0.0 · TypeScript · 跨平台**

Forge（锻造）+ Kit（工具集）：名称不限定某一种能力，截图与浏览器自动化是首批内置模块，后续功能以独立模块接入。

一个基于 [Model Context Protocol](https://modelcontextprotocol.io) 的 MCP 服务器，提供 **25 个工具**：

- **截图工具** —— 纯代码实现（[`node-screenshots`](https://www.npmjs.com/package/node-screenshots) Rust/NAPI 原生库），同一套代码支持 **Windows / macOS / Linux**
- **浏览器自动化工具** —— 基于 `playwright-core` 驱动本机 Chrome/Edge，无需下载浏览器

全部源码使用 **TypeScript 严格模式**（`strict` + `noUncheckedIndexedAccess`），工具参数由 zod schema 自动推导类型，编译期零 `any`。

## 环境要求

- Node.js ≥ 18
- Windows 10+ / macOS 10.15+ / Linux(X11)
- **macOS**：需在 *系统设置 → 隐私与安全性 → 屏幕录制* 中授权运行本服务的宿主程序（如 Terminal / iTerm / 你的 MCP 客户端），否则截图会返回黑屏或空窗口列表
- 浏览器工具需要本机安装 Google Chrome 或 Microsoft Edge

## 安装与运行

```bash
npm install
npm run build      # tsc 编译到 dist/
npm start          # 启动 MCP 服务器 (stdio)
npm run typecheck  # 仅类型检查，不产出文件
```

构建后按下方「在 MCP 客户端中注册」配置客户端即可。

扩展新功能请阅读 [模块开发指南](docs/mcp-extending.md)；命名、版本策略与架构决策见 [项目基线](docs/mcp-project-foundation.md)。

## 在 MCP 客户端中注册

### DeepSeek Harness (DSH)

DSH 通过 profile 的 patch 层注册外部 MCP 服务器，配置写入 `~/.dsh/profiles/<profile>/cordis.patch.yml`：

```yaml
- insert:
    - id: mcp-forgekit
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: forgekit
        transport: stdio
        command: '/absolute/path/to/node'
        args:
          - /absolute/path/to/ForgeKit/dist/index.js
        cwd: /absolute/path/to/ForgeKit
        toolCallTimeoutMs: 120000
        failOnStartupError: false
        reconnect:
          enabled: true
          maxAttempts: 10
```

工具会以 `mcp__forgekit__<原始名>` 暴露给模型。注意条目必须包在 `- insert:` 里，否则只会尝试覆盖同 `id` 的既有条目而不会新增。完整字段说明、环境变量清洗规则与排错表见 **[DSH 安装指南](docs/dsh-install.md)**。

### 其他 stdio 客户端

任何支持 stdio 传输的 MCP 客户端都可用 `command` + `args` 直接启动本服务器：

```json
{
  "mcpServers": {
    "forgekit-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/forgekit-mcp/dist/index.js"]
    }
  }
}
```

## 工具列表

### 截图工具

| 工具 | 说明 |
|---|---|
| `screenshot_screen` | 截取屏幕（`all` = 每个显示器返回一张图；`primary` = 仅主显示器），返回 PNG |
| `screenshot_region` | 截取屏幕矩形区域（虚拟屏幕物理像素坐标，支持负坐标）；跨显示器时按显示器分块返回 |
| `screenshot_window` | 按标题子串截取窗口（不区分大小写）；留空截取当前聚焦窗口 |
| `list_windows` | 列出顶层窗口：标题、应用名、PID、坐标尺寸、最小化/最大化/聚焦状态 |

### 浏览器自动化工具

| 工具 | 说明 |
|---|---|
| `browser_launch` | 启动浏览器（可选）；`headless:false` 显示窗口、`persistent` 登录态持久化(默认开)、`stealth` 反检测(默认开)、`humanize` 拟人化(默认开)、`userAgent`/`headers` 自定义请求头、`userDataDir` 配置目录 |
| `browser_close` | 关闭浏览器（登录态自动备份） |
| `browser_humanize` 🆕 | 查看/修改拟人化设置（打字间隔、操作停顿、开关），运行时生效 |
| `browser_save_state` 🆕 | 导出登录态（cookies + localStorage）为 JSON 文件 |
| `browser_load_state` 🆕 | 导入登录态并刷新页面 |
| `browser_headers` 🆕 | 请求头管理（get/set/clear）：三层策略，自定义 UA 自动派生 sec-ch-ua 并同步 navigator 指纹 |
| `browser_navigate` | 导航到 URL（省略协议自动补 `https://`）；`waitUntil`: load / domcontentloaded / networkidle / commit |
| `browser_info` | 当前状态：URL、标题、视口、无头模式、可执行文件路径 |
| `browser_screenshot` | 网页截图（`fullPage: true` 截整页），返回 PNG |
| `browser_click` | 点击元素；左/右/中键、双击/三击 |
| `browser_type` | 输入文本；`clear` 清空填写，否则逐字输入；`submit` 后按 Enter |
| `browser_press` | 按键（Enter、Tab、Control+A 等），可先聚焦元素 |
| `browser_select` | `<select>` 选择（`value`/`label`/`index` 三选一） |
| `browser_scroll` | 滚动窗口或指定元素 |
| `browser_scroll_all` | 分步滚动到底以触发懒加载，带最大次数保护 |
| `browser_wait` | 等待选择器状态（attached/detached/visible/hidden）或定时等待 |
| `browser_evaluate` | 页面内执行 JS 表达式，返回 JSON |
| `browser_get_text` | 提取元素可见文本（默认 body，上限 50k 字符） |
| `browser_get_html` | 提取元素 outerHTML（留空返回整个文档，上限 50k） |
| `browser_history` | 后退 / 前进 / 刷新 |
| `browser_tabs` | 标签页：list / new（可带 url）/ close |

### 选择器语法（Playwright）

CSS `div.btn > span` · 文本 `text=登录` · XPath `xpath=//button` · ARIA `role=button[name="确定"]`

## 项目结构

```
src/
  index.ts                 # stdio 启动与进程退出；不注册业务工具
  server.ts                # 可组合服务器工厂与模块资源回收
  metadata.ts              # 从 package.json 读取名称与版本
  core/
    module.ts              # ToolModule / ToolRegistrar 契约
    results.ts             # 文本、图片、错误结果封装
  modules/
    index.ts               # 唯一内置模块清单（新增模块在此接入）
    screenshot/index.ts    # 4 个截图/窗口工具
    browser/
      index.ts             # 浏览器模块入口与资源回收
      session.ts           # 启停、状态、拟人化、请求头
      navigation.ts        # 导航、历史、标签页
      interaction.ts       # 点击、输入、选择、滚动、等待
      content.ts           # 网页截图、文本、HTML、脚本
      state.ts             # 登录态导入/导出
  browser.ts               # 现有浏览器业务实现（保留）
  headers.ts               # 请求头策略纯函数
  screenshot/              # 原生/Windows 降级后端、截图存储与保留期清理
  types.ts                 # 通用领域类型
scripts/capture.ps1        # Windows 截图降级脚本

test/                      # 只存放数据，不放测试代码
  contracts/tools.v1.json  # 25 个工具的完整声明基线
  login-state/             # 私有浏览器配置与登录态；不进入发布包
  screenshot/              # 截图输出；不进入发布包

docs/
  dsh-install.md           # 在 DeepSeek Harness 中安装
  mcp-extending.md         # 如何增加新模块与工具
  mcp-project-foundation.md # 命名、版本、架构与验证记录
  screenshot-retention-faq.md # 截图保留期（自动清理）说明
```

## 架构说明

### 截图（跨平台，纯代码）

主后端是 `node-screenshots`（Rust/NAPI，零依赖，同一 API 覆盖 Windows/macOS/Linux）：

- **屏幕**：`Monitor.all()` 枚举显示器（含坐标/缩放因子/主屏标志），逐屏 `captureImage()`
- **区域**：按虚拟屏幕坐标定位重叠显示器 → 捕获整屏 → `Image.crop()` 裁剪（跨显示器区域自动分块）
- **窗口**：`Window.all()` 枚举顶层窗口 → 标题子串匹配（优先聚焦窗口）→ `Window.captureImage()`
- **降级**：Windows 上原生路径失败时自动改用 `scripts/capture.ps1`（CopyFromScreen / PrintWindow）兜底

### 浏览器

`playwright-core` + 本机 Chrome/Edge（`playwright-core` 不下载浏览器）：懒启动、单实例复用、断连自动重置；截图以 MCP `image` 内容块（base64 PNG）返回。跨平台路径已内置（Windows/macOS/Linux 的 Chrome 与 Edge 常见安装位置）。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MCP_SCREENSHOT_DIR` | `test/screenshot` | 截图保存目录 |
| `MCP_SCREENSHOT_RETENTION_DAYS` | `3` | 自动生成截图的保留天数；`0` 关闭自动清理 |
| `MCP_SCREENSHOT_RETENTION_INTERVAL_HOURS` | `6` | 后台扫描间隔（小时）；`0` 只在首次截图时扫一次 |
| `MCP_BROWSER_USER_DATA_DIR` | `test/login-state/browser-profile` | 浏览器用户配置目录（登录态） |
| `MCP_BROWSER_PERSISTENT` | `true` | 是否启用持久化配置（登录态保留） |
| `MCP_BROWSER_STEALTH` | `true` | 反检测模式（隐藏自动化特征） |
| `MCP_BROWSER_HUMANIZE` | `true` | 拟人化模式（随机间隔/停顿/抖动） |
| `MCP_BROWSER_TYPING_MIN_MS` / `MAX_MS` | `40` / `120` | 拟人化打字间隔范围（毫秒） |
| `MCP_BROWSER_ACTION_MIN_MS` / `MAX_MS` | `150` / `600` | 操作前"思考"停顿范围（毫秒） |
| `MCP_BROWSER_HEADLESS` | `true` | 设为 `false` 默认显示浏览器窗口 |
| `MCP_BROWSER_EXECUTABLE` | 自动查找 | 自定义 Chrome/Edge 可执行文件路径 |
| `MCP_BROWSER_LAUNCH_MODE` | `auto` | 浏览器启动方式：`cdp`（自带 spawn+CDP 连接）/ `direct`（Playwright 原生）/ `auto`（自动学习：哪种坏了就记住并永久跳过） |
| `MCP_BROWSER_TIMEOUT_MS` | `30000` | 操作超时（毫秒） |
| `MCP_BROWSER_LOCALE` | `zh-CN` | 浏览器语言 |

## 登录态（持久化）

**默认开启**：浏览器使用持久化用户配置目录 `test/login-state/browser-profile/`，cookie、localStorage、IndexedDB、记住的登录全部保留——**登录一次，之后一直有效**。

- 会话 cookie（本该关闭即失效的）在关闭时也会自动备份到 `browser-profile/mcp-session-state.json`，下次启动自动恢复（Chrome 本身不保证落盘这类 cookie）
- `browser_save_state` / `browser_load_state`：把登录态（cookies + localStorage）导出/导入为 JSON 文件（默认 `test/login-state/state.json`），可用于：
  - 在不同机器/环境间迁移登录
  - 备份某个站点的登录态
  - 从真实浏览器导出 cookie 后注入自动化浏览器
- `browser_launch { persistent: false }` 可切换为无痕模式（什么都不留）

## 无头模式

| 方式 | 用法 |
|---|---|
| 默认 | 无头（`headless: true`），不显示窗口，后台静默执行 |
| 临时显示窗口 | `browser_launch { headless: false }` —— 需要**人工操作**时用（扫码登录、过滑块验证、看一眼页面） |
| 环境变量 | `MCP_BROWSER_HEADLESS=false` 让所有启动默认显示窗口 |

推荐登录流程：`browser_launch { headless: false }` → 打开目标网站 → 人工扫码/输验证码登录 → `browser_close`（登录态已保存）→ 之后 `headless: true` 自动化操作都是登录状态。

注意：切换 headless/persistent 模式会自动重启浏览器（配置目录不变，登录态不丢）。

## 反检测（Stealth）

**默认开启**（`browser_launch { stealth: false }` 或 `MCP_BROWSER_STEALTH=false` 关闭）。对比实测：

| 检测信号 | stealth=ON | stealth=OFF |
|---|---|---|
| `navigator.webdriver` | `undefined` ✅ | `true` ❌ 被识别为自动化 |
| `window.chrome` 运行时 | 存在 ✅ | 存在 |
| `navigator.plugins`（无头时） | 5 个（模拟正常） | 空（无头特征） |

实现内容：

1. **启动层**：移除 `--enable-automation`（去掉"由自动化测试软件控制"提示条与默认自动化标记）、`--disable-blink-features=AutomationControlled`
2. **注入层**（每个页面/iframe 在页面脚本前执行）：
   - `navigator.webdriver` → undefined
   - 补齐 `window.chrome.app/runtime` 结构
   - `navigator.permissions.query('notifications')` 不再 reject
   - 无头时模拟 plugins 列表、伪装 WebGL 渲染器（SwiftShader 是常见无头特征）

**相对 Selenium 的优势**：Selenium 的 `cdc_` / `$cdc_...` 变量是 Chromedriver 留下的经典检测点，Playwright 无此问题。

**诚实说明（局限性）**：以上覆盖常见检测手段，能绕过大多数网站的基础自动化检测；但无法保证绕过 Cloudflare Turnstile、DataDome、PerimeterX 这类专业风控（它们综合分析 TLS 指纹、行为轨迹、Canvas/WebGL 细粒度指纹等）。对抗专业风控建议配合：有头模式 + 真实登录态 + 拟人化操作（见下节）。

## 请求头（Headers）

**三层策略**，优先级从低到高合并：

| 层 | 来源 | 说明 |
|---|---|---|
| 1. 浏览器原生（兜底） | Chrome 自动发送 | 你什么都没设置时的默认请求头就是它——**从不伪造**，Accept / sec-fetch-* / Accept-Encoding 等永远是浏览器真实值 |
| 2. 一致性派生（derived） | 由自定义 User-Agent 自动派生 | `sec-ch-ua` / `sec-ch-ua-mobile` / `sec-ch-ua-platform` / `sec-ch-ua-full-version-list`，保证改 UA 后指纹不自相矛盾 |
| 3. 自定义（custom） | `browser_headers set` 或 `browser_launch { headers }` | 校验后覆盖，可随时 clear 回到原生 |

```js
browser_headers { action: "get" }                                   // 查看当前策略（含每项来源）
browser_headers { action: "set", userAgent: "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36",
                  headers: { "X-Trace-Id": "abc", "Accept-Language": "zh-CN,zh;q=0.9" } }
browser_headers { action: "clear" }                                 // 回到浏览器原生头
browser_launch  { headers: {...}, userAgent: "..." }                // 启动时一并设置
```

**指纹一致性（重点）**：单独改 User-Agent 而不改 `sec-ch-ua` 是浏览器自动化最大的露馅点。因此传入 `userAgent` 时自动完成：

1. 按 UA 版本派生 `sec-ch-ua` 家族请求头（`"Not A;Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"` 形式）
2. 通过 CDP `Emulation.setUserAgentOverride` 同步 `navigator.userAgent`、`navigator.userAgentData`（brands/platform/getHighEntropyValues）—— 请求头和 JS 指纹永不打架
3. `navigator.webdriver` 等 stealth 伪装继续生效

**健壮性规则**：
- 校验失败**整体拒绝**，绝不半应用（宁可报错也不留不一致状态）
- 拒绝覆盖：`Host` / `Content-Length` / `Connection` 等 HTTP 框架头，`:proxy-`、`sec-websocket-` 前缀——覆盖它们会破坏请求或暴露自动化
- 拒绝控制字符（`CRLF` 请求头注入）
- `Cookie` 可设但会提示改用 `browser_load_state`（避免与 Cookie 罐叠加）
- `Accept-Language` 走 CDP `acceptLanguage` 通道（优先级高于 extraHTTPHeaders），自动剥掉 q 权重传裸列表，由 Chrome 生成规范 q 值——与真实浏览器逐字节一致

**验证**：自定义头真实上线、sec-ch-ua 派生与 UA 一致、`navigator.userAgentData` 与请求头不劈叉、clear 后回到原生、注入与框架头被拒绝。

## 拟人化（Humanize）
**默认开启**，让自动化操作接近真人节奏（`browser_launch { humanize: false }` 或 `MCP_BROWSER_HUMANIZE=false` 关闭）：

| 行为 | 默认 | 说明 |
|---|---|---|
| 打字间隔 | 每键随机 40–120ms | 逐字随机间隔（真人节奏，不是固定值） |
| 操作前停顿 | 随机 150–600ms | 点击/按键/选择/滚动前的"思考"停顿 |
| 点击位置抖动 | 开 | 点击元素内随机位置（不是死板的中心点） |
| 平滑滚动 | 开 | 分 3–6 段滚动，段间小停顿（不是瞬移） |

运行时随时查看/修改（`browser_humanize` 工具，**无需重启浏览器**）：

```
browser_humanize {}                                             → 查看当前配置
browser_humanize { humanize: false }                            → 关闭拟人化（机器速度）
browser_humanize { typingDelayMinMs: 80, typingDelayMaxMs: 200 } → 打字更慢更像人
browser_humanize { actionDelayMinMs: 0, actionDelayMaxMs: 0 }    → 取消操作停顿
```

单次覆盖：`browser_type { ..., delay: 300 }` 显式传 `delay` 时本次按固定间隔打字（`delay: 0` = 纯机器速度），不传则用拟人化随机间隔。所有范围均可通过 `browser_launch` 参数或环境变量自定义。

## 截图保存与命名

默认保存到项目下 `test/screenshot/`，文件名格式为 **`<名称>-YYYYMMDD-HHMMSS.png`**：

| 截图类型 | 文件名示例 |
|---|---|
| 窗口（按应用名） | `QQ-20260925-112845.png` |
| 窗口（无应用名时用标题） | `洛克王国：世界-20260925-112845.png` |
| 屏幕（显示器名） | `screen-CG322K-20260925-112845.png` |
| 区域 | `region-20260925-112845.png` |

- 名称中的非法文件名字符（`<>:"/\|?*`）自动替换为 `-`，中文正常保留
- 同一秒内多张截图自动追加 `-2`、`-3` 后缀防覆盖
- **3 天前的自动生成截图自动清理**：只删除「命名完全符合 `<名称>-YYYYMMDD-HHMMSS[-N].png`、时间戳能反解成真实日期、文件头是 PNG」且已过期 3 天的文件。手动放入的图片、命名不符的文件、非 PNG、以及 `validation/`、`baseline-*`、`run-*` 等子目录一律不动。保留期与扫描间隔可用 `MCP_SCREENSHOT_RETENTION_DAYS` / `MCP_SCREENSHOT_RETENTION_INTERVAL_HOURS` 调整（详见下方环境变量与 [截图保留期说明](docs/screenshot-retention-faq.md)）

## 其他说明

- `monitor=all` 时每个显示器返回一张图（带显示器名称/分辨率/坐标的文字标注），而非拼接图
- **网吧/还原系统环境注意**：若系统盘有还原保护，重启后 `test/login-state/`（登录态）会被清空。建议定期用 `browser_save_state` 导出登录态 JSON 保存到非还原盘/网盘，换机或还原后用 `browser_load_state` 一键恢复
- 需要修改工具行为时改动 `src/` 后运行 `npm run build`


## 版本与发布约定

- 项目名称：**ForgeKit MCP**；npm 包名与 MCP `serverInfo.name`：`forgekit-mcp`。
- 当前版本：**1.0.0**。原 `2.0.0` 未发布，经确认重新定为首个模块化基线，不表示本次已发布到 npm。
- 遵循 SemVer：兼容修复升 PATCH（`1.0.1`），兼容的新模块/工具升 MINOR（`1.1.0`），破坏工具参数、返回语义或移除工具升 MAJOR（`2.0.0`）。
- `package.json` 是版本来源，MCP 握手和启动日志自动读取它；用 `npm version patch --no-git-tag-version` 等命令同步更新锁文件。
- 发布白名单仅包含编译产物、必要脚本和文档，不包含浏览器配置、登录态、截图或测试日志。发布前仍应执行 `npm pack --dry-run --ignore-scripts` 审查文件清单。
