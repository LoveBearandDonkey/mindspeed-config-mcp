import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const baselineDirectory = path.join(
  repositoryRoot,
  "apps/web/config-relation-plane-baseline/training-run-twin-standalone",
);
const baselineHtmlFile = path.join(
  baselineDirectory,
  "config-relation-plane-mindspeed-config-mcp.html",
);
const observerFile = path.join(baselineDirectory, "js/config-relation-observer.js");
const importFile = path.join(baselineDirectory, "js/config-relation-import.js");
const planeFile = path.join(baselineDirectory, "js/config-relation-plane.js");
const capacityFile = path.join(baselineDirectory, "js/config-relation-capacity.js");
const boundaryDocument = path.join(repositoryRoot, "docs/MCP UI边界清单.md");
const mcpShellStyleFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-shell.css");
const mcpShellEntryFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-shell-entry.js");
const mcpFixesAdapterFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-fixes-adapter.js");
const mcpValidationAdapterFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-validation-adapter.js");
const viteConfigFile = path.join(repositoryRoot, "apps/mcp-server/vite.config.js");
const builtShellDirectory = path.join(repositoryRoot, "apps/mcp-server/ui/dist/ui-shell-v1/training-run-twin-standalone");
const builtShellFile = path.join(builtShellDirectory, "config-relation-plane-mindspeed-config-mcp.html");

const FIELD_DESTINATIONS = Object.freeze({
  totalLayer: "model.total_layers",
  dp: "parallel.dp",
  pp: "parallel.pp",
  vpp: "parallel.vpp",
  tp: "parallel.tp",
  cp: "parallel.cp",
  microBatch: "batch.micro_batch_size",
  microBatchNum: "batch.micro_batch_count",
  seqLen: "batch.sequence_length",
  recomputeLayers: "memory.recompute_layers",
  loraRank: "memory.lora_rank",
  routedExpert: "model.routed_experts",
  topK: "model.top_k",
  sharedExpert: "model.shared_experts",
  ep: "parallel.ep",
  totalRank: "cluster.total_ranks",
  node: "cluster.ranks_per_node",
  cpMode: "parallel.cp_mode",
  seqParallel: "parallel.sequence_parallel",
  vocabEmbDp: "parallel.vocab_embedding_data_parallel",
  expertTp: "parallel.expert_tensor_parallel",
  shardMode: "memory.shard_mode",
  recomputeMode: "memory.recompute_mode",
  lora: "memory.lora_enabled",
  dtype: "memory.compute_dtype",
  paramsDtype: "memory.parameter_dtype",
});

const REMOVAL_BATCHES = Object.freeze([
  {
    batch: "A",
    item: 5,
    label: "左侧框架导航",
    html: [
      "pto-ide-frame__activity-rail",
      'id="navMonitoring"',
      'aria-label="Search"',
      'aria-label="Source control"',
      'aria-label="Terminal"',
      'id="navTaskCompare"',
      'id="navRelationEvents"',
      'go("navMonitoring"',
      'go("navTaskCompare"',
    ],
    sources: [
      [observerFile, ['getElementById("navRelationEvents")?.addEventListener']],
      [path.join(baselineDirectory, "css/ide-frame-pattern.css"), [".pto-ide-frame__activity-rail"]],
    ],
  },
  {
    batch: "B1",
    item: 6,
    label: "运行事件可见区",
    html: [
      'id="croEventRail"',
      'id="croEventRailExpand"',
      'id="croEventRailCollapse"',
      'id="croIncidentBanner"',
      'id="croIncidentView"',
      'id="croIncidentDetail"',
      'id="croIncidentLineage"',
    ],
    sources: [
      [observerFile, [
        'getElementById("croEventRailCollapse")?.addEventListener',
        'getElementById("croIncidentBannerClose")?.addEventListener',
      ]],
      [path.join(baselineDirectory, "css/config-relation-observer.css"), [".cro-event-rail", ".cro-incident-banner"]],
    ],
  },
  {
    batch: "B2",
    item: 7,
    label: "运行事件依赖",
    html: [
      'id="croMech"',
      'id="croMechPlay"',
      'id="croMechMap"',
      'id="croIncidentFlow"',
      'id="croIncidentStage"',
      'id="croStageZoomIn"',
      'id="croStageZoomOut"',
      'id="croStageZoomFit"',
    ],
    sources: [
      [observerFile, ["const INCIDENT_GROUPS", "const MECHANISM_RENDERERS", "function buildIncidentLineage"]],
      [path.join(baselineDirectory, "css/config-relation-observer.css"), [".cro-mech", ".cro-incident-stage"]],
    ],
  },
  {
    batch: "C",
    item: 8,
    label: "顶栏旧宿主与占位动作",
    html: [
      "<span>训练监控</span>",
      'id="croRankIntro"',
      'id="croExportConfig"',
      'href="./config-relation-observer.html"',
    ],
    sources: [
      [path.join(baselineDirectory, "css/config-relation-yaml.css"), [".cro-export-btn"]],
    ],
  },
  {
    batch: "D",
    item: 9,
    label: "文档视图",
    html: [
      'id="croDocEntry"',
      'data-observer-view="doc"',
      'id="croDocRegion"',
      'id="croDocTocList"',
      'id="croDocBody"',
      'src="./js/config-relation-doc.js',
      'href="./css/config-relation-doc.css',
    ],
    sources: [
      [path.join(baselineDirectory, "js/config-relation-doc.js"), ['getElementById("croDocBody")']],
      [path.join(baselineDirectory, "css/config-relation-doc.css"), [".cro-doc"]],
      [planeFile, ['getElementById("croDocEntry")']],
    ],
  },
  {
    batch: "E1",
    item: 11,
    label: "无效负载热力视图与控件",
    html: [],
    sources: [
      [planeFile, [
        '["heat", "负载热力"',
        "const HEAT_METRICS",
        "function buildHeat",
        "crop-heat__routeslider",
        "crop-heatbanner",
        "crop-heat-detail",
      ]],
      [path.join(baselineDirectory, "css/config-relation-plane.css"), [
        ".crop-heat__pill",
        '.crop-center[data-mode="heat"]',
      ]],
    ],
  },
]);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function objectKeys(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `缺少 ${name}`);
  const end = source.indexOf("\n  };", start);
  assert.notEqual(end, -1, `${name} 没有结束标记`);
  return Array.from(source.slice(start, end).matchAll(/^    ([A-Za-z][A-Za-z0-9]*):/gm), ([, key]) => key);
}

