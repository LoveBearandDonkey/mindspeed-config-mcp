# MindSpeed Config MCP

面向 MindSpeed 训练配置校验、Rank 拓扑、配置修复建议和理论容量估算的独立项目。

## 当前状态

项目处于第一阶段：四项纯计算接口已经形成第一版并通过单元测试，stdio MCP Server
也已注册对应的四个只读 Tool。当前尚未实现远程 HTTP、鉴权和服务器部署。

第一版范围：

1. `validate_parallel_config`
2. `compute_rank_topology`
3. `suggest_config_fixes`
4. `estimate_training_capacity`

纯计算入口由 `packages/config-core/src/index.js` 统一导出。当前 Rank 语义为
`page-derived`，容量置信等级为 `theoretical`。

## 目录

```text
apps/
  mcp-server/       # 协议适配层，纯计算核心稳定后再实现
  web/              # 工具矩阵页面适配层
packages/
  config-core/      # 四项能力的唯一计算实现
  contracts/        # 输入输出 JSON Schema
docs/               # 来源映射、验收矩阵和架构决策
tests/              # fixtures、golden 与兼容性测试
tools/              # 上游只读验证脚本
deploy/             # 后续服务器部署文件
```

## 边界

- 页面与未来 MCP Server 必须共用 `config-core`；
- MindSpeed Core 是版本化规则证据源，不作为服务端运行时依赖；
- MindSpeed Agent 是路由、编排和解释层，不复制到计算核心；
- 第一版不启动训练，不读取任意服务器文件路径；
- 每个结论必须携带规则版本、来源、假设和置信等级。

## 开发基线

```powershell
npm test
npm run test:contracts
npm run test:golden
npm run test:mcp
npm run verify:upstream
```

`verify:upstream` 默认读取同级目录 `D:\Projects\compute-graph-viewer-wzh`，也可通过
`TOOL_MATRIX_ROOT` 指定其他只读工作区。

## 项目文档

- [完整集成分析](docs/集成分析.md)
- [项目负责人手动事项清单](docs/项目负责人手动事项.md)
- [零阶段基线与已知问题](docs/零阶段基线.md)
- [源码能力映射](docs/源码能力映射.md)
- [验收矩阵](docs/验收矩阵.md)
- [MCP 本地使用](docs/MCP本地使用.md)
- [页面原型拷贝清单](docs/页面原型拷贝清单.md)
