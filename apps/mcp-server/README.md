# MCP Server

第一版使用官方 MCP TypeScript SDK v2 和 MCP Apps 扩展，通过 stdio 暴露五个只读 Tool：

- `validate_parallel_config`
- `compute_rank_topology`
- `suggest_config_fixes`
- `parse_training_config`
- `estimate_training_capacity`

五个 Tool 都关联 `ui://mindspeed-config/result-view.html`。支持 MCP Apps 的客户端会在
Tool 返回后展示校验卡片、Rank 表格、修复差异、字段映射或容量条形图；不支持界面的
客户端仍可使用文本说明和 `structuredContent`。

启动：

```powershell
npm run start:mcp
```

`start:mcp` 会先把界面构建为不依赖外部 CDN 的单文件 HTML，再启动 stdio Server。

stdio 模式下标准输出保留给 MCP JSON-RPC，诊断信息只能写入标准错误。协议层只负责
Schema 校验、工具/界面资源注册和错误映射，所有业务公式仍由 `packages/config-core` 提供。