test("待删除批次的 DOM、监听和样式证据当前都真实存在", () => {
  const html = read(baselineHtmlFile);
  for (const batch of REMOVAL_BATCHES) {
    for (const marker of batch.html) {
      assert.ok(html.includes(marker), `${batch.batch} ${batch.label} 缺少 HTML 证据：${marker}`);
    }
    for (const [file, markers] of batch.sources) {
      const source = read(file);
      for (const marker of markers) {
        assert.ok(source.includes(marker), `${batch.batch} ${batch.label} 缺少源码证据：${marker}`);
      }
    }
  }
});

test("第 5 项只从 MCP App 产物移除 Activity Rail，基线证据保持不变", () => {
  const baseline = read(baselineHtmlFile);
  const builtShell = read(builtShellFile);
  const baselineMarkers = [
    'class="pto-ide-frame__activity-rail',
    'id="navMonitoring"',
    'aria-label="Search"',
    'aria-label="Source control"',
    'aria-label="Terminal"',
    'id="navTaskCompare"',
    'id="navRelationEvents"',
    'go("navMonitoring"',
    'go("navTaskCompare"',
  ];
  for (const marker of baselineMarkers) {
    assert.ok(baseline.includes(marker), `4173 基线缺少 Activity Rail 证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含 Activity Rail：${marker}`);
  }
  assert.ok(
    !builtShell.includes('getElementById("navRelationEvents")'),
    "MCP App 仍包含 Activity Rail 的运行事件监听或状态挂钩",
  );
  assert.match(builtShell, /class="pto-ide-frame__workarea"/, "主工作区不应随 Activity Rail 一起删除");
});

test("第 6、7 项从 MCP App 移除运行事件可见区和隐性依赖", () => {
  const baseline = read(baselineHtmlFile);
  const builtShell = read(builtShellFile);
  const removedDom = [
    "croEventRail",
    "croEventRailExpand",
    "croEventRailCollapse",
    "croIncidentBanner",
    "croIncidentView",
    "croIncidentDetail",
    "croIncidentLineage",
    "croMech",
    "croMechPlay",
    "croMechMap",
    "croIncidentFlow",
    "croIncidentStage",
    "croStageZoomIn",
    "croStageZoomOut",
    "croStageZoomFit",
  ];
  for (const id of removedDom) {
    assert.ok(baseline.includes(`id="${id}"`), `4173 基线缺少运行事件节点 #${id}`);
    assert.ok(!builtShell.includes(`id="${id}"`), `MCP App 仍包含运行事件节点 #${id}`);
  }
  const removedDependencies = [
    "const INCIDENT_GROUPS",
    "const MECHANISM_RENDERERS",
    "function buildIncidentLineage",
    "function selectIncident",
    "function renderIncidentRail",
    "function setEventRailCollapsed",
    'getElementById("croIncidentView")',
    ".cro-event-rail{",
    ".cro-incident-view{",
    ".cro-mech{",
    ".cro-stage-zoom{",
    ".is-event-rail-collapsed",
  ];
  for (const marker of removedDependencies) {
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含运行事件依赖：${marker}`);
  }
  assert.match(
    builtShell,
    /<div class="pto-ide-frame__pane-body cro-board" id="croBoard">/,
    "配置工作台主视图必须保持可见",
  );
});

test("第 8 项删除旧顶栏入口但按验收要求保留 MindSpeed intro", () => {
  const baseline = read(baselineHtmlFile);
  const builtShell = read(builtShellFile);
  const removed = [
    'class="pto-ide-frame__workspace"',
    'id="croRankIntro"',
    'id="croExportConfig"',
    'href="./config-relation-observer.html"',
  ];
  for (const marker of removed) {
    assert.ok(baseline.includes(marker), `4173 基线缺少顶栏证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含待删除顶栏入口：${marker}`);
  }
  for (const preserved of ['id="croMindSpeedIntro"', 'id="croImportConfig"', 'id="themeToggle"']) {
    assert.ok(builtShell.includes(preserved), `MCP App 误删保留入口：${preserved}`);
  }
});

test("第 9 项移除文档视图但保留 YAML 代码视图", () => {
  const baseline = read(baselineHtmlFile);
  const baselineEvidence = [
    baseline,
    read(path.join(baselineDirectory, "js/config-relation-yaml.js")),
    read(path.join(baselineDirectory, "js/config-relation-plane.js")),
    read(path.join(baselineDirectory, "css/config-relation-doc.css")),
    read(path.join(baselineDirectory, "css/config-relation-plane.css")),
  ].join("\n");
  const builtShell = read(builtShellFile);
  const removed = [
    'id="croDocEntry"',
    'data-observer-view="doc"',
    'id="croDocRegion"',
    'id="croDocTocList"',
    'id="croDocBody"',
    "config-relation-doc.js",
    "config-relation-doc.css",
    ".cro-doc",
    ".is-doc",
    'classList.toggle("is-doc"',
    "一份配置要过三关",
  ];
  for (const marker of removed) {
    assert.ok(baselineEvidence.includes(marker), `4173 基线缺少文档证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含文档视图依赖：${marker}`);
  }
  for (const preserved of [
    'id="croYamlRegion"',
    'data-observer-view="yaml"',
    'id="croYamlCode"',
    ".crop-pane--code",
    'id="croImportConfig"',
  ]) {
    assert.ok(builtShell.includes(preserved), `MCP App 误删 YAML/导入能力：${preserved}`);
  }
});

test("第 10 项收敛可见与无障碍文案并声明纯计算边界", () => {
  const baselineEvidence = [
    read(baselineHtmlFile),
    read(observerFile),
    read(path.join(baselineDirectory, "js/config-relation-yaml.js")),
    read(planeFile),
  ].join("\n");
  const builtShell = read(builtShellFile);
  const replaced = [
    "Config and Relation Observer",
    "观测视图切换",
    "配置与关系观测",
    "运行观测",
    "按当前配置实时生成",
  ];
  for (const marker of replaced) {
    assert.ok(baselineEvidence.includes(marker), `4173 基线缺少旧文案证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含第 10 项旧文案：${marker}`);
  }
  for (const marker of [
    "MindSpeed Config Workbench",
    "配置视图切换",
    "配置与关系分析",
    "通信分析",
    "随当前配置生成训练启动 yaml",
    "纯计算 · 不启动训练 · 不采集实时指标",
    "待实测标定",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少第 10 项目标文案：${marker}`);
  }
});

