# UI 逐项改造清单

## 基线与目标

- 唯一视觉和交互基线：`apps/web/config-relation-plane-baseline/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp.html`
- 来源：`D:\Projects\compute-graph-viewer-wzh\Profiling_Insight_and_Tool`
- 来源 Git 提交：`485d520`；复制的是 2026-10-08 的工作区快照，包含源页面尚未提交的更新。
- 原始主页面 SHA-256：`067563EBFA2E584488A4C852B0889A498BECB46E20EEECC61A668849A473A6B2`
- 复制范围：`training-run-twin-standalone`、`shared`、`rank-intro`、`mindspeed-intro`，共 120 个文件；复制后逐文件 SHA-256 校验为 0 个差异。
- 已批准的基线偏差：本项目副本的文件名追加 `-mindspeed-config-mcp`，`<title>` 追加 `· mindspeed-config-mcp`，只用于区分浏览器地址和页签；源仓库、页面可见布局和操作逻辑不变。v1 页面返回 v2 的内部链接同步指向新文件名。

基线目录只用于比对和验收，不直接接入 MCP、不重构、不格式化。后续功能改造应在 MCP App 工作副本或适配层中完成。

### 为什么原清单没有清理项

原清单的第 1～3 项只解决“先把原页装进 MCP App，再逐个替换数据来源”，因此把“原页面壳层、导航、默认状态保持不变”写成了这些阶段的验收约束。这个约束本应只在接线初期生效，却没有继续补一条“接线稳定后收缩产品边界”的轨道，结果把用于像素比对的基线壳层误当成了最终产品范围。运行事件、训练监控、训练对比、通用 IDE 导航、内嵌文档和介绍页并不因此获得 MCP 产品需求。

从第 4 项起纠正为两条并行但逐项验收的轨道：

- **能力接入**：解析、校验、Rank 拓扑、修复建议和容量估算继续由 MCP Tool 的 `structuredContent` 驱动；
- **产品减法**：删除没有对应 Tool、契约或纯计算核心职责的旧宿主模块，并清除其 DOM、监听器、状态、样式和资源。

第 0 项的 4173 页面仍是只读对照基线。后续“删除”只发生在 MCP App 工作副本或构建期的可审查变换中；之前各项“必须保持不变”是当项的局部约束，不是对最终页面的永久要求。

## MCP 页面保留与清除边界

### 明确保留

- 配置导入，以及能映射到稳定输入契约的配置编辑控件；
- 静态配置校验、Rank 拓扑、修复建议和容量估算的展示区域；
- 与上述结果直接相关的模型、并行度、批次、精度、开关、筛选、悬浮和视图联动；
- MCP App 必需的加载、取消、超时、鉴权失效、错误、空结果和重试状态；
- “静态规则”“不启动训练”以及 `theoretical`、`model-informed`、`calibrated` 等能力边界说明。

### 明确清除

- 左侧通用 IDE/框架导航：训练监控、Search、Source control、Terminal、训练对比、配置关系与运行事件等入口；
- “运行事件”侧栏、事件横幅、事件详情、故障传播、计算血缘、机制播放和仅为这些视图服务的代码与资源；
- 顶部“训练监控”工作区名称，以及“文档”“what is rank”“MindSpeed intro”等脱离 MCP Tool 主流程的入口；
- 内嵌文档整页、章节目录、文档视图状态和专用 CSS/JS；
- 没有点击行为、没有 Tool 支撑或会暗示已具备外部写入能力的占位操作，例如当前仅有外观的“导出配置”；
- 暗示正在训练、来自实测监控或已经连接远端系统的旧文案。

### 表单与文本的判定门槛

表单不能凭“现在看起来没用”一次性删除。每个控件必须登记到一张字段去向表，并按以下顺序判断：

1. 能映射到 `packages/contracts/` 的 Tool 输入，或明确控制某个 Tool 请求：保留；
2. 只读展示来自 Tool `structuredContent`，且页面不复制业务公式：保留，但改为结果展示而不是本地计算表单；
3. 暂未接线、但已在后续 Rank、修复或容量 Tool 的稳定契约中：保留到对应能力验收后再判断；
4. 只服务运行事件、训练监控、训练对比、旧文档或原宿主跳转：删除；
5. 没有契约字段、没有 Tool 输出、没有交互行为，或与另一控件重复表达同一输入：删除或合并；
6. 页面规则与框架规则不一致：保留差异提示，不用删控件来隐藏差异。

每次删除都要同时处理可见节点、键盘焦点顺序、事件监听、持久化状态、查询参数分支、CSS、静态数据和构建资源；不得只用 `display: none` 长期遮住旧模块。

## 每一项的固定验收方式

每次只处理下表一行。进入下一行前必须同时满足：

1. 明确本次允许变化的页面区域，其他区域不得发生视觉或交互变化；
2. 对照原版检查布局、尺寸、颜色、字体、间距、滚动、悬浮、折叠、拖拽和主题切换；
3. 验证本项对应的 MCP Tool 输入、加载、成功、警告、错误和空结果状态；
4. 记录偏差；偏差未经确认不得用“近似实现”替代；
5. 由用户确认本项后，再提交代码并进入下一项。

## 改造顺序

