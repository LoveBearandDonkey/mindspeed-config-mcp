# MCP Server

第一版使用官方 MCP TypeScript SDK v2 和 MCP Apps 扩展，通过 stdio 暴露五个只读 Tool：

- `validate_parallel_config`
- `compute_rank_topology`
- `suggest_config_fixes`
- `parse_training_config`
- `estimate_training_capacity`

五个计算 Tool 保留完整 `inputSchema`，供模型、普通 MCP 客户端和 MCP App 调用。另注册
六个零参数界面入口：统一工作台以及五个分析页入口。支持 MCP Apps 的客户端通过这些入口
打开 `ui://mindspeed-config/result-view.html`，在自定义中文输入区中填写或导入配置，再由
App 调用对应计算 Tool；用户无需操作宿主自动生成的 JSON Schema 表单。不支持界面的客户端
仍可直接调用五个计算 Tool，获取文本说明和 `structuredContent`。

启动：

```powershell
npm run start:mcp
```

`start:mcp` 会先把界面构建为不依赖外部 CDN 的单文件 HTML，再启动 stdio Server。

stdio 模式下标准输出保留给 MCP JSON-RPC，诊断信息只能写入标准错误。协议层只负责
Schema 校验、工具/界面资源注册和错误映射，所有业务公式仍由 `packages/config-core` 提供。

## Streamable HTTP

```powershell
$env:MCP_BEARER_TOKEN="至少-32-字符的随机值"
npm run start:http
```

默认监听 `127.0.0.1:3000`：MCP 端点是 `/mcp`，健康检查是 `/health`。`/mcp`
必须携带 `Authorization: Bearer <token>`；服务不会在缺少 Token 时启动。

监听所有网卡时还必须配置 `MCP_ALLOWED_HOSTS`。完整配置见
[MCP 远程使用](../../docs/MCP远程使用.md)。
