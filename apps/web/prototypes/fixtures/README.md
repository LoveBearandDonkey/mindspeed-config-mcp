# V2 双样本验收输入快照

本目录只保存验收用快照，不作为训练脚本执行。所有快照固定于 2026-10-21；改动上游页面或脚本后，须重新生成并重新调用 MCP。

## A：openPangu 2.0 参考配置（2048 卡）

- [页面生成的 MindFormers YAML](./openpangu-default-2048.yaml)：从 `apps/web/config-relation-plane-baseline/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp.html` 对应的 `openpangu-default` 预设取得。通过该页依赖的 `shared/plane-rules.js`、`js/config-relation-observer.js` 的 `createController({configPreset:'openpangu-default'})` 与 `derive()`，再调用同页 `js/config-relation-yaml.js` 的 `buildYamlLines()` 生成；未手工填写数值。页面预设本身并非独立的上游训练文件。
- [预设与派生结构快照](./openpangu-default-2048.preset.json)：保存页面控制器的配置、模型预设、卡型、拓扑计数和 Stage 分层。页面的默认口径是 **EP 从 DP 内切出**，`DP=512, PP=4, TP=1, CP=1, EP=64`，总 Rank 为 2048。
- [MCP 输入契约副本](./openpangu-default-2048.training.json)：仅把同一预设的显式值映射到 `training-config-v1` 字段，用于 MCP 静态校验、Rank、容量和规划。`trainer.model_name` 保留页面生成 YAML 的模型名称，因为当前解析器未映射 `model.id`。`pipeline_layer_offsets=[[1,1,0,0]]` 来自页面分层，不能在复验时静默丢失。此文件是派生副本，不冒充页面原始 YAML 或官方训练脚本。

## B：DeepSpeed Phi‑4 SuperOffload

- 原始脚本与模型结构位于 `D:\Projects\compute-graph-viewer-wzh\Profiling_Insight_and_Tool\training-run-twin-standalone\config-test\new test\05_deepspeed_phi4_superoffload`。上游提交与模型结构来源见该目录的 `../README.md`。
- [脚本内嵌的 DeepSpeed JSON 快照](./phi4-superoffload-default.json)：只读取脚本 `MODE=superoffload` 分支的 heredoc，把脚本默认 `BATCH_SIZE=4` 代入；没有执行脚本、创建训练输出或启动训练。`MODE=zerooffload` 或传入其他批量参数时，该快照不再代表本次输入。

验收页分别记录“原文被 MCP 解析出的结果”和 Agent 从已记录页面预设或内嵌 JSON 补充确认的事实；解析器未映射的字段不得冒充已由 MCP 校验。
