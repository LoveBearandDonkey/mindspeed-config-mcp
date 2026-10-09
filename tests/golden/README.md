# Golden 输出

`a01-a15.golden.json` 保存验收矩阵 A01～A15 及动态 PP Stage 边界的稳定摘要。`parser-dialects.golden.json`
保存 MindFormers、Megatron Shell、LLaMA-Factory 和 DeepSpeed 的字段映射、保守默认值、
同文件推导值与剩余缺口。Golden 只记录确定性字段，不记录 DOM 标识或时间戳。

运行：

```powershell
npm run test:golden
```

规则有意变化时，必须先核对 [`docs/验收矩阵.md`](../../docs/验收矩阵.md) 和来源证据，
再更新 Golden；不能仅因为测试失败就覆盖快照。
