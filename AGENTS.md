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
- HTTP 模式不得在缺少 `MCP_BEARER_TOKEN` 时降级为匿名访问；
- 中文正文统一使用“昇腾”“NPU”“CANN”“MindSpeed”。

## 本地页面预览

- 每次完成页面或页面样式相关修改后，在最终答复前自动使用 `mindspeed-config-mcp-local` skill 执行 `Preview`，重新构建并刷新 `http://127.0.0.1:4174/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp.html?preview=1`；用户明确要求不刷新时除外。只有用户明确要求完整 MCP 服务或 Inspector 时才改用 `Refresh`。

## 场景 1：对话中快速检查配置

- Agent 先读取用户指定的磁盘文件或用户显式提供的未保存内容，再调用当前会话实际连接的 V2 MCP `parse_training_config`；本地 `config-core` 调用、健康检查和工具登记均不能冒充本次 MCP 调用。若 MCP 调用失败，应明确说明，只能把本地分析标为回退结果。
- 核对 `data.mcp_invocation`、`source_snapshot`、`missing_required_fields`、`tool_readiness` 和未检查字段。只有对应工具就绪时，才继续调用并行校验、Rank 或容量工具；不得用解析成功表示训练配置已通过完整校验。
- 面向用户的结论固定为四章：①一句话说明文件是否读取与解析成功、原始配置总数、纳入字段解析与对照的数量、完整分析缺少的必需配置数，明确解析不等于完整校验；②用表格列出已确认问题、待核对差异及对应规则或约束，不能把未证实差异写成训练阻断；③用表格给出 0～3 个有证据的排序方案及推荐理由，无安全方案时明确写 0 个；④列出缺失配置及补齐后可继续进行的校验。结尾根据方案数量提问：0 个时只索取缺失信息，不要求选择；1 个时询问是否采用；多个时请用户回复序号。用户选择方案或明确授权修改后，Agent 先展示拟改动，再写入源文件并复查；已获授权时不重复索取许可。
