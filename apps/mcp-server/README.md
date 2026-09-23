# MCP Server

第一版使用官方 TypeScript SDK，通过 stdio 暴露四个只读 Tool：

- `validate_parallel_config`
- `compute_rank_topology`
- `suggest_config_fixes`
- `estimate_training_capacity`

启动：

```powershell
npm run start:mcp
```

stdio 模式下标准输出保留给 MCP JSON-RPC，诊断信息只能写入标准错误。协议层只负责
Schema 校验、工具注册和错误映射，所有业务公式仍由 `packages/config-core` 提供。