| 序号 | 状态 | MCP 能力 / Tool | 本次只改什么 | 必须保持不变 | 验收交互示例 |
|---:|---|---|---|---|---|
| 0 | 已验收 | 原版页面基线 | 在本仓库 4173 端口原样运行复制页面 | 全部视觉与既有操作逻辑 | 打开页面，逐区对照源页面；导入内置配置、切换主题、折叠面板、操作 Rank 视图 |
| 1 | 已验收 | `open_config_workbench` | 让 MCP App 打开时承载原页面壳层，不改页面结构和视觉 | 原页三栏布局、顶部工具栏、导航、默认状态 | 对 Agent 说“打开配置工作台”，看到与 4173 基线一致的页面 |
| 2 | 已验收 | `parse_training_config` | 将文件导入和文本输入接到解析 Tool，仅替换数据来源 | 原文件选择器、示例配置入口、字段回填和提示位置 | 上传 YAML/JSON/Shell，页面原位置展示“已映射、推导、默认、未识别”字段 |
| 3 | 已验收 | `validate_parallel_config` | 将静态校验结果接到原页已有结论、约束和标记区域 | 原配置表单、关系线、卡片层级和交互 | 用户修改 TP 后看到：“配置合法，符合已建模的数学约束”或明确的违规公式 |
| 4 | 已验收 | MCP UI 边界清单 | 建立“DOM/文案/表单 → Tool/契约/去向”清单，并为待删除入口补存在性测试 | 只盘点，不改变页面视觉；4173 基线永久不改 | 能逐项回答每个顶栏入口、左栏入口、面板和表单为何保留或删除，并记录对应选择器、脚本和样式 |
| 5 | 已验收 | 壳层减法 1：左侧框架导航 | 从 MCP App 删除整条 Activity Rail：训练监控、Search、Source control、Terminal、训练对比、配置关系与运行事件入口及其跳转监听 | 主工作区内容、配置输入、Rank/容量区域和 4173 基线不变 | 页面不再出现左侧图标栏；键盘 Tab 不再进入这些入口；主工作区自然补齐宽度，无空白占位 |
| 6 | 已验收 | 壳层减法 2：运行事件可见区 | 删除“运行事件”侧栏、展开/收起按钮、事件横幅和事件详情视图，固定回到配置工作台主视图 | `.cro-board` 内配置、关系、Rank 和容量区域不变 | 搜索页面无“运行事件/传播源/受影响/事件详情/计算血缘”；修改配置仍正常刷新静态结果 |
| 7 | 已验收 | 壳层减法 3：运行事件依赖 | 删除事件数据、渲染器、机制播放、画布缩放、事件专用监听/状态/CSS，以及失去引用的资源 | 不删除配置关系、Rank 画布共用的基础组件 | 构建产物不再含事件数据与事件选择器；无空监听、控制台异常和不可达资源，包体变化有记录 |
| 8 | 已验收 | 顶栏减法 | 删除“训练监控”工作区名称、“what is rank”和无行为的“导出配置”及 v1 链接；按用户要求暂时保留“MindSpeed intro” | 导入配置、MindSpeed intro、表单/代码切换、主题及 MCP 必需状态不变 | 顶栏无已批准删除的旧产品跳转和占位动作；导入 YAML/JSON/Shell 的完整流程仍通过 |
| 9 | 已验收 | 文档视图减法 | 删除文档页签/分支、`#croDocRegion`、章节目录、文档专用 CSS/JS 和相关状态；保留与输入有关的表单/代码视图 | 配置代码视图不是“文档”，不得随之删除 | 页面与构建产物中不再出现文档入口或整篇规则正文；表单/代码切换与配置导入正常 |
| 10 | 已验收 | 可见与无障碍文案收敛 | 将“观测视图切换”改为“配置视图切换”、“配置与关系观测”改为“配置与关系分析”、“运行观测”改为“通信分析”，根节点英文无障碍名改为 MindSpeed Config Workbench；将“实时生成”改为“随当前配置生成”；统一补充“纯计算、不启动训练、不采集实时指标”的边界说明 | 保留公式、来源引用、框架差异、容量置信度以及“待实测标定/不是实测”等诚实边界；不为文案改名内部 `croObserver`、`data-observer-view`，不重复删除第 5～9 项已经移除的事件/监控模块 | 可见文本和无障碍名称不暗示正在训练或连接监控系统；页面明确说明能力边界；“待实测/非实测”说明仍完整 |
| 11 | 已验收 | 无效视图与控件减法 | 删除“负载热力”整档：① `#cropModes [data-mode="heat"]`；② 六个 `.crop-heat__pill[data-metric]` 模拟度量按钮：`mem` 内存占用、`flops` 计算量、`busy` 计算时间、`idle` 空闲时间、`comm` 通信时间、`route` 专家负载；③ 色阶与说明 `.crop-heat__legend`、`.crop-heat__help`；④ 路由塌缩播放和时间滑杆 `.crop-heat__routeplay`、`.crop-heat__routeslider` 及 step 端点；⑤ 构造故障横幅 `.crop-heatbanner` 及四阶段进度；⑥ 热力格选择和右栏 `.crop-heat-detail`；同步删除专用模型、状态、监听和 CSS | 不删除 26 个训练配置字段；不删除“配置寻优”和改名后的“通信分析”；不提前删除第 12～14 项需要的 Rank、修复和容量输入 | 构建产物不再包含 heat 模式、六个模拟度量、路由塌缩时间轴、构造故障或热力详情；字段去向测试仍证明 26 个配置字段完整 |
| 12 | 已验收 | `compute_rank_topology` | 将整网图、Layer/PP 分段、专家切片、Rank 矩阵、右侧选中详情，以及“通信分析”中的通信组成员，统一改为读取 `structuredContent.data`；删除浏览器内重复计算 Rank 坐标和通信组成员的公式。详细的页面变化见下文“第 12 项改造前后对照” | 保持现有三栏布局、Rank 平面画法、缩放与拖拽、“自适应 / Rank 视角 / 整机视角”、“专家着色 / TP 标注 / Layer 标注”、悬浮提示、点击高亮和跨区域联动；4173 基线不变 | 使用同一配置对照改造前后：总 Rank、节点、PP 分段、Layer 类型和专家范围应一致；点击 Rank 13 后，右栏内容必须能逐字段追溯到 Tool 返回的 Rank 记录和通信组，非法配置、调用失败时不得继续显示上一份拓扑 |
| 13 | 已验收 | `suggest_config_fixes` | 把修复候选接到原页已有建议/差异区域，并保留 locked fields | 原错误定位和配置编辑体验 | 锁定不可改字段后，选择一个最小修改方案并回填，再次校验通过 |
| 14 | 已验收 | `estimate_training_capacity` | 用 theoretical 结果驱动原容量与瓶颈展示 | 原显存构成图、Stage 展示和风险表达 | 查看瓶颈 Stage、权重/梯度/优化器/激活拆分，并明确“不是实测峰值” |
| 15 | 已验收 | 表单减法 B：能力收口 | 保留全部 26 个配置字段及“表单视图 / 代码视图”；删除顶部整网 3D Deck 及其入口；共享专家只展示配置数量，不推测 Rank 放置；删除独立“通信分析”及浏览器模拟的事件、频次、载荷和 HCCS/RDMA 路径，把 Tool 返回的 TP/PP/DP/CP/EP/EDP 组成员并入 Rank 右栏；当前未发现重复编辑控件，不做臆断合并 | 配置原文/生成预览、已验收的 Tool 输入、Rank 平面、框架差异和容量表达不变；4173 基线不变 | 内置或上传配置仍可查看原文，修改表单后可查看生成预览；26 个字段完整；页面无整网图和独立通信分析；点击 Rank 可查看来自 `structuredContent.data.groups` 的通信组成员 |
| 16 | 已验收 | MCP App 宿主交互 | 增加加载、取消、超时、鉴权失效和 Tool 错误状态 | 不改变正常成功态的已批准布局 | 断开 MCP 或 Token 失效时，在约定区域中文提示并可重试 |
| 17 | 首版子集待验收 | 减法回归与资源收口 | 首个 MCP 版本只删除确认不进入当前 Vite/MCP Resource 的旧页面副本、重复样例和旧测试入口，并补页面初始化主链路回归；隐藏旧页签、旧解析辅助、热力节点、Deck/通信共用样式和布局分支延期到下一迭代 | 26 个配置字段、预置配置、表单/代码视图、Rank 平面、并行通信组、容量图、宿主状态、MindSpeed intro、`config-core`、契约、Tool 行为及 4173 基线不变 | 首版只验收旧入口不再被引用、当前构建和 98 项测试通过，以及运行时画布、预置配置、表单挂载完整；不以包体缩减作为发布门槛 |
| 18 | 已实现，待用户验收 | MCP 资源打包 | 将验收后的页面及依赖打包为 MCP App Resource | 4173 只作为原始基线；最终 App 只需与逐项批准后的目标区域一致 | Inspector、支持 MCP Apps 的客户端和独立预览三处结果一致，且不再打包被清除模块 |
| 19 | 已验收 | 腾讯云生产部署 | 使用多阶段 Docker 镜像、Compose 和 Streamable HTTP 部署当前 MCP Server 与内嵌 App Resource；首轮团队内测只绑定宿主机回环地址并通过 SSH 隧道访问 | 不改 `config-core`、契约、Tool 业务公式和第 0 项基线；不影响现有服务；不把 Token、上游源码或本地路径写入镜像 | 容器以非 root、只读文件系统运行；实机确认 3000、3001 已占用，本服务仅在 `127.0.0.1:3002` 接收宿主机流量；`/health`、401 门禁、携带 Token 的 MCP/App Resource 以及容器重启恢复均已通过，现有容器持续运行 |

### 第 19 项腾讯云生产部署参数

本项依据 `docs/.部署参数.md` 中已经确认的服务器条件冻结：腾讯云上海 `ap-shanghai-2`、Ubuntu Server 24.04 LTS、x86_64、4 核 CPU、4 GB 内存、40 GB CLOUD_SSD、Docker 27.5.1。首版是纯 CPU 计算服务，**不需要 NPU、CANN、PyTorch，也不挂载 MindSpeed、Megatron-Core 或 MindSpeed-Agent 源码目录**。现有 Model Visualization MCP 的 8787 端口及容器保持不变。