test("第 11 项删除模拟负载热力整档但保留配置和容量入口", () => {
  const baselineEvidence = [
    read(planeFile),
    read(path.join(baselineDirectory, "css/config-relation-plane.css")),
  ].join("\n");
  const builtShell = read(builtShellFile);
  const removed = [
    '["heat", "负载热力"',
    'data-mode="heat"',
    "const HEAT_METRICS",
    "function buildHeat",
    "crop-heat-extra",
    "crop-heat__pill",
    "crop-heat__routeslider",
    "crop-heatbanner",
    "crop-heat-detail",
    "let routeTau",
  ];
  for (const marker of removed) {
    assert.ok(baselineEvidence.includes(marker), `4173 基线缺少负载热力证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含第 11 项负载热力依赖：${marker}`);
  }
  for (const marker of ["配置寻优", "cropMemoryToggle"]) {
    assert.ok(builtShell.includes(marker), `MCP App 误删第 11 项保留能力：${marker}`);
  }
});

test("第 15 项保留配置输入与代码视图，并收口整网、共享专家和通信组展示", () => {
  const baseline = read(baselineHtmlFile);
  const baselinePlane = read(planeFile);
  const builtShell = read(builtShellFile);

  for (const marker of ['id="croNetRegion"', 'id="croDeckHost"', 'id="croNetView"']) {
    assert.ok(baseline.includes(marker), `4173 基线缺少整网图证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含整网图可见节点：${marker}`);
  }
  for (const marker of [
    '["comm", "运行观测"',
    "function commSteps(c)",
    "function commLink(c, dom)",
    "function renderComm()",
    "function renderWarnings(el, topology)",
  ]) {
    const baselineEvidence = [baselinePlane, read(observerFile)].join("\n");
    assert.ok(baselineEvidence.includes(marker), `4173 基线缺少第 15 项清理证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 仍包含第 15 项浏览器本地结论或通信公式：${marker}`);
  }
  for (const marker of [
    "cropLeftTabs",
    'id="croConfigPresetSelect"',
    'id="croImportConfig"',
    "mcpConfigImportRow",
    "128Rank-实验配置",
    'const paneForm = el("div", "crop-pane crop-pane--form")',
    'const paneCode = el("div", "crop-pane crop-pane--code")',
    'leftBody.append(paneForm, paneCode, paneNet)',
    'tabs.addEventListener("click", onPaneTabClick)',
    'id="croYamlRegion"',
    'id="croYamlCode"',
    "cro:source",
    "原文 · 只读，改动表单即回到生成的 yaml",
    "mcp-shared-expert-summary",
    "这里只展示配置数量，不推测 Rank 放置",
    "并行通信组",
    "mcpGroupsById",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少第 15 项保留或收口结果：${marker}`);
  }
  assert.ok(builtShell.includes("leftHead.appendChild(tabs)"), "表单/代码切换应位于左栏标题行右侧");
  assert.ok(!builtShell.includes("leftIntro.appendChild(tabs)"), "表单/代码切换不应继续单独占据左栏引导区一行");
  assert.match(
    read(mcpShellStyleFile),
    /\.crop-left__head \.crop-tabs\s*\{[\s\S]*?width:\s*auto;[\s\S]*?min-height:\s*24px;[\s\S]*?\}/,
    "左栏标题行内的表单/代码切换应缩小整体高度",
  );
  assert.match(
    read(mcpShellStyleFile),
    /\.crop-left__head\s*\{[\s\S]*?gap:\s*12px;[\s\S]*?\}[\s\S]*?\.crop-left__head \.crop-left__tabs\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?\}/,
    "表单/代码切换应紧跟训练配置标题并保持 12px 间距",
  );
  assert.match(
    read(mcpShellStyleFile),
    /\.crop-left__head \.crop-tabs \.btn\s*\{[\s\S]*?height:\s*20px;[\s\S]*?\}/,
    "左栏标题行内的表单/代码按钮应使用紧凑高度",
  );
  assert.ok(
    !builtShell.includes('["net", "整网查询", "整网 3D deck 正视图"]'),
    "MCP App 不应恢复整网查询入口",
  );
  assert.ok(
    !builtShell.includes('id="croModelSelect"'),
    "MCP App 不应显示独立模型选择字段",
  );
  assert.ok(!builtShell.includes("cinnnnnndy 配置"), "MCP App 不应保留旧配置名称");
  assert.ok(
    builtShell.includes("previousWorldSignature !== nextWorldSignature"),
    "MCP App 在 Rank 世界规模变化后应重新适配画布视口",
  );
  for (const field of Object.keys(FIELD_DESTINATIONS)) {
    assert.ok(builtShell.includes(`${field}:`), `第 15 项误删配置字段定义：${field}`);
  }
});

test("配置下拉与导入弹窗共用单行配置解析横幅", () => {
  const builtShell = read(builtShellFile);
  for (const marker of [
    "mcp-parse-banner",
    ".cro-config-error.mcp-parse-banner.is-mcp-invalid:not(.mcp-fixes__candidate)",
    "cro-config-error is-blocking is-guidance is-mcp-invalid",
    "配置解析",
    "croPreviewName",
    "mcpImportScore",
    "font-size:var(--font-size-body-sm)",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少配置解析横幅标记：${marker}`);
  }
  const sourceStyle = read(mcpShellStyleFile);
  assert.match(
    sourceStyle,
    /\.cro-config-error\.mcp-parse-banner\.is-mcp-invalid:not\(\.mcp-fixes__candidate\)\s*\{[\s\S]*?justify-content:\s*flex-start;[\s\S]*?\}/,
    "配置解析横幅没有让标题和正文从左侧连续排列",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner__body,[\s\S]*?text-align:\s*left;[\s\S]*?\}/,
    "配置解析正文没有左对齐",
  );
  assert.match(
    sourceStyle,
    /\.cro-yaml__preview > \.mcp-parse-banner\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?max-width:\s*calc\(100% - 32px\);[\s\S]*?margin-inline:\s*16px;/,
    "配置下拉中的解析横幅没有被第二栏宽度约束并保留左右 16px 外边距",
  );
});

