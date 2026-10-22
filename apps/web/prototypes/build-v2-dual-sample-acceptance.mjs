import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pagePath = fileURLToPath(new URL('./v2-dual-sample-acceptance.html', import.meta.url));
const page = readFileSync(pagePath, 'utf8');
const icon = (kind, label, pressed = false) => `<button type="button" data-reply-action="${kind}" aria-label="${label}" title="${label}"${pressed ? ' aria-pressed="false"' : ''}><svg aria-hidden="true"><use href="#icon-${kind}"></use></svg></button>`;
const actions = `<div class="reply-actions" role="group" aria-label="答复操作">${icon('like', '点赞', true)}${icon('dislike', '点踩', true)}${icon('copy', '复制')}${icon('share', '分享')}<span class="reply-feedback" role="status" aria-live="polite"></span></div>`;
const source = (description, pending = false) => `<div class="case-source${pending ? ' case-source--pending' : ''}"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/>${pending ? '<path d="M10 5.5v5l3 2"/>' : '<path d="m6.4 10 2.4 2.4 4.8-5"/>'}</svg><span>${description}</span></div>`;

function answer({ number, side, name, meta, question, toolSource, body, evidence }) {
  return `<article class="panel panel--${side}"><div class="panel-inner">
    <div class="panel-top"><div class="panel-meta"><strong>${side.toUpperCase()} · ${name}</strong><span>${meta}</span></div><span class="question-label">场景问句</span><p class="question">${question}</p>${source(toolSource)}</div>
    <div class="reply-body" id="reply-${number}-${side}">${body}</div>
    <div class="panel-foot">${actions}<details><summary>查看本次调用与输入证据</summary><div class="evidence">${evidence}</div></details></div>
  </div></article>`;
}

function pending({ side, name, meta, question, title, detail }) {
  return `<article class="panel panel--${side}"><div class="panel-inner"><div class="panel-top"><div class="panel-meta"><strong>${side.toUpperCase()} · ${name}</strong><span>${meta}</span></div><span class="question-label">场景问句</span><p class="question">${question}</p>${source('待验收 · 尚未调用工具', true)}</div><div class="reply-body"><div class="pending-state">${title}</div><p>${detail}</p></div></div></article>`;
}

function floor(number, title, state, left, right, isPending = false) {
  const id = `scene-${number}`;
  return `<section class="floor${isPending ? ' pending' : ''}" id="${id}" aria-labelledby="${id}-title"><div class="floor-heading"><div class="floor-titleline"><span class="floor-number">${String(number).padStart(2, '0')} / 06</span><h2 id="${id}-title">${title}</h2></div><span class="floor-state">${state}</span></div><div class="floor-grid">${left}${right}</div></section>`;
}

const aName = 'openPangu 2.0 · 2048 卡';
const bName = 'Phi‑4 SuperOffload';

