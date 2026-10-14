# Golden 输出

`a01-a15.golden.json` 保存验收矩阵 A01～A15、动态 PP Stage 边界、均匀 PP 整除失败时的动态分层修复候选、已选择动态 PP 但缺少 `num_layer_list` 时的均衡分层修复候选、动态 PP 规则 profile 修复候选、缺少 MindFormers `offset` 矩阵时的均衡矩阵修复候选，以及 Attention Heads / KV Heads 分组约束与修复候选的稳定摘要。`parser-dialects.golden.json`
保存 MindFormers、Megatron Shell、LLaMA-Factory 和 DeepSpeed 的字段映射、保守默认值、
同文件推导值与剩余缺口，并固定缺少机器规格时采用的 950PR 128G 容量优先假设。
Golden 只记录确定性字段，不记录 DOM 标识或时间戳。

运行：

```powershell
npm run test:golden
```

规则有意变化时，必须先核对 [`docs/验收矩阵.md`](../../docs/验收矩阵.md) 和来源证据，
再更新 Golden；不能仅因为测试失败就覆盖快照。
