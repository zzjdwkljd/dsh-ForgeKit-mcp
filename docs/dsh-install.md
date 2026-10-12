# 在 DeepSeek Harness (DSH) 中安装

DSH 不读取 Claude Desktop 风格的 `mcpServers` JSON，而是通过 **profile 的 patch 层**注册外部 MCP 服务器。本页给出可直接使用的配置与排错要点。

## 1. 先构建

DSH 启动的是编译产物，必须先构建：

```bash
npm install
npm run build      # 生成 dist/index.js
```

## 2. 编辑 profile patch 文件

配置文件位于 DSH 配置目录下的 profile patch 层：

| 位置 | 路径 |
| --- | --- |
| profile 级（推荐） | `~/.dsh/profiles/<profile>/cordis.patch.yml`，桌面版 profile 通常为 `desktop` |
| 用户级 | `~/.dsh/cordis.patch.yml` |

Windows 下 `~` 即 `%USERPROFILE%`，例如 `C:\Users\<你>\.dsh\profiles\desktop\cordis.patch.yml`。

在文件的**顶层 YAML 数组**中追加一个条目：

```yaml
# ---- ForgeKit MCP：本机 stdio 服务器（截图 + 浏览器自动化）----
# 工具以 mcp__forgekit__<原始名> 暴露给模型。
- insert:
    - id: mcp-forgekit
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: forgekit        # [A-Za-z0-9_-]{1,32}，同作用域内唯一
        transport: stdio
        command: '/absolute/path/to/node'   # 绝对路径，不依赖 PATH 继承
        args:
          - /absolute/path/to/ForgeKit/dist/index.js
        cwd: /absolute/path/to/ForgeKit     # playwright-core 等依赖的相对解析基准
        env:
          MCP_BROWSER_EXECUTABLE: '/absolute/path/to/msedge'   # 可选：显式指定 Chrome/Edge
        toolCallTimeoutMs: 120000    # 浏览器类调用比默认 60s 慢，适当放宽
        failOnStartupError: false    # 连不上不阻塞 harness 启动
        reconnect:
          enabled: true
          maxAttempts: 10
```

Windows 示例（路径用单引号，反斜杠无需转义）：

```yaml
- insert:
    - id: mcp-forgekit
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: forgekit
        transport: stdio
        command: 'D:\nodejs\node.exe'
        args:
          - D:/text/MCP/ForgeKit/dist/index.js
        cwd: D:/text/MCP/ForgeKit
        env:
          MCP_BROWSER_EXECUTABLE: 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
        toolCallTimeoutMs: 120000
        failOnStartupError: false
        reconnect:
          enabled: true
          maxAttempts: 10
```

## 3. 为什么必须是 `- insert:`

patch 层的语义是：**没有 `insert` 的条目只会去覆盖同 `id` 的已有条目**；目标不存在时仅告警并跳过，不会新增。因此直接写 `- id: mcp-forgekit` 是无效的——不会报错，但服务器也不会注册。新增服务器必须包在 `- insert:` 列表里。

## 4. 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | patch 条目自身的标识，用于覆盖定位；与 `serverName` 无关 |
| `name` | 是 | 固定为 `@deepseek-ai/dsh-mcp-client`，DSH 自带的 MCP 客户端插件 |
| `serverName` | 是 | MCP 服务器名，正则 `[A-Za-z0-9_-]{1,32}`，同作用域内唯一。它决定工具前缀 |
| `transport` | 是 | 本机进程用 `stdio` |
| `command` / `args` | 是 | 启动命令；`command` 用绝对路径，避免继承不到 PATH |
| `cwd` | 建议 | 子进程工作目录，决定 `node_modules` 的相对解析基准 |
| `env` | 否 | 追加到子进程的环境变量，见下节 |
| `toolCallTimeoutMs` | 否 | 单次工具调用超时，默认 60s；浏览器操作建议放宽 |
| `failOnStartupError` | 否 | `true` 时启动失败会阻塞 harness；调试期建议 `false` |
| `reconnect` | 否 | 断线重连策略 |

## 5. 环境变量会被清洗

DSH 给 stdio 子进程的环境是**清洗后的父环境**：会丢掉名字匹配 `*KEY|PASSWORD|SECRET|TOKEN*` 的变量，以及全部 `DSH_*` 变量，再叠加条目里的 `env`。

由此有两点后果：

1. 任何外部可执行文件路径（如 Chrome/Edge）都必须在 `env` 里**显式传递**，不能指望从父进程继承。
2. 不要把密钥类变量放在这里指望它被保留；本服务器不需要任何凭据。

ForgeKit 支持的环境变量（`MCP_SCREENSHOT_DIR`、`MCP_BROWSER_*`、`MCP_SCREENSHOT_RETENTION_*` 等）都可以在 `env` 下按需设置，未设置时使用 README 中的默认值。

## 6. 验证

1. 保存 `cordis.patch.yml` 后**重启 DSH**（patch 层在 profile 加载时读取）。
2. 让模型列一次工具，应能看到 `mcp__forgekit__screenshot_screen`、`mcp__forgekit__browser_launch` 等条目。前缀格式为 `mcp__<serverName>__<原始工具名>`。
3. 调一次 `mcp__forgekit__screenshot_screen`：返回图片即表示 stdio 通道与截图后端均正常。

也可以脱离 DSH 直接验证服务器本身：

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | node dist/index.js
```

正常时会返回 `serverInfo` 的 JSON（名称 `forgekit-mcp`）。

## 7. 排错

| 现象 | 原因与处理 |
| --- | --- |
| 工具列表里完全没有 `mcp__forgekit__*` | 条目没包在 `- insert:` 里；或 YAML 缩进/顶层数组结构写错；或没重启 DSH |
| DSH 启动被阻塞或报错 | `failOnStartupError: true` 且服务器启动失败。先按上节命令单独验证 `node dist/index.js` |
| 服务器启动失败 | 忘了 `npm run build`，`dist/index.js` 不存在 |
| 浏览器工具报找不到可执行文件 | `env` 清洗导致 PATH 未继承，显式设置 `MCP_BROWSER_EXECUTABLE` |
| 浏览器调用超时 | 调大 `toolCallTimeoutMs` |
| 截图返回黑屏 / 空窗口列表（macOS） | 需在 *系统设置 → 隐私与安全性 → 屏幕录制* 中授权 DSH 宿主程序 |
| 想换工具前缀 | 修改 `serverName`，工具会变为 `mcp__<新名>__*` |
