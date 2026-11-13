# MindSpeed 当前问答内容案例

主体核对日期：2026-11-12；案例三补充核对：2026-11-13。

> 本文主体分析对象是 `D:\Projects\MindSpeed`（MindSpeed Core）；2026-11-13 新增的案例三单独说明 MindSpeed-Agent 的 Issue 分诊插件及 Observatory 网页。本文保存在 `D:\Projects\mindspeed-config-mcp\docs`，该位置只是文档存放位置，不代表所述能力属于配置 MCP。各案例按所属仓库区分。

## 先说明：原生使用方式不是问答或 MCP

当前 MindSpeed 仓库是面向昇腾 NPU 的训练加速库。README 的典型用法是在 Megatron-LM 的 `pretrain_gpt.py` 中导入适配器，再通过训练启动脚本配置并行、内存、通信等特性：

```python
import torch
import mindspeed.megatron_adaptor
```

用户实际输入是 Python 代码、命令行参数、模型与数据路径等；程序执行后产生训练行为、日志、异常或落盘文件。

## MindSpeed 对比MindSpeed-Agent
两者通常配合使用。

### MindSpeed 适配与执行专家

>我已有训练代码，要在昇腾上运行或提速

MindSpeed 的检查实际嵌在 Megatron 参数校验及特性校验过程中（训练程序的一环）；它最本质的能力，依然是负责让	Python 训练在昇腾 NPU 上适配并加速。检查只是执行前顺手做的事。
比如

执行前校验（初始化时触发）：参数是否满足要求，某个特性依赖的功能是否开启

运行适配：某个训练框架使用了 CUDA 专用接口、算子或通信方式，需要进行昇腾适配；

加速优化：通过融合算子减少执行开销，通过通信重叠减少等待，通过并行和内存优化支持更合适的训练规模。效果可能体现为吞吐提高、耗时下降或内存占用降低；


使用方式是，在配套环境（你的电脑）中安装 MindSpeed，然后在 Megatron 的训练脚本中“import”引入

### MindSpeed-Agent 规则检查专家

>我不知道参数怎么配、为什么报错、该改哪里

>我要把 GPU 模型迁移到昇腾

MindSpeed-Agent 则提供专门的审查、preflight 和训练验证工作流，负责帮助开发者分析、配置、迁移、调优和验证训练。

使用方式是，需要加载到Agent（如Claude Code、Codex）中使用。服务供给方式是插件（执行）+Skills+工作流（组织过程）+资料

## 当前典型输入和输出

| 能力 | 用户实际输入 | 用户可见输出或产物 |
| --- | --- | --- |
| 训练适配与加速 | 导入 `mindspeed.megatron_adaptor`，执行带模型、数据和并行参数的 Megatron 训练脚本 | 训练运行、终端日志、loss 等训练指标；checkpoint 是否保存取决于训练脚本配置 |
| 参数约束检查 | 训练启动时传入特性参数 | 不满足已实现约束时抛出异常；不是一份统一的中文检查报告 |
| Auto settings 并行策略搜索 | 基线训练脚本加 `--auto-settings`、搜索类型、工作目录、目标卡数等 | 实际拉起 Profiling，输出搜索日志和推荐配置，保存 Profiling 及中间数据 |
| Profiling 采集 | 训练脚本加 `--profile`、采集步、Rank、保存路径等 | 指定目录中的性能采集数据，供后续分析；不会自动回答“慢在哪里、怎么改” |
| 数据预处理 | 数据文件、Tokenizer 参数和输出前缀 | 预训练用 `.bin` / `.idx` 文件及处理日志，具体取决于使用的处理脚本和选项 |
| Python 算子调用 | 张量及算子参数 | 张量等 Python 返回值，具体以算子接口为准；不是自然语言答复 |
| 补丁命令 | 安装后执行 `mindspeed -P` 或 `mindspeed -R` | 补丁应用／撤销过程和失败信息；这个 CLI 是补丁启动器，不是聊天入口 |

## 案例一：让程序搜索并行配置

### 用户问题

> 我有一份已经能跑的训练脚本，现在想在 16 张 NPU 上试试更合适的并行策略。MindSpeed 自己能搜索吗？怎么运行，最后会给我什么？

### 使用说明式答复

可以使用 Auto settings。它需要基线训练脚本、适配的运行环境和真实 Profiling，不是只提交卡数就做一次离线问答。官方说明提供 `white`、`black`、`mixed` 三种搜索方式；搜索涉及实际启动采集任务。

以两节点、每节点 8 张 NPU 的基线脚本为例，在传给训练程序的参数列表中加入下面的片段。已有的模型、数据、Tokenizer、训练参数仍需保留；这不是独立完整的启动命令。

