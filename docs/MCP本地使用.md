# MCP 本地使用

## 当前能力

同一个 `mindspeed-config-mcp` Server 提供五个只读分析 Tool：

1. `validate_parallel_config`
2. `compute_rank_topology`
3. `suggest_config_fixes`
4. `parse_training_config`
5. `estimate_training_capacity`

五个 Tool 都不会启动训练、连接远端或修改输入文件。解析工具接收配置文本，不根据
用户给出的路径读取服务器文件。

此外还有六个零参数界面入口：`open_config_workbench` 和五个 `open_<分析 Tool>` 入口。
它们不增加新的计算规则，只负责以统一中文界面组织文件导入、表单填写、缺项补充和上述
五个计算 Tool 的调用。计算 Tool 的 `inputSchema` 仍是协议校验和普通 MCP 客户端表单的
事实来源；支持 MCP Apps 的客户端优先打开零参数界面入口，用户不需要操作宿主 JSON 表单。

## 启动

在项目根目录安装依赖并运行：

```powershell
npm install
npm run start:mcp
```

这是 stdio 服务，启动后等待 MCP 客户端通过标准输入输出通信，不会显示普通交互式
命令行界面。标准输出专用于 JSON-RPC，诊断信息只能写到标准错误。

启动前会构建一个单文件 MCP App。支持 MCP Apps 的客户端会直接渲染结果界面；普通
MCP 客户端仍能收到同样的文本说明和结构化 JSON。

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

需要跨进程或跨主机访问时，改用[MCP 服务端配置与运维](MCP服务端配置与运维.md)中的 Streamable
HTTP 入口；不要通过自行转发 stdio 来模拟网络服务。

## 推荐交互

- “从数学约束看，这套配置合法吗？”
- “Rank 13 位于哪个节点和 PP Stage？它属于哪些并行组？”
- “总卡数不能变、EP 也不能变，给我最小修复方案。”
- “解析这段启动脚本，告诉我哪些参数已映射、哪些没看懂。”
- “为什么最后一个 Stage 更容易 OOM？把六段理论显存列出来。”

返回值同时包含一句面向人的解释和完整 `structuredContent`。Rank 拓扑使用
`page-derived` 标记；容量估算使用 `theoretical` 标记。

## 验证

```powershell
npm run test:mcp
```

测试会先构建 MCP App，通过内存传输调用五个计算 Tool 和六个零参数界面入口、读取 `ui://`
界面资源，再真实启动 stdio 子进程完成握手和工具枚举。
