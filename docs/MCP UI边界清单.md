# MCP UI 边界清单

## 目的与口径

本清单是 `UI 逐项改造清单` 第 4 项的盘点结果。它回答当前页面中的 DOM、文案、面板和表单分别由哪个 Tool 或稳定契约支撑，以及后续保留、删除或复核的去向。

- 盘点基准：`apps/web/config-relation-plane-baseline/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp.html`。
- 4173 基线永久只读。后续删除只作用于 MCP App 工作副本或构建期的可审查变换。
- “保留”表示属于五类纯计算 Tool 或 MCP App 宿主必需能力；不表示允许浏览器继续复制业务公式。
- “删除”均由对应批次实施；已完成批次只改 MCP App 构建产物，4173 基线不变。
- “复核”表示先保留到对应 Tool 接通，再在第 15 项检查是否仍有契约或 `structuredContent` 去向。

## 顶栏与壳层入口

| 当前入口 / 选择器 | 当前行为与实现 | Tool / 契约去向 | 决定 |
|---|---|---|---|
| 工作区文案 `.pto-ide-frame__workspace`（“训练监控”） | 旧宿主名称，无请求 | 无 | 第 8 项已删除 |
| 隐藏页签 `#croViewTabs` 的 relation | 关系主视图 | 校验、Rank、修复、容量结果容器 | 保留行为；最终入口由工作台收敛 |
| 隐藏页签 `#croViewTabs` 的 yaml | 内置/上传配置原文与当前表单生成预览 | `parse_training_config.source`、页面当前配置 | 第 15 项已确认保留；原文明确标为只读，修改表单后回到生成预览 |
| 隐藏页签 `#croViewTabs` 的 doc | `data-observer-view="doc"` | 无 | 第 9 项已删除 |
| `#croDocEntry` | 切换内嵌文档 | 无 | 第 9 项已删除 |
| `#croRankIntro` | 跳到独立 Rank 介绍页 | 无 | 第 8 项已删除 |
| `#croMindSpeedIntro` | 跳到独立 MindSpeed 介绍页 | 用户指定的临时保留入口 | 第 8 项例外保留；后续仅在用户确认后删除 |
| `#croImportConfig` | 文件/文本导入 | `parse_training_config` | 保留 |
| `#croExportConfig` | 只有外观，没有 click 行为 | 无；且会暗示外部写入 | 第 8 项已删除 |
| `a[href="./config-relation-observer.html"]` | 跳到旧 v1 页面 | 无 | 第 8 项已删除 |
| `#themeToggle` | 深浅主题切换 | MCP App 本地显示偏好 | 保留 |
| 动态面板开关 `.crop-panel-toggle` | 收放配置栏/详情栏 | 工作台显示偏好 | 保留 |

## 左侧框架导航

以下入口全部属于批次 A（第 5 项），没有 Tool 或契约去向。第 5 项已从 MCP App 构建产物删除整条 `.pto-ide-frame__activity-rail`，没有使用 `display:none`；4173 基线继续保留：

| 入口 | 当前行为 | 同批清理 |
|---|---|---|
| `#navMonitoring` | 内联 `go()` 跳到训练监控页面 | 跳转监听、图标、焦点站点、rail 布局列 |
| `button[aria-label="Search"]` | 无业务行为 | DOM、图标、焦点站点 |
| `button[aria-label="Source control"]` | 无业务行为 | DOM、图标、焦点站点 |
| `button[aria-label="Terminal"]` | 无业务行为 | DOM、图标、焦点站点 |
| `#navTaskCompare` | 内联 `go()` 跳到训练对比页面 | 跳转监听、图标、焦点站点 |
| `#navRelationEvents` | 展开/收起运行事件栏 | `config-relation-observer.js` 监听和 `aria-pressed` 状态 |

## 面板与结果区域