const scene1a = answer({
  number: 1, side: 'a', name: aName, meta: '页面预设 YAML + 完整契约副本',
  toolSource: '已调用 V2 MCP：parse_training_config × 2、validate_parallel_config、compute_rank_topology、estimate_training_capacity',
  question: '请检查 openPangu 2.0 参考配置（2048 卡），看看有没有训练配置问题？',
  body: `<p class="reply-lead">页面生成的 YAML 已读取并解析；同一预设的完整契约副本通过了已建模静态校验。两种输入的映射范围不同，不能把副本的通过结论冒充 YAML 原文已完整校验。</p>
    <div class="reply-block"><h3>① 读取与解析</h3><p>页面 YAML 读取 <strong>46</strong> 项、映射 <strong>31</strong> 项，完整分析缺 <strong>4</strong> 项；从该预设生成的契约副本读取 <strong>41</strong> 项、映射 <strong>38</strong> 项，必需字段缺 <strong>0</strong> 项。解析成功不等于完整校验通过。页面预设写明 2048 Rank、昇腾 910B 64 GiB、PP 4 / EP 64、每节点 8 卡。</p></div>
    <div class="reply-block"><h3>② 问题与待核对差异</h3><table class="issue-table"><thead><tr><th>结论</th><th>本轮证据</th><th>MCP 约束依据</th></tr></thead><tbody><tr><td>待核对</td><td>契约副本同时有 <code>model.id=openpangu-2.0-flash-92b</code> 与 <code>trainer.model_name=openpangu_2_0_flash_92b</code>；解析时后者覆盖前者。</td><td><code>PARSE_TARGET_OVERWRITTEN</code>；尚未证实违反训练约束，需按实际框架语义核对。<code>parse-training-config@0.3.2</code>。</td></tr></tbody></table><p style="margin-top:8px">页面 YAML 无 MCP 问题项；完整契约副本通过已建模静态校验。Rank 工具生成 <strong>2048</strong> 个 Rank、4 个 Stage（12 / 12 / 11 / 11 层）；容量仅为 <code>theoretical</code>，瓶颈 Stage 0 约 <strong>10.9 GiB/卡</strong>，不是实测峰值。</p><p>Agent 补充观察：YAML 明示微批 1、全局批 12288、EP 从 DP 内切出、CP=Ulysses；当前解析器把全局批 12288 映射成微批，并填入 <code>ep_mode=mf</code>、<code>cp_mode=ring</code>。这是解析映射差异，不是原配置已证实的训练错误。</p></div>
    <div class="reply-block"><h3>③ 建议方案</h3><p>页面 YAML 当前输入不足以输出推荐方案：完整分析还缺 4 项必需配置。若按同一预设的完整契约副本检查，当前没有可复验的配置修改建议；请先核对两个模型名称的差异。原有 PP offset <code>[1,1,0,0]</code> 已映射且静态有效。</p></div>
    <div class="reply-block"><h3>④ 还缺什么</h3><p>YAML 解析缺注意力头数、每节点卡数、卡型和单卡显存；页面预设已有这些值，契约副本据此完成并行、Rank 和 theoretical 容量检查。HiF8 算子精度、MTP 和实机峰值仍不由上述容量结果证明。</p></div>
    <div class="reply-block"><h3>下一步帮助</h3><p>请补充上列缺失配置；补齐后我可以继续校验。或者，您需要我先帮您补齐可从现有文件确认的配置，再进行一轮检查吗？请一并确认实际使用的模型名称。</p></div>`,
  evidence: `<p>V2 发布提交 <code>6deaf83</code>。页面 YAML <code>parse_training_config</code>：<code>73ccbb96-0de9-4809-9fa5-d9167549a448</code>；SHA-256 <code>bda70d54099c…dee0cdb</code>。</p><p>契约副本解析：<code>eb5eca96-ac9f-4bd1-9268-aa676bea71cc</code>；SHA-256 <code>f89cb7bfe37d…b6740</code>。静态、Rank、容量工具使用保留 offset 的完整副本；详见验收记录。</p>`,
});

