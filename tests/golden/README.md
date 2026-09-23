# Golden 输出

`a01-a15.golden.json` 保存验收矩阵 A01～A15 的稳定摘要。Golden 只记录规则编号、
Rank 覆盖、修复差异和容量分段等确定性字段，不记录 DOM 标识或时间戳。

运行：

```powershell
npm run test:golden
```

规则有意变化时，必须先核对 [`docs/验收矩阵.md`](../../docs/验收矩阵.md) 和来源证据，
再更新 Golden；不能仅因为测试失败就覆盖快照。
