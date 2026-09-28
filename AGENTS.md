# MindSpeed Config MCP

## 项目目的

把训练配置校验、Rank 拓扑、配置修复建议、原始配置解析和理论容量估算沉淀为可测试的纯计算核心，
再由页面和 MCP 协议适配层共同调用。

## 架构边界

- `packages/config-core/` 是计算规则的唯一事实来源，不依赖 DOM 或 MCP SDK；
- `packages/contracts/` 保存稳定输入输出契约；
- `apps/mcp-server/` 只做协议、鉴权和错误映射，不重复业务公式；
- MCP App 只渲染 `structuredContent`，不在浏览器内复制业务公式；
- `apps/web/` 只做页面交互和可视化，不重复业务公式；
- MindSpeed、Megatron-Core 和 MindSpeed-Agent 均为上游证据源，不作为第一版运行时依赖；
- 不得把 `config-relation-observer.js` 或 `config-relation-capacity.js` 整体搬入服务端。

## 变更规则

- 修改规则时必须同时更新来源引用和 Golden 测试；
- 页面规则与框架规则不一致时显式返回差异，不静默选择；
- 容量估算必须标明 `theoretical`、`model-informed` 或 `calibrated`；
- 任何会启动训练、连接远端或写入外部系统的能力必须与纯计算工具隔离；
- 中文正文统一使用“昇腾”“NPU”“CANN”“MindSpeed”。
