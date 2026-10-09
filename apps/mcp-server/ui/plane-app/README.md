# 配置关系平面 MCP 基线

本目录以用户在 2026-09-30 确认完成的上游 `config-relation-plane.html` 为界面基线。
逐文件来源、SHA-256、字节数和未复制脚本的原因记录在 `BASELINE.json`。

保留的上游资产包括 HTML DOM、14 份 CSS、视图辅助脚本，以及 `config-test/` 的
11 份配置和说明。以下脚本没有直接复制运行：

- `config-relation-observer.js`
- `config-relation-capacity.js`
- `config-relation-yaml.js`
- `config-relation-import.js`
- `config-relation-plane.js`

这些脚本混合了浏览器端业务公式。MCP 版由 `mcp-plane-entry.js`、
`mcp-plane-view.js`、`mcp-plane.css` 和 `sample-catalog.js` 接入；解析、校验、Rank
拓扑、修复建议和理论容量均只读取 MCP Tool 返回的 `structuredContent`。