| 区域 / 选择器 | 当前数据来源 | 目标 Tool / 去向 | 决定 |
|---|---|---|---|
| 导入弹窗 `#croImportPanel` | MCP 解析适配层 | `parse_training_config` | 保留 |
| 配置错误区 `#croConfigError` | 原页本地规则 + MCP 结论 | `validate_parallel_config` | 保留；第 15 项清除剩余重复公式 |
| 配置栏 `#cropLeft`、表单/代码 `#cropLeftTabs` | 当前配置状态 | 五类 Tool 的输入 | 保留 |
| 整网查询 `#croDeckHost` | 原页 3D Deck 与静态模型结构投影 | 无独立 MCP 产品需求 | 第 15 项已从 MCP App 删除整块可见区域、入口和 Deck 资源；模型选择移入保留的配置流程 |
| Layer 导航 `#croLayerNav`、结构 `#croStructure` | 原页 topology | `compute_rank_topology.data.layers/stages` | 保留到第 12 项接线后复核 |
| MoE 专家区 `#croSharedExperts`、`#croRoutedExperts` | 原页 topology | `compute_rank_topology.data.expert_slices` | 保留到第 12 项接线后复核 |
| Rank 矩阵 `#croHeat` | 原页 topology | `compute_rank_topology.data.ranks/nodes/stages` | 保留；第 12 项改由 MCP 结果驱动 |
| 中栏配置视图 `#cropCenter [data-mode="config"]` | 原页 topology | Rank、修复联动 | 保留 |
| 中栏通信视图 `#cropCenter [data-mode="comm"]` | Tool 通信组成员 + 浏览器模拟通信事件、频次、载荷与链路 | `compute_rank_topology.data.groups` 只支撑通信组成员 | 第 15 项删除独立视图和本地模拟；可信的 TP/PP/DP/CP/EP/EDP 组成员并入 Rank 右侧详情 |
| 中栏热力视图 `#cropCenter [data-mode="heat"]`、`.crop-heat-extra` | 构造的运行态负载、事故与时间轴 | 无 Tool、无实测输入 | 第 11 项删除整档及下表全部专用控件；若未来新增稳定契约需重新立项 |
| 右侧详情 `#cropRight` | 选中 Rank/Layer/Stage 的本地查询 | `compute_rank_topology` | 保留；第 12 项接线 |
| 单卡容量 `#croCapacity` | 原页浏览器容量公式；MCP App 已移除该公式 | `estimate_training_capacity` | 第 14 项已接线；保留六段构成、Stage、瓶颈和风险表达，只渲染 `structuredContent` |
| YAML 区 `#croYamlRegion` | 内置/上传原文；表单变更后生成当前 YAML/Shell 预览 | `parse_training_config.source`、页面当前配置 | 第 15 项确认保留；它是配置的代码表达，不要求伪装成 Tool 结果 |

## 运行事件与文档删除批次

### 批次 B1（第 6 项）：运行事件可见区

已从 MCP App 构建产物删除 `#croEventRail`、`#croEventRailExpand`、`#croEventRailCollapse`、`#croIncidentBanner`、`#croIncidentView`、`#croIncidentDetail`、`#croIncidentLineage`，并清除展开/收起状态、事件选择状态、横幅关闭逻辑和 `.cro-board`/事件详情显隐分支。4173 基线保留。

### 批次 B2（第 7 项）：运行事件隐性依赖

已从 MCP App 构建产物删除 `#croMech`、`#croMechPlay`、`#croMechMap`、`#croIncidentFlow`、`#croIncidentStage`、`#croStageZoomIn`、`#croStageZoomOut`、`#croStageZoomFit` 及其事件数据、`MECHANISM_RENDERERS`、`INCIDENT_GROUPS`、事件血缘、定时播放、拖拽缩放与专用 CSS。配置 Rank 画布共用的 pan/zoom 和通用血缘抽屉保留。

### 批次 C（第 8 项）：顶栏旧宿主与占位动作

已删除“训练监控”工作区名、`#croRankIntro`、`#croExportConfig` 与 v1 链接。按用户本轮验收要求暂时保留 `#croMindSpeedIntro`；同时保留 `#croImportConfig`、`#themeToggle` 和 MCP 宿主状态。

### 批次 D（第 9 项）：文档视图

已从 MCP App 构建产物删除 `#croDocEntry`、`#croDocRegion`、`#croDocTocList`、`#croDocBody`、`data-observer-view="doc"` 分支、`config-relation-doc.js`、`config-relation-doc.css`、`.is-doc` 布局和文档滚动状态。`#croYamlRegion` 以及表单/代码切换继续保留；4173 基线不变。