首轮团队内测采用 SSH 隧道：2026-10-12 实机确认 3000 已由 `ascend-tiling-mcp` 占用、3001 已由 Node 服务监听，因此 Docker 只发布 `127.0.0.1:3002`，腾讯云防火墙不开放 3002，客户端通过 22 端口隧道连接。因此域名、DNS、ICP备案、TLS 证书和 443 反向代理在内测阶段可以延期；转为公网 HTTPS 入口前仍必须补齐下表对应参数。

| 参数组 | 冻结值 | 说明 |
|---|---|---|
| 构建平台 | `linux/amd64` | 与服务器 x86_64 一致；从仓库根目录按 `package-lock.json` 做可复现构建 |
| Node.js | `22` 系列 Debian slim 镜像 | 满足仓库 `node >=20.19.0` 和 Vite `^20.19.0 || >=22.12.0`；镜像实现时锁定具体 digest，避免浮动标签静默升级 |
| 镜像/容器名 | `mindspeed-config-mcp:0.1.0` / `mindspeed-config-mcp` | UI 在镜像构建阶段执行 `npm ci`、`npm run build:ui`；运行阶段只启动已构建产物 |
| 生产启动命令 | `node apps/mcp-server/src/http-entry.js` | 不在每次容器启动时重新构建 UI；不使用仅适合本地 stdio 的 `start:mcp` |
| 应用监听 | `MCP_HTTP_HOST=0.0.0.0`、`MCP_HTTP_PORT=3000` | `0.0.0.0` 只表示容器内监听，不能直接发布到公网 |
| Docker 端口 | `127.0.0.1:3002:3000` | 3000、3001 和 8787 均已有服务；腾讯云防火墙不新增 3002 公网规则 |
| 外部端点 | `https://<待分配的 MCP 域名>/mcp` | 后续复用公网 443，由宿主机反向代理转发到 `http://127.0.0.1:3002/mcp`；80 只做 HTTPS 跳转，不接受明文 MCP 请求 |
| 健康检查 | 容器内 `http://127.0.0.1:3000/health`，间隔 30 秒、超时 5 秒、连续 3 次失败判异常、启动宽限 20 秒 | `/health` 无 Token，只返回非敏感服务状态；反向代理可暴露同域 `/health` |
| Host 白名单 | `MCP_ALLOWED_HOSTS=<待分配的 MCP 域名>,127.0.0.1,localhost` | 公网监听时是服务启动硬门槛；值中不写协议和端口。反向代理必须保留原始 `Host` |
| Origin 白名单 | 首版不设置 `MCP_ALLOWED_ORIGINS` | 桌面/服务器 MCP 客户端及 MCP App 宿主桥接不需要浏览器跨域直连；以后确有 Web 客户端时再加入明确来源，不使用 `*` |
| MCP 鉴权 | `MCP_BEARER_TOKEN` 为至少 32 字符的密码学随机值 | 通过服务器密钥文件或部署平台 Secret 注入，文件权限 `0600`；不得写入 Git、Dockerfile、镜像层、Compose 正文或部署日志 |
| 反向代理 | HTTPS 443、HTTP/1.1、关闭响应缓冲、请求体上限 2 MB、读超时 300 秒 | TLS 只在反向代理终止；转发 `/mcp` 和 `/health`，并传递 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto` |
| 容器安全 | 非 root 用户、只读根文件系统、`no-new-privileges`、删除全部 Linux capabilities，仅给 `/tmp` 临时文件系统 | 服务无持久化数据和外部写入需求，不挂载 Docker socket、SSH 密钥或宿主源码目录 |
| 资源与重启 | `1 CPU`、`1 GiB` 内存、无 swap 扩容、`restart: unless-stopped` | 为同机现有服务和系统预留资源；首版上线后根据容器 CPU、内存和请求延迟再调高，不凭理论值扩容 |
| 日志 | Docker `json-file`，`max-size=10m`、`max-file=3` | 不记录 Bearer Token 或用户提交的完整训练配置；日志只保留启动、关闭和脱敏错误信息 |
| 运行时环境 | `NODE_ENV=production` | `.env.example` 中三个上游源码根目录和 `TOOL_MATRIX_ROOT` 均不进入生产环境，它们不是运行时依赖 |

尚需运维在转为公网 HTTPS 前提供三个外部值：可用域名、该域名指向 `42.192.111.92` 的 DNS 记录、覆盖该域名的有效 TLS 证书。三者就绪前可以通过 SSH 隧道完成容器与协议验收，但**不得把 `http://42.192.111.92:3002/mcp` 当作生产入口，也不得为了临时访问关闭 Bearer Token 或 Host 校验**。

部署验收顺序固定为：先确认 3002 未被占用且现有服务健康，再运行完整测试和构建；启动新容器后检查 `/health`、401 门禁和携带 Token 的 MCP 初始化；最后按需要接入 HTTPS，验证 11 个 Tool/界面入口、`ui://mindspeed-config/result-view.html` 和容器重启恢复。任一步失败只回滚新容器和本服务路由，不修改现有服务。

2026-10-12 上云验收记录：腾讯云容器已经在宿主机 `127.0.0.1:3002` 启动，`/health` 返回 `status: ok`，无 Token 请求 `/mcp` 返回 401；SSH 隧道内携带 Token 的真实 MCP 握手可枚举 11 个 Tool/界面入口并读取 App Resource。重启后容器状态为 `Up (healthy)`；`pto-swimlane-d4-candidate`、`ascend-tiling-mcp` 和 `model-visualization-kit` 持续运行，3000、3001、8787 端口未调整，公网未开放 3002。

### 第 17 项首版安全子集与后续迭代

为了优先发布第一个 MCP 版本，第 17 项拆成两个阶段。**首版只做可由入口依赖图证明安全的物理副本清理，不再修改当前页面的 HTML、运行时 JS 或 CSS。** 隐藏 DOM、旧解析辅助、Deck/通信残余、主题和响应式分支统一延期到下一迭代，并且必须先有真实浏览器回归，不能再根据“当前看不见”、名称或包体大小直接判断为死代码。

#### 首个 MCP 版本：本次只做

1. 删除不再由当前 Vite 入口、MCP Resource、服务端注册或测试运行链引用的旧 `ui/mcp-app.html`、`ui/plane-app/` 和旧 `ui/src` 页面实现。
2. 删除旧 `plane-app/config-test/`、旧 `BASELINE.json` 与只测试旧页面实现的测试；把仍有价值的 26 字段/schema 契约检查迁到当前适配层。
3. 更新 `upstreams.lock.json`，让上游基线只指向第 0 项保留目录。
4. 增加页面初始化生命线断言，锁定 `sampleOf`、`#croConfigPresetSelect`、`#croHeat`、`.cro-cluster__grid`、`cropStage`、`cropWorld` 和表单三块 pane；运行时复核预置数量、画布节点和表单挂载。
5. 首版产物允许继续携带隐藏旧页签和共用实现。它们不影响第一个 MCP 版本发布，也不在本轮半小时窗口内继续裁剪。

#### 下一迭代：有浏览器回归后再做