```bash
--auto-settings \
--auto-settings-type mixed \
--auto-settings-work-dir ./auto_settings_dir \
--auto-settings-ranks 16 \
--auto-settings-log-level info \
--target-nnodes 2 \
--nproc-per-node 8 \
--master-addr "$MASTER_ADDR" \
--master-port 6005 \
--node-rank "$NODE_RANK"
```

其中主节点地址、节点 Rank 和节点数量应与实际基线脚本一致，主端口需按环境设置。当前特性校验明确禁止 Auto settings 与 `--save` 或 `--load` 同用，不能原样保留基线里的这些选项。

### 原生输出是什么

程序会打印搜索过程及推荐配置。以下是源码中的固定日志内容，省略了时间戳、日志前缀和阶段性日志；尖括号占位内容用于说明，不是实测结果：

```text
<==========Auto settings search config start==========>
<==========Final config generated==========>
The recommended configurations are:
<==========Top #0 config==========>
<本次搜索得到的配置对象的字符串表示>
<==========Auto settings search completed==========>
```

代码请求搜索前三组配置；实际有哪些结果取决于搜索过程，不能在没有运行时编造 TP、PP、显存或性能数值。除日志外，工作目录还用于保存 Profiling 和中间配置数据，代码中有 JSON、Pickle 等文件读写。这些是运行过程的数据，不是统一的 MCP JSON 响应。

### 依据和验证边界

- 使用说明：`D:\Projects\MindSpeed\docs\zh\features\auto_settings.md`。
- 搜索及推荐日志：`D:\Projects\MindSpeed\mindspeed\auto_settings\auto_settings.py`，`search(..., topk=3)` 和最终日志输出。
- save/load 限制：`D:\Projects\MindSpeed\mindspeed\features_manager\auto_settings\auto_settings_feature.py`。
- 本文只核对文档和代码，没有在 NPU 上执行搜索，没有真实候选数值。

## 案例二：采集慢训练的性能数据

### 用户问题

> 训练能跑，但速度不理想。我想先看 Rank 0 的 CPU 和 NPU 数据，只采一小段，不想整段训练都采。怎么开，采完能看到什么？

### 使用说明式答复

在已有训练脚本参数中加入下面的片段，然后按原方式启动训练：

```bash
--profile \
--profile-step-start 30 \
--profile-step-end 35 \
--profile-level level1 \
--profile-with-cpu \
--profile-ranks 0 \
--profile-save-path ./profile_run_001
```

这里选择全局 Rank 0，启用 CPU 信息采集，并设置采集调度区间。应让训练执行足够的步数。源码将 `skip_first` 设置为开始值，将 `active` 设置为结束值减开始值，不应把参数理解为包含两个端点的六步采集。

### 原生输出是什么

训练继续执行，Profiler 在指定目录导出采集数据。源码使用：

```python
on_trace_ready=torch_npu.profiler.tensorboard_trace_handler(args_.profile_save_path)
```

用户获得的是 `./profile_run_001` 下的性能数据，供后续使用配套性能分析工具查看。具体子目录、文件名和导出内容取决于 torch_npu/CANN 版本及采集选项，不能仅凭这个参数片段保证一套固定文件清单。

它不会原生生成下面这样的问答结论：

> “你的训练慢是因为某项并行参数，建议改为某个值。”

这是性能数据采集入口。把采集证据进一步解释成根因或调参建议，需要后续分析，不能把“已经采集”写成“已经完成诊断”。

### 依据和验证边界

- 使用说明：`D:\Projects\MindSpeed\docs\zh\user-guide\profile.md`。
- 采集实现：`D:\Projects\MindSpeed\mindspeed\core\training.py` 的 `train_decorator`。
- 另一处采集适配：`D:\Projects\MindSpeed\mindspeed\functional\profile\adaptor.py`。
- 本文没有在 NPU 上执行训练或生成本例的采集文件。

## 所以，输出是纯文字还是结构化数据

不是只有纯文字，但也没有覆盖全部功能的统一响应结构。

| 输出类型 | 原生例子 | 常见用途 |
| --- | --- | --- |
| 文字 | 运行日志、参数异常、Auto settings 推荐配置的文本打印 | 查看运行情况、定位错误、读取搜索结果 |
| 性能数据文件 | Profiler 导出的采集数据 | 后续性能分析和可视化 |
| 内部结构化文件 | Auto settings 使用的 JSON、Pickle 等 | Profiling 编排、解析、搜索和中间状态传递 |
| 训练／数据产物 | 按配置保存的 checkpoint、预处理 `.bin` / `.idx` | 训练续跑、模型保存和数据加载 |
| Python 对象 | 算子返回的张量等 | 模型计算，由调用代码消费 |