const scene1b = answer({
  number: 1, side: 'b', name: bName, meta: '原始 shell + 模型 JSON + 内嵌 JSON',
  toolSource: '已调用 V2 MCP：parse_training_config × 2（原始脚本、提取的 JSON）',
  question: '请检查这份 DeepSpeed Phi‑4 SuperOffload 脚本和模型配置，看看有没有训练配置问题？',
  body: `<p class="reply-lead">脚本和模型 JSON 已读取并解析；脚本内动态生成的 SuperOffload JSON 也已静态提取并单独解析。当前还不能据此说训练配置通过完整校验。</p>
    <div class="reply-block"><h3>① 读取与解析</h3><p>原始 shell + 模型 JSON 共读取 <strong>46</strong> 项、映射 <strong>28</strong> 项，完整分析缺 <strong>9</strong> 项；按 <code>MODE=superoffload</code>、默认批量 4 提取的内嵌 JSON + 模型共读取 <strong>41</strong> 项、映射 <strong>14</strong> 项，单独解析还缺 <strong>20</strong> 项。两次解析均未达到静态工具的就绪条件。</p></div>
    <div class="reply-block"><h3>② 问题与待核对差异</h3><table class="issue-table"><thead><tr><th>结论</th><th>文件事实</th><th>MCP 规则与来源</th></tr></thead><tbody><tr><td>待核对</td><td><code>model.id</code>：脚本写 <code>microsoft/phi-4</code>，模型 JSON 的 <code>model_type</code> 为 <code>phi3</code>。</td><td><code>PARSE_SOURCE_CONFLICT</code>；同一模型字段跨来源值不同，需确认实际值。<code>parse-training-config@0.3.2</code>。</td></tr></tbody></table><p style="margin-top:8px">Agent 补充观察：两者分别是仓库模型名和架构类型，尚不能称为训练阻断。内嵌 JSON 明示 ZeRO‑3、BF16、CPU SuperOffload、<code>ratio=0.90</code>，但 SuperOffload 专用字段未进入当前静态规则；脚本本身没有被 MCP 自动展开为这份 JSON。</p></div>
    <div class="reply-block"><h3>③ 建议方案</h3><p>当前输入不足以输出推荐方案：还缺已确认的训练框架和设备条件。原始脚本和内嵌 JSON 都尚不能形成可复验的配置修改建议；本轮没有修改源文件。</p></div>
    <div class="reply-block"><h3>④ 还缺什么</h3><p>原始脚本解析还缺 DP、总 Rank、卡型与显存、微批与序列长度、微批数、计算及参数精度等 9 项映射。补齐后可继续并行与容量检查。ZeRO‑3 的通用分片映射不等于 SuperOffload 的 CPU 行为已被验证。</p></div>
    <div class="reply-block"><h3>下一步帮助</h3><p>请补充上列缺失配置，并确认两份来源实际使用的值；补齐后我可以继续校验。或者，您需要我先帮您补齐可从现有文件确认的配置，再进行一轮检查吗？</p></div>`,
  evidence: `<p>V2 发布提交 <code>6deaf83</code>。原始 shell + 模型 <code>parse_training_config</code>：<code>b90967f3-58c0-400f-854a-070c6d8741e5</code>；脚本 SHA-256 <code>7f717371a1d0…25ad2d</code>，模型 <code>91292104cdcf…18d77da</code>。</p><p>内嵌 JSON + 模型：<code>2213b874-8d34-4eca-80a6-2de819b89bd8</code>；JSON <code>c63263f60124…578201b</code>。没有执行 shell 或训练。</p>`,
});

const scene2a = answer({
  number: 2, side: 'a', name: aName, meta: '锁定 2048 Rank 与 EP 64',
  toolSource: '已调用 V2 MCP：suggest_config_fixes（当前无需修复）',
  question: '帮我改一下；总卡数和 EP 别动。',
  body: `<p class="reply-lead">保留总 Rank 2048 和 EP 64。完整预设副本已通过已建模静态校验，修复工具判断当前无需修复，因此本轮没有改写文件。</p><div class="reply-block"><h3>本次修复调用</h3><p>向 <code>suggest_config_fixes</code> 传入页面预设的完整契约副本，并锁定 <code>cluster.total_ranks</code> 与 <code>parallel.ep</code>；结果 <code>already_valid=true</code>。解析器已映射原有 PP offset <code>[1,1,0,0]</code>，不会生成“均匀 PP 保底”方案。</p></div><div class="reply-block"><h3>后续动作</h3><p>若你想改变训练目标或显存余量，请给出目标；那将是规划新方案，而非修复已证实的配置错误。当前没有拟改字段、文件差异或修改后复查结果。</p></div>`,
  evidence: `<p>源副本 SHA-256 <code>f89cb7bfe37d…b6740</code>。<code>suggest_config_fixes</code> 使用完整 offset 与锁定项；返回静态有效、无需修复。</p>`,
});