| 删除批次 | 本项具体删除 | 明确保留 / 防止误删 |
|---|---|---|
| 隐藏的旧全局视图切换 | **下一迭代**：删除仍靠 `.pto-ide-frame__topbar-center { display:none }` 隐藏的 `#croViewTabs`、其中“关系视图 / YAML 视图”按钮、`data-observer-view` 监听和旧视图状态；表单/代码切换不再借道这个隐藏 tablist | 保留左栏可见的 `#cropLeftTabs`、“表单视图 / 代码视图”、`#croYamlRegion`、原文与生成预览 |
| 已不可达的整网 3D Deck 实现残余 | 第 15 项已经删除可见的整网 Deck DOM 和入口；本项只删除因 `#croDeckHost` 已不存在而不会产生界面的查询、`createDeck`/渲染与选中同步、主题/调色板同步、整网折叠与视角状态，以及 `.cro-region--net`、`.is-net-collapsed`、整网 grid 列和只服务 Deck 的 `--pto-model-deck-*`/选择器 | 正常界面应零视觉变化；保留模型选择器、Layer/Stage、结构条、MoE、Rank 平面及其实际仍引用的通用颜色。共用样式按选择器逐条裁剪，不整文件误删；若清理后任何当前可见区域变化，视为回归 |
| 独立通信分析残余 | 删除 `data-mode="comm"`、通信旅程/阶段/播放/选中状态和已不可达模板；删除 `.crop-comm*`、`.crop-commflow*` 以及只服务模拟事件、频次、载荷、HCCS/RDMA 路径的变量、动画和响应式规则 | 保留 Rank 右栏“并行通信组”以及从 `structuredContent.data.groups` 读取的 TP/PP/DP/CP/EP/EDP 编号和成员 |
| 前序删除批次余留 | 静态扫描并删除 Activity Rail 的 `.pto-ide-frame__activity-rail`/rail button 专用规则，运行事件 `.cro-event*`/`.cro-incident*`/`.cro-mech*`/stage zoom，文档 `.cro-doc*`/`.is-doc`，负载热力 `.crop-heat*`/route playback 等残余 CSS、JS、模板和主题分支 | `ide-frame-pattern.css` 中仍服务顶栏、主工作区和面板的通用规则继续保留；`hidden` 仅用于真实加载、折叠、弹窗和视图状态，不把它一律当死代码 |
| 旧导入实现 | 从 `config-relation-import.js` 删除已由 `mcp-parse-adapter.js` / `mcp-shell-entry.js` 接管的本地解析、重复监听、重复状态和不可达错误分支 | 保留当前“导入”按钮、文件读取/粘贴、解析报告、缺口补值、应用到表单和清空流程 |
| 焦点与 ARIA | 删除指向已移除节点的 `aria-controls`、`aria-labelledby`、`aria-describedby`、`aria-expanded` 更新，旧焦点恢复目标和不可见元素的 `tabindex`；移除不存在节点上的 click/key/theme listener | 保留可见 tab、折叠区、弹窗、Rank 格、重试和取消按钮的合法 ARIA、焦点环与键盘操作 |
| 旧 MCP UI 实现与打包入口 | **首版安全子集**：删除不再由 Vite 或 MCP Resource 使用的 `ui/mcp-app.html`、`ui/plane-app/`、`ui/src/app.js`、`styles.css`、`preview-results.js`、旧 `workbench.js`/`builtin-configs.js`、`ui/src/plane/`；先把仍有价值的 schema/模型测试迁到当前适配层，再删除只测试旧实现的测试 | 保留当前入口 `vite.config.js → 基线 HTML + mcp-shell-entry.js`，保留当前五类适配器、`mcp-host-interaction.js` 和 `mcp-shell.css`；同步更新 `upstreams.lock.json` 与旧路径文档引用 |
| 重复资源和复制规则 | **首版安全子集**：删除旧 `plane-app/config-test/` 样例副本、旧 `BASELINE.json`、旧资源复制/预览规则，以及不再可能进入当前单文件产物的 import/alias | 保留第 0 项 4173 基线目录及当前从基线 `config-test/` 打包的 YAML/JSON/Shell 样例；删除前验证每个样例仍可从配置下拉使用 |
| 窄屏与主题死分支 | 删除只为整网列、通信视图、事件栏、文档和热力视图设置的 media query、CSS 变量、主题刷新及 resize 分支 | 保留三栏展开/收起、Rank 缩放拖拽、深浅主题和 MCP 宿主宽度适配；在 360、600、900、1280 px 宽度复核无横向空栏和控件遮挡 |

首版安全子集的删除判据是“文件不在当前 Vite/MCP Resource/服务端/测试运行链中，并且删除前后单文件产物及浏览器运行时生命线不变”。下一迭代的运行时减法才使用“当前 DOM、当前 JS 创建路径和当前适配层均无引用”的判据，而且还必须通过真实浏览器对照。不能只因类名来自旧页面就删除，也不能用新增 `display:none` 代替删除。

1. 首版当前 UI 依赖图只有基线 HTML、`mcp-shell-entry.js`、当前适配器和必要样式/样例；旧页面入口只允许在本清单的历史记录和“不存在性”测试中出现。
2. 26 个配置字段、导入、预置配置、表单/代码视图、Rank 视角与标注、右栏并行通信组、理论容量、修复回填、宿主状态和 `MindSpeed intro` 的存在性测试继续通过。
3. 浏览器运行时必须能看到预置配置选项、非空 `cropWorld`、Rank 节点、三块表单区域和已挂载的隐藏计算引擎；出现 `sampleOf` 等初始化异常立即阻止发布。
4. `config-core`、契约、Golden 和五类 Tool 的结构化结果零变化；4173 基线文件 SHA-256 零变化。
5. 首版不要求体积下降。隐藏页签、Deck/通信共用实现、旧导入辅助和 CSS 标记归零全部列入下一迭代，不阻塞第一个 MCP 版本。

### 第 12 项改造前后对照：`compute_rank_topology`

这一项的目标不是重画 Rank 页面，而是把页面中“拓扑事实由谁计算”换掉。改造前，页面根据表单里的总 Rank、每节点卡数、TP、PP、DP、CP、EP 等值，在浏览器中再次推导 Stage、节点、Rank 坐标和通信组；改造后，浏览器只把当前统一训练配置提交给 `compute_rank_topology`，再按 Tool 返回的 `structuredContent.data` 渲染原有界面。相同输入且规则一致时，用户首先看到的应是**数值不变、布局不变、数据来源改变**，而不是一套新界面。