前文提到的 `quick_assessment`、`required_inputs`、统一 `structuredContent` 等，属于相邻的配置 MCP 仓库，不能据此描述当前 MindSpeed 原生接口。

## 指定 docs 目录里与原生使用相关的文档

`D:\Projects\mindspeed-config-mcp\docs` 中有相关说明，但侧重点是集成与能力映射：

- [集成分析.md](./集成分析.md)：第 1、2 节区分 MindSpeed Core、MindSpeed Agent 和 MCP，表格中列出 Core 的典型输入为模型、训练参数、集群及并行配置，典型输出为实际训练行为和性能。
- [源码能力映射.md](./源码能力映射.md)：列出从 MindSpeed 参数约束、Auto Settings 等代码提取规则的来源，不是完整的原生操作手册。
- `MCP本地使用.md`、`V2版-用户使用流程.md`：介绍配置 MCP 的使用，不能当作 MindSpeed Core 自身的原生入口说明。

原生操作优先参考当前 MindSpeed 仓库的 README、`docs/zh/user-guide/quickstart.md`、`docs/zh/user-guide/profile.md` 和 `docs/zh/features/auto_settings.md`。

## 案例三：在 MindSpeed-Agent 中按需打开 Observatory Issue 看板

记录日期：2026-11-13。对象为 `D:\Projects\MindSpeed-Agent` 中的 `mindspeed-scan-issue-agent` 插件；两张页面截图由用户提供，保存在本文同目录。

### 用户问题与答复要点

> 这个页面是在 MindSpeed-Agent 工作流中给用户提供的吗？什么时候触发，展示的内容是什么？

是。Observatory 是 **GitCode Issue 分诊插件按需提供的专业网页**，用于查看仓库问题、检阅分诊结果，以及配置凭据和发布权限。它不是覆盖训练、推理、迁移和算子调优的统一工作台，也不是 MindSpeed Core 的原生界面或配置 MCP 的 MCP App。

插件通过 `gitcode-issue-triage` Skill 识别需求，由 Python 启动器安装、构建和运行独立的 `mindspeed-issue-observatory` 网站。用户可以从宿主 Agent 发起，也可以直接运行命令。

### 什么时候触发页面

| 用户需求或执行阶段 | 插件行为与页面作用 |
| --- | --- |
| “打开 Ascend/MindSpeed-Agent 的 Issue 看板”“查看这个仓库的 Issue 可视化情况” | 使用已确认的目标仓库执行 `visualize --repo owner/repo`，启动本地网站并打开浏览器；没有明确仓库时才询问 |
| 批量分诊前发现没有只读 Token | 引导进入 `/agent-settings` 配置本机凭据；无 Token 也允许先启动设置页 |
| 用户直接执行 `visualize` 命令 | 不依赖聊天，直接启动同一套完整网页 |
| 普通扫描或分析候选 Issue | 使用 `scan --mode dry-run` 返回分析结果，不要求每次打开网页；需要代码证据或草稿时可进入 `shadow` 模式 |
| 交互发布前需要审批 | 在设置页读取具体仓库的待审批草稿，核对完整内容后给予单次授权；审批不等于立即发布，实际执行前仍需重新核查 |

典型协作链为：**用户在宿主 Agent 提出 Issue 管理需求 → 插件收集和分析 → 按需打开网页检阅 → 用户配置或审批 → Agent 继续执行。** 首次缺少凭据时，设置步骤会前移到批量分析之前。

### 页面一：Issue 分析看板

入口示例：`http://127.0.0.1:5173/?repo=Ascend%2FMindSpeed-Agent`。

![Observatory Issue 分析看板：尚未采集及请求失败状态](<./Issue 分诊插件提供完整的 Observatory 网页.png>)

看板提供分析概览、Issue 工作台、采集与变化、分析设置等入口。按页面实现，可展示以下信息；本图仅截取其中的分析概览部分：

- Open Issue、明确 Bug、疑似 Bug/待分诊、高优先级关注数量。
- 问题领域分布、积压时长、需关注的问题清单，以及搜索、筛选和导出。
- Issue 详情、纳入原因、建议优先级与证据入口，可跳转 GitCode 原单。
- 采集时间、数据可见范围、历史快照和变化，以及具备所需数据后的近 30 天响应/解决效率。

**本次截图的真实状态。** 当前对象为 `Ascend/MindSpeed-Agent`，页面显示“尚未采集”“该仓库尚未成功采集”，并提示“不允许跨站请求”。因此，图中的 `0` 是当前未成功采集状态下的展示，**不能解释为仓库实际没有 Issue，也不能据此计算 Bug 数量或服务效率**。本次未排查跨站请求错误的根因，不能将它直接归因于 Token 缺失。

