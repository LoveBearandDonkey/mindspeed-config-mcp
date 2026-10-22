# V2 约束视图原型

独立页面：[constraint-lens.html](./constraint-lens.html)。直接用浏览器打开即可；它不接管当前工作台入口，也不写源配置。实验代码、测试和构建脚本均位于本目录，不修改 `config-core`、MCP 服务或其契约。

双样本验收展示页：[v2-dual-sample-acceptance.html](./v2-dual-sample-acceptance.html)。页面采用约束视图的问句气泡与答复 panel，按六个场景纵向排列，左右对照页面的 openPangu 2.0 参考配置（2048 卡）与 DeepSpeed Phi‑4 SuperOffload。场景 1～3 的文字固定于 2026-10-21 的[来源快照](./fixtures/README.md)和当前连接的 V2 MCP 结果；场景 4～6 明示待验收。此静态页本身不调用 MCP、不修改文件；修改答复内容后运行 `node apps/web/prototypes/build-v2-dual-sample-acceptance.mjs` 重新生成页面主体。完整记录见[双样本逐项验收记录](../../../docs/V2双样本逐项验收记录.md)。

## 参考与设计判断

[ChatGPT Learn 的三个 inline visualizations](https://learn.chatgpt.com/docs/visualizations#explore-interactive-examples) 分别用曲线、波场和分词步骤表达当下的一个关系，控件紧贴所展示的关系。该文档也建议选择足以解释问题的最小图形形式。[Microsoft 的信息架构建议](https://learn.microsoft.com/en-us/power-platform/well-architected/experience-optimization/information-architecture) 提倡逐步展示次要信息和功能。[Windows 应用设计建议](https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/design-for-lob) 对窄窗口建议把次要详情下移或收起，并保持可读控件和键盘焦点。

由此选用**约束证明卡**：结论句 → 本次判断涉及的量 → 一个可直接读出问题的图 → 当前关系才需要的试调项 → 按需展开字段与规则来源。当前关系决定图形，主视图不固定为 Rank 或内存图。

| 约束类型 | 主视图 | 首屏让用户看到的事实 |
| --- | --- | --- |
| WordSize：并行乘积、总 Rank 与 CP/EP 分层 | 因子链 + Rank 拓扑；失配时显示同刻度对照 | 哪些并行度形成乘积，如何对应每个 Rank，和总 Rank 差多少 |
| 层数、注意力头等不能整除 | 等份分组 + 显式余数 | 每份多少，以及无法分入的余数 |
| 静态校验通过后的 Rank 拓扑 | Stage 行 + TP 分片标注 + 可点选 Rank | Rank 属于哪个 Stage、哪个 TP 分片，相关 PP 配对是谁 |
| 理论容量 | 使用量与卡容量共用刻度 | 哪个 Stage 是瓶颈，以及 theoretical 的证据级别 |

WordSize 页签合并了原“并行乘积”和“CP × EP 拓扑”：有效配置展示因子链与嵌套 Rank 平面，失配或超过 128 Rank 时仍展示因子链及同刻度乘积对照。PP 是 Stage 分区，TP 分片编号直接标在每个 Rank 格上；CP 为行，EP 为分组，外层轴依 `ep_mode` 显示 DP 或 EDP。初始的两个 32 Rank 配置均由 `validateParallelConfig` 和 `computeRankTopology` 计算为有效：正交口径使用 DP 2 × PP 2 × TP 2 × CP 2 × EP 2；切出式使用 DP 4 × PP 2 × TP 2 × CP 2，其中 DP 4 分解为 EDP 2 × EP 2，EP 不再重复计入 world_size。两种口径的 Rank 排列相同，轴含义和乘积不同。

WordSize 的因子与总 Rank 提供滑动条和可填写数字；单行吸顶的 mast 可在最大宽度 1080px 的宽屏布局与 480px 的窄屏布局间切换。宽屏时控制器位于视图右侧，容器宽度不够时移到视图上方；窄屏模式也同步收起页签和拓扑图的横向排布。视图内保留只读乘积式与 TP 分片标注。色彩、圆角和排版参照仓库根目录的 `色彩.png` 及 ChatGPT Learn 的 inline visualization 示例，采用白色卡片、浅灰绘图区、蓝色主强调和橙色余数提示。并行因子可输入 1～1024 的整数，总 Rank 可输入 1～65536；滑动条默认显示 1～16／1～128，填写更大数值时滑动范围随之扩展。

可调页签默认各字段未锁定。用户拖动一个字段时，它始终作为主动值；[原型平衡计算](./constraint-lens-balance.js) 只在未锁字段中寻找通过现有 `validateParallelConfig` 的组合，先比较被动改动字段数，再比较数值改动距离。若有可行解，改动后的被动数字框以橙色高亮 3 秒；锁定字段不会被动变化，但用户仍可手动修改它。若当前模型约束或锁定组合使新值无解，页面保留上一个有效值并以轻量文字说明，不展示临时失配图。当前页签的配置偏离页面载入时的初始值后，结论标签左侧显示“复原”；点击只恢复该页签，WordSize 同时恢复 EP 口径与锁定状态。平衡计算只读复用现有 `parallelWorld`，来源为 `compute-graph-viewer-wzh:shared/plane-rules.js@1e6bb6e`；[原型基线](./constraint-lens-balance.golden.json) 固定了自动调整、锁定跳过和无解回退。为控制页面尺寸，有效拓扑最多展开 128 个 Rank，超过时仍显示计算和校验结果。运行 `node apps/web/prototypes/build-constraint-lens.mjs` 可从[原型入口](./constraint-lens-entry.js) 重新构建独立 HTML 中的计算代码。

均匀分层和注意力切分页签可在右侧编辑本页示例配置；方案默认不选，选择后只更新左侧预览，点击“试用”才写入右侧控件。两个示例各有 7 个分组，有配置问题时列表露出约 3 行半并可滚动，问题行固定在列表下方；问题解决后不显示建议区，列表露出约 5 行半，最后一个分组仍固定在下方。均匀分层用每 Stage 16 层的视图目标展示一个 Stage 缺 12 层；注意力切分展示 2 头未分配。方案同时满足视图目标并通过内嵌 `config-core` 静态复验，试调不会写源配置。Rank 拓扑和理论容量页签仍展示仓库验收夹具与 `config-core` 的测试快照；WordSize 使用内嵌的现有校验能力及本目录实验交互逻辑实时计算。WorldSize V2 顶部可在“原始”和“MCP”间切换。直接打开磁盘 HTML 时默认“原始”，用内嵌 `config-core` 快照生成本地静态试调建议；从 `/mindspeed-config/prototypes/constraint-lens.html` 或 `/mindspeed-config-v2/prototypes/constraint-lens.html` 进入时默认“MCP”，浏览器通过已登录的 HttpOnly 会话调用同源 `/api/tools/suggest_config_fixes`，只把返回的 `structuredContent.data.suggestions` 映射到建议、画布标注和“试用”。原始模式的建议不能冒充线上 MCP 调用；磁盘直开时 MCP 模式没有服务结果。该独立原型通过服务的浏览器工具 API 调用 V2 工具能力，不宣称发起 MCP 协议调用。原型验证单独运行：`node --test apps/web/prototypes/constraint-lens-balance.verify.mjs`，不加入仓库默认测试入口。
