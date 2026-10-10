import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const baselineRoot = fileURLToPath(new URL("../web/config-relation-plane-baseline/", import.meta.url));
const baselinePage = fileURLToPath(new URL(
  "../web/config-relation-plane-baseline/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp.html",
  import.meta.url,
));
const bridgeFile = fileURLToPath(new URL("./ui/src/mcp-shell-entry.js", import.meta.url));
const bridgeDirectory = path.dirname(bridgeFile);
const sampleDirectory = path.join(path.dirname(baselinePage), "config-test");
const outputDirectory = fileURLToPath(new URL("./ui/dist/ui-shell-v1/", import.meta.url));

function resolveLocalAsset(htmlFile, reference) {
  const cleanReference = reference.split(/[?#]/, 1)[0];
  return path.resolve(path.dirname(htmlFile), decodeURIComponent(cleanReference));
}

function escapeClosingScript(source) {
  return source.replaceAll("</script", "<\\/script");
}

function expandLocalCssImports(cssFile, source, stack = new Set()) {
  const normalizedFile = path.resolve(cssFile);
  if (stack.has(normalizedFile)) throw new Error(`Circular CSS import: ${normalizedFile}`);
  const nextStack = new Set(stack).add(normalizedFile);
  return source.replace(/@import\s+["']([^"']+)["'];/g, (statement, reference) => {
    if (!reference.startsWith(".")) return statement;
    const importedFile = path.resolve(path.dirname(normalizedFile), reference);
    const importedSource = fs.readFileSync(importedFile, "utf8");
    return expandLocalCssImports(importedFile, importedSource, nextStack);
  });
}

function bundledSamples() {
  return Object.fromEntries(fs.readdirSync(sampleDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ya?ml|json|sh|bash)$/i.test(entry.name))
    .map((entry) => [entry.name, fs.readFileSync(path.join(sampleDirectory, entry.name), "utf8")]));
}

function bridgeSource() {
  return fs.readFileSync(bridgeFile, "utf8")
    .replace("__MCP_BUILTIN_SOURCES__", JSON.stringify(bundledSamples()));
}

function replaceRequired(source, pattern, replacement, label) {
  const transformed = source.replace(pattern, replacement);
  if (transformed === source) throw new Error(`MCP UI subtraction did not find ${label}`);
  return transformed;
}

function replaceRangeRequired(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) throw new Error(`MCP UI subtraction did not find ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function connectMcpTopology(source, assetFile) {
  const basename = path.basename(assetFile);
  if (basename === "config-relation-observer.js") {
    let transformed = replaceRequired(
      source,
      /if \(!topology\.valid\) return;\r?\n\s*lastValidConfig = \{ \.\.\.config \};\r?\n\s*lastValidTopology = topology;\r?\n\s*listeners\.forEach\(\(fn\) => fn\(topology\)\);\r?\n\s*document\.dispatchEvent\(new CustomEvent\("cro:change", \{ detail: topology \}\)\);/,
      `if (!topology.valid) {
        global.__mcpTopologyAdapter?.invalidate(topology);
        return;
      }
      const mcpTopology = global.__mcpTopologyAdapter?.resolve(topology);
      if (global.__mcpTopologyAdapter && !mcpTopology) return;
      const publishedTopology = mcpTopology || topology;
      lastValidConfig = { ...config };
      lastValidTopology = publishedTopology;
      listeners.forEach((fn) => fn(publishedTopology));
      document.dispatchEvent(new CustomEvent("cro:change", { detail: publishedTopology }));`,
      "the MCP topology publication gate",
    );
    transformed = replaceRequired(
      transformed,
      /get topology\(\) \{\r?\n\s*const current = derive\(config\);\r?\n\s*return current\.valid \|\| !lastValidTopology \? current : lastValidTopology;\r?\n\s*\}/,
      `get topology() {
        const current = derive(config);
        const mcpTopology = global.__mcpTopologyAdapter?.peek(current);
        if (mcpTopology) return mcpTopology;
        if (global.__mcpTopologyAdapter && lastValidTopology) return lastValidTopology;
        return current.valid || !lastValidTopology ? current : lastValidTopology;
      }`,
      "the MCP topology getter",
    );
    return transformed;
  }
  if (basename === "config-relation-plane.js") {
    let transformed = replaceRequired(
      source,
      /function commPeers\(dom, anchor\) \{\r?\n\s*if \(dom\.count <= 1\) return \[anchor\];\r?\n\s*const idx = Math\.floor\(anchor \/ dom\.stride\) % dom\.count;\r?\n\s*const base = anchor - idx \* dom\.stride;\r?\n\s*const out = \[\];\r?\n\s*for \(let i = 0; i < dom\.count; i \+= 1\) out\.push\(base \+ i \* dom\.stride\);\r?\n\s*return out;\r?\n\s*\}/,
      `function commPeers(dom, anchor) {
    const type = String(dom.name || "").toLowerCase();
    const groups = topology?.mcpGroups?.[type] || [];
    const group = groups.find((item) => item.ranks.includes(anchor));
    return group ? [...group.ranks] : [anchor];
  }`,
      "the MCP communication-group lookup",
    );
    transformed = replaceRequired(
      transformed,
      /\["传输内容", s\.why \? `\$\{s\.payload\} —— \$\{s\.why\}` : s\.payload\],\r?\n\s*\["谁和谁", commPeerText\(peers\)\],\r?\n\s*\["通信范围", `\$\{s\.domain\.name\} group · \$\{s\.domain\.count\} 个 rank`\r?\n\s*\+ \(s\.domain\.stride > 1 \? ` · 步长 \$\{s\.domain\.stride\}` : " · rank 连号"\)\],\r?\n\s*\["跨几台机器",/,
      `["传输内容（页面说明）", s.why ? \`\${s.payload} —— \${s.why}\` : s.payload],
      ["谁和谁（MCP）", commPeerText(peers)],
      ["通信范围", \`\${s.domain.name} group · \${peers.length} 个 rank · 成员来自 MCP\`],
      ["跨几台机器（页面推导）",`,
      "the communication provenance labels",
    );
    return replaceRequired(
      transformed,
      /\["频次", s\.per\],/,
      '["频次（页面说明）", s.per],',
      "the communication frequency provenance label",
    );
  }
  return source;
}