| 原页面区域 | 改造前显示什么、数据怎样产生 | 改造后会变成什么 | 对应 Tool 字段 |
|---|---|---|---|
| 整网查询 `#croDeckHost` | 浏览器根据当前表单自行拼出整网、Stage、Layer 和专家关系 | 保留原整网图的节点形状、层级和点击方式；图中的 Stage、Layer、Dense/MoE 类型及专家分片改读 MCP 结果，不再由页面复制一套拓扑公式 | `data.stages`、`data.layers`、`data.expert_slices` |
| Layer 导航 `#croLayerNav` | 页面本地计算每一层属于哪个 PP Stage，并生成 Layer 刻度和 PP 分段 | 原来的 Layer 刻度、PP 分段色块和选中联动仍在；每个 Layer 的编号、所属 Stage、Stage 内偏移和 Dense/MoE 类型改由返回值决定 | `data.layers[].layer/stage/stage_offset/ffn` |
| 结构条 `#croStructure` | 页面从本地模型预设和本地派生拓扑生成 Emb、Dense/MoE、Norm、Head 等结构，并与 Layer 区联动 | 保留现有结构条外观与点选联动；其中可由拓扑契约确定的 Layer 数量、顺序和 Dense/MoE 分区改读 Tool。Tool 尚未返回的结构语义不得伪装成 MCP 结论，继续保留时要明确它只是页面静态结构说明，并在第 15 项复核去向 | `data.layers`、`data.counts.total_layers/dense_layers/moe_layers` |
| 共享/路由专家区 `#croSharedExperts`、`#croRoutedExperts` | 页面按专家总数和 EP 在浏览器中计算“每个 EP rank 持有哪些专家” | 专家胶囊、颜色和点击联动保留；每个 EP 切片的专家起止编号与完整成员列表直接读取 Tool。共享专家当前不在 `compute_rank_topology` 输出内，不得凭本项结果宣称已由 MCP 计算 | `data.expert_slices[].ep_index/expert_start/expert_end/experts` |
| Rank 矩阵 `#croHeat` | 浏览器用本地 `rank = stage × …` 等编址规则生成每一行、每个 Stage 块、节点边界和 Rank 坐标 | 矩阵仍按原平面布局展示，原来的行列方向、PP 分块、EDP 分组、节点边界和格子样式不变；每个 Rank 放在哪个 Node、哪个 PP Stage，以及 DP/EDP/EP/TP/CP 坐标，全部改读 MCP 返回的逐 Rank 记录 | `data.ranks[]`、`data.nodes[]`、`data.stages[]`、`data.counts` |
| “自适应 / Rank 视角 / 整机视角” | 页面先本地算 Rank，再按缩放级别把多张卡聚合成整机行 | 三个视角及自动切换阈值不变；“整机视角”按 `nodes[].ranks` 聚合，“Rank 视角”按 `ranks[]` 展开。视角切换只改变显示粒度，不重新计算拓扑 | `data.nodes[].ranks`、`data.ranks[]` |
| “专家着色 / TP 标注 / Layer 标注” | 页面根据本地坐标重新判断专家归属、TP 组和 Layer/Stage 展开关系 | 按钮名称、默认状态和视觉效果不变；专家着色读取 `expert_slices`，TP 标注读取 Rank 的 `group_ids.tp` 及 `groups.tp`，Layer 标注读取 `layers/stages`。按钮只控制显示，不在浏览器中重算成员 | `data.expert_slices`、`data.groups.tp`、`data.layers`、`data.stages` |
| 悬浮某个 Rank 格 | 悬浮文案中的 Rank、节点、Stage 和并行坐标来自浏览器本地派生对象 | 气泡的位置和样式不变；文案改为从被悬浮的 `data.ranks[]` 记录取值。没有返回的字段不补猜测值 | `data.ranks[].rank/node/stage/dp_index/edp_index/ep_index/tp_index/cp_index` |
| 点击 Rank 后的右侧详情 `#cropRight` | 页面调用本地 `coordsOfRank` 等查询，展示 Node、PP Stage、DP/EDP、EP、TP、CP、所持专家和关联 Layer | 原右栏分组、胶囊、可点击跳转与画布高亮不变；基础坐标改读该 Rank 记录，所属通信组通过该 Rank 的 `group_ids` 反查 `data.groups`，专家范围从 `expert_slices` 取得，所在 Layer 从其 Stage 对应的 `layers` 取得 | `data.ranks[]`、`data.groups`、`data.expert_slices`、`data.layers` |
| 点击 PP Stage | 页面本地给出层范围、层数、卡数和相关 Rank | 右栏仍显示“PP Stage N”；层起止、层数和 Rank 成员改为直接展示返回的 Stage 记录，点击相关 Rank 仍可回到矩阵定位 | `data.stages[].stage/layer_start/layer_end/layer_count/ranks` |
| 点击 Layer 或专家 | 页面本地反查承载 Rank、节点、Stage 和专家关系 | 原交叉高亮与右栏详情保留；反查只在 Tool 已返回的 `layers`、`ranks`、`stages` 和 `expert_slices` 之间建立，不再另算一份并行坐标 | `data.layers`、`data.ranks`、`data.stages`、`data.expert_slices` |
| “通信分析”中的“谁和谁” | 页面用 stride/count 公式在浏览器内临时生成 TP、PP、DP、CP、EP、EDP 组成员 | 选中 Rank 后，TP/PP/DP/CP/EP/EDP 组的编号和成员列表改为读取该 Rank 的 `group_ids`，再查找 `data.groups`；页面不再用步长公式生成成员。原通信事件名称、次数、载荷、HCCS/RDMA 判断不在当前 Tool 契约内，本项不得把它们标成 MCP 结论，须保留为明确的页面说明或留到第 15 项删除/另立契约 | `data.ranks[].group_ids`、`data.groups.tp/pp/dp/cp/ep/edp` |
| 页面初次打开或修改配置 | 页面可以立即用本地公式重画，用户看不出结果是否来自 Tool | 首次得到合法配置、以及影响拓扑的字段变化后调用 Tool；请求期间在原结果区域显示“正在更新 Rank 拓扑”，避免把旧矩阵误认为新配置结果；成功后一次性替换整网、矩阵和详情所用的数据快照 | Tool 请求参数为当前统一训练配置；成功结果为完整 `structuredContent` |
| 口径与来源说明 | 页面本地结果容易被误认为真实训练运行拓扑 | 在结果区域保留 `page-derived` 口径和 assumptions，明确这是按页面规则生成的静态拓扑，不是训练实测，也没有连接远端集群；Megatron-Core 证据未锁定前，不宣称通信组与实际运行逐 Rank 完全一致 | `data.semantics`、顶层 `assumptions` |

#### 用户能直观看到的变化

- 页面不会新增一套“简化版 Rank 表格”，原来的整网图、Rank 平面和右侧详情仍是唯一主界面。
- 对同一份合法配置，改造前后的 Rank 数、节点范围、PP Stage 分段、Layer 数、Dense/MoE 分区、专家范围和各并行组成员应一致；如果不一致，页面必须把差异作为规则差异暴露出来，不能静默采用其中一套。
- 用户点击 Rank 13 后，右栏仍在原位置显示详情，但每一项都能追溯到同一次 Tool 结果：基础位置来自 `data.ranks[13]`，TP/PP/DP/CP/EP/EDP 组来自该记录的 `group_ids` 与 `data.groups`，不再由浏览器重新算一遍。
- 用户修改 TP、PP、DP、CP、EP、总 Rank、每节点卡数或层数后，旧矩阵先进入更新状态；新结果返回后，矩阵、Stage、Layer、专家区和右栏共同切换，不能出现“矩阵是新配置、右栏还是旧配置”的混合画面。
- 页面会新增明确的来源边界提示，例如“`page-derived` 静态拓扑；不启动训练、不采集实时指标、不连接远端集群”。这不是新增能力，而是把原页面容易误解的能力边界说清楚。

#### 异常状态改造前后

| 场景 | 改造前可能出现的情况 | 改造后必须呈现 |
|---|---|---|
| 静态校验不通过 | 页面局部仍可能按旧公式画出一幅貌似完整的 Rank 图 | 不生成新矩阵；在原结果区展示 Tool 返回的校验错误，并清除或明确失效上一份拓扑，不能让用户把旧图当成当前配置 |
| MCP 调用中 | 页面本地重画速度很快，看不出远端结果是否已经返回 | 原拓扑区域显示加载状态，保留页面尺寸避免布局跳动；禁止用半份新数据刷新局部区域 |
| MCP 调用失败或超时 | 本地公式仍能给出结果，容易掩盖 Tool 实际不可用 | 显示中文错误和重试入口；不得静默降级为浏览器本地公式，也不得把缓存结果标成当前结果 |
| 返回缺字段或空结果 | 页面可能用默认值补齐，从而生成貌似可信的图 | 指出缺少的字段和受影响区域；未获得 Rank/Stage/Group 数据时，对应区域显示不可用，不猜测成员或坐标 |
| 新旧规则结论不一致 | 页面只展示本地推导，差异不可见 | 显式展示页面规则与框架规则的差异；在用户确认口径前，不静默覆盖为任一方 |

#### 第 12 项验收动作

