# MCP Server

服务使用官方 MCP TypeScript SDK v2 和 MCP Apps 扩展，通过 stdio 暴露六个只读 Tool：

- `validate_parallel_config`
- `compute_rank_topology`
- `suggest_config_fixes`
- `parse_training_config`
- `estimate_training_capacity`
- `review_config_change`

六个计算 Tool 保留完整 `inputSchema`，供模型和普通 MCP 客户端调用。另注册
六个零参数界面入口：统一工作台以及五个分析页入口。支持 MCP Apps 的客户端通过这些入口
打开 `ui://mindspeed-config/result-view.html`，在自定义中文输入区中填写或导入配置，再由
App 调用对应计算 Tool；用户无需操作宿主自动生成的 JSON Schema 表单。不支持界面的客户端
仍可直接调用六个计算 Tool，获取文本说明和 `structuredContent`。修改复查 Tool 仅供模型调用，不另设页面；它接收调用方读取的修改前后文件文本，不按路径读取或写入文件。

启动：

```powershell
npm run start:mcp
```

`start:mcp` 会先把界面构建为不依赖外部 CDN 的单文件 HTML，再启动 stdio Server。
构建会拒绝多文件产物、未内联的 CSS/JS/媒体依赖或已清除模块回流。在仓库根目录运行
`npm run preview:adapted-ui` 可在 4174 端口直接预览与 MCP Resource 相同的生产 HTML。
真实产物名为 `config-relation-plane-mindspeed-config-mcp-YYYYMMDD-HHmmss.html`，时间戳使用
上海时区；服务端会在产物目录中严格发现唯一文件，无需在每次打包后修改路径。

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
[MCP 服务端配置与运维](../../docs/MCP服务端配置与运维.md)。