function connectMcpFixes(source, assetFile) {
  if (path.basename(assetFile) !== "config-relation-observer.js") return source;
  let transformed = replaceRangeRequired(
    source,
    "  /* ── 建议修法",
    "  /* ── 悬浮说明",
    "  /* 修复候选统一由 suggest_config_fixes 计算，页面不再保留一套本地修复公式。 */\n",
    "the browser-local fix proposal formula",
  );
  transformed = replaceRequired(
    transformed,
    "invalidTyped = { field, value: parsed, proposal: proposeFix(config, field) };",
    "invalidTyped = { field, value: parsed, proposal: null };",
    "the browser-local fix proposal call",
  );
  transformed = replaceRequired(
    transformed,
    "没能算出兼容这个数的改法 —— 换一个值，或退回上一组参数",
    "请在下方查看 MCP 修复候选，或退回上一组参数",
    "the browser-local no-fix message",
  );
  transformed = replaceRangeRequired(
    transformed,
    "    /* 配置状态横幅：",
    "    function emit() {",
    `    /* 页面基础推导只负责阻止无效 DOM 刷新；可见结论统一由 MCP 校验与修复结果渲染。 */
    function renderConfigError() {
      const host = document.getElementById("croConfigError");
      if (!host) return;
      Array.from(host.children).forEach((child) => {
        if (!["mcpValidationConclusion", "mcpFixesConclusion"].includes(child.id)) child.remove();
      });
      host.classList.remove("is-blocking", "is-guidance", "is-warning");
    }

`,
    "the browser-local validation conclusion renderer",
  );
  transformed = replaceRequired(
    transformed,
    /      importConfig,\r?\n      \/\* 冻结期间也返回上一组自洽拓扑：/,
    `      importConfig,
      cancelInvalidConfig() {
        if (!lastValidConfig) return false;
        const changed = Object.keys(lastValidConfig)
          .some((field) => !Object.is(config[field], lastValidConfig[field]));
        Object.assign(config, lastValidConfig);
        invalidTyped = null;
        rangeHint = null;
        emit();
        return changed;
      },
      /* 冻结期间也返回上一组自洽拓扑：`,
    "the invalid-configuration cancel action",
  );
  transformed = replaceRequired(
    transformed,
    "setAdvancedOpen(entry, readAdvancedOpen(entry.storeKey), false);",
    "setAdvancedOpen(entry, false, false);",
    "the default-collapsed advanced panels",
  );
  return transformed;
}

function connectMcpCapacity(source, assetFile) {
  const basename = path.basename(assetFile);
  if (basename === "config-relation-capacity.js") {
    return `/* 容量计算已迁移到 estimate_training_capacity；第 14 项适配层只渲染 structuredContent。 */`;
  }
  if (basename !== "config-relation-plane.js") return source;
  let transformed = replaceRequired(
    source,
    "  applyTransform();",
    `  document.addEventListener("mcp:capacity-result", () => {
    scheduleRender();
    if (!relation) renderDetail();
  });

  applyTransform();`,
    "the MCP capacity result repaint hook",
  );
  transformed = replaceRequired(
    transformed,
    `  const memoryLegendRank = makeMemoryMarker("rank");
  memoryLegendRank.hidden = true;`,
    `  const memoryLegendRank = makeMemoryMarker("rank");
  memoryLegendRank.hidden = true;
  const memoryLegendCaution = makeMemoryMarker("caution");
  memoryLegendCaution.hidden = true;`,
    "the Rank HBM caution marker",
  );
  transformed = replaceRequired(
    transformed,
    `  memoryLegendTrack.append(memoryLegendRamp, memoryLegendShadeLo, memoryLegendShadeHi,
    memoryLegendMin, memoryLegendMax, memoryLegendRank);`,
    `  memoryLegendTrack.append(memoryLegendRamp, memoryLegendShadeLo, memoryLegendShadeHi,
    memoryLegendCaution, memoryLegendMin, memoryLegendMax, memoryLegendRank);`,
    "the Rank HBM caution marker placement",
  );
  transformed = replaceRequired(
    transformed,
    `    positionMemoryLegend();

    const valid =`,
    `    positionMemoryLegend();

    const rawCautionRatio = Number(global.croCapacityModel?.THRESHOLD?.tight);
    const cautionRatio = Number.isFinite(rawCautionRatio)
      ? clamp(rawCautionRatio, 0, 1) : null;
    memoryLegendCaution.hidden = cautionRatio === null;
    if (cautionRatio !== null) {
      placeMemoryLegendMarker(memoryLegendCaution, cautionRatio,
        \`警戒 \${Math.round(cautionRatio * 100)}%\`);
    }
    const cautionNote = cautionRatio === null
      ? "" : \`；页面 theoretical 警戒线 \${Math.round(cautionRatio * 100)}%\`;

    const valid =`,
    "the Rank HBM caution threshold from config-core",
  );
  transformed = replaceRequired(
    transformed,
    `      memoryLegend.title = \`Rank \${selectedRank} 的 HBM 占用为 \${Math.round(ratio * 100)}%\`;`,
    `      memoryLegend.title = \`Rank \${selectedRank} 的 HBM 占用为 \${Math.round(ratio * 100)}%\`
        + cautionNote;`,
    "the selected Rank HBM caution description",
  );
  transformed = replaceRequired(
    transformed,
    `    memoryLegend.title = \`当前 Rank HBM 占用范围 \${Math.round(loRatio * 100)}%–\${Math.round(hiRatio * 100)}%\`
      + "；冷蓝 = 占用低，火红 = 占用高";`,
    `    memoryLegend.title = \`当前 Rank HBM 占用范围 \${Math.round(loRatio * 100)}%–\${Math.round(hiRatio * 100)}%\`
      + "；冷蓝 = 占用低，火红 = 占用高" + cautionNote;`,
    "the Rank HBM range caution description",
  );
  return transformed;
}

function subtractActivityRail(html) {
  const withoutRail = replaceRequired(
    html,
    /\s*<nav\b[^>]*class="[^"]*pto-ide-frame__activity-rail[^"]*"[^>]*>[\s\S]*?<\/nav>\s*/,
    "\n",
    "the activity rail",
  );
  return replaceRequired(
    withoutRail,
    /\s*\/\/ rail 底部互跳组：[\s\S]*?go\("navTaskCompare", "\.\/TaskCompare\.html"\);\s*\}\)\(\);/,
    "",
    "the activity rail navigation listeners",
  );
}