const scene2b = answer({
  number: 2, side: 'b', name: bName, meta: '脚本总 Rank / EP 尚无完整映射',
  toolSource: '沿用场景 1 的 parse_training_config；suggest_config_fixes 未就绪、未调用',
  question: '帮我改一下；总卡数和 EP 别动。',
  body: `<p class="reply-lead">原脚本写的是单 GPU DeepSpeed 运行，但本轮 MCP 未映射出可锁定的总 Rank，EP 也不是显式的源配置值；因此没有可复验修复候选，也没有改动文件。</p><div class="reply-block"><h3>为何暂不写回</h3><p>脚本只把 <code>--num_gpus=1</code> 传给本地 DeepSpeed，<code>MODE</code> 决定是否生成 SuperOffload JSON。原文解析尚缺 9 项必需字段，修复工具未就绪。仅靠单 GPU 事实推断并锁定全部并行字段，会把框架默认行为当成原文证据。</p></div><div class="reply-block"><h3>需要确认</h3><p>请给出实际运行的 <code>MODE</code>、批量参数及设备信息，并明确希望修复哪一项问题。确认后在脚本副本上展示拟改字段与差异，再按新文本复查。</p></div>`,
  evidence: `<p>沿用原始 shell + 模型解析请求 <code>b90967f3-58c0-400f-854a-070c6d8741e5</code> 的就绪状态；<code>suggest_config_fixes</code> 未就绪，未调用修复或修改复查工具。</p>`,
});

const scene3a = answer({
  number: 3, side: 'a', name: aName, meta: '2048 卡基线 → 64 张昇腾 910B',
  toolSource: '已调用 V2 MCP：plan_training_config（返回 3 个候选）',
  question: '我有 64 张 NPU，每张可用显存 64 GiB，帮我调整这份 openPangu 配置。',
  body: `<p class="reply-lead">以页面 2048 卡预设为基线，MCP 返回 3 个经过已建模静态规则筛选的 64 卡候选；目前还没有选定并生成源文件。</p><div class="reply-block"><h3>排序候选与理论容量</h3><table class="issue-table"><thead><tr><th>序号</th><th>并行与批量变化</th><th>推荐理由 / 取舍</th></tr></thead><tbody><tr><td>1 · 工具首选</td><td>TP1 / PP4 / EP4 / DP16，微批数 24→768。</td><td>4 处改动；瓶颈约 <strong>48.6 GiB/卡</strong>，<code>theoretical</code>、safe。</td></tr><tr><td>2</td><td>TP1 / PP4 / EP8 / DP16，微批数 24→768。</td><td>同为 4 处改动；理论瓶颈约 <strong>36.8 GiB/卡</strong>，显存余量更大。</td></tr><tr><td>3</td><td>TP2 / PP4 / EP8 / DP8，微批数 24→1536。</td><td>理论瓶颈约 <strong>54.1 GiB/卡</strong>，等级 tight；TP 通信待实测。</td></tr></tbody></table></div><div class="reply-block"><h3>关键限制与下一步</h3><p>工具为保持原全局批 12288，把微批数提高到 768 或 1536；步耗时、流水线效率与真实峰值均未知。三项均是配置候选，尚无可审阅的最终文件，也不能保证不 OOM。请回复候选序号，或说明是否允许降低全局批；选定后再生成副本、展示差异并复查。</p></div>`,
  evidence: `<p><code>plan_training_config</code>：64 张昇腾 910B、64 GiB/卡、8 卡/节点、<code>minimal-change</code>；检查 25 个组合，14 个静态合法，返回排序前 3 个。基线为完整契约副本，容量均标 <code>theoretical</code>。</p>`,
});

