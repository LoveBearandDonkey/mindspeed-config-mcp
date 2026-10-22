# 对话审阅暂存区

这里保存场景 2 的独立审阅输入。原始 YAML、训练契约副本和外部 Phi‑4 脚本均不改写。

- `openpangu-2048-analysis-contract.json`：从同一页面预设生成的完整契约副本提取纯计算字段。其注意力头数来自 YAML 的 `model.model_config.num_heads=48`；每节点 8 卡、昇腾 910B、64 GiB 来自页面预设及 YAML 注释；微批 1、全局批 12288、EP 从 DP 切分、CP=Ulysses 和 PP offset 由 YAML 与预设交叉核对。此文件只供 MCP 静态复查，不是 MindFormers 可执行 YAML。契约中的 `model.id` 与原 YAML 的 `trainer.model_name` 仍需按实际框架语义确认。
- `phi4-superoffload-confirmed-facts.json`：只记录原脚本、脚本内嵌 JSON 和模型 JSON 能直接支持的事实。目标设备、显存和完整并行条件没有写入，不可当成可运行训练配置。
- `openpangu-128-pilot-candidate.training.json`：从原完整契约复制出 128 Rank / 每卡可用 32 GiB 的先导实验候选，改为 DP16、PP8、EP8、全局批 128、微批数 8，并采用 8 Stage 的 offset。MCP 已对这份副本执行静态校验、Rank、理论容量和修改差异复查；它仍是审阅副本，不是可直接启动的 MindFormers YAML。卡型暂沿用昇腾 910B、每节点 8 卡；原契约中的模型名差异仍需确认。

场景 3 的 128 张 NPU / 可用显存 32 GiB 是新的规划条件，不覆盖上述 2048 卡来源。所有容量数字均为 `theoretical`，需要目标环境实测。