test("配置下拉与导入弹窗在仍缺输入时提供可编辑的第三栏", () => {
  const builtShell = read(builtShellFile);
  for (const marker of [
    "mcpPreviewMissingPane",
    "mcpImportMissingPane",
    "mcp-missing-field__control",
    "zoom-control-readout cro-stepper__input mcp-missing-field__input",
    "zoom-control-group cro-stepper__control mcp-missing-field__control",
    "MCP缺口配置补齐方案",
    "MCP缺口（",
    "mcp-completion-plan is-single",
    "mcp-completion-plan__cards",
    "mcp-completion-plan__card",
    "mcp-completion-plan__recommended",
    "mcp-completion-plan__confirmation",
    "我已核对源文件未提供的模型结构占位值",
    "静态安全兜底方案",
    "MCP 已把缺失项和冲突项列在下方",
    "核对并应用",
    "计算中… MCP 正在解析当前代码并求解完整候选",
    "计算中… MCP 正在解析预置配置并求解完整候选",
    "停止输入后自动解析",
    "aria-busy",
    "MCP 完整复验通过",
    "处理方案",
    "910 · 32G",
    "910B · 64G",
    "950PR · 128G",
    "减少 ",
    "增加 ",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少仍缺输入补值能力：${marker}`);
  }
  const sourceStyle = read(mcpShellStyleFile);
  const shellSource = read(mcpShellEntryFile);
  const missingPaneSource = shellSource.slice(
    shellSource.indexOf("function createMissingPane"),
    shellSource.indexOf("function mountConfigImportEntry"),
  );
  assert.doesNotMatch(missingPaneSource, /cro-import__hint/, "第三栏仍然创建 cro-import__hint");
  assert.doesNotMatch(
    shellSource,
    /mcp-completion-plan__select/,
    "处理方案仍在使用下拉框",
  );
  assert.match(
    shellSource,
    /plans\.length === 1[\s\S]*?mcp-completion-plan is-single[\s\S]*?plans\.length > 1[\s\S]*?mcp-completion-plan__cards/,
    "单方案纯文本与多方案卡片选择没有按方案数量分流",
  );
  assert.match(
    shellSource,
    /function completionPlanLabel[\s\S]*?推荐\|需确认[\s\S]*?plans\.length === 1[\s\S]*?completionPlanLabel\(preferred\)/,
    "方案名称没有移除多余的“推荐/需确认”后缀",
  );
  assert.match(
    shellSource,
    /plans\.length > 1[\s\S]*?plan\.recommended[\s\S]*?mcp-completion-plan__recommended[\s\S]*?推荐/,
    "多方案卡片没有显式标注推荐项",
  );
  assert.match(
    shellSource,
    /plans\.find\(\(plan\) => plan\.id === state\.current\.selectedPlanId\)[\s\S]*?plans\.find\(\(plan\) => plan\.recommended\)/,
    "多方案首次打开时没有默认选中推荐项",
  );
  const cardSelectionSource = shellSource.slice(
    shellSource.indexOf('card.addEventListener("click"'),
    shellSource.indexOf("cards.append(card)"),
  );
  assert.doesNotMatch(
    cardSelectionSource,
    /applyParsed|importConfig|applyButton\.click/,
    "点击处理方案卡片不应直接应用到表单",
  );
  assert.match(
    cardSelectionSource,
    /event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/,
    "处理方案卡片点击仍会冒泡并被弹窗误判为外部点击",
  );
  assert.match(
    shellSource,
    /MCP缺口（\$\{paths\.length\}）配置补齐方案/,
    "第三栏标题没有显示本次解析的真实缺口数",
  );
  assert.match(
    shellSource,
    /\.\.\.missingPaths[\s\S]*?preferred\?\.values[\s\S]*?\.map\(\(item\) => item\.path\)/,
    "第三栏没有合并显示缺失字段与候选修复的冲突字段",
  );
  const importSource = read(importFile);
  assert.match(
    importSource,
    /if \(preset\) \{[\s\S]*?cro:config-preview-change[\s\S]*?previewPreset\(preset\)/,
    "切换到内置预设时没有先通知 MCP 清理上一份补齐状态",
  );
  assert.match(
    shellSource,
    /function resetSampleCompletion\(\)[\s\S]*?sample\.token \+= 1;[\s\S]*?sample\.current = null;[\s\S]*?renderMissingInputs\(null, sample, pane, applyButton\)[\s\S]*?cro:config-preview-change[\s\S]*?resetSampleCompletion\(\)/,
    "MCP 适配层没有在预览目标切换时失效旧请求并清空第三栏",
  );
  assert.doesNotMatch(
    shellSource,
    /mcp-completion-status is-invalid|当前没有通过完整静态复验的候选，暂不可应用/,
    "第三栏仍保留无操作项的红色无解提示",
  );
  assert.match(
    shellSource,
    /mcp-confirm-apply[\s\S]*?mcp-completion-plan__confirmation input[\s\S]*?checkbox\.click\(\)[\s\S]*?applyButton\.click\(\)/,
    "核对并应用没有先完成可见勾选再立即应用",
  );
  assert.match(
    read(mcpShellEntryFile),
    /LIVE_PARSE_DELAY_MS\s*=\s*450[\s\S]*?setTimeout\([\s\S]*?parseImported\([\s\S]*?LIVE_PARSE_DELAY_MS/,
    "导入配置代码没有在停止输入后进行防抖实时计算",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-status\.is-pending[\s\S]*?animation:\s*mcp-completion-spin/,
    "第三栏计算中状态没有可见的 loading 动画",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-status\.is-valid::before[\s\S]*?border-bottom:[^;]+;[\s\S]*?border-left:[^;]+;/,
    "第三栏有效状态左侧没有线性对勾图标",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-status\.is-review\s*\{[\s\S]*?var\(--warning\)/,
    "用户修改导致待复验时没有使用可操作的审核态",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-plan__confirmation\s*\{[\s\S]*?var\(--warning\)/,
    "待核对内容没有保留黄色确认提示",
  );
  const baseline = read(baselineHtmlFile);
  assert.match(baseline, /id="croImportApply"[^>]*>应用<\/button>/, "导入弹窗按钮没有改为“应用”");
  assert.doesNotMatch(baseline, /id="croImportApply"[^>]*>应用到表单<\/button>/);
  assert.match(
    read(mcpValidationAdapterFile),
    /supplementOverrides[\s\S]*?trainingConfigFor/,
    "用户确认的补值没有进入后续 Tool 的统一配置",
  );
  assert.match(
    sourceStyle,
    /\.mcp-import__workspace\.has-missing-inputs\s*\{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?\}/,
    "导入弹窗有缺项时没有切换为三栏",
  );
  assert.match(
    sourceStyle,
    /\.cro-yaml__menu-body\.has-missing-inputs\s*\{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?\}/,
    "配置下拉有缺项时没有切换为三栏",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner__body,[\s\S]*?-webkit-line-clamp:\s*2;/,
    "配置解析横幅没有放宽为最多两行",
  );
  assert.match(
    sourceStyle,
    /input\[type="number"\]\.cro-stepper__input\s*\{[\s\S]*?appearance:\s*textfield;/,
    "补齐方案的数值输入没有切换为页面左右加减控件",
  );
  assert.match(
    sourceStyle,
    /\.mcp-missing-field \.cro-select\s*\{[\s\S]*?background-image:\s*url\(/,
    "补齐方案的下拉框没有预置下拉箭头",
  );
  assert.match(
    builtShell,
    /页面内置预设 · .*项已完整落入表单/,
    "页面内置预设仍冒充 MCP 文件适配度",
  );
});

test("应用配置后关闭弹窗、返回表单页签并保留应用结果", () => {
  const builtShell = read(builtShellFile);
  for (const marker of [
    "mcpImportAppliedStatus",
    "配置已成功应用到表单",
    "配置已应用，页面自动调整了",
    '#cropLeftTabs [data-pane="form"]',
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少应用后返回表单交互：${marker}`);
  }
  assert.match(
    builtShell,
    /croImportClose["'`]\)\?\.click\(\)/,
    "应用成功后没有关闭导入弹窗",
  );
  assert.match(
    read(mcpShellEntryFile),
    /addEventListener\("cro:config-change", \(\) => \{[\s\S]*?appliedStatusSignature !== currentPageConfigSignature\(\)[\s\S]*?clearAppliedStatus\(\)/,
    "应用结果没有按配置快照失效",
  );
  assert.match(
    read(mcpShellEntryFile),
    /APPLIED_STATUS_DURATION_MS\s*=\s*3000[\s\S]*?document\.body\.insertAdjacentHTML\("beforeend", renderAppliedStatus\(adjusted\)\)[\s\S]*?setTimeout\(clearAppliedStatus, APPLIED_STATUS_DURATION_MS\)/,
    "应用结果没有作为页面级 Toast 显示并在 3 秒后自动关闭",
  );
  assert.match(
    read(mcpShellEntryFile),
    /data-dismiss-mcp-import-applied[\s\S]*?clearAppliedStatus\(\)/,
    "应用结果 Toast 没有保留手动关闭入口",
  );
  assert.match(
    read(mcpShellStyleFile),
    /\.mcp-import-applied\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--space-4\);[\s\S]*?right:\s*var\(--space-4\);[\s\S]*?z-index:\s*10000;/,
    "应用结果没有固定浮动在页面右上角",
  );
  assert.match(
    read(mcpShellStyleFile),
    /\.mcp-import-applied\.is-adjusted\s*\{[\s\S]*?var\(--warning\)/,
    "自动配平后的应用结果没有使用非阻断警示语义",
  );
});

test("补齐后的样例配置继续在配置步进器显示用户所选名称", () => {
  const importSource = read(importFile);
  const shellSource = read(mcpShellEntryFile);
  assert.match(
    importSource,
    /croImport\.selectAppliedSample[\s\S]*?activeSampleFile = file;[\s\S]*?activeSampleSignature = currentConfigSignature\(\);[\s\S]*?restoreMergedSelection\(\)/,
    "配置下拉没有提供补齐后保留样例身份的入口",
  );
  assert.match(
    importSource,
    /activeSampleSignature !== currentConfigSignature\(\)[\s\S]*?clearActiveSample\(\)/,
    "配置下拉仍会把不改变配置值的 MCP 视图刷新误判为手动修改",
  );
  assert.match(
    shellSource,
    /croImport\?\.selectAppliedSample\?\.\(appliedSample\.file\)/,
    "MCP 应用样例后没有把用户所选配置名称写回配置下拉",
  );
  assert.doesNotMatch(
    shellSource,
    /optionValue = `__yaml_sample__:/,
    "MCP 适配层不应继续只抢写一次下拉 DOM",
  );
});

test("配置选择面板保留来源说明并删除重复的解析总账", () => {
  const baseline = read(baselineHtmlFile);
  const observer = read(path.join(baselineDirectory, "config-relation-observer.html"));
  const importSource = read(importFile);
  const shellSource = read(mcpShellEntryFile);
  for (const source of [baseline, observer]) {
    assert.ok(source.includes('class="cro-preview__source" id="croPreviewSource"'), "配置选择面板缺少来源说明行");
  }
  assert.match(importSource, /source: doc\.getElementById\("croPreviewSource"\)/, "页面预览没有恢复来源说明引用");
  assert.match(shellSource, /sourceLine = document\.getElementById\("croPreviewSource"\)/, "MCP 预览没有恢复来源说明引用");
  for (const source of [importSource, shellSource]) {
    assert.match(
      source,
      /querySelector\(":scope > \.cro-import__lede"\)\?\.remove\(\)/,
      "配置选择面板没有删除重复的 cro-import__lede",
    );
  }
});

test("第 12 项以 compute_rank_topology 快照驱动原 Rank 页面", () => {
  const baselineEvidence = [read(observerFile), read(planeFile)].join("\n");
  const builtShell = read(builtShellFile);
  for (const marker of [
    "function coordsOfRank(rank)",
    "function commPeers(dom, anchor)",
    "out.push(base + i * dom.stride)",
  ]) {
    assert.ok(baselineEvidence.includes(marker), `4173 基线缺少原拓扑公式证据：${marker}`);
  }
  for (const marker of [
    "__mcpTopologyAdapter",
    "compute_rank_topology",
    "正在更新 Rank 拓扑",
    "MCP Rank 拓扑",
    "mcpGroups",
    "publishedTopology",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少第 12 项接线：${marker}`);
  }
  assert.ok(
    !builtShell.includes("out.push(base + i * dom.stride)"),
    "通信组成员不得继续由浏览器 stride/count 公式生成",
  );
  assert.ok(!builtShell.includes("mcpTopologyStatus"), "右上角不得保留 MCP 拓扑状态标识");
  for (const preserved of [
    "自适应",
    "Rank 视角",
    "整机视角",
    "专家着色",
    "TP标注",
    "Layer标注",
  ]) {
    assert.ok(builtShell.includes(preserved), `第 12 项误删原 Rank 交互：${preserved}`);
  }
});

test("第 13 项以 suggest_config_fixes 驱动原建议区域并保留字段锁定", () => {
  const baseline = read(observerFile);
  const builtShell = read(builtShellFile);
  const sourceStyle = read(mcpShellStyleFile);
  const viteConfig = read(viteConfigFile);
  assert.ok(baseline.includes("function proposeFix(config, anchor)"), "4173 基线缺少原页面修复公式证据");
  assert.ok(!builtShell.includes("function proposeFix(config, anchor)"), "MCP App 不得继续用浏览器本地公式生成候选");
  for (const marker of [
    "suggest_config_fixes",
    "mcpFixesConclusion",
    "锁定不可改字段",
    "应用并重新校验",
    "其他 ",
    "评分 ",
    "推荐",
    "修改方案",
    "已限制检索4个字段以内的修改方案保障性能，评分越低越优",
    "MindSpeed 合法优先",
    "保持资源规模",
    "显存安全优先",
    "流水线均衡优先",
    "locked_fields",
    "候选与当前锁定字段冲突",
    "cancelInvalidConfig",
    "cro-config-error__msg",
    "配置出错，图形未更新",
    "mcp-fixes__candidate mcp-parse-banner cro-config-error is-blocking is-guidance is-mcp-invalid",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少第 13 项接线：${marker}`);
  }
  const validationAdapter = read(mcpValidationAdapterFile);
  assert.ok(!validationAdapter.includes("共发现"), "整体问题提示不应重复显示错误数量");
  assert.ok(!validationAdapter.includes("图形已暂停更新"), "整体问题提示应只保留“图形未更新”");
  assert.ok(!builtShell.includes("mcp-validation__eyebrow"), "校验明细不应继续显示 MCP 静态校验眉题");
  assert.ok(!builtShell.includes("mcp-validation__metrics"), "静态校验区不应继续渲染指标摘要行");
  assert.match(sourceStyle, /\.cro-config-error__title\.is-error\s*\{[\s\S]*?padding-bottom:\s*8px;[\s\S]*?\}/, "错误标题底部应保留 8px 内边距");
  assert.ok(!builtShell.includes("mcp-fixes__boundary"), "修复候选底部不应继续显示边界文案");
  assert.match(
    sourceStyle,
    /#croConfigError\.cro-config-error\.is-mcp-invalid\s*\{[\s\S]*?var\(--danger\)[\s\S]*?\}/,
    "阻断态整体问题卡片应沿用红色错误样式",
  );
  assert.doesNotMatch(sourceStyle, /\.cro-config-error__msg \+ \.mcp-validation/, "整体问题与校验明细之间不应继续显示分割线");
  assert.match(
    sourceStyle,
    /\.cro-config-error\.is-mcp-invalid \.mcp-fixes__candidate\s*\{[\s\S]*?display:\s*grid;[\s\S]*?\}/,
    "修复候选的标题、修改内容和操作按钮应各自占行",
  );
  assert.match(
    sourceStyle,
    /\.mcp-fixes__candidate \.btn\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?justify-self:\s*start;[\s\S]*?\}/,
    "修复候选按钮应按文本内容定宽而不是铺满卡片",
  );
  assert.match(
    sourceStyle,
    /\.mcp-validation__warnings\s*\{[\s\S]*?border:\s*1px solid[\s\S]*?var\(--warning\)[\s\S]*?background:\s*linear-gradient[\s\S]*?\}/,
    "提醒内容应使用黄色警示横幅",
  );
  assert.match(
    sourceStyle,
    /\.mcp-fixes__other-summary\s*\{[\s\S]*?color:\s*#fff;[\s\S]*?\}[\s\S]*?\.mcp-fixes__other-summary::marker\s*\{[\s\S]*?color:\s*#fff;/,
    "其他方案摘要的图标和文字应为白色",
  );
  assert.ok(
    viteConfig.includes('"setAdvancedOpen(entry, false, false);"'),
    "MCP 页面中的高级选项应默认收起",
  );
  assert.ok(!read(mcpFixesAdapterFile).includes('mcp-fixes__objective-label'), "策略下拉左侧不应继续显示方案排序标签");
  assert.ok(
    read(mcpFixesAdapterFile).includes('element("details", "mcp-fixes__policy")'),
    "锁定字段应使用默认折叠的 details",
  );
  assert.ok(
    !read(mcpFixesAdapterFile).includes('container?.classList.add("is-blocking", "is-mcp-invalid")'),
    "修复建议适配器不得写入校验容器的阻断状态",
  );
  assert.ok(
    read(mcpValidationAdapterFile).includes('document.addEventListener("cro:config-change"'),
    "MCP 校验必须监听包含无效配置在内的配置尝试事件",
  );
  assert.ok(!builtShell.includes("找到 ${suggestions.length} 个按评分排序的候选"), "修复区头部不应显示候选数量");
  for (const marker of ["croConfigError", "取消修改", "is-mcp-invalid"]) {
    assert.ok(builtShell.includes(marker), `第 13 项误删原错误定位或编辑体验：${marker}`);
  }
  assert.ok(
    !builtShell.includes('<em>${escapeHtml(meta.source)}</em>'),
    "配置下拉左侧选项卡不应继续渲染来源 em 标签",
  );
});

test("第 14 项以 estimate_training_capacity 驱动原容量与瓶颈展示", () => {
  const baseline = read(capacityFile);
  const builtShell = read(builtShellFile);
  const sourceStyle = read(mcpShellStyleFile);
  const viteConfig = read(viteConfigFile);
  for (const marker of [
    "function activationBytes(topo, stage)",
    "function measure(topo, stage)",
    "global.croCapacityModel = {",
  ]) {
    assert.ok(baseline.includes(marker), `4173 基线缺少原容量公式证据：${marker}`);
    assert.ok(!builtShell.includes(marker), `MCP App 不得继续打包原页面容量公式：${marker}`);
  }
  for (const marker of [
    "estimate_training_capacity",
    "mcp:capacity-result",
    "正在调用 estimate_training_capacity",
    "理论瓶颈",
    "theoretical · 静态理论容量",
    "不是设备实测峰值",
    "容量计算已迁移到 estimate_training_capacity",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少第 14 项接线：${marker}`);
  }
  for (const marker of [
    'id="croCapacity"',
    'id="croCapacityScene"',
    'id="croCapacityLegend"',
    'id="croCapacityStages"',
    'id="croCapacityVerdict"',
    "内存观测",
  ]) {
    assert.ok(builtShell.includes(marker), `第 14 项误删原容量展示或联动：${marker}`);
  }
  assert.ok(
    builtShell.includes("crop-memory-legend__marker--caution"),
    "Rank HBM 图例应显示容量警戒线",
  );
  assert.ok(
    viteConfig.includes("global.croCapacityModel?.THRESHOLD?.tight"),
    "Rank HBM 警戒线必须读取 config-core 容量阈值而不是在画布重复常量",
  );
  assert.match(
    sourceStyle,
    /\.crop-memory-legend__shade\s*\{[\s\S]*?var\(--background\) 76%[\s\S]*?\}/,
    "Rank HBM 当前范围以外的色阶应进一步暗化",
  );
  assert.match(
    sourceStyle,
    /\.crop-memory-legend__marker--caution::before\s*\{[\s\S]*?background:\s*var\(--warning\);[\s\S]*?\}/,
    "Rank HBM 警戒线应使用警示色",
  );
});

test("MCP App 空闲右栏不保留浏览器本地配置评估", () => {
  const builtShell = read(builtShellFile);
  for (const marker of [
    "function renderAssessment()",
    "当前配置评估",
    'gradeSec("L-A"',
    'gradeSec("L-B"',
    'gradeSec("L-C"',
    'gradeSec("L-D"',
    'safe: "预计可跑"',
    'metric("流水线气泡"',
    'metric("估算证据等级"',
  ]) {
    assert.ok(!builtShell.includes(marker), `MCP App 不应保留空闲态本地评估公式或结论：${marker}`);
  }
  for (const marker of [
    "MCP App 的右栏只展示选中对象详情",
    "单卡容量只随有效的对象详情显示",
    "点画布上的 rank 行、layer 列、PP Stage 条或格子里的专家",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少对象详情空闲态边界：${marker}`);
  }
});

test("第 16 项提供宿主加载、取消、超时、鉴权失效、Tool 错误和重试状态", () => {
  const builtShell = read(builtShellFile);
  for (const marker of [
    "mcp-host-state",
    "正在连接 MCP Host",
    "正在调用 MCP Tool",
    "已取消 MCP 调用",
    "MCP 调用超时",
    "MCP 鉴权已失效",
    "MCP Tool 返回错误",
    "MCP 连接已断开",
    "mcp:retry-requested",
    "maxTotalTimeout",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少第 16 项宿主状态：${marker}`);
  }
});

test("每个原页面可编辑字段都登记了稳定契约去向", () => {
  const source = read(observerFile);
  const actualFields = [
    ...objectKeys(source, "FIELD_SPECS"),
    ...objectKeys(source, "FLAG_SPECS"),
  ].sort();
  assert.deepEqual(Object.keys(FIELD_DESTINATIONS).sort(), actualFields);
});

test("边界文档覆盖所有删除批次、入口选择器和表单字段", () => {
  const document = read(boundaryDocument);
  for (const batch of REMOVAL_BATCHES) {
    assert.match(document, new RegExp(`批次 ${batch.batch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    for (const marker of batch.html.filter((value) => value.startsWith('id="'))) {
      assert.ok(document.includes(`\`#${marker.slice(4, -1)}\``), `文档未登记 ${marker}`);
    }
  }
  for (const [field, destination] of Object.entries(FIELD_DESTINATIONS)) {
    assert.ok(document.includes(`\`${field}\``), `文档未登记页面字段 ${field}`);
    assert.ok(document.includes(`\`${destination}\``), `文档未登记契约字段 ${destination}`);
  }
});
