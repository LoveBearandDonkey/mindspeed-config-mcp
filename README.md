# MindSpeed Config MCP

面向 MindSpeed 训练配置校验、Rank 拓扑、配置修复建议和理论容量估算的独立项目。

## 当前状态

V1 基线已归档为 `v1.0.8`；V2 正在 `main` 开发。`集成分析.md` 表中第 1、2、3、4、6 项已形成 V1 并通过
单元测试。stdio MCP Server 当前已注册六个只读计算 Tool，并提供六个无需填写宿主 JSON 的
自定义中文界面入口；远程 Streamable HTTP、健康检查和静态 Bearer
Token 鉴权已经实现。生产
服务器的 TLS、反向代理和进程托管仍待按目标环境落地。

当前计算入口：

1. `validate_parallel_config`
2. `compute_rank_topology`
3. `suggest_config_fixes`
4. `parse_training_config`
5. `estimate_training_capacity`（对应分析表第 6 项）
6. `review_config_change`（修改后的源文件差异与静态复查，仅供 Agent 直接调用）

面向用户的入口包括统一工作台 `open_config_workbench` 和五个 `open_<分析 Tool>` 页面：
可选择、拖入或直接填写 YAML、JSON、Shell 配置，在统一中文表单中核对并补齐缺项，再调用
上述五项分析能力。第六项用于 Agent 修改源文件后的复查，不另设页面。底层计算 Tool 继续用各自的 `inputSchema` 做协议校验。

计算 Tool 的文本结果先给结论、首要依据和下一步；`structuredContent.quick_assessment` 保留同一摘要及完整结构化结果。解析结果包含源文本 SHA-256；修复候选保留字段级 `changes`，`review_config_change` 可根据修改前后文本、锁定字段与候选差异复查实际修改。

纯计算入口由 `packages/config-core/src/index.js` 统一导出。当前 Rank 语义为
`page-derived`，容量置信等级为 `theoretical`。

`validate_parallel_config` 现已同时覆盖 Hybrid/Adaptive CP、MC2/CoC、AMPipe、2D TP、
ND MatMul、MoE dispatcher/overlap 和重计算组合约束。合法配置还会在独立的
`suggestions` 中返回卡型 CP 搜索空间、HCCL Buffer 与容量方向建议；这些 advisory
不参与 `valid/invalid` 判定，性能排序仍需 Profiling 或实测。

## 目录

```text
apps/
  mcp-server/       # MCP 协议适配与可嵌入结果界面
  web/              # 工具矩阵页面适配层
packages/
  config-core/      # 计算规则与修改复查的唯一实现
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
- 配置解析只处理调用方显式传入的文本，不根据路径读取服务器文件；
- 每个结论必须携带规则版本、来源、假设和置信等级。

## 开发基线

```powershell
npm test
npm run build:ui
npm run package:github-pages
npm run test:contracts
npm run test:golden
npm run test:mcp
npm run test:http
npm run smoke:http
npm run verify:upstream
```

`verify:upstream` 默认读取同级目录 `D:\Projects\compute-graph-viewer-wzh`，也可通过
`TOOL_MATRIX_ROOT` 指定其他只读工作区。

`package:github-pages` 会在 `deploy/github-pages/` 生成可直接发布的自包含静态体验包。
其中五项计算在浏览器内调用同一份 `config-core`；GitHub Pages 不提供 MCP 协议端点。

## 项目文档

- [完整集成分析](docs/集成分析.md)
- [源码能力映射](docs/源码能力映射.md)
- [验收矩阵](docs/验收矩阵.md)
- [MCP 本地使用](docs/MCP本地使用.md)
- [MCP 本地模拟验收](docs/MCP本地模拟验收.md)
- [团队成员简易 MCP 访问方式](docs/团队成员简易MCP访问方式.md)
- [MCP 服务端配置与运维](docs/MCP服务端配置与运维.md)
- [UI 逐项改造清单](docs/UI逐项改造清单.md)