### 批次 D2（第 10 项）：可见与无障碍文案

第 10 项只收敛用户可见文字和无障碍名称，不把内部标识符当成界面文案：

| 当前文字 / 位置 | 第 10 项目标 | 决定依据 |
|---|---|---|
| `aria-label="观测视图切换"` | “配置视图切换” | 表达当前配置视图，不暗示监控采集 |
| `aria-label="配置与关系观测"` | “配置与关系分析” | 页面展示纯计算分析结果 |
| 根节点 `aria-label="Config and Relation Observer"` | “MindSpeed Config Workbench” | 与产品名称和配置工作台定位一致 |
| 中栏“运行观测”及同名 ARIA | “通信分析” | 数据去向是 `compute_rank_topology.data.groups`，不是运行监控 |
| YAML 提示“按当前配置实时生成” | “随当前配置生成” | 表达表单联动，避免被理解为实时采集 |
| 页面能力边界 | 统一说明“纯计算、不启动训练、不采集实时指标” | 明确 MCP 第一版能力范围 |
| “待实测标定”“不是实测”“没有实测回流” | 保留 | 这些是必要的置信度与证据边界，不是监控暗示 |
| `croObserver`、`data-observer-view` 等内部标识 | 不改名 | 用户不可见，改名没有产品收益且会扩大回归面 |

### 批次 E1（第 11 项）：无效视图与控件

26 个训练配置字段均有稳定契约去向，第 11 项不删除左侧配置表单字段。删除范围固定为下列无 Tool、无实测输入的“负载热力”专用视图与控件，不再使用“候选”表述：

| 删除对象 | 选择器 / 控件 | 删除理由 | 同批清理 |
|---|---|---|---|
| “负载热力”页签与 heat 模式 | `#cropModes [data-mode="heat"]`、`#cropCenter[data-mode="heat"]` | 没有 Tool 或 `structuredContent` 去向 | heat 模式切换、默认状态和显隐分支 |
| 六个模拟度量 | `.crop-heat__pill[data-metric="mem"]` 内存占用；`flops` 计算量；`busy` 计算时间；`idle` 空闲时间；`comm` 通信时间；`route` 专家负载 | 全部由浏览器公式和构造故障生成，不是实测数据 | `HEAT_METRICS`、量程、色阶、格式化和点击监听 |
| 色阶与口径说明 | `.crop-heat__legend`、`.crop-heat__help` | 只解释上述模拟度量 | `.crop-heat-extra` 及专用提示文本 |
| 路由塌缩播放与时间滑杆 | `.crop-heat__routeplay`、`.crop-heat__routeslider`、`.crop-heat__routeend` | 复刻已删除的运行事件事故时间线，无稳定输入 | `routeTau`、计时器、四阶段数据与播放监听 |
| 构造故障横幅 | `.crop-heatbanner`、`.crop-heatbanner__phases` | 展示人为构造的慢卡、链路劣化和路由塌缩，不是 Tool 结论 | 故障常量、横幅渲染与阶段状态 |
| 热力格选择与详情 | heat 模式下的格子状态、`.crop-heat-detail` | 详情完全依赖上述模拟模型 | `heatPick`、最坏格选择、详情渲染和专用 CSS |

第 11 项当时保留“配置寻优”和改名后的“通信分析”，以免提前影响第 12 项接线；第 15 项复核后删除独立“通信分析”，仅把 `compute_rank_topology.data.groups` 支撑的通信组成员并入 Rank 详情。“配置寻优”和“内存观测”继续保留。

### 批次 E2（第 15 项）：能力收口

已按最终产品用途完成能力收口：

- 26 个原页面配置字段全部保留；它们均进入统一训练配置或作为明确派生读数，没有发现两个编辑入口写入同一契约字段，因此本项不做臆断合并；
- 保留“表单视图 / 代码视图”。内置和上传配置可显示只读原文，用户修改表单后回到当前配置生成预览；
- 删除顶部整网 3D Deck、整网查询入口及 Deck CSS/JS 资源；模型选择保留并继续作为 Tool 输入；
- 共享专家保留为 `model.shared_experts` 的配置数量说明，不再生成或暗示 Tool 未返回的 Rank 放置；
- 删除独立“通信分析”、通信旅程播放以及浏览器模拟的通信事件、频次、载荷、HCCS/RDMA 路径；
- TP/PP/DP/CP/EP/EDP 组成员继续保留，但收进 Rank 右侧详情，并且只读取 `data.ranks[].group_ids` 与 `data.groups`；
- 原校验、修复、Rank 和容量结果继续由五类 Tool 驱动，页面不恢复被替代的业务公式。