分类和优先级属于分析建议，不等于已复现并确认代码缺陷；Open 状态也不保证代码尚未修复。阅读结果时应同时核对采集时间、可见范围、原单和关联代码。

### 页面二：Agent 设置中心

入口：`http://127.0.0.1:5173/agent-settings`。

![Observatory Agent 设置中心：凭据、可信仓库与单次发布审批](<./Issue 分诊插件提供完整的 Observatory 网页-设置.png>)

| 区域 | 用法与边界 |
| --- | --- |
| GitCode 凭据 | 分别配置只读 Token 和发布 Token；提交给本机服务，保存到 Windows 凭据管理器，网页不回显；不要粘贴到聊天或仓库文件 |
| 可信仓库 | 添加 GitCode `owner/repo`，设置默认仓库及交互/定时发布开关；点击保存仓库配置后生效，新仓库默认不能发布 |
| 单次发布审批 | 选择仓库并读取待审批草稿，核对具体 Issue 和完整回复后授权；交互审批绑定本次草稿，仍需 Agent 执行发布命令并核查远端结果 |

本图中只读与发布 Token 均为“未配置”，目标仓库为 `Ascend/MindSpeed-Agent`，交互发布和定时发布均未勾选，也没有展示已批准的草稿。定时发布属于单独模式，只允许预设模板，除仓库开关外还需调度命令显式请求；不能把“已打开设置页”或“已加入可信仓库”当作发布授权。

### 本次启动方式与后续使用

运行环境要求 Python 3.10+、Git、Node.js 24+ 和 npm。以下命令在插件目录执行，`visualize` 启动完整网页；旧 `serve` 只提供轻量诊断页，不能替代完整看板。

```powershell
Set-Location 'D:\Projects\MindSpeed-Agent\plugins\mindspeed-scan-issue-agent'
python scripts/issue_agent.py check
python scripts/issue_agent.py visualize --repo Ascend/MindSpeed-Agent --port 5173 --sync-interval-minutes 0
```

本机的 `python` 命令为 Windows 应用执行别名，本次实际使用已有 uv 管理的 Python 3.12 启动：

```powershell
uv run --no-project --python 3.12 python scripts/issue_agent.py visualize --repo Ascend/MindSpeed-Agent --port 5173 --sync-interval-minutes 0
```

首次启动自动拉取网站的 `codex/agent-settings-v0.4` 分支，执行依赖安装和生产构建；后续复用本地安装。此次服务监听 `127.0.0.1:5173`，启动器健康检查通过。无只读 Token 时先打开设置页；配置后需重启网站，采集进程才会使用新凭据。完整批量分诊需满足凭据要求，公开 API 的不完整降级预览需要用户明确接受。

查看状态和停止服务：

```powershell
python scripts/issue_agent.py visualize-status
python scripts/issue_agent.py visualize-stop
```

### 刷新机制：服务端和浏览器分别控制

| 机制 | 默认行为 | 本次启动及使用说明 |
| --- | --- | --- |
| 服务端定时同步 | 启动时执行，之后默认每 60 分钟采集；不依赖浏览器保持打开 | 本次用 `--sync-interval-minutes 0` 关闭，仅作用于服务端调度 |
| 看板前端刷新 | 页面打开时，若为基线或数据超过 15 分钟，会尝试采集；之后默认每 15 分钟刷新，可在分析设置中调整或暂停 | 图中仍显示“每 15 分钟自动分析”，所以不能说全部自动刷新已关闭 |
| 手动刷新 | 用户点击“立即分析”触发采集 | 采集能否成功仍取决于请求、权限和数据源；本次截图显示失败状态 |

本案例确认了网站构建启动和两类页面的用途，没有完成真实 Issue 数据采集、缺陷复现、草稿发布或跨站请求故障修复。截图用于记录交互入口与当前状态，不作为完整分诊效果的验收证据。

### 依据

- [GitCode Issue 分诊 Skill](../../MindSpeed-Agent/skills/common/common/gitcode-issue-triage/SKILL.md)：触发话术、模式选择、凭据预检与页面启动约定。
- [Issue 分诊插件说明](../../MindSpeed-Agent/plugins/mindspeed-scan-issue-agent/README.md)：完整网站、轻量诊断页、启动要求与发布流程。
- [网站启动器](../../MindSpeed-Agent/plugins/mindspeed-scan-issue-agent/engine/issue_agent/web_observatory.py)：安装分支、监听地址、健康检查、凭据注入与服务生命周期。
- 本机网站代码位于 `C:\Users\24565\AppData\Local\9-17-scan-issue-agent\web-observatory\app`；`app/page.tsx` 用于核对看板内容与前端刷新，`app/agent-settings.tsx` 用于核对设置和审批，`scripts/serve.mjs` 用于核对服务端定时同步。以上说明对应本次安装版本。