1. 在 4173 打开基线页，在 4174 或 Inspector 打开改造页，加载同一份合法配置；记录总 Rank、节点数、PP Stage 数、每段 Layer 范围、Dense/MoE 层数和专家切片，确认改造页的每个数字都能在 `structuredContent.data` 中找到。
2. 在“Rank 视角”点击 Rank 13；确认矩阵高亮、右栏标题和 Node、PP Stage、DP/EDP、EP、TP、CP 坐标不跳位，并逐一核对 `data.ranks` 中 `rank === 13` 的记录。
3. 在右栏依次打开 Rank 13 的 TP、PP、DP、CP、EP、EDP 组；确认成员来自其 `group_ids` 对应的 `data.groups`，并通过测试证明页面已删除本地 `commPeers` 一类成员生成公式。
4. 点击 Rank 13 所属 PP Stage、Layer 和专家胶囊；确认矩阵、Layer 导航、专家区和右栏仍保持双向联动，缩放、拖拽、适配、三种视角、专家着色、TP 标注和 Layer 标注均与改造前一致。
5. 分别修改 TP、PP、DP、CP、EP、总 Rank、每节点卡数和总层数；确认每次只有同一份 Tool 结果成功后才整体刷新，且快速连续修改时旧请求不能覆盖较新的配置。
6. 输入一份总 Rank 与并行乘积不一致的配置；确认页面只展示静态校验错误，不生成或沿用貌似属于当前配置的 Rank 矩阵。
7. 模拟 Tool 超时、错误和缺少 `groups` 字段；确认页面显示中文失败状态与重试入口，且不会退回浏览器本地拓扑公式。
8. 检查结果边界文案：必须出现 `page-derived`、静态计算、非训练实测、不连接远端；不得出现“实时 Rank”“当前集群状态”或“实际通信组已确认”等超出证据的话。

## 清除批次的事实来源

批次 A～F 的范围、选择器、隐性依赖和验收门槛统一维护在 [`MCP UI边界清单.md`](./MCP%20UI边界清单.md)。本文件只维护第 5～17 项的实施顺序与验收状态，不再复制批次明细；后续范围变化必须先更新边界清单，再实施对应步骤。

## 当前停点

第 12～16 项已由用户确认验收；第 17 项已收缩为首版安全子集并完成回归；第 18 项已实现并待用户验收：

