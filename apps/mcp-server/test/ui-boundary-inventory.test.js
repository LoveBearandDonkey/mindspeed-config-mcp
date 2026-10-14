import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { isPackagedAppHtmlFilename } from "../src/app-resource.js";

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
const yamlFile = path.join(baselineDirectory, "js/config-relation-yaml.js");
const planeFile = path.join(baselineDirectory, "js/config-relation-plane.js");
const capacityFile = path.join(baselineDirectory, "js/config-relation-capacity.js");
const boundaryDocument = path.join(repositoryRoot, "docs/MCP UI边界清单.md");
const mcpShellStyleFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-shell.css");
const mcpShellEntryFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-shell-entry.js");
const mcpFixesAdapterFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-fixes-adapter.js");
const mcpValidationAdapterFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-validation-adapter.js");
const viteConfigFile = path.join(repositoryRoot, "apps/mcp-server/vite.config.js");
const serverPackage = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, "apps/mcp-server/package.json"),
  "utf8",
));
assert.match(serverPackage.productVersion, /^\d+\.\d+\.\d+$/, "产品版本必须是数字语义版本");
const builtShellDirectory = path.join(repositoryRoot, "apps/mcp-server/ui/dist/ui-shell-v1/training-run-twin-standalone");
const builtShellFiles = fs.readdirSync(builtShellDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && isPackagedAppHtmlFilename(entry.name));
assert.equal(builtShellFiles.length, 1, "构建目录必须只有一个带时间戳的 MCP App HTML");
const builtShellFile = path.join(builtShellDirectory, builtShellFiles[0].name);

