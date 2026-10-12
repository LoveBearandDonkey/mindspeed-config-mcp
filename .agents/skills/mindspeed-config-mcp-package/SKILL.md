---
name: mindspeed-config-mcp-package
description: "Package and verify the MindSpeed Config MCP App as a timestamped, self-contained HTML resource. Use when the user asks to package, rebuild, refresh, locate, or verify the deployable UI artifact, including Chinese requests such as ‘打包第18项’, ‘重新打包页面’, ‘生成部署 HTML’, ‘最新打包文件在哪’ or ‘校验打包产物’."
---

# MindSpeed Config MCP 资源打包

生成当前 MCP App 的唯一时间戳单文件，并返回可交付产物的确切路径、大小和 SHA-256。
这是 UI Resource 打包，不执行 Docker、服务器发布或远端写入。

## 执行

运行本 Skill 的 `scripts/package-ui.ps1`。脚本默认从 Skill 位置识别项目根目录；若用户设置了
`MINDSPEED_CONFIG_MCP_ROOT`，优先使用该值。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <skill目录>\scripts\package-ui.ps1
```

日常小步迭代使用默认模式。只有用户要求发布级完整复核，或本次修改涉及 MCP Resource 注册、
构建规则、协议/鉴权时，追加 `-FullVerify`；它会运行完整测试和 Streamable HTTP smoke。

构建成功必须满足：

- 产物位于 `apps/mcp-server/ui/dist/ui-shell-v1/training-run-twin-standalone/`；
- 文件名为 `config-relation-plane-mindspeed-config-mcp-YYYYMMDD-HHmmss.html`，时间使用上海时区；
- 目录只保留本次生成的一个 HTML；
- CSS、JavaScript、样例和必要依赖全部内联；
- 已清除模块不得重新进入产物；
- MCP Server 通过唯一文件发现逻辑读取它，不需要手工修改服务端路径。

构建或校验失败时不要把旧文件报告为新产物。读取命令错误并修复后重试。

## 修改边界

- 不直接编辑 `ui/dist/`；它会在下一次构建时重建。
- 4173 基线目录只用于对照。App 专属改动优先放在 `apps/mcp-server/ui/src/`、适配器或
  `apps/mcp-server/vite.config.js`，不要为了打包修改基线视觉事实。
- 不改 `config-core` 业务公式或契约，除非用户的功能请求本身要求这样做。

## 返回结果

告诉用户：打包是否成功、时间戳文件名、绝对路径、字节数、SHA-256，以及是否执行了完整复核。
不要把 `ui://mindspeed-config/result-view.html` 误称为磁盘文件；它是 MCP 中映射到该 HTML 的资源 URI。