const scene3b = answer({
  number: 3, side: 'b', name: bName, meta: '原脚本是单 GPU DeepSpeed',
  toolSource: '已调用 V2 MCP：plan_training_config（PLAN_NEEDS_CONTEXT）',
  question: '我有 64 张 NPU，每张可用显存 64 GiB，帮我调整这份 Phi‑4 SuperOffload 配置。',
  body: `<p class="reply-lead">当前输入不足以规划可运行的 64 张 NPU 配置；本轮没有生成文件。</p><div class="reply-block"><h3>工具返回的缺口</h3><p>仅传入 64 张 NPU、64 GiB/卡和最小改动目标时，<code>plan_training_config</code> 返回 <code>PLAN_NEEDS_CONTEXT</code>：还缺 <strong>13</strong> 项模型、批量或框架条件。原脚本中的单 GPU DeepSpeed 入口、ZeRO‑3 和 CPU SuperOffload 不能自动推成昇腾上的 64 卡方案。</p></div><div class="reply-block"><h3>需要确认</h3><p>请确认目标框架是否仍为 DeepSpeed、具体 NPU 卡型、实际 <code>MODE</code>、全局批目标，以及 SuperOffload 在目标环境的适配方式。补齐这些事实后才能评估可规划范围；当前没有实机兼容或容量承诺。</p></div>`,
  evidence: `<p>资源规划调用返回 <code>ready=false</code>、<code>PLAN_NEEDS_CONTEXT</code>，尚缺 13 项必需条件。Phi‑4 原脚本解析另见场景 1。</p>`,
});

