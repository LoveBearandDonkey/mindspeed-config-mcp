import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables
} from "@modelcontextprotocol/ext-apps";

import "./styles.css";
import "./plane/plane.css";
import { PREVIEW_RESULTS, PREVIEW_VIEWS } from "./preview-results.js";
import { createWorkbench } from "./workbench.js";
import { createPlaneView } from "./plane/plane-view.js";

const title = document.getElementById("title");
const summary = document.getElementById("summary");
const status = document.getElementById("status");
const metrics = document.getElementById("metrics");
const primary = document.getElementById("primary");
const traceBody = document.getElementById("traceBody");
let workbench;
const selectionDetail = document.getElementById("selectionDetail");
const planeView = createPlaneView({
  host: document.getElementById("planePanel"),
  onSelect: renderPlaneSelection,
});

const TITLES = {
  validate_parallel_config: "并行配置校验",
  compute_rank_topology: "Rank 拓扑矩阵",
  suggest_config_fixes: "最小修改建议",
  parse_training_config: "训练配置解析",
  estimate_training_capacity: "理论训练容量"
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metric(value, label) {
  const node = element("div", "metric");
  node.append(element("b", "", String(value)), element("span", "", label));
  return node;
}

function setMetrics(items) {
  metrics.replaceChildren(...items.map(([value, label]) => metric(value, label)));
}

function resultSummary(result) {
  switch (result.tool) {
    case "validate_parallel_config":
      return result.data.valid
        ? `配置合法，符合已建模的数学约束；world size = ${result.data.world_size}。这不代表目标环境已经实机运行通过。`
        : `配置未通过静态校验，共发现 ${result.errors.length} 个问题。`;
    case "compute_rank_topology":
      return result.data.valid
        ? `按 ${result.data.semantics} 口径生成 ${result.data.ranks.length} 个 Rank。`
        : "配置不合法，因此没有生成 Rank 矩阵。";
    case "suggest_config_fixes":
      return result.data.already_valid
        ? "当前配置已经合法，不需要修改。"
        : result.data.solved ? `找到 ${result.data.suggestions.length} 个经过复验的方案。` : "当前搜索范围内没有找到合法方案。";
    case "parse_training_config":
      return `原文映射 ${result.data.explicit_mapped_count} 个，同文件推导 ${result.data.derived_count} 个，省略态默认 ${result.data.defaulted_count} 个；未识别 ${result.data.unmapped_count} 个。`;
    case "estimate_training_capacity": {
      if (!result.data.valid) return "配置不合法，因此没有生成容量数字。";
      const stage = result.data.stages[result.data.bottleneck_stage];
      return `理论瓶颈是 Stage ${stage.stage}：${stage.total_gib.toFixed(1)} GiB（${stage.level}）。这不是实测峰值。`;
    }
    default:
      return "已返回结构化结果。";
  }
}

function renderDiagnostics(result) {
  const list = element("div", "diagnostics");
  const items = [
    ...result.errors.map((item) => ({ ...item, kind: "error" })),
    ...result.warnings.map((item) => ({ ...item, kind: "warning" }))
  ];
  if (!items.length) {
    list.append(element("div", "diagnostic", "✓ 没有发现已建模约束问题。"));
    return list;
  }
  for (const item of items) {
    const row = element("article", "diagnostic");
    row.dataset.kind = item.kind;
    row.append(element("strong", "code", item.code), element("p", "", item.message));
    if (item.formula) row.append(element("p", "code", item.formula));
    list.append(row);
  }
  return list;
}

function renderValidation(result) {
  setMetrics([
    [result.data.valid ? "合法" : "不合法", "数学约束"],
    [result.data.world_size ?? "—", "world size"],
    [result.errors.length, "错误"],
    [result.warnings.length, "警告"]
  ]);
  primary.replaceChildren(panelTitle("校验明细", `${result.errors.length + result.warnings.length} 项`), renderDiagnostics(result));
}

function panelTitle(text, note) {
  const row = element("div", "panel-title");
  row.append(element("h2", "", text), element("small", "", note));
  return row;
}

function renderTopology(result) {
  if (!result.data.valid) {
    planeView.clear();
    return renderValidation(result);
  }
  const rows = result.data.ranks;
  planeView.setTopology(result.data);
  planeView.showTopology();
  setMetrics([
    [rows.length, "Rank"],
    [result.data.stages.length, "PP Stage"],
    [result.data.counts.nodes, "节点"],
    [result.data.semantics, "语义"]
  ]);
  const list = element("div", "stage-summary-list");
  for (const stage of result.data.stages) {
    const row = element("article", "stage-summary");
    row.append(
      element("strong", "", `Stage ${stage.stage}`),
      element("span", "code", `Layer ${stage.layer_start}–${stage.layer_end}`),
      element("span", "code", `${stage.ranks.length} Rank`),
    );
    list.append(row);
  }
  primary.replaceChildren(panelTitle("拓扑摘要", "点击中间画布查看 Rank 坐标"), list);
}

function renderFixes(result) {
  const suggestions = result.data.suggestions ?? [];
  setMetrics([
    [result.data.already_valid ? "无需修改" : result.data.solved ? "有解" : "无解", "结论"],
    [suggestions.length, "候选方案"],
    [(result.data.locked_fields ?? []).length, "锁定字段"],
    [result.errors.length, "原配置错误"]
  ]);
  const list = element("div", "suggestions");
  if (result.data.already_valid) list.append(element("div", "suggestion", "✓ 当前配置已经通过全部已建模规则。"));
  for (const suggestion of suggestions) {
    const card = element("article", "suggestion");
    card.append(element("strong", "", `方案 ${suggestion.rank}`));
    for (const change of suggestion.changes) {
      card.append(element("p", "code", `${change.path}: ${change.old_value} → ${change.new_value}`));
    }
    list.append(card);
  }
  if (!suggestions.length && !result.data.already_valid) list.append(renderDiagnostics(result));
  primary.replaceChildren(panelTitle("修复方案", "每项均已重新执行静态校验"), list);
}

function renderParse(result) {
  const data = result.data;
  setMetrics([
    [data.mapped_count, "已映射"],
    [data.unmapped_count, "未识别"],
    [data.ignored_count, "已忽略"],
    [data.complete ? "完整" : `缺 ${data.missing_required_fields.length}`, "统一配置"]
  ]);
  const tabs = element("div", "mapping-tabs");
  const list = element("div", "mapping-list");
  const groups = [
    ["mapped_fields", "已映射"],
    ["unmapped_fields", "未识别"],
    ["ignored_fields", "已忽略"],
    ["missing_required_fields", "缺少输入"]
  ];
  function select(key) {
    for (const button of tabs.children) button.setAttribute("aria-selected", String(button.dataset.key === key));
    list.replaceChildren();
    const values = data[key] ?? [];
    for (const value of values) {
      const row = element("div", "mapping-row");
      if (typeof value === "string") row.append(element("span", "code", value), element("span", "", "需要补充"));
      else row.append(
        element("span", "code", value.source_key),
        element("span", "", value.target_path ? `${value.target_path} = ${JSON.stringify(value.value)}` : `${value.reason}（${JSON.stringify(value.value)}）`)
      );
      list.append(row);
    }
    if (!values.length) list.append(element("div", "mapping-row", "没有项目"));
  }
  for (const [key, label] of groups) {
    const button = element("button", "", `${label} ${data[key]?.length ?? 0}`);
    button.type = "button";
    button.dataset.key = key;
    button.addEventListener("click", () => select(key));
    tabs.append(button);
  }
  select("mapped_fields");
  primary.replaceChildren(panelTitle("字段映射", `${data.detected_format} · ${data.source_name ?? "粘贴内容"}`), tabs, list);
}

function renderCapacity(result) {
  if (!result.data.valid) return renderValidation(result);
  const stages = result.data.stages;
  planeView.setCapacity(result.data);
  const peak = Math.max(...stages.map((stage) => stage.capacity_gib));
  setMetrics([
    [`Stage ${result.data.bottleneck_stage}`, "理论瓶颈"],
    [result.data.bottleneck_level, "风险等级"],
    [Math.max(...stages.map((stage) => stage.total_gib)).toFixed(1) + " GiB", "峰值估算"],
    [result.confidence, "置信等级"]
  ]);
  const list = element("div", "capacity-list");
  for (const stage of stages) {
    const row = element("div", "capacity-row");
    row.dataset.level = stage.level;
    const bar = element("div", "bar");
    const fill = element("i");
    fill.style.width = `${Math.min(100, stage.total_gib / peak * 100)}%`;
    bar.append(fill);
    row.append(element("strong", "", `Stage ${stage.stage}`), bar, element("span", "code", `${stage.total_gib.toFixed(1)} / ${stage.capacity_gib} GiB`));
    list.append(row);
  }
  primary.replaceChildren(panelTitle("各 Stage 单卡容量", "理论估算，不是实测峰值"), list);
}

function renderTrace(result) {
  const assumptions = element("ul");
  for (const item of result.assumptions ?? []) assumptions.append(element("li", "", item));
  const pre = element("pre", "code", JSON.stringify(result, null, 2));
  traceBody.replaceChildren(assumptions, pre);
}

function render(result) {
  if (!result?.tool) return;
  if (result.tool === "open_config_workbench") {
    const targetTool = result.data?.target_tool ?? null;
    metrics.replaceChildren();
    primary.replaceChildren(
      panelTitle("分析结果", "完成上方输入后显示"),
      element("div", "empty-state", targetTool ? `填写输入后运行“${TITLES[targetTool]}”。` : "请选择、粘贴或直接填写配置开始分析。")
    );
    traceBody.replaceChildren();
    workbench.open(targetTool);
    return;
  }
  if (!workbench.active) workbench.open(result.tool);
  title.textContent = TITLES[result.tool] ?? result.tool;
  summary.textContent = resultSummary(result);
  status.textContent = result.status;
  status.dataset.status = result.status;
  const renderers = {
    validate_parallel_config: renderValidation,
    compute_rank_topology: renderTopology,
    suggest_config_fixes: renderFixes,
    parse_training_config: renderParse,
    estimate_training_capacity: renderCapacity
  };
  (renderers[result.tool] ?? renderValidation)(result);
  renderTrace(result);
}

function renderPlaneSelection({ rank, column, expertSlice, memory }) {
  const rows = [
    ["Rank", rank.rank], ["节点", rank.node], ["Stage", rank.stage],
    ["DP / EDP", `${rank.dp_index} / ${rank.edp_index}`],
    ["TP / CP / EP", `${rank.tp_index} / ${rank.cp_index} / ${rank.ep_index}`],
    [column.layer === undefined ? "列" : "Layer", column.layer ?? `Stage ${column.stage}`],
    ["FFN", column.ffn === "moe" ? "MoE" : column.ffn === "dense" ? "Dense" : "Stage 汇总"],
  ];
  if (expertSlice) rows.push(["专家切片", `${expertSlice.expert_start}–${expertSlice.expert_end}`]);
  if (memory) rows.push(["理论显存", `${memory.total_gib.toFixed(2)} / ${memory.capacity_gib} GiB（${memory.level}）`]);
  selectionDetail.replaceChildren(...rows.map(([label, value]) => {
    const row = element("div", "selection-row");
    row.append(element("span", "", label), element("strong", "code", String(value)));
    return row;
  }));
}

function applyHostContext(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

const previewKey = new URLSearchParams(window.location.search).get("preview");
const standalonePreview = previewKey !== null;

if (standalonePreview) {
  const previewApp = {
    async callServerTool(request) {
      if (request.name === "parse_training_config") {
        return { isError: false, structuredContent: PREVIEW_RESULTS.parse_training_config };
      }
      throw new Error("独立预览未连接 MCP Host；请在 Inspector 或支持 MCP Apps 的客户端中运行分析。");
    },
  };
  workbench = createWorkbench({ app: previewApp, renderResult: render });
  const previewNav = document.getElementById("previewNav");
  previewNav.hidden = false;

  function selectPreview(toolName) {
    const selected = PREVIEW_VIEWS.some(([name]) => name === toolName) ? toolName : "open_config_workbench";
    for (const button of previewNav.querySelectorAll("button")) {
      button.setAttribute("aria-selected", String(button.dataset.previewTool === selected));
    }
    const url = new URL(window.location.href);
    url.searchParams.set("preview", selected);
    window.history.replaceState({}, "", url);
    if (selected === "open_config_workbench") {
      render({ tool: selected, data: { target_tool: null } });
      workbench.showPreview();
      title.textContent = "MindSpeed 中文配置工作台";
      summary.textContent = "独立预览已展开完整三步工作台；演示值不参与正式 MCP 计算。";
      status.textContent = "本地预览";
      status.dataset.status = "valid";
      return;
    }
    render({ tool: "open_config_workbench", data: { target_tool: selected } });
    workbench.showPreview();
    render(PREVIEW_RESULTS[selected]);
  }

  for (const [toolName, label] of PREVIEW_VIEWS) {
    const button = element("button", "preview-tab", label);
    button.type = "button";
    button.dataset.previewTool = toolName;
    button.addEventListener("click", () => selectPreview(toolName));
    previewNav.append(button);
  }
  selectPreview(previewKey === "1" ? "open_config_workbench" : previewKey);
} else {
  const app = new App({ name: "MindSpeed Config Result View", version: "0.1.0" });
  workbench = createWorkbench({ app, renderResult: render });
  app.ontoolresult = (result) => render(result.structuredContent);
  app.onhostcontextchanged = applyHostContext;
  app.onerror = (error) => {
    status.textContent = "界面错误";
    status.dataset.status = "error";
    summary.textContent = error instanceof Error ? error.message : String(error);
  };

  app.connect().then(() => applyHostContext(app.getHostContext())).catch(app.onerror);
}