### 批次 F（第 17 项）：死代码与资源收口

清除前述删除产生的不可见死代码、无引用 CSS 选择器、JS 导入、内联模板、资源复制规则和悬空 ARIA 关系；以构建、UI 合约、键盘操作、深浅主题及不同宿主宽度回归作为验收门槛。

## 表单字段到稳定契约的去向

下面覆盖原页 `FIELD_SPECS` 与 `FLAG_SPECS` 的全部 26 个字段。第 15 项已复核它们的统一训练配置去向，没有删除字段，也没有发现两个可编辑控件写入同一个契约字段。

| 页面字段 | 契约字段 | 当前控件位置 | 使用者 | 决定 |
|---|---|---|---|---|
| `totalLayer` | `model.total_layers` | Model Architecture | 校验、Rank、修复、容量 | 保留 |
| `dp` | `parallel.dp` | Model Architecture | 校验、Rank、修复、容量 | 保留 |
| `pp` | `parallel.pp` | Model Architecture | 校验、Rank、修复、容量 | 保留 |
| `tp` | `parallel.tp` | Model Architecture | 校验、Rank、修复、容量 | 保留 |
| `cp` | `parallel.cp` | Model Architecture | 校验、Rank、修复、容量 | 保留 |
| `vpp` | `parallel.vpp` | Model Architecture 高级 | 校验、修复、容量 | 保留 |
| `cpMode` | `parallel.cp_mode` | Model Architecture 高级 | 校验、修复 | 保留 |
| `seqParallel` | `parallel.sequence_parallel` | Model Architecture 高级 | 校验、修复、容量 | 保留 |
| `vocabEmbDp` | `parallel.vocab_embedding_data_parallel` | Model Architecture 高级 | 校验、修复、容量 | 保留 |
| `shardMode` | `memory.shard_mode` | Model Architecture 高级 | 校验、修复、容量 | 保留 |
| `routedExpert` | `model.routed_experts` | MoE | 校验、Rank、修复、容量 | 保留 |
| `topK` | `model.top_k` | MoE | 校验、修复、容量 | 保留 |
| `sharedExpert` | `model.shared_experts` | MoE | 校验、修复、容量 | 保留 |
| `ep` | `parallel.ep` | MoE | 校验、Rank、修复、容量 | 保留 |
| `expertTp` | `parallel.expert_tensor_parallel` | MoE | 校验、修复、容量 | 保留 |
| `totalRank` | `cluster.total_ranks` | Cluster | 校验、Rank、修复 | 保留 |
| `node` | `cluster.ranks_per_node` | Cluster 高级只读 | Rank 节点编址；实际值由卡型与总 Rank 推导 | 第 15 项确认保留；它是节点数量派生读数，不是卡型号或总 Rank 的重复控件 |
| `microBatch` | `batch.micro_batch_size` | Cluster | 校验、修复、容量 | 保留 |
| `seqLen` | `batch.sequence_length` | Cluster | 校验、修复、容量 | 保留 |
| `microBatchNum` | `batch.micro_batch_count` | Cluster 高级 | 校验、修复、容量 | 保留 |
| `recomputeMode` | `memory.recompute_mode` | Cluster 高级 | 修复、容量 | 保留 |
| `recomputeLayers` | `memory.recompute_layers` | Cluster 高级 | 修复、容量 | 保留 |
| `dtype` | `memory.compute_dtype` | Cluster 高级 | 校验、修复、容量 | 保留 |
| `paramsDtype` | `memory.parameter_dtype` | Cluster 高级 | 修复、容量 | 保留 |
| `lora` | `memory.lora_enabled` | Cluster 高级 | 修复、容量 | 保留 |
| `loraRank` | `memory.lora_rank` | Cluster 高级 | 修复、容量 | 保留 |