- MCP App 构建入口直接读取第 0 项基线 HTML，不再使用旧版 `mcp-plane-view.js` 重画页面；
- 构建阶段按原顺序内联原版 CSS 和 JS，仅追加无视觉输出的 MCP App 握手桥；
- 单文件产物不含外链 CSS/JS，MCP Server 与 UI 适配测试 8/8、HTTP/鉴权测试 3/3 通过；
- 本机 Chrome/Edge 的无头截图模式被系统环境以退出码 1 拒绝，因此最终像素一致性由用户在 4173 基线与 Inspector 中并排验收；
- 第 1 项已由用户确认并进入第 2 项；第 2 项只接入 `parse_training_config`，不接入校验、Rank、修复或容量 Tool；
- 顶部“导入配置”的文件选择、文本粘贴、解析、回填继续使用原 DOM 和交互位置；
- 左侧“配置”菜单中的 YAML/JSON/Shell 样例随单文件 MCP App 打包并走同一个解析 Tool，内置模型预设仍走原页面逻辑；
- 报告在原区域区分显式映射、同文件推导、省略态默认、未识别、暂不建模和仍缺输入，并明确“不启动训练”。
- 用户验收反馈后的导入区调整：入口改为“导入”并移动到“配置”选择器右侧；选文件后自动解析；弹窗采用“配置代码｜校验结果”左右布局；有代码时显示“清空”；“应用到表单”改为底部主按钮。
- 导入弹窗二次精简：标题栏不显示文件状态，关闭改为 × 图标；说明只保留支持的 YAML、Shell、JSON 三类方言。
- 配置下拉与导入弹窗共用固定 MCP 必填口径：“本文件共 X 个配置，其中 N 项可回填 MCP，缺口 G 项。总适配度 N/M”。X 只统计源文件配置项；M 来自 `config-core` 的固定必填字段集合，不再把文件里的未识别字段计入分母，因此不同文件的分母保持一致。
- 导入弹窗三次调整：简短方言说明移动到标题下方并使用小号常规字重；“应用到表单”左对齐；“导入”入口等待动态配置下拉生成后再移动到其右侧，避免初始化时序导致入口仍留在顶部。
- 预览地址分离：4173 为未注入适配层的基线页面，4174 为带适配层的改造版页面（浏览器内复用 `config-core`，不经过 MCP 协议），6274 Inspector 用于真实 MCP 验收。
- 第 2 项已由用户确认；第 3 项只接入 `validate_parallel_config`，尚未用 MCP 结果驱动 Rank、修复建议或容量图。
- 当前表单自动转换为统一训练配置：模型结构常量取自原页面模型预设，卡数、并行度、批次、精度和开关取自左栏当前值；不要求输入模型源码，也不启动训练。
- 静态校验复用原页面 `croConfigError` 横幅：合法时显示“配置合法，符合已建模的数学约束”，不合法时逐条显示问题和约束公式，并始终显示“只代表静态规则、不是实机运行”的边界。
- 校验涉及的原页面字段使用独立的 MCP 红色/黄色标记；不复用原校验器的 `is-invalid` 状态，避免两套刷新互相清除。收在“高级选项”内的违规字段会就地展开，但不改写用户保存的折叠偏好。
- 4174 独立预览直接调用同一份 `config-core` 校验函数；Inspector 中通过 MCP 协议调用 `validate_parallel_config`。两条路径共用相同的输入转换、结果文案和字段标记适配层。
- MCP 校验横幅在 `.cro-board` 内纵向滚动时吸附在顶部，错误、警告、通过、加载和不可用状态共用相同位置与层级，避免切换状态时跳动；4173 基线不受影响。
- 修正 PP 层数口径：不再把“总层数不能被 PP 整除”无条件判为 MindSpeed 错误。原“高级选项”增加“PP 分层”两档；“均分”按默认 MindSpeed Core / Megatron 规则要求整除，“动态”按 MindSpeed-LLM MCore 的 `num_layer_list` 规则校验。
- 页面不再按 `total_layers % pp` 在浏览器自动选择或补齐动态 PP。没有导入证据、MCP 补齐方案或用户明确选择时按“均分”原样提交；默认 46 层、PP 4 会由 Tool 报告不整除。用户只选择“动态”但没有 `num_layer_list` 时，页面也不生成 `12 / 12 / 11 / 11`，由 `validate_parallel_config` 报缺口，再由 `suggest_config_fixes` 返回可应用分层。
- 动态 PP 同时校验三个条件：`num_layer_list` 项数等于 PP、各项之和等于总层数、VPP 必须为 1；动态 PP 与 VPP 同时启用时返回明确冲突，不再混成普通整除错误。
- 配置解析器已识别 MindSpeed-LLM 的 `--num-layer-list 12,12,11,11`，并推导 `pipeline_layer_mode=dynamic`；应用到表单后同步更新“PP 分层”控件。
- “PP 分层”的均分/动态选择器下方不额外显示 Stage 层数，避免与 Layer 布局重复表达；动态分层仍进入 MCP 校验输入和结论数据。
- `suggest_config_fixes` 遇到均匀 PP 的 `total_layers % pp !== 0` 时，把“切换为动态 PP并生成 `num_layer_list`”作为可直接应用的首选候选，同时保留调整 PP/并行度的其他候选；规则来源仍锁定 MindSpeed-LLM `7826e88`。
- 用户已选择动态 PP，但 `num_layer_list` 缺失、项数不等于 PP 或层数总和不等于总层数时，`suggest_config_fixes` 会按 `floor(total_layers / pp)` 均分，并把余数从前往后各补一层，返回可直接应用且已经 `validate_parallel_config` 复验的 Stage 层数；用户锁定 `parallel.num_layer_list` 时不会覆盖。
- 导入配置弹窗与配置下拉面板的第三栏共用 `completion.plans`；动态 PP 候选显示为“切换到动态 PP”，标记为推荐并在首次展示时自动选中，用户仍可改选其他经过复验的方案。
- 动态 PP 已存在但 `rule_profile.framework` 不是 `mindspeed-llm-mcore` 时，修复区与两处第三栏提供“切换到 MindSpeed-LLM MCore 规则口径”，同时更新 version/source commit，并用完整配置复验后才允许应用。
- 配置预览横幅中的 `.cro-import__name`（`croPreviewName`）与导入弹窗 `mcpImportScore` 共用唯一评分函数；源文件总项、已覆盖必填数与固定必填总数均读取 `parse_training_config` 结果，不在页面复制统计规则。
- 本次规则证据新增锁定 MindSpeed-LLM `7826e88`；完整自动测试 57/57 通过。
- 第 3 项已由用户确认并进入第 4 项；详细盘点、删除批次、字段去向和存在性测试统一记录在 [`MCP UI边界清单.md`](./MCP%20UI边界清单.md)，本项没有删除、隐藏或重排任何页面元素。
- 第 4 项已由用户确认；第 5 项在 MCP App 构建期删除整条 Activity Rail、两个跨页跳转绑定及运行事件入口挂钩，4173 基线文件保持不变。
- 第 5 项已由用户确认；第 6 项删除运行事件侧栏、横幅和详情视图，第 7 项继续删除事件数据、机制渲染、事件血缘、播放/缩放监听与专用 CSS。
- 第 8 项删除“训练监控”工作区名称、`what is rank`、无行为“导出配置”和 v1 链接；按用户明确要求暂时保留 `MindSpeed intro`。
- 第 6～8 项已由用户确认；第 9 项删除文档入口、页签、正文、目录、专用 JS/CSS 和 `doc` 状态，YAML 代码视图与导入能力保持不变。
- 第 9 项已由用户确认；第 10 项已收敛可见与无障碍文案并在顶栏常驻标明纯计算边界，不改内部 `croObserver` 命名。
- 第 11 项已删除“负载热力”整档、六个模拟度量、路由塌缩时间轴、构造故障横幅、热力详情及专用模型/状态/监听/CSS；26 个训练配置字段、“配置寻优”、“通信分析”和“内存观测”保持不变。
- 第 10、11 项已由用户确认验收；随后将配置下拉与导入弹窗中的解析评分统一为“配置解析｜评分与可回填项”的单行横幅，继续复用唯一评分函数。
- 第 12 项已进入待用户验收：MCP App 构建产物在原控制器发布拓扑前经过 `compute_rank_topology` 闸门；整网、Layer/Stage、专家切片、Rank 矩阵和右侧详情只消费同一份 Tool 快照，4173 基线不变。
- 4174 预览直接调用 `config-core` 的 `computeRankTopology`，Inspector 通过 MCP 协议调用同名 Tool；两条路径共用 `mcp-topology-adapter.js`，并用请求 token 防止较旧结果覆盖新配置。
- “通信分析”的 TP/PP/DP/CP/EP/EDP 成员已改读 `data.groups`；传输内容、频次和 HCCS/RDMA 位置判断仍属于页面说明，并在界面标签中明确区分，未冒充 MCP 结论。
- 拓扑请求中、失败、Tool 判定非法和页面基础配置非法时，原矩阵会标记为失效；不会静默降级成本地 Rank 公式。动态 PP 的 Stage 边界改为读取已校验的 `num_layer_list`，并新增 A16 Golden 场景。
- 第 12 项自动化验证共 69 项通过；本机 Edge 无头模式仍未产出 DOM 或截图，因此最终像素、悬浮和点击联动等待用户在 4174 与 Inspector 中验收。
- 第 13 项已进入待用户验收：原配置错误横幅继续负责字段定位和取消修改，`suggest_config_fixes` 在同一区域展示用户显式选择的 `locked_fields`、最多三个经过静态复验的最小差异候选，并支持回填后再次校验。
- 4174 预览直接调用 `config-core` 的 `suggestConfigFixes`，Inspector 通过 MCP 协议调用同名 Tool；构建产物已移除浏览器原有 `proposeFix` 候选公式，页面只消费 `structuredContent`，且防御性拒绝任何触碰锁定字段的返回候选。
- 第 13 项交互复核后进一步收敛：无解态只显示“取消修改”；合法态不渲染空的修复区并可关闭绿色校验卡；单纯聚焦表单不再重复请求；锁定区只允许新增锁定当前候选会修改的字段，已锁字段仍可取消。
- 修复搜索已从最多两个字段放宽为最多四个字段，使用确定性分层束搜索控制耗时；搜索阶段用违规数和修改距离裁剪候选，最终由用户选择的策略对已发现合法方案排序，不能把裁剪后的第一项解释为穷举全局最优。
- 修复区按评分展示前三项，其余已返回候选折叠到“其他 X 项方案”；原边界说明已替换为第二个“取消修改”按钮。
- 为避免把大量候选塞进 MCP 结果，单次最多返回评分靠前的 10 项；如搜索发现更多解，结果会保留截断标记。评分第一的方案显示“推荐”，锁定字段栏默认折叠。
- 只有一个候选时使用“修改方案”标题，不显示“推荐”标签和评分；多候选时才展示排名、推荐标签与评分。
- 只有一个候选时不显示“锁定不可改字段”栏；锁定栏只用于多候选间的进一步筛选。
- 多候选时可选择四种 MindSpeed 规则派生排序：MindSpeed 合法优先、保持资源规模、显存安全优先、流水线均衡优先；后两种明确使用 theoretical 容量口径，修改距离只作为平局规则。
- 第 13 项验收时完整自动化测试 76/76 通过；横幅、锁定字段和候选回填体验已由用户确认进入下一项。
- MCP 校验责任后续进一步收口：4174/Inspector 构建产物不再执行原页面的 `validate`、`warn`、`reconcile`、最近合法值/模型整除公式、结构档位过滤、动态量程或导入夹值，也不在浏览器推断和补齐动态 PP。首帧和切换模型时不再按并行乘积重算 `Total Rank/Node`；预设提供什么就提交什么。手输及导入数值原样进入统一训练配置，字段红黄状态只读取 `validate_parallel_config`，修复候选和动态 PP 分层只读取 `suggest_config_fixes`；等待或非法期间保留上一份 MCP 有效拓扑，不用浏览器公式生成替代结论。4173 基线仍保留原交互，作为迁移对照。
- 输入适配层不再把 `Seq Length`、并行度、Total Rank、模型可调项或自定义卡容量悄悄回退到正整数默认值。例如 `Seq Length = 1` 会原样交给 Tool；是否符合 Schema 和当前 CP/框架规则由 MCP 返回。无法解析成数字的文本仍由输入控件撤销，因为它尚不能形成 Tool 的数值字段，这不作为训练配置规则结论。
- 导入配置中的 0 或负数卡容量不再被页面丢弃或替换为当前卡型容量，而是原样交给 MCP Schema；未填写自定义容量（`null`/空值）才使用所选卡型的标准容量。页面也不再向 Tool 输入额外生成 `global_batch_size`，避免把本地批量公式冒充源配置。
- 第 12、13 项已由用户确认验收并进入第 14 项。
- 第 14 项保留原 `#croCapacity`、六段构成、占比、风险横幅和各 PP Stage 小柱；底部容量卡、中央“内存观测”和右侧“当前配置评估”共用同一份 `estimate_training_capacity` 结果。
- MCP App 构建产物已整份移除原 `config-relation-capacity.js` 业务公式；`mcp-capacity-adapter.js` 只负责 GiB/byte 单位映射、绘图缩放、选中联动和状态呈现，不在浏览器复制容量公式。
- 容量请求使用 token 防止旧响应覆盖新配置；加载、非法结果、缺字段和调用错误会清空旧容量视图，错误态提供重试，不会静默回退到原页面公式。
- 容量结果和口径浮层固定标记 `theoretical`、静态理论容量、不是设备实测峰值且不连接远端集群；经验系数与 assumptions 直接展示 Tool 返回值。
- 第 14 项实现后的完整自动化测试共 80/80 通过；容量视觉、口径和点击联动已由用户确认验收。
- Rank HBM 黄色警戒线读取 `estimate_training_capacity.data.thresholds.tight`，当前为带 20% 余量的 80% 未校准保守策略；画布不复制阈值。警戒线使用黄色虚线，最大 Rank 超线时在“当前范围”后显示黄色“OOM风险高”。
- 第 15 项已由用户确认验收：全部 26 个配置字段以及“表单视图 / 代码视图”保留；内置与上传配置继续显示只读原文，修改表单后回到当前配置生成预览。
- MCP App 已删除顶部整网 3D Deck、整网查询入口及独立 Deck CSS/JS 资源引用；模型选择保留并继续进入五类 Tool 的统一训练配置。共用脚本和内联样式里残留的 Deck 查询、渲染及选择器列入第 17 项彻底删除。
- 共享专家区改为仅展示 `model.shared_experts` 配置数量，不再生成或暗示共享专家 Rank 放置；路由专家切片继续读取 `compute_rank_topology.data.expert_slices`。
- 独立“通信分析”的可见 DOM、通信旅程播放以及浏览器模拟的事件、频次、载荷和 HCCS/RDMA 路径已删除；点击 Rank 后，右栏新增“并行通信组”，TP/PP/DP/CP/EP/EDP 编号和成员只读取 `data.ranks[].group_ids` 与 `data.groups`。共用样式中残留的 `.crop-comm*` / `.crop-commflow*` 列入第 17 项。
- 原页面可见的本地校验/建议结论渲染已清除；页面保留的预设、控件步进和绘图布局只承担输入与可视化，不给出配置合法性结论。可见结论由 `validate_parallel_config` 和 `suggest_config_fixes` 返回结果驱动，Rank 数值与成员关系由 `compute_rank_topology` 快照驱动。
- 第 15 项实现后的完整自动化测试共 85/85 通过；布局、代码视图、Rank 点击和能力收口已由用户确认验收。
- 第 16 项加载、取消、超时、鉴权失效、Tool 错误和重试状态已由用户确认验收；正常成功态布局保持不变。
- 2026-10-10 重新审视第 17 项后，范围已从笼统“清死代码”细化为隐藏旧页签、Deck/通信残余、前序批次余留、旧导入分支、焦点/ARIA、旧 MCP UI 实现、重复资源及窄屏/主题死分支八组明确减法。
- 首次实现错误删除了旧导入脚本中的 `sampleOf`，但配置选择器初始化仍调用该函数，导致页面启动在 `ReferenceError` 处中断；预置选项、画布内容和表单布局因此同时受损。隐藏的 `#croHeat` / `.cro-cluster__grid` 也仍被平面页用作计算与联动引擎，不能按“界面不可见”判为死节点。
- 上述激进构建期裁剪已从当前产物撤回，拓扑状态挂载也恢复到原节点；单文件重新回到上一次提交的 1,693,040 bytes（Vite gzip 495.28 kB）。新增回归断言锁定 `sampleOf`、预置选择器、隐藏计算引擎、`cropStage` / `cropWorld` 以及三块左栏 pane 的完整性。
- 4173 主页面基线 SHA-256 仍为 `A4A23CA0B0B124F11690B99E39BD3C33A0E9553C6727AF297E5C5D9BB5737B18`。第 17 项不再以包体下降或标记归零作为验收依据；后续减法必须先证明不改变上一次提交页面的运行时 DOM、画布内容、预置配置和表单几何。
- 为优先发布首个 MCP 版本，第 17 项当前只保留旧 MCP 页面副本、重复样例、旧入口和旧实现测试的物理清理；非文档源码扫描只剩“不存在性”测试引用这些路径，当前 Vite/MCP Resource 不依赖它们。隐藏页签、导入辅助、热力计算引擎、Deck/通信共用脚本及 CSS 全部延期到下一迭代。
- 首版安全子集复核：完整自动化测试 98/98 通过；4174 浏览器运行时预置配置 13 项，当前项为“128Rank-实验配置”，`cropWorld` 有 149 个子节点，页面有 272 个 Rank 数据节点，三块表单区域和 `.cro-cluster__grid` 隐藏计算引擎均已挂载。
- 第 18 项将 `ui://mindspeed-config/result-view.html`、服务端产物路径和 CSP/权限/边框元数据集中到唯一资源定义；`resources/list` 和 `resources/read` 返回一致元数据。
- `build:ui` 在每次构建后强制验证：产物目录只能有一个约定 HTML，CSS/JS/图像/媒体不得留下外链依赖，已验收能力必须存在，已清除的 Activity Rail、运行事件、文档视图、负载热力和整网 Deck 可见模块不得回流。
- `preview:adapted-ui` 改为先生成生产单文件，再由 `vite preview` 直接服务该产物；开发态转换单独保留为 `dev:adapted-ui`。因此 4174、Inspector 和支持 MCP Apps 的客户端均以同一份 HTML 为验收对象。
- 第 18 项产物名改为 `config-relation-plane-mindspeed-config-mcp-YYYYMMDD-HHmmss.html`，时间戳使用上海时区；每次构建清理旧产物并只保留当次文件。服务端按严格命名规则发现唯一 HTML，4174 固定预览 URL 也映射到该文件，无需手改路径。
- 仓库新增 `$mindspeed-config-mcp-package` Skill，用于高频小步迭代打包；默认快速构建并返回路径/字节数/SHA-256，发布级复核可加 `-FullVerify`。
- 时间戳改造后完整自动化测试 110/110 通过，Streamable HTTP smoke 通过；`-FullVerify` 最终产物 `config-relation-plane-mindspeed-config-mcp-20261010-165323.html` 为 1,710,521 bytes，SHA-256 为 `62F24910ADB229CE4DDE3E8CCBA0E26855FC5934ABCB41FC670E9B8F5BDD55CF`。同一内容的生产预览响应与磁盘文件字节级一致。
- 配置下拉面板与导入弹窗在存在缺口时新增“无需 X 项补缺，直接导入”。二次确认弹窗逐字段列出受影响 Tool；“继续导入”保留缺口并停止对应 Tool，绝不继承上一份配置；“补齐后导入”复用原完整候选；“取消导入”关闭两层，右上角关闭只返回上一层。

### 第 10、11 项验收记录

1. 打开 4174，确认顶栏显示“纯计算 · 不启动训练 · 不采集实时指标”。
2. 使用读屏检查或查看 DOM，确认根节点、视图切换和主面板分别使用 “MindSpeed Config Workbench”“配置视图切换”“配置与关系分析”。
3. 确认中栏只有“配置寻优”和“通信分析”，不再出现“负载热力”；YAML 提示使用“随当前配置生成”。
4. 在“通信分析”切换 Rank、播放通信行程并查看右栏，确认原通信交互仍可用。
5. 回到“配置寻优”，检查 26 个配置字段、内存观测、单卡容量、导入和静态校验没有被删除。
6. 打开 4173，确认原始“负载热力”仍完整存在；运行 `npm test`，确认第 10、11 项双向断言通过。