const FIELD_DESTINATIONS = Object.freeze({
  totalLayer: "model.total_layers",
  hidden: "model.hidden_size",
  heads: "model.num_attention_heads",
  kvHeads: "model.num_key_value_heads",
  denseIntermediate: "model.ffn_hidden_size",
  moeIntermediate: "model.expert_ffn_hidden_size",
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
      'aria-label="Search"',
      'aria-label="Source control"',
      'aria-label="Terminal"',
      'id="navRelationEvents"',
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
        ".crop-heat-extra",
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

test("本地预览与 MCP 宿主都接通 PP 分层修复回填", () => {
  const shellSource = read(mcpShellEntryFile);
  const calls = shellSource.match(/installFixesAdapter\([\s\S]*?applyPipelineSettings\(settings\)[\s\S]*?\);/g) ?? [];
  assert.equal(calls.length, 2, "preview 与 MCP host 两个分支都必须传入 applyPipelineSettings");
  const fixesSource = read(mcpFixesAdapterFile);
  assert.doesNotMatch(fixesSource, /找不到可用的 PP 分层控件/, "不得把适配器接线失败误报成 DOM 控件缺失");
  assert.match(fixesSource, /PP 分层设置应用通道不可用/, "接线异常必须显示准确的故障提示");
});

test("MindFormers 的 EP Rank 域与 PP 层偏置使用不同名称并说明彼此独立", () => {
  const baseline = read(baselineHtmlFile);
  const validationAdapter = read(mcpValidationAdapterFile);
  const shellEntry = read(mcpShellEntryFile);
  assert.match(baseline, /data-ep-mode="mf"[\s\S]*?>MF EP 域<\/button>/, "MoE 选项必须明确表示 EP 域");
  assert.match(baseline, /这是 MoE 的 EP Rank 域口径[\s\S]*?与 PP 分层里的「MF 层偏置」互相独立/, "MoE 提示必须排除 PP 层分配语义");
  assert.ok(validationAdapter.includes('["mindformers-offset", "MF 层偏置"]'), "PP 选项必须明确表示层偏置");
  assert.match(validationAdapter, /只影响各虚拟 Stage 的层数，不改变 MoE 的 EP Rank 口径/, "PP 提示必须排除 MoE Rank 域语义");
  assert.ok(shellEntry.includes('["mf", "MindFormers EP 域"]'), "结构化表单必须沿用 EP 域命名");
  assert.ok(shellEntry.includes('["mindformers-offset", "MindFormers PP 层偏置"]'), "结构化表单必须沿用 PP 层偏置命名");
});

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
  assert.match(baseline, /id="croCardMenu"[\s\S]*?cro-card-picker__divider[\s\S]*?自定义（GB）[\s\S]*?id="croCardMemoryInput"/,
    "卡型号面板缺少分割线后的自定义容量输入");
  assert.match(baseline, /zoom-control-group[\s\S]*?id="croCardMemoryDecrease"[\s\S]*?id="croCardMemoryInput"[\s\S]*?id="croCardMemoryIncrease"/,
    "自定义容量没有复用页面的左右加减输入控件");
  assert.match(read(observerFile), /`自定义 · \$\{memory\}G`/,
    "自定义容量回写后仍显示硬件型号前缀");
  const builtShell = read(builtShellFile);
  const baselineMarkers = [
    'class="pto-ide-frame__activity-rail',
    'aria-label="Search"',
    'aria-label="Source control"',
    'aria-label="Terminal"',
    'id="navRelationEvents"',
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
    'class="pto-ide-frame__host-chip"',
    'class="pto-ide-frame__workspace"',
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
  assert.match(
    builtShell,
    /id="croMindSpeedIntro" href="https:\/\/yinyucheng0601\.github\.io\/compute-graph-viewer\/Profiling_Insight_and_Tool\/mindspeed-intro\/mindspeed-static-config-analysis\.html"/,
    "MindSpeed intro 未指向静态配置分析页面",
  );
  for (const identity of [
    '<h1 class="mcp-product-title">配置校验与可视化</h1>',
    '<span class="mcp-product-tag">Powered by MindSpeed Agent</span>',
    `<span class="mcp-product-tag mcp-product-version" data-product-version="${serverPackage.productVersion}">v${serverPackage.productVersion}</span>`,
    '<div class="mcp-compute-boundary" role="note">纯静态文件校验</div>',
  ]) {
    assert.ok(builtShell.includes(identity), `MCP App 缺少产品标识：${identity}`);
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
    '.crop-pane--code',
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
    "表单视图",
    "代码视图",
    "配置与关系分析",
    "通信分析",
    "查看内置或上传配置，并预览当前表单生成的训练启动配置",
    "纯静态文件校验",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少第 10 项目标文案：${marker}`);
  }
  assert.ok(!builtShell.includes("待实测标定"), "MCP App 不应残留浏览器本地容量告警文案");
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

test("代码视图用用户提供的模型结构替代生成启动命令", () => {
  const yamlSource = read(yamlFile);
  const shellSource = read(mcpShellEntryFile);
  const validationSource = read(mcpValidationAdapterFile);
  const builtShell = read(builtShellFile);

  assert.doesNotMatch(yamlSource, /GENERATED_LAUNCH_PRESET_IDS|function buildLaunchLines/);
  assert.match(yamlSource, /paintPlainSource\(doc\.getElementById\("croLaunchCode"\), modelSource\)/);
  assert.match(yamlSource, /modelSource = next\?\.modelSource \|\| null/);
  assert.match(shellSource, /current\.source\?\.modelSource[\s\S]*?current\.modelStructureUploadedSource/);
  assert.match(shellSource, /manuallyEnteredModel\[path\.slice\("model\."\.length\)\] = value/);
  assert.match(shellSource, /marks: sourceMarks\(current\.result, adjusted\),[\s\S]*?modelSource/);

  assert.match(
    shellSource,
    /missingRequiredFields = useCompletion\s*\? \[\][\s\S]*?incompleteImport: !useCompletion/,
    "应用第三栏补齐方案后仍被误判为缺少 Tool 输入",
  );
  assert.match(
    validationSource,
    /for \(const path of Object\.keys\(event\.detail\?\.supplements \?\? \{\}\)\) sourcePaths\.add\(path\)/,
    "用户确认的第三栏补值没有进入内存估算证据",
  );
  assert.doesNotMatch(shellSource, /strictSourceEvidence/);

  assert.ok(builtShell.includes('id="croYamlRegion" aria-label="训练配置"'));
  assert.ok(builtShell.includes('<h2 class="cro-region__title cro-yaml__title">训练配置</h2>'));
  assert.ok(builtShell.includes('aria-label="训练配置选项"'));
  assert.ok(builtShell.includes('<span class="cro-yaml__launch-title">模型结构</span>'));
  assert.ok(builtShell.includes('<span class="cro-yaml__launch-note">导入提供时显示</span>'));
  assert.ok(builtShell.includes('aria-label="复制模型结构"'));
  assert.ok(!builtShell.includes('<span class="cro-yaml__launch-title">启动命令</span>'));
  assert.ok(!builtShell.includes('<h2 class="cro-region__title cro-yaml__title">配置文件</h2>'));
});

test("配置下拉与导入弹窗共用四行配置智能解析横幅", () => {
  const builtShell = read(builtShellFile);
  for (const marker of [
    "mcp-parse-banner",
    ".cro-config-error.mcp-parse-banner.is-mcp-invalid:not(.mcp-fixes__candidate)",
    "cro-config-error is-blocking is-guidance is-mcp-invalid",
    "配置智能解析",
    "配置智能解析与补齐",
    "mcp-parse-banner__inline-warning",
    "mcpParseValidation",
    "mcpParseCapacity",
    "croPreviewName",
    "mcpImportScore",
    "font-size:var(--font-size-body-sm)",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少配置解析横幅标记：${marker}`);
  }
  const sourceStyle = read(mcpShellStyleFile);
  const shellSource = read(mcpShellEntryFile);
  assert.match(
    shellSource,
    /title\.textContent = "配置智能解析"[\s\S]*?scoreLine[\s\S]*?validationLine[\s\S]*?capacityLine[\s\S]*?body\.append\(scoreLine, validationLine, capacityLine\)/,
    "配置智能解析横幅不是标题独占一行、下方三行正文",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner__line::before\s*\{[\s\S]*?content:\s*"·";/,
    "配置智能解析的三行正文没有保留缩进点",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner \.mcp-parse-banner__line\.is-valid::before\s*\{[\s\S]*?border:\s*0;[\s\S]*?content:\s*"·";[\s\S]*?transform:\s*none;/,
    "配置智能解析的正常状态仍显示对勾而不是缩进点",
  );
  assert.match(
    shellSource,
    /text\.textContent = String\(copy\)\.replace\(\/。\$\/, ""\)/,
    "配置智能解析状态行仍会保留句末句号",
  );
  assert.match(
    shellSource,
    /const gapCopy = `缺口 \$\{missing\} 项`[\s\S]*?mcp-parse-banner__inline-warning[\s\S]*?score\.replaceChildren/,
    "适配统计没有只把“缺口 N 项”单独标为警告色",
  );
  assert.match(
    shellSource,
    /hasCompletionPane \? "配置智能解析与补齐" : "配置智能解析"/,
    "配置智能解析标题没有随第三栏显隐切换",
  );
  assert.match(
    sourceStyle,
    /\.cro-config-error\.mcp-parse-banner\.is-mcp-invalid:not\(\.mcp-fixes__candidate\)\s*\{[\s\S]*?display:\s*grid;[\s\S]*?\}/,
    "配置智能解析横幅没有按标题加三行正文排列",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner__line\s*\{[\s\S]*?text-align:\s*left;[\s\S]*?\}/,
    "配置解析正文没有左对齐",
  );
  assert.match(
    sourceStyle,
    /\.cro-yaml__menu-body > \.cro-config-error\.mcp-parse-banner\.is-mcp-invalid:not\(\.mcp-fixes__candidate\)\s*\{[\s\S]*?grid-column:\s*2 \/ -1;[\s\S]*?grid-row:\s*1;[\s\S]*?width:\s*auto;[\s\S]*?max-width:\s*calc\(100% - 32px\);[\s\S]*?margin:\s*16px 16px 0;/,
    "配置下拉中的解析横幅没有位于第二、三栏顶部，或仍会溢出、贴边",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner \.cro-config-error__title\s*\{[\s\S]*?color:\s*transparent;[\s\S]*?linear-gradient\(90deg, var\(--primary\), var\(--success\)\);[\s\S]*?font-size:\s*12px;/,
    "配置智能解析与补齐标题没有使用渐变文字色和 12px 字号",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner \.mcp-parse-banner__line\.is-pending,[\s\S]*?\.is-valid\s*\{[\s\S]*?color:\s*var\(--foreground\);[\s\S]*?\.is-review\s*\{[\s\S]*?color:\s*var\(--warning\);[\s\S]*?\.is-danger\s*\{[\s\S]*?color:\s*var\(--danger\);/,
    "解析横幅没有按正常白色、风险黄色、错误红色控制正文",
  );
  assert.match(
    sourceStyle,
    /\.mcp-import__workspace > \.mcp-parse-banner\s*\{[\s\S]*?grid-column:\s*2 \/ -1;[\s\S]*?grid-row:\s*1;/,
    "导入弹窗中的解析横幅没有位于第二、三栏顶部",
  );
  assert.match(
    sourceStyle,
    /\.cro-import__report \.cro-import__from\s*\{[\s\S]*?color:\s*var\(--foreground-muted, var\(--foreground-secondary\)\);/,
    "配置下拉与导入面板第二栏的来源键和契约路径没有降为弱一级文字色",
  );
  assert.match(
    sourceStyle,
    /\.mcp-import__result-pane \.cro-import__report ul b,[\s\S]*?font-weight:\s*var\(--font-weight-regular, 400\);/,
    "第二栏列表内容仍然使用粗体",
  );
  assert.match(
    sourceStyle,
    /\.mcp-import__box \.cro-import__head\s*\{[\s\S]*?border-bottom:\s*0;[\s\S]*?\.cro-yaml__preview \.cro-import__head\s*\{[\s\S]*?border-bottom:\s*0;/,
    "导入弹窗或配置下拉的标题栏仍保留下划线",
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
    "MCP缺口配置推荐补齐方案",
    "MCP缺口（",
    "mcp-completion-plan__cards",
    "mcp-completion-plan__card",
    "mcp-completion-plan__recommended",
    "mcp-completion-plan__confirmation",
    "已预置模型结构的配置",
    "采用可编辑模型结构预置",
    "mcp-model-structure-tabs",
    "预填模型结构",
    "上传模型结构",
    "上传模型结构文件",
    "config.json / YAML / Shell",
    "源文件缺少模型结构参数。",
    "本栏已为缺失项提供可编辑候选值；候选值仅用于补齐 MCP 规则检查与理论容量估算所需输入，请按实际模型结构确认",
    "以下候选值已与源文件显式值或初始推导值不同，需要额外确认：",
    "确认并应用后，本栏当前值会补入配置",
    "理论显存预计超限",
    "候选值已调整 · 需确认",
    "静态安全兜底方案",
    "MCP 已列出缺失项和冲突项",
    "核对并应用",
    "计算中… MCP 正在解析当前代码并求解完整候选",
    "计算中… MCP 正在解析预置配置并求解完整候选",
    "停止输入后自动解析",
    "aria-busy",
    "原配置与补填项合并后的完整配置",
    "已通过 MCP 规则检查",
    "mcp-completion-capacity-status",
    "mcp-completion-plan__capacity",
    "核对风险并应用",
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
  const importSource = read(importFile);
  assert.match(
    sourceStyle,
    /\.mcp-completion-plan\s*\{[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/,
    "补齐方案外层仍有边框或背景，形成卡片套卡片",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-plan__card\s*\{[\s\S]*?border:\s*1px solid var\(--border-default\);[\s\S]*?background:\s*var\(--surface-1\);/,
    "移除补齐方案外框时不应一并移除内部方案卡片",
  );
  assert.match(
    shellSource,
    /title\.className = "mcp-import__pane-title"[\s\S]*?MCP缺口配置推荐补齐方案/,
    "第三栏标题仍继承彩色错误标题样式，或缺少“推荐”文案",
  );
  assert.ok(!importSource.includes("模型结构来源"), "配置下拉不得把模型结构来源伪装成配置选项");
  assert.ok(!importSource.includes("cro-yaml__structure-note"), "配置下拉不得保留模型结构说明卡");
  assert.match(
    importSource,
    /if \(activeSampleFile\) \{[\s\S]*?option\[value="__custom__"\][\s\S]*?\.remove\(\)[\s\S]*?delete mergedSelect\.dataset\.presetSignature/,
    "切换到其它配置后仍会保留不可再次选择的自定义临时项",
  );
  const observerSource = read(observerFile);
  assert.match(
    observerSource,
    /sourceConfigName[\s\S]*?customLabel = \(sourceName \|\| "自定义"\) \+ "已经过调整"[\s\S]*?option\.textContent = customLabel/,
    "手动调整配置后，下拉没有保留原配置名",
  );
  assert.match(
    importSource,
    /function setSourceConfigName\(name,[\s\S]*?dataset\.sourceConfigName = sourceName[\s\S]*?customOption\.textContent = adjusted \? `\$\{sourceName\}已经过调整` : sourceName[\s\S]*?addEventListener\("cro:source"/,
    "导入配置名没有同步给下拉与选项卡片",
  );
  assert.match(
    importSource,
    /function configLabelHtml\(value\)[\s\S]*?cro-config-adjusted-tag[\s\S]*?mergedTrigger\.innerHTML = configLabelHtml\(label\)[\s\S]*?configLabelHtml\(meta\.label\)/,
    "配置触发框与临时选项没有把“已手动调整”渲染为独立标签",
  );
  assert.match(
    sourceStyle,
    /\.cro-config-adjusted-tag\s*\{[\s\S]*?var\(--warning\)[\s\S]*?background:[^;]*var\(--warning\)/,
    "已手动调整标签没有使用黄色标签样式",
  );
  assert.match(
    sourceStyle,
    /\.mcp-model-structure-import\s*\{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?border:\s*1px dashed/,
    "上传模型结构入口没有使用左右分区的虚线卡片",
  );
  assert.match(
    sourceStyle,
    /\.mcp-model-structure-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,[\s\S]*?\.mcp-model-structure-upload\[hidden\]\s*\{[\s\S]*?display:\s*none;/,
    "模型结构来源没有使用双页签，或上传区在默认态仍然可见",
  );
  assert.ok(
    shellSource.includes("window.croObserver.setModel(modelId)"),
    "确认预置结构后没有把页面模型切换到同一份结构",
  );
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
  assert.doesNotMatch(
    shellSource,
    /mcp-completion-plan is-single|caption\.textContent = "处理方案"|caption\.textContent = "选择处理方案"/,
    "单方案摘要或处理方案标题仍在渲染",
  );
  assert.match(
    shellSource,
    /if \(plans\.length > 1\)[\s\S]*?mcp-completion-plan__cards/,
    "多方案场景没有保留可选择的方案卡片",
  );
  assert.match(
    shellSource,
    /function completionPlanLabel[\s\S]*?推荐\|需确认[\s\S]*?plans\.length > 1[\s\S]*?completionPlanLabel\(plan\)/,
    "方案名称没有移除多余的“推荐/需确认”后缀",
  );
  assert.match(
    shellSource,
    /const missingCopy = "源文件缺少模型结构参数。"/,
    "确认文案仍重复列出补填区已有的模型结构字段",
  );
  const confirmationSource = shellSource.slice(
    shellSource.indexOf("function confirmationCopy"),
    shellSource.indexOf("function syncCompletionConfirmation"),
  );
  assert.doesNotMatch(confirmationSource, /第三栏/, "确认文案仍使用“第三栏”术语");
  assert.match(
    confirmationSource,
    /本栏已为缺失项提供可编辑候选值；候选值仅用于补齐 MCP 规则检查与理论容量估算所需输入，请按实际模型结构确认。/,
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
  assert.match(
    shellSource,
    /mcpPreviewMissingPane[\s\S]*?mcpImportMissingPane/,
    "配置下拉面板与导入配置弹窗没有共同挂载第三栏",
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
    /MCP缺口（\$\{paths\.length\}）配置推荐补齐方案/,
    "第三栏标题没有显示本次解析的真实缺口数",
  );
  assert.match(
    shellSource,
    /const missingModelPaths = missingPaths\.filter\(isModelStructurePath\)[\s\S]*?\.\.\.missingModelPaths,[\s\S]*?\.\.\.missingPaths/,
    "第三栏没有把真实缺失的模型结构字段优先列为可编辑预填项",
  );
  assert.match(
    shellSource,
    /预填模型结构[\s\S]*?上传模型结构[\s\S]*?uploadPanel\.hidden = mode !== "upload"[\s\S]*?row\.hidden = mode === "upload"/,
    "模型结构页签没有默认选择预填，或预填字段与上传按钮仍会同时出现",
  );
  assert.match(shellSource, /modelStructureMode \?\?= "prefill"/, "模型结构页签没有默认选择预填");
  assert.match(
    shellSource,
    /const awaitingModelStructureUpload[\s\S]*?modelStructureMode === "upload"[\s\S]*?modelStructureUploadStatus !== "ready"[\s\S]*?&& !awaitingModelStructureUpload/,
    "上传模型结构页签尚未上传成功时仍能点击应用",
  );
  assert.match(
    shellSource,
    /async function uploadModelStructure[\s\S]*?callParseTool\(\{ name: file\.name, content \}\)[\s\S]*?for \(const path of missingModelPaths\)[\s\S]*?modelStructureUploadStatus = "ready"[\s\S]*?validateCompletion/,
    "上传的模型结构文件没有经过解析、缺失字段检查和完整复验",
  );
  assert.match(
    shellSource,
    /const sourceValueByPath = new Map[\s\S]*?"explicit", "derived"[\s\S]*?const adjustedCandidatePaths = [\s\S]*?requires-confirmation[\s\S]*?sourceValueByPath\.has\(item\.path\)[\s\S]*?!sameValue[\s\S]*?row\.dataset\.missingKind = missingModelStructure[\s\S]*?"candidate-change"[\s\S]*?候选值已调整 · 需确认/,
    "第三栏没有只对源值确实发生变化的候选显示黄色标签",
  );
  assert.match(
    shellSource,
    /function confirmationCopy\(preferred, missingModelPaths, adjustedPaths,[\s\S]*?if \(missingModelPaths\.length\)[\s\S]*?源文件缺少模型结构参数。[\s\S]*?if \(adjustedPaths\.length\)[\s\S]*?fieldList\(adjustedPaths\)/,
    "确认文案没有根据实际字段区分模型结构缺口与配置修复",
  );
  assert.ok(
    !shellSource.includes("源文件无法还原真实模型结构，MCP 只能先用占位值完成静态复验"),
    "确认文案仍在用笼统的模型结构占位说明覆盖非结构修复方案",
  );
  assert.match(
    shellSource,
    /function appendCapacityBadge\(parent, capacity\)[\s\S]*?status !== "estimated" \|\| capacity\.recommendation_eligible === true\) return;[\s\S]*?mcp-completion-plan__capacity/,
    "安全或显存不可判断的候选仍会创建 HBM 容量标签",
  );
  assert.match(
    shellSource,
    /function syncSelectedCapacityBadge\(current, pane\)[\s\S]*?mcp-completion-plan__card\.is-selected[\s\S]*?child\.remove\(\)[\s\S]*?appendCapacityBadge\(heading, currentCapacityAssessment\(current\)\)[\s\S]*?function syncCompletionCapacityStatus[\s\S]*?syncSelectedCapacityBadge\(current, pane\)/,
    "重新估算显存后没有同步当前方案的 HBM 标签",
  );
  assert.match(
    shellSource,
    /function syncCompletionCapacityStatus[\s\S]*?recommendation_eligible !== true[\s\S]*?capacityBannerCopy/,
    "配置建模状态与显存风险状态没有独立渲染",
  );
  assert.doesNotMatch(
    shellSource,
    /确认仅作为建模草案应用|当前候选不是可启动推荐，确认后只能作为建模草案应用/,
    "显存风险操作仍使用建模草案文案",
  );
  assert.doesNotMatch(
    shellSource,
    /修改任一补齐值后会重新复验|个缺失的模型结构参数，请核对预填值/,
    "绿色配置复验状态仍保留旧的冗长说明",
  );
  assert.match(
    shellSource,
    /if \(sample\.current && pane\) renderMissingInputs\(sample\.current\.result, sample, pane, applyButton\)/,
    "配置下拉先完成预置解析、后挂载横幅时仍会遗留两条等待状态",
  );
  assert.match(
    importSource,
    /function previewPreset\(id\)[\s\S]*?const target = Object\.assign[\s\S]*?cro:config-preset-preview-ready[\s\S]*?presetId: id, config: target/,
    "页面内置预设预览没有把目标配置通知给 MCP 状态横幅",
  );
  assert.match(
    shellSource,
    /async function validateConfigPresetPreview\(detail\)[\s\S]*?pageConfigToTrainingConfig[\s\S]*?pipelineSettingsForPreset[\s\S]*?Promise\.all[\s\S]*?callValidateTool\(config\)[\s\S]*?callCapacityTool\(config\)[\s\S]*?当前内置预设已通过 MCP 规则检查/,
    "页面内置预设没有实际执行 MCP 规则检查和理论显存估算",
  );
  assert.match(
    shellSource,
    /addEventListener\("cro:config-preset-preview-ready"[\s\S]*?validateConfigPresetPreview\(event\.detail\)/,
    "页面内置预设的计算结果没有接回配置智能解析横幅",
  );
  assert.doesNotMatch(
    sourceStyle,
    /\.mcp-completion-plan__capacity\.is-safe/,
    "安全候选仍保留容量标签样式",
  );
  assert.ok(
    !shellSource.includes("这些值无法从源文件还原。")
      && !shellSource.includes("第三栏已提供全部补齐项"),
    "黄色确认横幅仍包含重复说明",
  );
  const confirmationCopySource = shellSource.match(
    /function confirmationCopy\([\s\S]*?\n  function syncCompletionConfirmation/,
  )?.[0] ?? "";
  assert.ok(
    confirmationCopySource && !confirmationCopySource.includes("openPangu 2.0 Flash"),
    "补齐确认区不应把候选值归因于特定模型结构",
  );
  assert.ok(
    !shellSource.includes("我已逐项核对第三栏中的预填值"),
    "确认文案仍保留代替用户宣称已核对的句子",
  );
  assert.ok(
    !shellSource.includes("第三栏当前值会写入配置，并参与并行拓扑校验与 theoretical 理论容量估算"),
    "确认文案结尾仍保留冗长的影响范围说明",
  );
  assert.ok(
    !shellSource.includes("配置修复会改变源配置或并行规模"),
    "确认文案仍暗示会修改原始配置文件",
  );
  assert.ok(
    !shellSource.includes("配置修复 · 需确认"),
    "第三栏仍按非模型配置类型泛化显示黄色修复标签",
  );
  assert.ok(
    !shellSource.includes("模型结构缺失 · 已预填"),
    "第三栏仍对职责范围内的模型结构预填显示黄色标签",
  );
  assert.match(
    shellSource,
    /if \(adjustedCandidate\) \{[\s\S]*?reasonParts\.push\(`原值：\$\{inlineValue\(sourceValueByPath\.get\(path\)\)\}`\)[\s\S]*?mcp-missing-field__reason/,
    "候选值已调整时，字段原因没有先展示源文件的原值",
  );
  assert.match(
    shellSource,
    /\.\.\.missingPaths[\s\S]*?preferred\?\.values[\s\S]*?\.map\(\(item\) => item\.path\)/,
    "第三栏没有合并显示缺失字段与候选修复的冲突字段",
  );
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
    /\.mcp-completion-status\.is-review::before\s*\{[\s\S]*?border:\s*1\.5px solid currentColor;[\s\S]*?content:\s*"!";/,
    "橙色审核状态没有统一的线性感叹号图标",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-plan__confirmation\s*\{[\s\S]*?var\(--warning\)/,
    "待核对内容没有保留黄色确认提示",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-plan__confirmation input\s*\{[\s\S]*?appearance:\s*none;[\s\S]*?background:\s*transparent;[\s\S]*?\.mcp-completion-plan__confirmation input:checked\s*\{[\s\S]*?background:\s*var\(--warning\);/,
    "暗黑主题下的待核对复选框仍可能使用浏览器默认白色填充",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-plan__confirmation > span\s*\{[\s\S]*?max-height:\s*5\.6em;[\s\S]*?overflow-y:\s*auto;/,
    "第三栏的黄色确认横幅正文没有限制为四行并启用内部滚动",
  );
  assert.match(
    sourceStyle,
    /\.mcp-missing-pane\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?\.mcp-missing-pane__fields\s*\{[\s\S]*?overflow:\s*visible;/,
    "第三栏的补齐方案与配置字段没有共用同一个滚动区",
  );
  assert.match(
    sourceStyle,
    /\.mcp-completion-plan__confirmation\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/,
    "第三栏的黄色确认横幅没有在滚动触顶后固定",
  );
  assert.match(
    shellSource,
    /plansHost\.insertAdjacentElement\("afterend", confirmation\)/,
    "黄色确认横幅没有脱离方案列表，无法在字段滚动期间持续固定",
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
    read(mcpValidationAdapterFile),
    /capacityConfigFor[\s\S]*?容量估算已停止[\s\S]*?config\.json/,
    "导入模型缺少可信结构值时，容量链路没有停止并提示 config.json",
  );
  assert.match(
    read(path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-capacity-adapter.js")),
    /catch \(error\) \{[\s\S]*?lastResult = null;[\s\S]*?ready = false;[\s\S]*?renderEmpty\([\s\S]*?notifyCapacityConsumers\("unavailable", reason\);/,
    "容量输入证据不足时仍保留旧结果，点击 Rank 会把过期容量重新画回来",
  );
  assert.match(
    read(mcpValidationAdapterFile),
    /pipelineEvidence[\s\S]*?mcp-confirmed[\s\S]*?workbench-derived/,
    "动态 PP 没有区分 MCP 已确认数组与工作台即时均分",
  );
  assert.match(
    sourceStyle,
    /\.mcp-import__workspace\.has-missing-inputs\s*\{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?\}/,
    "导入弹窗有缺项时没有切换为三栏",
  );
  assert.match(
    sourceStyle,
    /\.mcp-import__workspace\.is-awaiting-validation\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?\.mcp-import__result-pane\[hidden\]\s*\{[\s\S]*?display:\s*none;/,
    "导入弹窗尚未开始校验时没有隐藏结果栏并让输入栏占满宽度",
  );
  assert.match(
    shellSource,
    /function setImportValidationStarted\(started\)[\s\S]*?is-awaiting-validation[\s\S]*?resultPane\.hidden = !started[\s\S]*?function resetImported[\s\S]*?setImportValidationStarted\(false\)[\s\S]*?async function parseImported[\s\S]*?setImportValidationStarted\(true\)/,
    "导入弹窗没有在初始态与校验态之间切换单栏和结果栏",
  );
  assert.doesNotMatch(
    shellSource,
    /mcpImportCodeTitle|codeTitle\.textContent = "配置代码"/,
    "导入弹窗仍保留“配置代码”标题",
  );
  assert.match(
    sourceStyle,
    /\.cro-yaml__menu-body\.has-missing-inputs\s*\{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?\}/,
    "配置下拉有缺项时没有切换为三栏",
  );
  assert.match(
    sourceStyle,
    /\.mcp-parse-banner__body\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*2px;/,
    "配置智能解析横幅没有保留三行正文",
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

test("配置下拉与导入弹窗提供带 Tool 影响告知的直接导入分支", () => {
  const shellSource = read(mcpShellEntryFile);
  const validationSource = read(mcpValidationAdapterFile);
  const sourceStyle = read(mcpShellStyleFile);
  for (const marker of [
    "无需${missing.length}项补缺，直接导入",
    "配置解析问题告知",
    "继续导入",
    "补齐后导入",
    "取消导入",
    "关闭并返回上一层",
    "不会使用上一份配置补缺",
    "missingFieldImpactRows",
    "toolReadinessForMissingFields",
    "incompleteImport: !useCompletion",
  ]) {
    assert.ok(shellSource.includes(marker), `直接导入交互缺少标记：${marker}`);
  }
  assert.match(
    shellSource,
    /mcp-import-issues__close[\s\S]*?closeIssueDialog\(\{ restoreFocus: true \}\)/,
    "二次确认弹窗右上角关闭后没有只返回上一层",
  );
  assert.match(
    shellSource,
    /dialog\.addEventListener\("click", \(event\) => event\.stopPropagation\(\)\)/,
    "二次确认弹窗的点击仍会冒泡并关闭配置下拉面板",
  );
  assert.match(
    shellSource,
    /mcp-import-issues__cancel[\s\S]*?croImportClose[\s\S]*?croPreviewCancel/,
    "取消导入没有同时覆盖导入弹窗和配置选择面板",
  );
  assert.match(
    shellSource,
    /mcp-import-issues__continue[\s\S]*?const appliedCurrent = context\.state\.current;[\s\S]*?applyParsed\(appliedCurrent, report, \{ useCompletion: false \}\)/,
    "继续导入没有明确绕过补齐候选",
  );
  assert.match(
    validationSource,
    /assertToolReady[\s\S]*?不会从上一份配置继承[\s\S]*?incompleteToolReadiness/,
    "直接导入后仍可能使用上一份配置驱动 MCP Tool",
  );
  assert.match(sourceStyle, /\.mcp-import-issues\s*\{[\s\S]*?z-index:\s*12000;/);
  assert.match(sourceStyle, /\.cro-yaml__menu \.mcp-direct-import\s*\{[\s\S]*?order:\s*-1;/);
  assert.ok(
    !shellSource.includes('btn-solid mcp-import-issues__complete'),
    "补齐后导入不应使用主按钮样式",
  );
  assert.doesNotMatch(
    sourceStyle,
    /\.mcp-direct-import\s*\{[^}]*var\(--warning\)/,
    "直接导入按钮不应使用黄色警示样式",
  );
  assert.doesNotMatch(
    sourceStyle,
    /\.mcp-import-issues__continue\s*\{[^}]*var\(--warning\)/,
    "继续导入按钮不应使用黄色警示样式",
  );
  assert.match(
    sourceStyle,
    /#croConfigError\.cro-config-error\.is-mcp-invalid,\s*#croConfigError\.cro-config-error\.is-mcp-unavailable\s*\{[\s\S]*?var\(--danger\)/,
    "暂时不可用卡片没有复用红色错误样式",
  );
  assert.match(
    sourceStyle,
    /#croConfigError\.is-mcp-unavailable \.mcp-fixes\s*\{\s*display:\s*none;/,
    "暂时不可用卡片仍会展示修复建议及其分割线",
  );
});

test("导入弹窗默认提供大小有别的训练配置与可选模型结构输入", () => {
  const shellSource = read(mcpShellEntryFile);
  const sourceStyle = read(mcpShellStyleFile);
  assert.match(
    shellSource,
    /querySelector\("\.cro-import__intro"\)\?\.remove\(\)/,
    "MCP 导入弹窗没有删除顶部说明文案",
  );
  assert.ok(!shellSource.includes("训练配置支持 MindFormers"), "MCP 适配层仍会恢复导入说明文案");
  assert.ok(!sourceStyle.includes("cro-import__intro"), "导入说明删除后仍残留专用样式");
  for (const marker of [
    "mcpImportModelFile",
    "mcpImportModelText",
    "mcpImportModelName",
    "mcpImportModelClear",
    "上传训练配置",
    "上传模型结构",
    "模型结构 <span>（可选）</span>",
    "上传或粘贴 config.json 文件内容",
    "importedSourceFromUi",
    "modelSource",
  ]) {
    assert.ok(shellSource.includes(marker), `双源导入缺少标记：${marker}`);
  }
  assert.match(
    shellSource,
    /function parseInput\(source\)[\s\S]*?source\.modelSource[\s\S]*?input\.model_source/,
    "模型结构内容没有进入 parse_training_config 的 model_source 契约",
  );
  assert.match(
    shellSource,
    /const legacyParse = document\.getElementById\("croImportParse"\)[\s\S]*?legacyParse\.hidden = true[\s\S]*?legacyParse\.tabIndex = -1/,
    "自动解析启用后没有隐藏兼容用的旧解析按钮",
  );
  assert.match(
    shellSource,
    /trainingHead\.append\(trainingTitle, name, clear\)[\s\S]*?trainingHead\.append\(trainingUpload\)[\s\S]*?modelHead\.append\(modelTitle, modelName, modelClear, modelUpload\)/,
    "两个输入框的清空按钮没有分别放在上传按钮左侧",
  );
  assert.match(
    shellSource,
    /#croImportClear[\s\S]*?ui\.text\.value = ""[\s\S]*?ui\.text\.dispatchEvent[\s\S]*?#mcpImportModelClear[\s\S]*?ui\.modelText\.value = ""[\s\S]*?ui\.modelText\.dispatchEvent/,
    "两个清空按钮没有分别只清理自己的输入源",
  );
  assert.match(
    sourceStyle,
    /\.mcp-import__training-source\s*\{[\s\S]*?flex:\s*1 1 68%;[\s\S]*?\.mcp-import__model-source\s*\{[\s\S]*?flex:\s*0 1 32%;/,
    "训练配置与模型结构输入没有保持上大下小的布局比例",
  );
  const modelStyle = sourceStyle.slice(
    sourceStyle.indexOf(".mcp-import__model-source {"),
    sourceStyle.indexOf("}", sourceStyle.indexOf(".mcp-import__model-source {")) + 1,
  );
  assert.doesNotMatch(modelStyle, /border-top|border-bottom/, "模型结构输入区仍保留分割线");
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

test("用户导入配置应用后可从配置下拉恢复解析报告与补齐栏", () => {
  const importSource = read(importFile);
  const shellSource = read(mcpShellEntryFile);
  assert.match(
    importSource,
    /croImport\.selectAppliedImport[\s\S]*?activeImportedSignature = currentConfigSignature\(\)[\s\S]*?adjusted: false[\s\S]*?restoreMergedSelection\(\)/,
    "配置下拉没有保存已应用导入文件的来源身份和配置快照",
  );
  assert.match(
    importSource,
    /cro:imported-config-preview-requested[\s\S]*?cancelable: true[\s\S]*?if \(!doc\.dispatchEvent\(previewRequest\)\) return;/,
    "自定义配置分支没有给 MCP 适配层恢复导入预览的机会",
  );
  assert.match(
    shellSource,
    /const appliedImport = \{ current: null, signature: null, adjusted: \[\], source: null \}[\s\S]*?function rememberAppliedImport[\s\S]*?selectAppliedImport/,
    "MCP 适配层没有持久保存刚应用的导入结果",
  );
  assert.match(
    shellSource,
    /function renderAppliedImportPreview\(event\)[\s\S]*?renderParseReportWithoutLede[\s\S]*?renderMissingInputs\(current\.result, appliedImport, pane, applyButton\)[\s\S]*?is-applied-snapshot[\s\S]*?control\.disabled = true/,
    "配置下拉没有以只读方式恢复导入时的第二栏和第三栏",
  );
  assert.match(
    shellSource,
    /preserveRenderedState[\s\S]*?new Map\(state\.current\.supplements\)[\s\S]*?preservedSupplements\?\.has\(path\)/,
    "重新渲染已应用快照时仍会丢失用户在第三栏确认过的补齐值",
  );
  assert.match(
    shellSource,
    /const appliedCurrent = imported\.current;[\s\S]*?applyParsed\(appliedCurrent[\s\S]*?rememberAppliedImport\(appliedCurrent, adjusted\)/,
    "导入应用成功后没有登记可从配置下拉恢复的快照",
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
  assert.match(
    shellSource,
    /renderParseReportWithoutLede\(ui\.report, result\)[\s\S]*?renderMissingInputs\(result, imported/,
    "导入弹窗初次解析后仍显示重复的 cro-import__lede",
  );
  assert.match(
    shellSource,
    /renderParseReportWithoutLede\(report, current\.result, \{ adjusted \}\)/,
    "导入配置应用后重绘报告时仍显示重复的 cro-import__lede",
  );
});

test("第 12 项以 compute_rank_topology 快照驱动原 Rank 页面", () => {
  const planeSource = read(planeFile);
  const viteConfig = read(viteConfigFile);
  const baselineEvidence = [read(observerFile), planeSource].join("\n");
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
    !viteConfig.includes("const topology = lastValidTopology"),
    "配置变化后必须从当前表单重新派生页面拓扑，不能继续拿旧 topology.card 作为 MCP 拓扑底稿",
  );
  assert.ok(
    !builtShell.includes("out.push(base + i * dom.stride)"),
    "通信组成员不得继续由浏览器 stride/count 公式生成",
  );
  assert.ok(!builtShell.includes("mcpTopologyStatus"), "右上角不得保留 MCP 拓扑状态标识");
  for (const preserved of [
    "内存预估",
    "拓扑全景",
    "Rank 视角",
    "整机视角",
    "TP标注",
    "Layer标注",
  ]) {
    assert.ok(builtShell.includes(preserved), `第 12 项误删原 Rank 交互：${preserved}`);
  }
  assert.doesNotMatch(planeSource, /\[\s*\["auto",\s*"自适应"\]/, "视角栏不得显示自适应选项");
  assert.match(planeSource, /tpBtn\.hidden = true;[\s\S]*?layerBtn\.hidden = true;/,
    "TP 与 Layer 标注开关应保留实现但屏蔽入口");
  assert.match(planeSource, /crop-tp-bracket__label", "TP"\)/,
    "放大后的 TP 括号不得追加数量标注");
  assert.match(planeSource,
    /memoryObservation \? `Stage \$\{block\.stage\}` : `PP Stage\$\{block\.stage\}`/,
    "内存预估视图的 PP 刻度应精简为 Stage 编号");
  assert.match(planeSource,
    /let unitMode = "rank";[\s\S]*?let tpGroupsVisible = true;[\s\S]*?let layerDetailVisible = false;[\s\S]*?let memoryObservation = true;[\s\S]*?let memoryAvailable = true;[\s\S]*?let memoryPrefs = \{ unit: "auto" \};/,
    "画布应默认进入开启 TP 标注的 Rank 内存预估视图，并保留拓扑全景的自适应偏好");
  assert.match(planeSource,
    /function syncMcpCapacityAvailability\(detail\)[\s\S]*?detail\.available === true[\s\S]*?setMemoryObservation\(false\)/,
    "容量证据不可用时画布没有自动回退到拓扑全景");
  assert.match(planeSource,
    /function preferMemoryAfterConfigRefresh\(\)[\s\S]*?preferMemoryOnNextCapacityReady = true[\s\S]*?cro:change[\s\S]*?preferMemoryAfterConfigRefresh\(\)[\s\S]*?onChange\(event\.detail\)/,
    "普通配置刷新且容量成功后没有恢复默认的内存预估视图");
  assert.match(planeSource,
    /mcp:parsed-config-applied[\s\S]*?preferMemoryAfterConfigRefresh\(\)[\s\S]*?mcp:pipeline-settings-change[\s\S]*?preferMemoryAfterConfigRefresh/,
    "导入配置或 PP 分层设置刷新后没有沿用内存预估默认规则");
  assert.match(planeSource,
    /const restoreMemoryDefault = memoryAvailable && preferMemoryOnNextCapacityReady;[\s\S]*?setMemoryObservation\(true\)/,
    "容量成功事件没有消费新配置的内存预估默认偏好");
  assert.match(planeSource,
    /memoryBtn\.setAttribute\("aria-disabled", String\(!memoryAvailable\)\)[\s\S]*?memoryBtn\.dataset\.tip = memoryUnavailableReason/,
    "内存预估不可用时没有禁用入口并提供原因气泡");
  assert.match(read(path.join(baselineDirectory, "css/config-relation-plane.css")),
    /\.crop-canvas-modes \.btn\.is-capacity-unavailable\s*\{[\s\S]*?cursor:\s*not-allowed/,
    "内存预估不可用时鼠标没有显示禁止状态");
  assert.match(planeSource,
    /memoryObservation = true;[\s\S]*?tpGroupsVisible = true;[\s\S]*?layerDetailVisible = false;/,
    "再次进入内存预估时应开启 TP 标注并保持 Stage 聚合");
  assert.match(planeSource,
    /const off = id === "node" && !allowed;[\s\S]*?memoryObservation && id === "rank"[\s\S]*?六段内存与 HBM 容量都按本机卡数汇总后填色/,
    "内存预估应允许切换 Rank/整机视角，并只在物理节点边界不成立时禁用整机档");
  assert.match(planeSource,
    /function buildMemoryStack\(measure, cardCount = 1\)[\s\S]*?const capacity = measure\.cap \* cards;[\s\S]*?measure\.values\[key\][\s\S]*?\* cards;[\s\S]*?buildMemoryStack\(memoryMeasure, span\)/,
    "整机内存填色应同时聚合六段占用和物理 HBM 容量，不能把首卡读数冒充整机");
  assert.match(planeSource,
    /const memoryScope = isNode \? `整机合计（\$\{memoryCards\} 卡）` : "单卡";[\s\S]*?m\.total \* memoryCards[\s\S]*?m\.cap \* memoryCards[\s\S]*?m\.values\.reserve \* memoryCards/,
    "整机内存悬浮信息应按本机卡数汇总总量、容量和六段明细");
  assert.match(planeSource,
    /function fitViewport\(\)[\s\S]*?tools\.getBoundingClientRect\(\)[\s\S]*?y1: clamp\(controlsTop, v\.y0, v\.y1\)[\s\S]*?const v = fitViewport\(\);/,
    "画布适配区域应避让右下控制栏所在的整行");
  assert.match(planeSource,
    /const MEMORY_ROW_GAP_PX = 6;[\s\S]*?const ROW_GAP_PX = MEMORY_ROW_GAP_PX \* 3;/,
    "拓扑全景的 Rank 行距应从原始 6px 的 2 倍只向上提高到 3 倍");
  assert.match(planeSource,
    /const rowGapPx = clamp\(layout\.rankRowGapPx \* k,[\s\S]*?layout\.rankRowGapPx, 3 \* layout\.rankRowGapPx\);[\s\S]*?const cellBodyH = span === 1 \? cellBodyW : rowH - rowGapWorld;/,
    "拓扑全景缩放后应保持屏幕最小 Rank 行距，并让 Rank 始终为正方形");
  assert.match(planeSource,
    /const guideOuterYGap = guideSpan === 1[\s\S]*?layout\.cellH - guideBody[\s\S]*?: guideRowGapWorld;/,
    "Rank 图层引导带应跟随正方形 Rank 的实际纵向边界");
  assert.match(planeSource,
    /const stageSlotX = memoryObservation \? sx - layout\.lane \* k : sx;[\s\S]*?--crop-stage-label-scale/,
    "内存预估极小缩放时 Stage 文字应借用完整槽位并压缩避让");
  assert.match(planeSource,
    /memoryObservation && col\.type === "stage"[\s\S]*?\(layout\.lane \+ cellW\) \* k/,
    "内存预估极小缩放时下层 Stage 序号应使用完整槽位");
  assert.ok(!builtShell.includes("crop-paint"), "画布不得保留专家着色按钮");
  assert.ok(!builtShell.includes("paintExperts"), "画布不得保留专家着色状态与渲染分支");
});

test("超长 MCP 错误卡不遮满左侧配置视口", () => {
  const sourceStyle = read(mcpShellStyleFile);
  assert.match(
    sourceStyle,
    /> \.cro-config-error\.is-mcp-invalid\s*\{[\s\S]*?max-height:\s*var\(--mcp-config-error-max-height,[\s\S]*?overflow-y:\s*auto;[\s\S]*?\}/,
    "超长错误卡应限制高度并在卡片内部滚动",
  );
  assert.match(
    read(mcpShellEntryFile),
    /--mcp-config-error-max-height[\s\S]*?height \* 2 \/ 3[\s\S]*?ResizeObserver/,
    "错误卡高度上限应跟随左侧配置滚动区并保持为其三分之二",
  );
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
    "MindSpeed 兼容警告最少",
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
  assert.match(sourceStyle, /\.cro-config-error\.is-mcp-invalid \.cro-config-error__msg\s*\{[\s\S]*?padding-bottom:\s*8px;[\s\S]*?\}/, "MCP 错误消息底部应保留 8px 内边距");
  assert.ok(!builtShell.includes("mcp-fixes__boundary"), "修复候选底部不应继续显示边界文案");
  assert.match(
    sourceStyle,
    /#croConfigError\.cro-config-error\.is-mcp-invalid,\s*#croConfigError\.cro-config-error\.is-mcp-unavailable\s*\{[\s\S]*?var\(--danger\)[\s\S]*?\}/,
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
    /\.mcp-validation__warnings\s*\{[\s\S]*?border:\s*1px solid[\s\S]*?var\(--warning\)[\s\S]*?background:\s*linear-gradient[\s\S]*?\}[\s\S]*?\.mcp-validation__warnings \.mcp-validation__diagnostic,[\s\S]*?color:\s*var\(--warning\);/,
    "提醒内容与分点应使用黄色警示语义",
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
  for (const marker of [
    "function fitParallelWorld",
    "function structurallyAllowed",
    "function clampToSpec",
    "function nearestMultiple",
    "function nearestDivisor",
    "function nearestPow2Divisor",
    "function tpShardBasis",
    "function ulyssesCpBasis",
    "function maxStageLayers",
    "function balancedPipelineLayers",
    "config.seqLen = nearestMultiple",
    "config.totalRank = parallelWorld(config)",
    "config.node = nodeLayout(config).node",
    "超量程的整数夹回去",
    "页面基础约束",
  ]) {
    assert.ok(!builtShell.includes(marker), `MCP App 仍残留浏览器本地校验或配平：${marker}`);
  }
  for (const marker of [
    "function validate() { return []; }",
    "function reconcile(config) { return config; }",
    "config[field] = parsed",
    "字段红黄状态只由 MCP validationMarks",
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少 MCP 校验全权接管证据：${marker}`);
  }
  assert.ok(
    read(mcpValidationAdapterFile).includes("sequence_length: configuredNumber(config.seqLen, 1)"),
    "Seq Length 仍在进入 MCP 前被正整数回退逻辑改写",
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
  const planeSource = read(planeFile);
  const builtShell = read(builtShellFile);
  const sourceStyle = read(mcpShellStyleFile);
  const viteConfig = read(viteConfigFile);
  assert.match(
    read(mcpValidationAdapterFile),
    /Object\.keys\(event\.detail\?\.supplements[\s\S]*?sourcePaths\.add\(path\)/,
    "第三栏已确认的容量结构值没有进入模型证据集合",
  );
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
    "内存预估",
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
  assert.ok(
    !read(path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-capacity-adapter.js")).includes("tight: 0.70"),
    "容量适配层不得保留旧的 70% 页面兜底阈值",
  );
  assert.match(
    sourceStyle,
    /\.crop-memory-legend__shade\s*\{[\s\S]*?var\(--background\) 76%[\s\S]*?\}/,
    "Rank HBM 当前范围以外的色阶应进一步暗化",
  );
  assert.match(
    sourceStyle,
    /\.crop-memory-legend__marker--caution::before\s*\{[\s\S]*?background:\s*repeating-linear-gradient\([\s\S]*?var\(--warning\)[\s\S]*?transparent[\s\S]*?\);[\s\S]*?\}/,
    "Rank HBM 警戒线应使用警示色虚线",
  );
  assert.ok(
    viteConfig.includes('memoryLegendRisk = el("span", "crop-memory-legend__risk", "OOM风险高")')
      && viteConfig.includes("hiRawRatio <= cautionRatio")
      && viteConfig.includes("rawRatio <= cautionRatio"),
    "Rank HBM 最大值越过警戒线后应在当前范围后显示 OOM 风险",
  );
  assert.ok(
    planeSource.includes("Math.round(rawRatio * 100)")
      && planeSource.includes("Math.round(loRawRatio * 100)")
      && planeSource.includes("Math.round(hiRawRatio * 100)"),
    "Rank HBM 图例应只夹取标记位置，百分比文案必须保留超过 100% 的真实值",
  );
  assert.ok(
    viteConfig.includes("cautionLabel.dataset.hint")
      && viteConfig.includes("是参考警戒线")
      && viteConfig.includes("作为警戒余量"),
    "Rank HBM 警戒值悬浮气泡应一句话说明阈值来源与边界",
  );
  assert.match(
    sourceStyle,
    /\.crop-memory-legend__risk\s*\{[\s\S]*?color:\s*var\(--warning\);[\s\S]*?\}/,
    "Rank HBM OOM 风险文案应使用警示色",
  );
  assert.match(
    sourceStyle,
    /\.crop-memory-legend__marker--caution \.crop-memory-legend__marker-label\s*\{[\s\S]*?pointer-events:\s*auto;[\s\S]*?cursor:\s*help;[\s\S]*?\}/,
    "Rank HBM 警戒值应允许鼠标悬浮并显示帮助光标",
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
  ]) {
    assert.ok(builtShell.includes(marker), `MCP App 缺少对象详情空闲态边界：${marker}`);
  }
  assert.ok(
    !builtShell.includes("点画布上的 rank 行、layer 列、PP Stage 条或格子里的专家"),
    "MCP App 无选中对象时不应渲染右栏空状态",
  );
  assert.match(
    builtShell,
    /if \(!p\) \{[\s\S]*?right\.classList\.add\("is-collapsed"\);[\s\S]*?syncPanelButtons\(\);[\s\S]*?return;/,
    "MCP App 无选中对象时没有自动关闭右栏",
  );
  assert.match(
    builtShell,
    /rb\.addEventListener\("click",[\s\S]*?if \(!relation\?\.primary\)[\s\S]*?right\.classList\.add\("is-collapsed"\)/,
    "MCP App 仍可在无选中对象时手动打开空右栏",
  );
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

test("第 17 项资源收口不得破坏页面初始化主链路", () => {
  const builtShell = read(builtShellFile);
  const inlineScripts = [...builtShell.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  inlineScripts.forEach((match, index) => {
    assert.doesNotThrow(
      () => new vm.Script(match[1], { filename: `mcp-app-inline-${index + 1}.js` }),
      `MCP App 第 ${index + 1} 段内联脚本存在语法错误`,
    );
  });
  assert.doesNotMatch(
    builtShell,
    /if \(!\(controller\.config\.customCardMemoryGB != null && Number\.isFinite\(custom\)\)\) return spec;/,
    "纯 derive(config) 不得引用控制器闭包中的 controller",
  );
  for (const marker of [
    'id="croYamlRegion"',
    '.crop-pane--form',
    '.crop-pane--code',
    'id="croImportConfig"',
    'id="croCapacity"',
    "mcp-host-state",
    'id="croConfigPresetSelect"',
    "const sampleOf =",
    'id="croHeat"',
    'const clusterGrid = doc.querySelector(".cro-cluster__grid")',
    "if (clusterGrid) engine.appendChild(clusterGrid)",
    'stage.id = "cropStage"',
    'world.id = "cropWorld"',
    "leftBody.append(paneForm, paneCode, paneNet)",
  ]) {
    assert.ok(builtShell.includes(marker), `第 17 项误删保留能力：${marker}`);
  }

  for (const legacyPath of [
    "apps/mcp-server/ui/mcp-app.html",
    "apps/mcp-server/ui/plane-app",
    "apps/mcp-server/ui/src/app.js",
    "apps/mcp-server/ui/src/styles.css",
    "apps/mcp-server/ui/src/preview-results.js",
    "apps/mcp-server/ui/src/workbench.js",
    "apps/mcp-server/ui/src/builtin-configs.js",
    "apps/mcp-server/ui/src/plane",
  ]) {
    assert.ok(!fs.existsSync(path.join(repositoryRoot, legacyPath)), `旧 MCP UI 路径仍存在：${legacyPath}`);
  }

  const baselineForHash = read(baselineHtmlFile).replace(
    /(<a class="btn btn-sm cro-export-btn" id="croMindSpeedIntro" href=")[^"]+(" target="_blank")/,
    "$1__MINDSPEED_INTRO_URL__$2",
  );
  const baselineHash = crypto.createHash("sha256").update(baselineForHash).digest("hex");
  assert.equal(
    baselineHash,
    "5c43ed794ea7b76ddfd074a1317f8542388feeebc9508cd6e6177d905a20585d",
    "除已确认的页面修改和单独校验的 MindSpeed intro 地址外，不得意外改写 4173 主页面基线",
  );
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