function subtractActivityRailObserverHooks(source, assetFile) {
  if (path.basename(assetFile) !== "config-relation-observer.js") return source;
  const withoutPressedState = replaceRequired(
    source,
    /^\s*document\.getElementById\("navRelationEvents"\)\?\.setAttribute\("aria-pressed", String\(!collapsed\)\);\r?\n/m,
    "",
    "the activity rail pressed state",
  );
  return replaceRequired(
    withoutPressedState,
    /^\s*document\.getElementById\("navRelationEvents"\)\?\.addEventListener\("click", \(\) => \{\r?\n[\s\S]*?^\s*\}\);\r?\n/m,
    "",
    "the activity rail event toggle listener",
  );
}

function subtractIncidentUi(html) {
  const withoutRail = replaceRangeRequired(
    html,
    '        <aside class="cro-event-rail"',
    "        <!-- 单一 pane",
    "",
    "the visible incident rail",
  );
  return replaceRangeRequired(
    withoutRail,
    "          <!-- 上区 · 事件关系横幅",
    '          <div class="pto-ide-frame__pane-body cro-board"',
    "",
    "the incident banner and detail view",
  );
}

function subtractLegacyTopbar(html) {
  let transformed = html.replace(
    /\s*<!-- 顶栏视图页签 \/ 导出配置键 \/ YAML 代码框 -->/,
    "",
  );
  transformed = replaceRequired(
    transformed,
    /\s*<div class="pto-ide-frame__workspace"[^>]*>[\s\S]*?<\/div>/,
    '\n        <div class="mcp-compute-boundary" role="note">纯计算 · 不启动训练 · 不采集实时指标</div>',
    "the legacy workspace name",
  );
  transformed = replaceRequired(
    transformed,
    /\s*<!-- what is rank：[\s\S]*?<a\b[^>]*id="croRankIntro"[\s\S]*?<\/a>/,
    "",
    "the Rank introduction link",
  );
  transformed = transformed.replace(
    /\s*<!-- MindSpeed intro：[\s\S]*?-->/,
    "",
  );
  transformed = transformed.replace(
    /\s*<!-- 导入配置（升级计划行 20）：[\s\S]*?-->/,
    "",
  );
  transformed = replaceRequired(
    transformed,
    /\s*<!-- 导出配置：[\s\S]*?<button\b[^>]*id="croExportConfig"[\s\S]*?<\/button>/,
    "",
    "the placeholder export action",
  );
  return replaceRequired(
    transformed,
    /\s*<a class="btn btn-sm" href="\.\/config-relation-observer\.html"[^>]*>v1<\/a>/,
    "",
    "the v1 observer link",
  );
}

function convergeProductCopy(html) {
  let transformed = replaceRequired(
    html,
    'aria-label="Config and Relation Observer"',
    'aria-label="MindSpeed Config Workbench"',
    "the root observer accessibility name",
  );
  transformed = replaceRequired(
    transformed,
    'aria-label="观测视图切换"',
    'aria-label="配置视图切换"',
    "the view-switcher accessibility name",
  );
  transformed = replaceRequired(
    transformed,
    'aria-label="配置与关系观测"',
    'aria-label="配置与关系分析"',
    "the analysis pane accessibility name",
  );
  return replaceRequired(
    transformed,
    "按当前配置实时生成训练启动 yaml，整网列保留",
    "随当前配置生成训练启动 yaml，整网列保留",
    "the real-time YAML wording",
  );
}

function convergeProductScriptCopy(source, assetFile) {
  if (path.extname(assetFile) !== ".js") return source;
  return source
    .replaceAll("cinnnnnndy 配置", "128Rank-实验配置")
    .replaceAll("配置与关系观测", "配置与关系分析")
    .replaceAll("运行观测", "通信分析")
    .replaceAll("运行详解", "通信详情")
    .replaceAll("按当前配置实时生成", "随当前配置生成");
}

function subtractCapabilityClosureHtml(html) {
  let transformed = replaceRequired(
    html,
    /\s*<link\s+rel="stylesheet"\s+href="\.\/css\/model-architecture-3d-deck-pattern\.css"\s*>/,
    "",
    "the whole-network deck stylesheet",
  );
  transformed = replaceRequired(
    transformed,
    /\s*<script\s+src="\.\/js\/model-architecture-3d-deck-pattern\.js"><\/script>/,
    "",
    "the whole-network deck script",
  );
  const netStart = transformed.indexOf("            <!-- ═══ 区域 A · 整网");
  const archStart = transformed.indexOf("            <!-- ═══ 区域 B · Model Architecture", netStart);
  if (netStart === -1 || archStart === -1) {
    throw new Error("MCP UI subtraction did not find the whole-network region");
  }
  const netRegion = transformed.slice(netStart, archStart);
  const presetStepper = netRegion.match(/\s*<div class="cro-stepper">\s*<label[^>]*for="croConfigPresetSelect"[\s\S]*?<\/select>\s*<\/div>/)?.[0];
  if (!presetStepper) throw new Error("MCP UI subtraction did not find the configuration preset selector");
  transformed = transformed.slice(0, netStart) + transformed.slice(archStart);
  transformed = replaceRequired(
    transformed,
    /(<h2 class="cro-region__title">(?:Model Architecture|模型结构与并行)<\/h2>)/,
    `$1\n              ${presetStepper.trim()}`,
    "the Model Architecture title for relocating the configuration preset selector",
  );
  transformed = replaceRangeRequired(
    transformed,
    "    // 整网视图三档：",
    "  </script>",
    "",
    "the whole-network view switcher",
  );
  transformed = transformed
    .replace(/^\s*window\.croDeckController\?\.setTheme\(theme\);\r?\n/m, "")
    .replace(/^\s*\/\/ deck 重算了 --pto-model-deck-\* 调色板[^\r\n]*\r?\n/m, "");
  return transformed;
}