## 非 `FIELD_SPECS` 控件与派生读数

| 页面项 | 契约去向 | 决定 |
|---|---|---|
| `#croModelSelect` / `model` | `model.id`、`model.hidden_size`、`model.num_attention_heads`、`model.num_key_value_heads`、`model.ffn_hidden_size`、`model.expert_ffn_hidden_size`、`model.vocab_size`、`model.first_k_dense_layers` | 保留；模型预设是这些结构常量的当前输入来源 |
| `#croConfigPresetSelect` | 一次设置多项训练配置字段 | 保留；不是独立契约字段 |
| `#croEpMode` / `epMode` | `parallel.ep_mode` | 保留 |
| `#mcpPipelineLayerMode` | `parallel.pipeline_layer_mode`、`parallel.num_layer_list` | 保留 |
| `#croCardSelect` / `card` | `cluster.ranks_per_node`、`cluster.card_model`、`cluster.card_memory_gib` | 保留 |
| `globalBatch` | `batch.global_batch_size` | 保留只读结果；由 MBS × DP × micro-batch count 生成请求 |
| `hiddenDim` | `model.hidden_size` | 保留只读结果；来自模型预设 |
| 导入源选择与文本 | `parse_training_config.source` | 保留 |
| `policy.locked_fields` | 已接入第 13 项修复建议区 | 仅允许用户显式锁定；单候选时隐藏，多候选时默认折叠 |
| `policy.objective` | 已接入第 13 项修复建议区 | 多候选时提供四种 MindSpeed 规则派生排序；旧值只在核心层兼容，不再作为 UI 选项 |
| `schema_version`、`rule_profile.*` | 适配层按方言与框架生成 | 不做用户表单；保留来源和框架差异说明 |

## 文件与资源责任

| 文件 | 当前责任 | 后续去向 |
|---|---|---|
| `config-relation-observer.js` | 表单、topology、关系联动；4173 基线仍混有事件数据与渲染 | 第 6～7 项已在 MCP 构建期拆除事件责任；纯计算逐步由 Tool 替代 |
| `config-relation-plane.js` | 三栏布局、Rank 画布、通信、热力、右栏 | 保留 Rank 基础；第 11 项删除无 Tool 热力，第 12 项接 MCP topology |
| `config-relation-capacity.js` | 4173 基线仍保留浏览器容量公式与图形 | MCP App 构建时整份移除脚本，由 `mcp-capacity-adapter.js` 把 `structuredContent` 映射回原 DOM，不复制业务公式 |
| `config-relation-yaml.js` | 表单/代码视图、内置/上传原文与当前配置生成预览 | 第 15 项确认保留；原文和生成预览明确区分来源 |
| `config-relation-doc.js` / `config-relation-doc.css` | 仅存在于 4173 基线的内嵌文档 | 第 9 项已从 MCP App 整份移除 |
| `config-relation-import.js` | 原页导入；MCP App 已由解析适配层接管关键事件 | 保留 DOM；第 17 项清理被适配层取代的死分支 |
| `ide-frame-pattern.css` | 顶栏、activity rail、工作区框架 | 删除 rail 规则前先确认顶栏仍引用的共用规则 |

## 验收与变更门槛

- `apps/mcp-server/test/ui-boundary-inventory.test.js` 锁定批次 A、B1、B2、C、D、E1 当前确实存在的 DOM、监听、样式证据。
- 同一测试从原页源码提取 `FIELD_SPECS` 与 `FLAG_SPECS`，要求 26 个字段全部出现在本清单并具备契约去向；以后新增字段而未登记会直接失败。
- 批次 A、B1、B2、C、D、E1、E2 已增加双向断言：MCP App 产物不存在已批准删除的 DOM、监听、状态和专用公式，4173 基线仍存在；批次 C 另断言 `#croMindSpeedIntro` 按用户要求保留，批次 D/E2 断言配置原文、生成预览与 26 个字段保留，批次 E2 另断言通信组成员改读 Tool 结果并进入 Rank 详情。
- 第 6～8 项没有改动 `config-core`、契约或第 12～14 项的业务接线；运行事件减法不影响配置关系和 Rank 画布共用组件。
