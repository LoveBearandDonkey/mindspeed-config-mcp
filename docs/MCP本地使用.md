# MCP 本地使用

## 当前能力

同一个 `mindspeed-config-mcp` Server 提供四个只读 Tool：

1. `validate_parallel_config`
2. `compute_rank_topology`
3. `suggest_config_fixes`
4. `estimate_training_capacity`

四个 Tool 都不会启动训练、连接远端或修改输入文件。

## 启动

在项目根目录安装依赖并运行：

```powershell
npm install
npm run start:mcp
```

这是 stdio 服务，启动后等待 MCP 客户端通过标准输入输出通信，不会显示普通交互式
命令行界面。标准输出专用于 JSON-RPC，诊断信息只能写到标准错误。

## 客户端配置骨架

支持 MCP stdio 的客户端通常需要一段类似配置：

```json
{
  "mcpServers": {
    "mindspeed-config": {
      "command": "node",
      "args": [
        "D:\\Projects\\mindspeed-config-mcp\\apps\\mcp-server\\src\\index.js"
      ]
    }
  }
}
```

不同客户端的配置文件位置和外层字段可能不同，但启动命令与参数保持一致。

## 推荐交互

- “从数学约束看，这套配置合法吗？”
- “Rank 13 位于哪个节点和 PP Stage？它属于哪些并行组？”
- “总卡数不能变、EP 也不能变，给我最小修复方案。”
- “为什么最后一个 Stage 更容易 OOM？把六段理论显存列出来。”

返回值同时包含一句面向人的解释和完整 `structuredContent`。Rank 拓扑使用
`page-derived` 标记；容量估算使用 `theoretical` 标记。

## 验证

```powershell
npm run test:mcp
```

测试会先用内存传输调用四个 Tool，再真实启动 stdio 子进程完成握手和工具枚举。