function subtractCapabilityClosureScript(source, assetFile) {
  const name = path.basename(assetFile);
  if (name === "config-relation-import.js") {
    return replaceRequired(
      source,
      '      + `<em>${escapeHtml(meta.source)}</em></span>`',
      '      + `</span>`',
      "the configuration-option source badge",
    );
  }
  if (name === "config-relation-observer.js") {
    return replaceRangeRequired(
      source,
      "    if (sharedHost) {",
      "\n    if (!routedHost) return;",
      `    if (sharedHost) {
      const summary = document.createElement("p");
      summary.className = "cro-empty mcp-shared-expert-summary";
      summary.textContent = counts.sharedExpert > 0
        ? \`当前配置包含 \${counts.sharedExpert} 个共享专家；这里只展示配置数量，不推测 Rank 放置。\`
        : "当前配置未启用共享专家。";
      sharedHost.appendChild(summary);
    }
`,
      "the inferred shared-expert placement UI",
    );
  }
  if (name !== "config-relation-plane.js") return source;

  let transformed = source;
  const legacyLeftLabel = '  left.setAttribute("aria-label", "训练配置 / 整网查询");';
  const currentLeftLabel = '  left.setAttribute("aria-label", "训练配置");';
  if (transformed.includes(legacyLeftLabel)) {
    transformed = transformed.replace(legacyLeftLabel, currentLeftLabel);
  } else if (!transformed.includes(currentLeftLabel)) {
    throw new Error("MCP UI subtraction did not find the left-panel accessibility name");
  }
  transformed = replaceRequired(
    transformed,
    /    topology = t;\r?\n    layout = buildLayout\(t\);/,
    `    const previousWorldSignature = topology
      ? [topology.counts.totalRank, topology.counts.totalLayer, topology.counts.pp,
        topology.counts.tp, topology.counts.cp, topology.counts.ep, topology.counts.edp].join(":")
      : "";
    topology = t;
    layout = buildLayout(t);
    const nextWorldSignature = [t.counts.totalRank, t.counts.totalLayer, t.counts.pp,
      t.counts.tp, t.counts.cp, t.counts.ep, t.counts.edp].join(":");`,
    "the topology change world-size signature",
  );
  transformed = replaceRequired(
    transformed,
    "    if (!fitted) { fitted = true; fit(); }",
    "    if (!fitted || previousWorldSignature !== nextWorldSignature) { fitted = true; fit(); }",
    "the topology change viewport refit",
  );
  transformed = transformed.replace(
    /^    \["net", "整网查询", "整网 3D deck 正视图"\],\r?\n/m,
    "",
  );
  transformed = replaceRequired(
    transformed,
    '    ["code", "代码视图", "随当前配置生成的训练启动 yaml（整板让位）"],',
    '    ["code", "代码视图", "查看内置或上传配置，并预览当前表单生成的训练启动配置"],',
    "the configuration-code provenance copy",
  );
  transformed = replaceRequired(
    transformed,
    "  leftIntro.appendChild(tabs);",
    "  leftHead.appendChild(tabs);",
    "the compact form/code tabs beside the left-panel title",
  );
  transformed = replaceRequired(
    transformed,
    /\s*const domain = commDomain\(c, "tp"\);\r?\n/,
    "\n",
    "the browser-derived TP communication domain",
  );
  transformed = replaceRequired(
    transformed,
    /const members = commPeers\(domain, anchor\)\.filter\(\(rank\) => rank >= stageStart\r?\n\s*&& rank < stageStart \+ layout\.ranksPerStage\);/,
    `const groupId = topology.coordsOfRank(anchor)?.groupIds?.tp;
      const members = [...(topology.mcpGroupsById?.tp?.get(groupId)?.ranks ?? [anchor])]
        .filter((rank) => rank >= stageStart && rank < stageStart + layout.ranksPerStage);`,
    "the MCP-backed TP group members",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ── 中栏外壳：配置寻优与通信分析共用同一 Rank 平面。 */",
    "  /* ══ 通信观测档",
    `  /* 中栏只保留配置寻优；通信组成员并入 Rank 详情。 */
  const center = el("div", "crop-center");
  center.id = "cropCenter";
  center.dataset.mode = "config";

`,
    "the standalone communication analysis tab",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ══ 通信观测档",
    '  const commDetail = el("div", "crop-comm__detail");',
    "",
    "the standalone communication analysis controls",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ══ 六·五、通信观测档",
    "  /* ── 配置寻优 / 通信分析切换",
    "",
    "the standalone communication analysis formulas and playback",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ── 配置寻优 / 通信分析切换",
    "  /* ══ 七、接上主脚本的两个事件",
    "",
    "the standalone communication analysis mode switch",
  );
  transformed = transformed
    .replace(/\s*\/\* 通信观测档整档由 counts 现算[\s\S]*?\n\s*renderComm\(\);/, "")
    .replace(/\s*\/\* 通信观测的「谁和谁」[\s\S]*?\n\s*renderComm\(\);/, "")
    .replace(/^\s*renderComm\(\);\r?\n/m, "");
  transformed = transformed.replace(
    "  toolbar.append(modelTitle, modeTabs, commNote, commExtra);",
    "  toolbar.append(modelTitle);",
  );
  transformed = replaceRequired(
    transformed,
    "  center.append(comm, stage);",
    "  center.append(stage);",
    "the standalone communication analysis panel",
  );
  transformed = replaceRequired(
    transformed,
    /\s*const commDetail = el\("div", "crop-comm__detail"\);[\s\S]*?rightBody\.appendChild\(commDetail\);/,
    "",
    "the standalone communication detail host",
  );
  transformed = replaceRequired(
    transformed,
    /\s*const commFlow = doc\.createElementNS\(SVG_NS, "svg"\);[\s\S]*?stage\.insertBefore\(commFlow, rulerTop\);/,
    "",
    "the standalone communication flow canvas",
  );
  transformed = transformed.replace(
    /\s*const commNote = el\("span", "crop-comm-note",[\s\S]*?\);\r?\n/,
    "\n",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ══ 六之二、静息态右栏：当前配置评估",
    "  function renderDetail() {",
    "  /* MCP App 的右栏只展示选中对象详情，不在浏览器计算配置评估结论。 */\n",
    "the browser-local idle configuration assessment",
  );
  transformed = replaceRequired(
    transformed,
    "默认把静息态的「当前配置评估」收起",
    "MCP App 的详情栏默认收起",
    "the obsolete idle-assessment layout comment",
  );
  transformed = replaceRequired(
    transformed,
    "    rightFacts.replaceChildren();",
    `    rightFacts.replaceChildren();
    rightBody.querySelector(":scope > .crop-rank-groups")?.remove();`,
    "the stale MCP communication group section",
  );
  transformed = replaceRangeRequired(
    transformed,
    "    /* 容量栏在两种状态下住在不同的地方：",
    "    if (!topology) return;",
    `    /* 单卡容量只随有效的对象详情显示；空闲态不展示配置摘要或上一份成功结果。 */
    if (capacity) capacity.hidden = !p;
    if (p && capacity && capacity.parentNode !== rightBody) {
      rightBody.appendChild(capacity);
    }

    if (!p) {
      rightTitle.textContent = "未选中";
      rightFacts.appendChild(el("p", "crop-empty",
        "点画布上的 rank 行、layer 列、PP Stage 条或格子里的专家，这里显示它的详情；"
        + "与它交叉的行、列、格会在画布上同时亮起来。"));
      return;
    }

`,
    "the idle right-panel assessment branch",
  );
  transformed = replaceRequired(
    transformed,
    /      rightFacts\.appendChild\(base\);\r?\n      rightFacts\.appendChild\(cardSection\(\)\);\r?\n      return;\r?\n    }\r?\n\r?\n    if \(p\.kind === "layer"\)/,
    `      rightFacts.appendChild(base);
      const groupSection = section("并行通信组");
      groupSection.classList.add("crop-rank-groups");
      let groupCount = 0;
      [["tp", "TP"], ["pp", "PP"], ["dp", "DP"], ["cp", "CP"], ["ep", "EP"], ["edp", "EDP"]]
        .forEach(([type, label]) => {
          const groupId = co.groupIds?.[type];
          const group = topology.mcpGroupsById?.[type]?.get(groupId);
          if (!group) return;
          groupCount += 1;
          groupSection.appendChild(kvRow(label, \`\${group.id} · rank \${group.ranks.join(", ")}\`, true));
        });
      rightFacts.appendChild(cardSection());
      if (groupCount) rightBody.appendChild(groupSection);
      return;
    }

    if (p.kind === "layer")`,
    "the MCP communication groups in Rank detail",
  );
  try {
    new Function(transformed);
  } catch (error) {
    throw new Error(`Capability closure produced invalid plane JavaScript: ${error.message}`);
  }
  return transformed;
}

