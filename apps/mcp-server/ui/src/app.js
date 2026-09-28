import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables
} from "@modelcontextprotocol/ext-apps";

import "./styles.css";

const title = document.getElementById("title");
const summary = document.getElementById("summary");
const status = document.getElementById("status");
const metrics = document.getElementById("metrics");
const primary = document.getElementById("primary");
const traceBody = document.getElementById("traceBody");

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
        ? `从已建模的数学约束看，这个配置合法；world size = ${result.data.world_size}。这不代表目标环境已经实机运行通过。`
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
      return `识别 ${result.data.mapped_count} 个字段，未识别 ${result.data.unmapped_count} 个；未识别字段没有被静默忽略。`;
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
  if (!result.data.valid) return renderValidation(result);
  const rows = result.data.ranks;
  setMetrics([
    [rows.length, "Rank"],
    [result.data.stages.length, "PP Stage"],
    [result.data.counts.nodes, "节点"],
    [result.data.semantics, "语义"]
  ]);
  const wrap = element("div", "table-wrap");
  const table = element("table");
  const head = element("thead");
  const headRow = element("tr");
  for (const cell of ["Rank", "节点", "Stage", "DP", "EDP", "TP", "CP", "EP"]) headRow.append(element("th", "", cell));
  head.append(headRow);
  const body = element("tbody");
  for (const rank of rows) {
    const row = element("tr");
    for (const value of [rank.rank, rank.node, rank.stage, rank.dp_index, rank.edp_index, rank.tp_index, rank.cp_index, rank.ep_index]) {
      row.append(element("td", "code", value));
    }
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  primary.replaceChildren(panelTitle("Rank 坐标", "可滚动查看全部 Rank"), wrap);
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

function applyHostContext(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

const app = new App({ name: "MindSpeed Config Result View", version: "0.1.0" });
app.ontoolresult = (result) => render(result.structuredContent);
app.onhostcontextchanged = applyHostContext;
app.onerror = (error) => {
  status.textContent = "界面错误";
  status.dataset.status = "error";
  summary.textContent = error instanceof Error ? error.message : String(error);
};

app.connect().then(() => applyHostContext(app.getHostContext())).catch(app.onerror);
