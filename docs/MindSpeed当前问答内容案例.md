# MindSpeed 当前问答内容案例

核对日期：2026-11-12。

> 本文分析对象是 `D:\Projects\MindSpeed`（MindSpeed Core）。本文保存在 `D:\Projects\mindspeed-config-mcp\docs`，该位置只是文档存放位置，不代表分析对象是配置 MCP。本文纠正此前把两个仓库混淆的案例。

## 先说明：原生使用方式不是问答或 MCP

当前 MindSpeed 仓库是面向昇腾 NPU 的训练加速库。README 的典型用法是在 Megatron-LM 的 `pretrain_gpt.py` 中导入适配器，再通过训练启动脚本配置并行、内存、通信等特性：

```python
import torch
import mindspeed.megatron_adaptor
```

用户实际输入是 Python 代码、命令行参数、模型与数据路径等；程序执行后产生训练行为、日志、异常或落盘文件。它不是必须由 Agent 调用的工具，也没有本文此前误写的九个 MCP 工具及 `content` / `structuredContent` 返回契约。

这里保留“问答案例”的文件名，是用问答解释如何使用原生功能。下文的中文答复是使用说明，不是 MindSpeed 自动生成的自然语言答复。

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