function subtractDocumentationView(html) {
  let transformed = replaceRequired(
    html,
    /\s*<!-- 文档视图（顶栏第三档）：[\s\S]*?<link\s+rel="stylesheet"\s+href="\.\/css\/config-relation-doc\.css[^"]*"\s*>/,
    "",
    "the documentation stylesheet",
  );
  transformed = transformed.replace(
    /\s*<!-- 全局视图页签：[\s\S]*?-->/,
    "",
  );
  transformed = replaceRequired(
    transformed,
    /\s*<button\b[^>]*data-observer-view="doc"[\s\S]*?<\/button>/,
    "",
    "the documentation view tab",
  );
  transformed = replaceRequired(
    transformed,
    /\s*<!-- 文档：顶栏正中[\s\S]*?<button\b[^>]*id="croDocEntry"[\s\S]*?<\/button>/,
    "",
    "the documentation topbar entry",
  );
  transformed = replaceRequired(
    transformed,
    /\s*<!-- ═══ 区域 F · 文档[\s\S]*?<article\b[^>]*id="croDocBody"[\s\S]*?<\/article>\s*<\/section>/,
    "",
    "the documentation region and article",
  );
  return replaceRequired(
    transformed,
    /\s*<!-- 文档视图：只从正文[\s\S]*?<script\s+src="\.\/js\/config-relation-doc\.js[^"]*"\s*><\/script>/,
    "",
    "the documentation script",
  );
}

function subtractIncidentObserverCode(source, assetFile) {
  if (path.basename(assetFile) !== "config-relation-observer.js") return source;
  let transformed = replaceRangeRequired(
    source,
    "  const INCIDENT_LINEAGE_ROLES = [",
    "  function buildMockLineage",
    "",
    "the incident lineage roles",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  function buildIncidentLineage",
    "  function createLineageDrawer",
    "",
    "the incident lineage builder",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ══ 事件机制图",
    "  /* ── 页面接线",
    "",
    "the incident data and mechanism renderers",
  );
  transformed = replaceRequired(
    transformed,
    /^\s*let railLayoutTimer = 0;\r?\n/m,
    "",
    "the incident rail layout timer",
  );
  transformed = replaceRequired(
    transformed,
    /^\s*if \(!payload\?\.incidentId\) \{\r?\n[\s\S]*?^\s*\}\r?\n(?=\s*\/\/ 「先选层)/m,
    "",
    "the incident reset branch",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\/ 事件模式下四域整块隐藏[\s\S]*?^\s*}\r?\n(?=\s*drawRelationLinks)/m,
    "\n",
    "the incident relation-line branch",
  );
  transformed = replaceRequired(
    transformed,
    /\s*const incident = Boolean\(p\?\.incidentId\);\r?\n\s*const selected = !incident && Boolean\(p\) && p\.kind === "stage" && s === p\.stage;\r?\n\s*el\.classList\.toggle\("is-selected", selected\);\r?\n\s*el\.classList\.toggle\("is-related", !incident && !selected && has\("stages", s\)\);/,
    `\n        const selected = Boolean(p) && p.kind === "stage" && s === p.stage;\n        el.classList.toggle("is-selected", selected);\n        el.classList.toggle("is-related", !selected && has("stages", s));`,
    "the incident-only stage highlighting branch",
  );
  transformed = replaceRangeRequired(
    transformed,
    "    let activeIncident = null;",
    "    /* 补量一次格宽/格高",
    `    function syncPalette() {\n      syncDeckPalette(document.getElementById("croDeckHost"), document.getElementById("croBoard"));\n    }\n\n`,
    "the incident interaction engine",
  );
  transformed = replaceRequired(
    transformed,
    /\s*if \(activeIncident\) requestAnimationFrame\(\(\) => selectIncident\(activeIncident\)\);\r?\n\s*else if \(relation\) reapplySelection\(topology\);/g,
    "\n      if (relation) reapplySelection(topology);",
    "the incident refresh branches",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\* 等距容器图[\s\S]*?^\s*\}\);\r?\n/m,
    "",
    "the incident detail chart theme listener",
  );
  transformed = replaceRequired(
    transformed,
    /\s*global\.addEventListener\("resize", \(\) => requestAnimationFrame\(\(\) => \{\r?\n\s*redrawLinks\(\);[\s\S]*?^\s*\}\)\);/m,
    '\n    global.addEventListener("resize", () => requestAnimationFrame(redrawLinks));',
    "the incident canvas resize branch",
  );
  transformed = replaceRequired(
    transformed,
    ', ".cro-event", ".pto-ide-frame__topbar"',
    ', ".pto-ide-frame__topbar"',
    "the incident selector whitelist entry",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\/ 运行事件是一次显式调查上下文：[\s\S]*?^\s*}\r?\n(?=\s*if \(!event\.target)/m,
    "\n",
    "the incident document-click branch",
  );
  transformed = replaceRequired(
    transformed,
    /\s*global\.croSelectIncident = selectIncident;[\s\S]*?if \(requestedEvent\) requestAnimationFrame\(\(\) => selectIncident\(requestedEvent\)\);/,
    "\n    controller.refresh();",
    "the incident listeners and deep-link boot path",
  );
  try {
    new Function(transformed);
  } catch (error) {
    throw new Error(`Incident subtraction produced invalid observer JavaScript: ${error.message}`);
  }
  return transformed;
}