const main = `<main class="shell">
  <header class="mast"><div class="brand"><span class="brand-mark" aria-hidden="true">◎</span><span>MindSpeed Config · V2 验收</span></div><nav class="mast-links" aria-label="相关文档"><a href="../../../docs/V2双样本逐项验收记录.md">验收记录</a><a href="./constraint-lens.html">约束视图参考</a></nav></header>
  <section class="hero" aria-labelledby="page-title"><p class="eyebrow">ACCEPTANCE / TWO SOURCE SETS</p><h1 id="page-title">同一场景，两份真实来源。</h1><p class="hero-copy">左侧采用页面中的 openPangu 2.0 参考配置（2048 卡）；右侧采用 DeepSpeed Phi‑4 SuperOffload 的原始脚本、模型结构和脚本内嵌 JSON。六个楼层呈现问句与答复。场景 1～3 依据本轮真实文件和当前连接的 V2 MCP 取证；条件不足或未交付文件的场景如实标出。</p><span class="scope-note">2026-10-21 · V2 v1.0.13 / 6deaf83 · 已重新调用线上 MCP</span></section>
  <section class="case-heads" aria-label="两组固定样本"><div class="case-head"><span class="case-kicker">A / MINDFORMERS · ASCEND NPU</span><h2>openPangu 2.0 · 2048 卡</h2><p>页面参考预设：昇腾 910B 64 GiB、2048 Rank、PP 4 / EP 64、MoE 256 专家。页面 YAML 与完整契约副本分别保留，便于辨认解析边界。</p><p class="file-path">Input files<code>openpangu-default-2048.yaml</code><code>openpangu-default-2048.training.json</code></p><div class="case-meta"><span>页面预设生成</span><span>MindFormers · MoE</span><span>原预设不改写</span></div></div><div class="case-head case-head--b"><span class="case-kicker">B / DEEPSPEED · SUPER OFFLOAD</span><h2>Phi‑4 SuperOffload</h2><p>上游单 GPU 微调脚本 + 模型 JSON。脚本按 MODE 在运行时生成 DeepSpeed JSON；本轮只静态提取 superoffload / 默认批量 4 分支。</p><p class="file-path">Input files<code>deepspeed_phi4_superoffload_finetune.sh</code><code>phi4_model_config.json</code><code>phi4-superoffload-default.json · extracted</code></p><div class="case-meta"><span>Shell + JSON</span><span>ZeRO‑3 · CPU Offload</span><span>未执行训练</span></div></div></section>
  <nav class="floor-nav" aria-label="六个验收场景"><a href="#scene-1" aria-current="location">01 快速检查</a><a href="#scene-2">02 修改复查</a><a href="#scene-3">03 资源规划</a><a href="#scene-4">04 性能回推</a><a href="#scene-5">05 工作台</a><a href="#scene-6">06 团队交接</a></nav>
  ${floor(1, '快速检查配置，直接得到结论', 'A 完整副本已静态校验 · B 仍缺条件', scene1a, scene1b)}
  ${floor(2, '延续对话，让 Agent 修改并复查源配置', '本轮均未修改文件', scene2a, scene2b)}
  ${floor(3, '只给训练目标，由 Agent 规划配置', 'A 有 3 个候选 · B 缺条件', scene3a, scene3b)}
  ${floor(4, '从训练性能问题回推配置调整', '待验收 · 缺同次运行证据', pending({side:'a',name:aName,meta:'等待 2048 卡运行证据',question:'这是本次训练落盘的性能数据，速度很差，帮我看看要不要调配置。',title:'等待同次运行的 Profiling 或日志',detail:'需确认实际训练是否使用页面 2048 卡预设，并关联对应 Rank、Step 和设备信息；不能把 theoretical 容量当作性能实测。'}), pending({side:'b',name:bName,meta:'等待 SuperOffload 运行证据',question:'这是本次训练落盘的性能数据，速度很差，帮我看看要不要调配置。',title:'等待同次运行的 Profiling 或日志',detail:'需要确认实际 MODE、CPU offload 指标和数据输入表现，再区分配置、代码、数据与设备瓶颈。'}), true)}
  ${floor(5, '主动打开工作台，探索和比较方案', '待验收 · 需要页面操作记录', pending({side:'a',name:aName,meta:'来源 YAML 与试验值应分开',question:'打开配置工作台，我想试试不同的 PP、EP 和重计算组合。',title:'等待浏览器或目标宿主实测',detail:'应核对页面预设值、导入 YAML、派生契约副本与当前试验值，观察 2048 Rank 画布；页面应用不等于写回源文件。'}), pending({side:'b',name:bName,meta:'heredoc 解析缺口应可见',question:'打开配置工作台，我想试试不同的 PP、EP 和重计算组合。',title:'等待浏览器或目标宿主实测',detail:'应检查脚本内生成的 DeepSpeed JSON 是否展示为独立来源，以及 CPU SuperOffload 字段是否明确标注未覆盖。'}), true)}
  ${floor(6, '把问题交给团队成员处理', '待验收 · 尚无交接答复', pending({side:'a',name:aName,meta:'预设、YAML、契约副本三源',question:'把这次配置问题整理给负责并行策略的同事。',title:'等待报告生成与人工复核',detail:'交接材料需区分页面预设、生成 YAML 与 MCP 契约副本，保留输入摘要、offset 和本轮静态/理论容量状态。'}), pending({side:'b',name:bName,meta:'MODE 与批量条件须留存',question:'把这次配置问题整理给负责并行策略的同事。',title:'等待报告生成与人工复核',detail:'报告应附原脚本和模型结构摘要、SuperOffload 分支提取条件、未映射字段与待确认硬件条件。'}), true)}
  <footer class="closing"><h2>这是一页验收答复记录，不是实时配置计算器。</h2><p>配置文件或服务版本变化后，应重新读取并复验，再更新答复。输入摘要、逐项状态和旧样本归档见 <a href="../../../docs/V2双样本逐项验收记录.md">V2 双样本逐项验收记录</a>。此页不启动训练，也不修改原始来源。</p></footer>
</main>`;

const replacement = /<main class="shell">[\s\S]*?<\/main>/;
if (!replacement.test(page)) throw new Error('Cannot locate acceptance page main');
writeFileSync(pagePath, page.replace(replacement, () => main), 'utf8');