function subtractIncidentCrossFileHooks(source, assetFile) {
  if (path.basename(assetFile) !== "config-relation-yaml.js") return source;
  let transformed = replaceRequired(
    source,
    /^\s*const incidentView = doc\.getElementById\("croIncidentView"\);\r?\n/m,
    "",
    "the YAML-view incident reference",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\* 事件模式与配置仿真模式互斥[\s\S]*?^\s*}\r?\n(?=\s*board\.classList\.toggle\("is-yaml")/m,
    "\n",
    "the YAML-view incident exit hook",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\* 运行事件栏在文档档整条不显示[\s\S]*?^\s*\?\.classList\.toggle\("is-doc-view", mode === "doc"\);\r?\n/m,
    "",
    "the document-view incident rail state",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\* 选中运行事件时主脚本会把[\s\S]*?^\s*}\r?\n(?=\s*\/\* 表单一动)/m,
    "\n",
    "the incident-view tab observer",
  );
  try {
    new Function(transformed);
  } catch (error) {
    throw new Error(`Incident subtraction produced invalid YAML-view JavaScript: ${error.message}`);
  }
  return transformed;
}

function subtractDocumentationCrossFileHooks(source, assetFile) {
  const name = path.basename(assetFile);
  if (name === "config-relation-yaml.js") {
    let transformed = replaceRangeRequired(
      source,
      "  /* ── 视图切换",
      "  function setup()",
      "  /* 表单与 YAML 代码视图共用同一组内部开关。 */\n",
      "the three-mode documentation switch description",
    );
    transformed = replaceRequired(
      transformed,
      'mode = next === "yaml" || next === "doc" ? next : "relation";',
      'mode = next === "yaml" ? "yaml" : "relation";',
      "the documentation mode branch",
    );
    transformed = replaceRequired(
      transformed,
      '      board.classList.toggle("is-doc", mode === "doc");',
      "",
      "the documentation board state",
    );
    try {
      new Function(transformed);
    } catch (error) {
      throw new Error(`Documentation subtraction produced invalid YAML-view JavaScript: ${error.message}`);
    }
    return transformed;
  }
  if (name === "config-relation-plane.js") {
    let transformed = replaceRequired(
      source,
      /^\s*syncDocEntry\(\);\r?\n/m,
      "",
      "the documentation entry synchronization call",
    );
    transformed = replaceRangeRequired(
      transformed,
      "  /* 顶栏正中那组「关系视图 / YAML / 文档」",
      "  /* ══ 三、画布状态",
      "",
      "the documentation topbar listener",
    );
    try {
      new Function(transformed);
    } catch (error) {
      throw new Error(`Documentation subtraction produced invalid plane JavaScript: ${error.message}`);
    }
    return transformed;
  }
  return source;
}

function subtractSyntheticHeatView(source, assetFile) {
  if (path.basename(assetFile) !== "config-relation-plane.js") return source;

  let transformed = replaceRangeRequired(
    source,
    "  /* ══ 负载热力：度量口径、色阶与成本模型",
    "  let pickedLayer = null;",
    `  /* 内存观测与通信微观图继续共用纯视觉冷暖色阶；模拟负载模型已删除。 */\n  const HEAT_RAMP_CSS = PR.heatRampCss(PR.HEAT_RAMP);\n  const heatColor = PR.heatColor;\n  const HEAT_GIB = 1024 * 1024 * 1024;\n\n`,
    "the synthetic heat metrics and model",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\* 热力降级档一帧最多铺多少条色带[\s\S]*?const HEAT_LOD_BUDGET = 6000;\r?\n/,
    "\n",
    "the synthetic heat low-detail budget",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  function heatModel() {",
    "  /* ══ 一、重排骨架",
    "",
    "the synthetic heat model accessors",
  );
  transformed = replaceRequired(
    transformed,
    '  modeTabs.setAttribute("aria-label", "中栏观测模式");',
    '  modeTabs.setAttribute("aria-label", "中栏分析模式");',
    "the center mode accessibility name",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ── 中栏外壳：三档观测模式",
    '  const center = el("div", "crop-center");',
    "  /* ── 中栏外壳：配置寻优与通信分析共用同一 Rank 平面。 */\n",
    "the obsolete three-mode description",
  );
  transformed = replaceRequired(
    transformed,
    /  \[\r?\n    \["config", "配置寻优", "这份配置切成什么形状：stage × layer × rank × 专家"\],\r?\n    \["comm", "运行观测", "跑一个 step 会发生哪些跨卡通信：谁和谁、多大范围、走哪条链路"\],\r?\n    \["heat", "负载热力", "同一幅平面按某个度量上色"\],\r?\n  \]\.forEach\(\(\[id, label, tip\], i\) => \{/,
    `  [\n    ["config", "配置寻优", "这份配置切成什么形状：stage × layer × rank × 专家"],\n    ["comm", "通信分析", "按当前配置分析跨卡通信：谁和谁、多大范围、走哪条链路"],\n  ].forEach(([id, label, tip], i) => {`,
    "the synthetic heat mode tab",
  );
  transformed = replaceRequired(
    transformed,
    '  comm.setAttribute("aria-label", "运行观测");',
    '  comm.setAttribute("aria-label", "通信分析");',
    "the communication view accessibility name",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ── 画布顶上那条红横幅",
    '  const commDetail = el("div", "crop-comm__detail");',
    "",
    "the synthetic heat fault banner",
  );
  transformed = replaceRequired(
    transformed,
    /\s*const heatDetail = el\("div", "crop-heat-detail"\);\r?\n\s*heatDetail\.hidden = true;\r?\n\s*heatDetail\.setAttribute\("aria-label", "负载格子详情"\);\r?\n\s*rightBody\.appendChild\(heatDetail\);/,
    "",
    "the synthetic heat detail host",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ══ 负载热力档",
    "  /* 通信观测档的**口径**",
    "",
    "the synthetic heat controls and route timeline",
  );
  transformed = transformed.replace(
    "  toolbar.append(modelTitle, modeTabs, commNote, heatExtra, commExtra);",
    "  toolbar.append(modelTitle, modeTabs, commNote, commExtra);",
  );
  if (transformed.includes("  /* 页签与热力工具合成一行")) {
    transformed = replaceRangeRequired(
      transformed,
      "  /* 页签与热力工具合成一行",
      '  const toolbar = el("div", "crop-toolbar");',
      "  /* 两档页签与通信说明共用工具栏。 */\n",
      "the obsolete heat-toolbar description",
    );
  }
  transformed = transformed
    .replaceAll('"crop-heat__legend crop-memory-legend"', '"crop-memory-legend"')
    .replaceAll('"crop-heat__legend-end"', '"crop-memory-legend__end"')
    .replaceAll('"crop-heat__legend-ramp crop-memory-legend__ramp"', '"crop-memory-legend__ramp"')
    .replaceAll('"--crop-heat"', '"--crop-memory-heat"');
  transformed = replaceRequired(
    transformed,
    /^\s*heatPick = null;\r?\n/gm,
    "",
    "the synthetic heat selection resets",
  );
  transformed = replaceRangeRequired(
    transformed,
    "    /* 热力档：整幅平面改按一个度量上色。",
    "    const memoryByStage =",
    "",
    "the synthetic heat render setup",
  );
  transformed = replaceRangeRequired(
    transformed,
    "      /* ── 热力的降级档",
    "      /* ── 逐行",
    "",
    "the synthetic heat low-detail renderer",
  );
  transformed = replaceRequired(
    transformed,
    "          const showDetail = !memoryObservation && !heatOn && d.on;",
    "          const showDetail = !memoryObservation && d.on;",
    "the heat-only detail suppression",
  );
  transformed = replaceRequired(
    transformed,
    '          const showSegs = !memoryObservation && col.type !== "stage" && !heatOn && !showDetail && showBands;',
    '          const showSegs = !memoryObservation && col.type !== "stage" && !showDetail && showBands;',
    "the heat-only segment suppression",
  );
  transformed = replaceRequired(
    transformed,
    "          const paint = paintExperts && moe && !heatOn;",
    "          const paint = paintExperts && moe;",
    "the heat-only expert-paint suppression",
  );
  transformed = replaceRequired(
    transformed,
    /\s*if \(heatOn && heatPick && heatPick\.rank === rank[\s\S]*?cell\.classList\.add\("is-heat-selected"\);\r?\n\s*}/,
    "",
    "the synthetic heat selected-cell state",
  );
  transformed = replaceRangeRequired(
    transformed,
    "          /* 热力：一格一个颜色",
    "          /* ── 格内的内容",
    "",
    "the synthetic per-cell heat renderer",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* 热力档下，气泡末尾补一行",
    "  function cellTip(cell) {",
    "",
    "the synthetic heat tooltip",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\+ heatTip\(cell\)/g,
    "",
    "the synthetic heat tooltip calls",
  );
  transformed = replaceRequired(
    transformed,
    /^\s*text \+= heatTip\(cell\);\r?\n/m,
    "",
    "the remaining synthetic heat tooltip call",
  );
  transformed = replaceRangeRequired(
    transformed,
    "    /* 热力格子点击选的是",
    "    if (!target) { emit(null); return; }",
    "",
    "the synthetic heat cell picker",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ══ 热力右栏：",
    "  function cardSection() {",
    "",
    "the synthetic heat detail implementation",
  );
  transformed = replaceRangeRequired(
    transformed,
    "  /* ── 三档切换",
    '  modeTabs.addEventListener("click", (event) => {',
    `  /* ── 配置寻优 / 通信分析切换 ───────────────────────────────────────── */\n  function setMode(mode) {\n    const nextMode = mode === "comm" ? "comm" : "config";\n    const hadLayerColumns = layerColumnsVisible();\n    if (nextMode !== "config" && memoryObservation) {\n      memoryObservation = false;\n      if (memoryPrefs) {\n        tpGroupsVisible = memoryPrefs.tp;\n        layerDetailVisible = memoryPrefs.layer;\n        unitMode = memoryPrefs.unit;\n      }\n      memoryPrefs = null;\n    }\n    center.dataset.mode = nextMode;\n    board.dataset.mode = nextMode;\n    syncMemoryControls();\n    const hasLayerColumns = layerColumnsVisible();\n    if (topology && hadLayerColumns !== hasLayerColumns) {\n      layout = buildLayout(topology);\n      pickedLayer = null;\n      pickedStage = null;\n      pickedEdp = null;\n      fit();\n    }\n    modeTabs.querySelectorAll("[data-mode]").forEach((btn) => {\n      const on = btn.dataset.mode === nextMode;\n      btn.classList.toggle("is-selected", on);\n      btn.setAttribute("aria-selected", String(on));\n    });\n    if (nextMode !== "comm") {\n      commDetail.hidden = true;\n      setPlaying(false);\n      flowClear();\n      flowSweepReset();\n      flowStopRaf();\n      commFlow.classList.remove("is-on");\n    }\n    if (nextMode === "comm") {\n      unitMode = "rank";\n      if (!flowBeat) flowBeat = flowDefaultBeat();\n      renderComm();\n      rightTitle.textContent = "通信详情";\n      if (!rightPinnedClosed) right.classList.remove("is-collapsed");\n    } else {\n      if (relation) emit(null);\n      if (!rightPinnedClosed) right.classList.remove("is-collapsed");\n    }\n    syncPanelButtons();\n    global.requestAnimationFrame(() => { clampView(); applyTransform(); scheduleRender(); });\n  }\n\n`,
    "the synthetic heat mode switching and playback",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\* 热力模型按 topology[\s\S]*?^\s*}\r?\n(?=\s*})/m,
    "",
    "the synthetic heat refresh branch",
  );
  transformed = replaceRequired(
    transformed,
    /^\s*if \(center\.dataset\.mode === "heat"\) renderHeatDetail\(\);\r?\n/m,
    "",
    "the synthetic heat selection refresh",
  );
  transformed = transformed
    .replaceAll("运行观测", "通信分析")
    .replaceAll("运行详解", "通信详情")
    .replaceAll("负载热力", "共享冷暖色阶")
    .replaceAll("buildHeat", "已删除的浏览器估算模型");

  try {
    new Function(transformed);
  } catch (error) {
    throw new Error(`Heat-view subtraction produced invalid plane JavaScript: ${error.message}`);
  }
  return transformed;
}

function subtractIncidentStyles(source, assetFile) {
  const name = path.basename(assetFile);
  if (name === "config-relation-observer.css") {
    let transformed = replaceRangeRequired(
      source,
      "/* 上区 · 事件关系横幅",
      "/* ── 单一面板",
      `.pto-ide-frame__workarea {\n  position: relative;\n  flex-direction: row;\n  gap: var(--space-2);\n  padding: 0 var(--space-2);\n}\n\n`,
      "the incident rail and banner styles",
    );
    transformed = replaceRequired(
      transformed,
      /\.cro-board,\r?\n\.cro-incident-view \{/,
      ".cro-board {",
      "the incident palette selector",
    );
    return replaceRangeRequired(
      transformed,
      "/* ══ 事件详情视图",
      "/* ══ 计算血缘抽屉",
      "",
      "the incident detail and mechanism styles",
    );
  }
  return source;
}

function subtractDocumentationStyles(source, assetFile) {
  if (path.basename(assetFile) !== "config-relation-plane.css") return source;
  let transformed = replaceRequired(
    source,
    /,\r?\n\.cro-board\.is-plane \.cro-region--doc(?= \{)/,
    "",
    "the documentation region in the shared plane selector",
  );
  transformed = replaceRangeRequired(
    transformed,
    "/* 文档档：整板让位",
    "/* Cluster 区搬进左栏",
    "",
    "the documentation plane layout",
  );
  transformed = replaceRequired(
    transformed,
    /\/\* yaml \/ 文档两档整块顶掉中栏。[\s\S]*?\.cro-board\.is-plane\.is-yaml \.crop-center,\r?\n\.cro-board\.is-plane\.is-doc \.crop-center \{ display: none; \}\r?\n\r?\n\.cro-board\.is-plane\.is-doc \.crop-toolbar \{ display: none; \}/,
    ".cro-board.is-plane.is-yaml .crop-center { display: none; }",
    "the documentation center and toolbar layout",
  );
  return replaceRequired(
    transformed,
    /\s*\/\* 右上角文档入口的按下态：[\s\S]*?#croDocEntry\.is-selected \{[\s\S]*?\}\r?\n/,
    "\n",
    "the documentation entry selected style",
  );
}

function subtractSyntheticHeatStyles(source, assetFile) {
  if (path.basename(assetFile) !== "config-relation-plane.css") return source;
  let transformed = replaceRangeRequired(
    source,
    "/* ── 热力档的格子",
    "/* 行/列的整条高亮",
    "",
    "the synthetic heat cell and low-detail styles",
  );
  transformed = transformed
    .replaceAll(".crop-heat__legend.crop-memory-legend", ".crop-memory-legend")
    .replaceAll(".crop-memory-legend__scale > .crop-heat__legend-end", ".crop-memory-legend__scale > .crop-memory-legend__end")
    .replaceAll("--crop-heat", "--crop-memory-heat");
  transformed = replaceRangeRequired(
    transformed,
    "/* 热力那半：",
    "/* 通信档那半：",
    "",
    "the synthetic heat toolbar styles",
  );
  transformed = replaceRequired(
    transformed,
    /\s*\/\* 「按完整一套专家区分着色」[\s\S]*?\.crop-center\[data-mode="heat"\] \.crop-paint \{ display: none; \}\r?\n/,
    "\n",
    "the synthetic heat expert-paint visibility",
  );
  transformed = replaceRequired(
    transformed,
    /\.cro-board\.is-plane\[data-mode="comm"\] \.crop-left,\r?\n\.cro-board\.is-plane\[data-mode="heat"\] \.crop-left \{ display: none; \}/,
    '.cro-board.is-plane[data-mode="comm"] .crop-left { display: none; }',
    "the synthetic heat left-panel visibility",
  );
  transformed = replaceRangeRequired(
    transformed,
    '.cro-board.is-plane[data-mode="heat"] .crop-right__body',
    "/* ══ 通信观测档",
    "",
    "the synthetic heat detail styles",
  );
  transformed = replaceRangeRequired(
    transformed,
    "/* ══ 负载热力档",
    "/* ══ 巡检色点",
    "",
    "the synthetic heat controls, timeline, and banner styles",
  );
  return transformed;
}

function inlineBaselineAssets() {
  return {
    name: "inline-config-relation-plane-baseline",
    enforce: "pre",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (path.resolve(context.filename) !== path.resolve(baselinePage)) return html;

        const mcpShell = subtractCapabilityClosureHtml(convergeProductCopy(subtractDocumentationView(
          subtractLegacyTopbar(subtractIncidentUi(subtractActivityRail(html))),
        )));
        const withStyles = mcpShell.replace(
          /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g,
          (tag, reference) => {
            const cssFile = resolveLocalAsset(context.filename, reference);
            const source = subtractSyntheticHeatStyles(
              subtractDocumentationStyles(
                subtractIncidentStyles(fs.readFileSync(cssFile, "utf8"), cssFile),
                cssFile,
              ),
              cssFile,
            );
            return `<style>${expandLocalCssImports(cssFile, source)}</style>`;
          },
        );
        const withScripts = withStyles.replace(
          /<script\s+src="([^"]+)"\s*><\/script>/g,
          (tag, reference) => {
            const assetFile = resolveLocalAsset(context.filename, reference);
            let source = fs.readFileSync(assetFile, "utf8");
            source = subtractActivityRailObserverHooks(source, assetFile);
            source = subtractIncidentCrossFileHooks(source, assetFile);
            source = subtractDocumentationCrossFileHooks(source, assetFile);
            source = subtractIncidentObserverCode(source, assetFile);
            source = subtractSyntheticHeatView(source, assetFile);
            source = convergeProductScriptCopy(source, assetFile);
            source = connectMcpTopology(source, assetFile);
            source = subtractCapabilityClosureScript(source, assetFile);
            source = connectMcpFixes(source, assetFile);
            source = connectMcpCapacity(source, assetFile);
            return `<script>${escapeClosingScript(source)}</script>`;
          },
        );

        return {
          html: withScripts,
          tags: [{
            tag: "script",
            attrs: { type: "module" },
            children: escapeClosingScript(bridgeSource()),
            injectTo: "body",
          }],
        };
      },
    },
  };
}

export default defineConfig({
  root: baselineRoot,
  cacheDir: fileURLToPath(new URL("../../node_modules/.vite/mcp-server-ui", import.meta.url)),
  resolve: {
    alias: { "@mcp-bridge": bridgeDirectory },
  },
  plugins: [inlineBaselineAssets(), viteSingleFile()],
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: baselinePage,
      output: {
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
