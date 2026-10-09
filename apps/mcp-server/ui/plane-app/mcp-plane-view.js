import { SAMPLE_CATALOG } from "./sample-catalog.js";

const TOOL_LABELS = {
  validate_parallel_config: "校验配置",
  compute_rank_topology: "生成 Rank 拓扑",
  suggest_config_fixes: "生成修复建议",
  estimate_training_capacity: "估算理论容量",
};

const FIELD_GROUPS = {
  parallel: [
    numberField("model.total_layers", "Total Layer"),
    numberField("parallel.dp", "DP"),
    numberField("parallel.pp", "PP"),
    numberField("parallel.tp", "TP"),
    numberField("parallel.cp", "CP"),
    numberField("parallel.vpp", "VPP"),
  ],
  moe: [
    numberField("model.routed_experts", "Routed Expert"),
    numberField("model.top_k", "Top-K"),
    numberField("model.shared_experts", "Shared Expert"),
    numberField("parallel.ep", "EP"),
  ],
  cluster: [
    numberField("cluster.total_ranks", "Total Rank"),
    numberField("cluster.ranks_per_node", "Rank / Node"),
    numberField("cluster.card_memory_gib", "单卡 GiB", 1),
  ],
  batch: [
    numberField("batch.micro_batch_size", "Micro Batch"),
    numberField("batch.sequence_length", "Seq Length"),
    numberField("batch.micro_batch_count", "微批数"),
    numberField("model.hidden_size", "Hidden"),
  ],
};

const MEMORY_COLORS = {
  weight: "#3B82F6",
  gradient: "#10B981",
  optimizer: "#8B5CF6",
  activation: "#F59E0B",
  reserve: "#64748B",
};

function numberField(path, label, step = 1) {
  return { path, label, step };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function setPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createMcpPlaneView({ onConfigChange, onRunTool, onParseSource }) {
  const board = document.getElementById("croBoard");
  const state = {
    config: null,
    topology: null,
    capacity: null,
    parseResult: null,
    rawSource: "",
    rawName: "",
    rawFormat: "auto",
    scale: 1,
    x: 86,
    y: 74,
    selected: null,
    memory: false,
    notifyTimer: 0,
  };

  const dom = mountShell();
  wireTopbar();
  wireImportPanel();
  wireCanvas();
  renderSampleOptions();

  return {
    getConfig: () => clone(state.config),
    setConfig(config, meta = {}) {
      state.config = clone(config);
      if (meta.raw !== undefined) state.rawSource = meta.raw;
      if (meta.name !== undefined) state.rawName = meta.name;
      if (meta.format !== undefined) state.rawFormat = meta.format;
      renderForm();
      renderSourceCode();
    },
    setBusy(busy, message = "") {
      board.dataset.busy = String(busy);
      dom.status.textContent = message || (busy ? "MCP 计算中…" : "就绪");
      dom.runButton.disabled = busy;
      document.getElementById("croImportParse").disabled = busy;
    },
    showResult,
    showError(message) {
      renderConfigMessage(message, "error");
      dom.status.textContent = "调用失败";
      dom.status.dataset.kind = "error";
    },
    async loadSample(id = SAMPLE_CATALOG[0].id) {
      const sample = SAMPLE_CATALOG.find((item) => item.id === id) ?? SAMPLE_CATALOG[0];
      document.getElementById("croConfigPresetSelect").value = sample.id;
      await parseAndMaybeApply(sample, true);
    },
  };

  function mountShell() {
    const netRegion = document.getElementById("croNetRegion");
    const yamlRegion = document.getElementById("croYamlRegion");
    const archRegion = board.querySelector(".cro-region--arch");
    const moeRegion = board.querySelector(".cro-region--moe");
    const clusterRegion = board.querySelector(".cro-region--cluster");
    const capacity = document.getElementById("croCapacity");
    const structureSection = board.querySelector(".cro-section--structure");
    const modelStepper = document.getElementById("croModelSelect")?.closest(".cro-stepper");
    const presetStepper = document.getElementById("croConfigPresetSelect")?.closest(".cro-stepper");

    const left = el("aside", "crop-left");
    left.id = "cropLeft";
    left.dataset.pane = "form";
    const leftHead = el("div", "crop-left__head");
    const leftTabs = el("div", "crop-left__tabs");
    leftTabs.setAttribute("role", "tablist");
    for (const [pane, label] of [["form", "训练配置"], ["net", "整网查询"]]) {
      const button = el("button", `crop-left__tab${pane === "form" ? " is-selected" : ""}`, label);
      button.type = "button";
      button.dataset.pane = pane;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => selectLeftPane(pane));
      leftTabs.append(button);
    }
    const leftClose = iconButton("收起配置栏", "M18 6 6 18M6 6l12 12");
    leftClose.addEventListener("click", () => toggleLeft(true));
    leftHead.append(leftTabs, leftClose);

    const leftIntro = el("div", "crop-left__intro");
    if (presetStepper) leftIntro.append(presetStepper);
    const sampleAction = el("button", "btn btn-sm crop-sample-parse", "解析并应用");
    sampleAction.type = "button";
    sampleAction.addEventListener("click", () => parseSelectedSample(true));
    const viewTabs = el("div", "segmented-control segmented-control-muted crop-tabs");
    for (const [pane, label] of [["form", "表单视图"], ["code", "代码视图"]]) {
      const button = el("button", `btn btn-sm${pane === "form" ? " is-selected" : ""}`, label);
      button.type = "button";
      button.dataset.pane = pane;
      button.addEventListener("click", () => selectLeftPane(pane));
      viewTabs.append(button);
    }
    leftIntro.append(sampleAction, viewTabs);

    const leftBody = el("div", "crop-left__body");
    const paneForm = el("div", "crop-pane crop-pane--form");
    const paneCode = el("div", "crop-pane crop-pane--code");
    const paneNet = el("div", "crop-pane crop-pane--net");
    for (const region of [archRegion, clusterRegion, moeRegion]) {
      if (region) paneForm.append(region);
    }
    if (yamlRegion) paneCode.append(yamlRegion);
    if (netRegion) paneNet.append(netRegion);
    const configError = document.getElementById("croConfigError");
    if (configError) paneForm.prepend(configError);
    leftBody.append(paneForm, paneCode, paneNet);
    left.append(leftHead, leftIntro, leftBody);

    const stage = el("div", "crop-stage");
    stage.id = "cropStage";
    stage.setAttribute("aria-label", "Stage × Layer × Rank 平面");
    const world = el("div", "crop-world");
    world.id = "cropWorld";
    const rulerTop = el("div", "crop-ruler crop-ruler--top");
    const rulerLeft = el("div", "crop-ruler crop-ruler--left");
    const rulerCorner = el("div", "crop-ruler__corner", "PP / Rank");
    const empty = el("div", "crop-empty", "选择内置配置，或导入配置后生成 Rank 拓扑");
    const tools = el("div", "crop-tools");
    const memoryButton = el("button", "btn btn-sm crop-memory-toggle", "内存观测");
    memoryButton.type = "button";
    memoryButton.addEventListener("click", () => {
      state.memory = !state.memory;
      memoryButton.classList.toggle("is-selected", state.memory);
      memoryButton.setAttribute("aria-pressed", String(state.memory));
      renderPlane();
    });
    const zoomOut = iconButton("缩小", "M5 12h14");
    const zoomIn = iconButton("放大", "M12 5v14M5 12h14");
    const readout = el("span", "crop-tools__readout", "100%");
    const fitButton = el("button", "btn btn-sm btn-ghost", "适配");
    zoomOut.addEventListener("click", () => zoomAt(0.8));
    zoomIn.addEventListener("click", () => zoomAt(1.25));
    fitButton.addEventListener("click", fit);
    tools.append(memoryButton, zoomOut, readout, zoomIn, fitButton);
    stage.append(world, rulerTop, rulerLeft, rulerCorner, empty, tools);

    const center = el("div", "crop-center");
    center.id = "cropCenter";
    center.dataset.mode = "config";
    center.append(stage);

    const right = el("aside", "crop-right");
    right.id = "cropRight";
    const rightHead = el("div", "crop-right__head");
    const rightTitle = el("h2", "crop-right__title", "分析与选中详情");
    const rightClose = iconButton("收起详情栏", "M18 6 6 18M6 6l12 12");
    rightClose.addEventListener("click", () => toggleRight(true));
    rightHead.append(rightTitle, rightClose);
    const rightBody = el("div", "crop-right__body");
    const facts = el("div", "crop-facts crop-mcp-facts");
    rightBody.append(facts);
    if (capacity) rightBody.append(capacity);
    if (structureSection) rightBody.append(structureSection);
    right.append(rightHead, rightBody);

    const toolbar = el("div", "crop-toolbar");
    toolbar.id = "cropToolbar";
    const modelTitle = el("div", "crop-model");
    const menuButton = iconButton("打开配置栏", "M4 7h16M4 12h16M4 17h16");
    menuButton.classList.add("crop-model__menu");
    menuButton.addEventListener("click", () => toggleLeft(false));
    modelTitle.append(menuButton);
    if (modelStepper) modelTitle.append(modelStepper);
    const modes = el("div", "tab-control crop-modes");
    for (const [mode, label] of [["config", "配置寻优"], ["memory", "内存观测"]]) {
      const button = el("button", `tab-control-item${mode === "config" ? " is-selected" : ""}`, label);
      button.type = "button";
      button.dataset.mode = mode;
      button.addEventListener("click", () => {
        state.memory = mode === "memory";
        memoryButton.classList.toggle("is-selected", state.memory);
        for (const item of modes.children) item.classList.toggle("is-selected", item === button);
        renderPlane();
      });
      modes.append(button);
    }
    const toolSelect = el("select", "cro-select crop-tool-select");
    for (const [name, label] of Object.entries(TOOL_LABELS)) toolSelect.append(new Option(label, name));
    toolSelect.value = "compute_rank_topology";
    const runButton = el("button", "btn btn-sm crop-run-tool", "运行 MCP 工具");
    runButton.type = "button";
    runButton.addEventListener("click", () => onRunTool(toolSelect.value));
    const status = el("span", "crop-mcp-status", "等待配置");
    toolbar.append(modelTitle, modes, el("span", "crop-toolbar__divider"), toolSelect, runButton, status);

    board.prepend(toolbar, left, center, right);
    board.classList.add("is-plane");
    board.dataset.mode = "config";
    return { board, left, center, stage, world, rulerTop, rulerLeft, empty, readout, right, rightTitle, facts, toolbar, toolSelect, runButton, status };
  }

  function iconButton(label, path) {
    const button = el("button", "btn btn-icon btn-ghost btn-sm");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="${path}"></path></svg>`;
    return button;
  }

  function renderSampleOptions() {
    const select = document.getElementById("croConfigPresetSelect");
    select.replaceChildren();
    for (const groupName of [...new Set(SAMPLE_CATALOG.map(({ group }) => group))]) {
      const group = el("optgroup");
      group.label = groupName;
      for (const sample of SAMPLE_CATALOG.filter(({ group }) => group === groupName)) {
        group.append(new Option(sample.name, sample.id));
      }
      select.append(group);
    }
    select.addEventListener("change", () => parseSelectedSample(false));
    select.value = SAMPLE_CATALOG[0].id;
  }

  async function parseSelectedSample(apply) {
    const id = document.getElementById("croConfigPresetSelect").value;
    const sample = SAMPLE_CATALOG.find((item) => item.id === id) ?? SAMPLE_CATALOG[0];
    await parseAndMaybeApply(sample, apply);
  }

  async function parseAndMaybeApply(source, apply) {
    try {
      const result = await onParseSource(source);
      state.parseResult = result.data;
      state.rawSource = source.content;
      state.rawName = source.name;
      state.rawFormat = source.format;
      renderParseReport(result.data, document.getElementById("croImportReport"));
      renderSourceCode();
      if (apply) applyParsedConfig(result.data, source);
      else renderConfigMessage(`已解析 ${source.name}：映射 ${result.data.mapped_count} 项；点击“解析并应用”写入表单。`, "ok");
      showResult(result);
      return result;
    } catch (error) {
      renderConfigMessage(error instanceof Error ? error.message : String(error), "error");
      throw error;
    }
  }

  function applyParsedConfig(data, source = {}) {
    state.config = clone(data.normalized_config);
    state.rawSource = source.content ?? state.rawSource;
    state.rawName = source.name ?? state.rawName;
    state.rawFormat = source.format ?? state.rawFormat;
    renderForm();
    renderSourceCode();
    document.getElementById("croImportApply").disabled = false;
    const suffix = data.complete ? "配置完整，可运行全部工具。" : `仍缺 ${data.missing_required_fields.length} 项，可在表单补齐。`;
    renderConfigMessage(`已应用 ${state.rawName || "配置"}；${suffix}`, data.complete ? "ok" : "warning");
    scheduleConfigChange(true);
  }

  function renderForm() {
    if (!state.config) return;
    mountFields("croParallelSteppers", FIELD_GROUPS.parallel);
    mountFields("croMoeSteppers", FIELD_GROUPS.moe);
    mountFields("croClusterSteppers", FIELD_GROUPS.cluster);
    mountFields("croBatchSteppers", FIELD_GROUPS.batch);
    renderSelectField(document.getElementById("croCardSelect"), "cluster.card_model", ["昇腾 910B", "昇腾 910B 64GB", "昇腾 910B 32GB"]);
    const modelSelect = document.getElementById("croModelSelect");
    const modelId = getPath(state.config, "model.id") ?? "未命名模型";
    modelSelect.replaceChildren(new Option(modelId, modelId));
    modelSelect.value = modelId;
    for (const button of document.querySelectorAll("#croEpMode [data-ep-mode]")) {
      const selected = button.dataset.epMode === getPath(state.config, "parallel.ep_mode");
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    renderExpertSummary();
  }

  function mountFields(id, fields) {
    const host = document.getElementById(id);
    host.replaceChildren(...fields.map(renderNumberField));
  }

  function renderNumberField(definition) {
    const wrapper = el("label", "cro-stepper crop-field");
    wrapper.dataset.path = definition.path;
    wrapper.append(el("span", "cro-stepper__label", definition.label));
    const control = el("span", "cro-stepper__control");
    const minus = el("button", "btn btn-icon btn-ghost btn-sm", "−");
    const input = el("input", "cro-stepper__input");
    const plus = el("button", "btn btn-icon btn-ghost btn-sm", "+");
    input.type = "number";
    input.min = "0";
    input.step = String(definition.step);
    input.value = getPath(state.config, definition.path) ?? "";
    input.setAttribute("aria-label", definition.label);
    const commit = (value) => {
      if (!Number.isFinite(value)) return;
      setPath(state.config, definition.path, value);
      input.value = String(value);
      scheduleConfigChange();
    };
    minus.type = plus.type = "button";
    minus.addEventListener("click", () => commit(Math.max(0, Number(input.value || 0) - definition.step)));
    plus.addEventListener("click", () => commit(Number(input.value || 0) + definition.step));
    input.addEventListener("change", () => commit(Number(input.value)));
    control.append(minus, input, plus);
    wrapper.append(control);
    return wrapper;
  }

  function renderSelectField(select, path, options) {
    const value = getPath(state.config, path) ?? options[0];
    select.replaceChildren(...[...new Set([value, ...options])].map((item) => new Option(item, item)));
    select.value = value;
    select.onchange = () => {
      setPath(state.config, path, select.value);
      scheduleConfigChange();
    };
  }

  function scheduleConfigChange(immediate = false) {
    clearTimeout(state.notifyTimer);
    state.notifyTimer = window.setTimeout(() => onConfigChange(clone(state.config)), immediate ? 0 : 320);
  }

  function renderExpertSummary() {
    const routed = getPath(state.config, "model.routed_experts") ?? 0;
    const shared = getPath(state.config, "model.shared_experts") ?? 0;
    const ep = getPath(state.config, "parallel.ep") ?? 1;
    document.getElementById("croSharedExperts").replaceChildren(el("span", "crop-summary-chip", shared ? `SE × ${shared}` : "无共享专家"));
    document.getElementById("croRoutedExperts").replaceChildren(el("span", "crop-summary-chip", routed ? `${routed} 个路由专家 · EP ${ep}` : "Dense 模型"));
  }

  function wireTopbar() {
    document.getElementById("croImportConfig").addEventListener("click", openImport);
    document.getElementById("croExportConfig").addEventListener("click", exportConfig);
    document.getElementById("croDocEntry").addEventListener("click", () => {
      const active = board.classList.toggle("is-doc");
      document.getElementById("croDocEntry").setAttribute("aria-pressed", String(active));
    });
    for (const button of document.querySelectorAll("#croEpMode [data-ep-mode]")) {
      button.addEventListener("click", () => {
        if (!state.config) return;
        setPath(state.config, "parallel.ep_mode", button.dataset.epMode);
        renderForm();
        scheduleConfigChange();
      });
    }
  }

  function selectLeftPane(pane) {
    dom.left.dataset.pane = pane;
    board.classList.toggle("is-yaml", pane === "code");
    board.classList.remove("is-doc");
    for (const button of dom.left.querySelectorAll("[data-pane]")) {
      const selected = button.dataset.pane === pane || (pane === "code" && button.dataset.pane === "form" && button.classList.contains("crop-left__tab"));
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
    }
  }

  function toggleLeft(closed) {
    dom.left.classList.toggle("is-collapsed", closed);
    board.classList.toggle("is-left-collapsed", closed);
    requestAnimationFrame(fit);
  }

  function toggleRight(closed) {
    dom.right.classList.toggle("is-collapsed", closed);
    requestAnimationFrame(fit);
  }

  function wireImportPanel() {
    const panel = document.getElementById("croImportPanel");
    const file = document.getElementById("croImportFile");
    const text = document.getElementById("croImportText");
    const apply = document.getElementById("croImportApply");
    document.getElementById("croImportClose").addEventListener("click", () => { panel.hidden = true; });
    panel.addEventListener("click", (event) => { if (event.target === panel) panel.hidden = true; });
    file.addEventListener("change", async () => {
      const selected = file.files?.[0];
      if (!selected) return;
      if (selected.size > 1024 * 1024) return renderParseError("文件超过 1 MiB，未读取。");
      text.value = await selected.text();
      document.getElementById("croImportName").textContent = selected.name;
    });
    document.getElementById("croImportParse").addEventListener("click", async () => {
      const content = text.value.trim();
      if (!content) return renderParseError("请先选择文件或粘贴配置内容。");
      const name = document.getElementById("croImportName").textContent;
      const format = inferFormat(name);
      try {
        const result = await onParseSource({ name: name === "未选择文件" ? "pasted-config.txt" : name, format, content });
        state.parseResult = result.data;
        state.rawSource = content;
        state.rawName = name;
        state.rawFormat = format;
        renderParseReport(result.data, document.getElementById("croImportReport"));
        apply.disabled = false;
        showResult(result);
      } catch (error) {
        renderParseError(error instanceof Error ? error.message : String(error));
      }
    });
    apply.addEventListener("click", () => {
      if (!state.parseResult) return;
      applyParsedConfig(state.parseResult, { name: state.rawName, format: state.rawFormat, content: state.rawSource });
      panel.hidden = true;
    });
  }

  function openImport() {
    const panel = document.getElementById("croImportPanel");
    panel.hidden = false;
    document.getElementById("croImportText").focus();
  }

  function renderParseError(message) {
    const report = document.getElementById("croImportReport");
    report.replaceChildren(el("p", "cro-import__empty crop-error-text", message));
  }

  function inferFormat(name) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
    if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "shell";
    return "auto";
  }

  function renderParseReport(data, host) {
    host.replaceChildren();
    const summary = el("div", "crop-parse-summary");
    summary.append(
      fact("识别格式", data.detected_format),
      fact("映射", data.mapped_count),
      fact("未识别", data.unmapped_count),
      fact("完整性", data.complete ? "完整" : `缺 ${data.missing_required_fields.length} 项`),
    );
    const list = el("div", "crop-mapping-list");
    for (const item of data.mapped_fields.slice(0, 24)) list.append(mappingRow(item.source_key, `${item.target_path} = ${JSON.stringify(item.value)}`));
    for (const item of data.unmapped_fields.slice(0, 12)) list.append(mappingRow(item.source_key, item.reason || "未建立映射", "warning"));
    for (const path of data.missing_required_fields) list.append(mappingRow(path, "仍需补充", "error"));
    host.append(summary, list);
  }

  function mappingRow(key, value, kind = "") {
    const row = el("div", "crop-mapping-row");
    if (kind) row.dataset.kind = kind;
    row.append(el("code", "", key), el("span", "", value));
    return row;
  }

  function renderSourceCode() {
    const path = document.getElementById("croYamlPath");
    if (path) path.textContent = state.rawName || "尚未导入配置";
    const code = document.getElementById("croYamlCode");
    if (code) code.textContent = state.rawSource || "# 从左侧内置配置选择，或点击右上角“导入配置”\n# 解析由 parse_training_config MCP 工具完成。";
    const launch = document.querySelector(".cro-yaml__launch");
    if (launch) launch.hidden = true;
  }

  function exportConfig() {
    if (!state.config) return renderConfigMessage("当前没有可导出的统一配置。", "warning");
    const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${getPath(state.config, "model.id") || "training-config"}.normalized.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function showResult(result) {
    if (!result?.tool) return;
    dom.status.dataset.kind = result.status === "invalid" || result.status === "error" ? "error" : "ok";
    dom.status.textContent = result.tool === "parse_training_config"
      ? `已解析：${result.data?.mapped_count ?? 0} 项映射`
      : `${TOOL_LABELS[result.tool] ?? result.tool}完成`;
    if (result.tool === "compute_rank_topology") {
      state.topology = result.data?.valid ? result.data : null;
      renderPlane();
      renderTopologyFacts(result);
    } else if (result.tool === "estimate_training_capacity") {
      state.capacity = result.data?.valid ? result.data : null;
      renderCapacity(result);
      renderPlane();
    } else if (result.tool === "validate_parallel_config") {
      renderValidation(result);
    } else if (result.tool === "suggest_config_fixes") {
      renderFixes(result);
    } else if (result.tool === "parse_training_config" && result.data) {
      state.parseResult = result.data;
    }
  }

  function renderValidation(result) {
    const valid = result.data?.valid;
    const message = valid
      ? `配置通过已建模约束；world size = ${result.data.world_size}。`
      : result.errors.map((item) => item.message).join("；") || "配置未通过校验。";
    renderConfigMessage(message, valid ? "ok" : "error");
    dom.facts.replaceChildren(
      fact("结论", valid ? "合法" : "不合法"),
      fact("错误", result.errors.length),
      fact("警告", result.warnings.length),
    );
  }

  function renderTopologyFacts(result) {
    const data = result.data;
    if (!data?.valid) return renderValidation(result);
    dom.facts.replaceChildren(
      fact("Rank", data.ranks.length),
      fact("PP Stage", data.stages.length),
      fact("节点", data.counts.nodes),
      fact("口径", data.semantics),
    );
    renderStructure(data);
  }

  function renderFixes(result) {
    const suggestions = result.data?.suggestions ?? [];
    dom.facts.replaceChildren(fact("候选方案", suggestions.length));
    for (const suggestion of suggestions) {
      const card = el("article", "crop-fix-card");
      card.append(el("strong", "", `方案 ${suggestion.rank}`));
      for (const change of suggestion.changes) card.append(el("code", "", `${change.path}: ${change.old_value} → ${change.new_value}`));
      dom.facts.append(card);
    }
    if (!suggestions.length) dom.facts.append(el("p", "crop-muted", result.data?.already_valid ? "当前配置无需修改。" : "当前搜索范围内没有方案。"));
  }

  function renderConfigMessage(message, kind) {
    const host = document.getElementById("croConfigError");
    host.textContent = message;
    host.dataset.kind = kind;
    host.hidden = !message;
  }

  function fact(label, value) {
    const node = el("div", "crop-fact");
    node.append(el("span", "", label), el("strong", "", String(value ?? "—")));
    return node;
  }

  function renderStructure(data) {
    const host = document.getElementById("croStructure");
    host.replaceChildren();
    for (const stage of data.stages) {
      const item = el("button", "crop-structure-item");
      item.type = "button";
      item.append(el("strong", "", `PP ${stage.stage}`), el("span", "", `Layer ${stage.layer_start}–${stage.layer_end}`));
      item.addEventListener("click", () => selectStage(stage.stage));
      host.append(item);
    }
  }

  function renderCapacity(result) {
    const data = result.data;
    const empty = document.getElementById("croCapacityEmpty");
    const body = document.getElementById("croCapacityBody");
    if (!data?.valid) {
      empty.hidden = false;
      empty.textContent = "配置未通过校验，未生成容量估算。";
      body.hidden = true;
      return;
    }
    empty.hidden = true;
    body.hidden = false;
    const bottleneck = data.stages.find((stage) => stage.stage === data.bottleneck_stage) ?? data.stages[0];
    const percent = bottleneck.capacity_gib ? bottleneck.total_gib / bottleneck.capacity_gib * 100 : 0;
    document.getElementById("croCapacityScope").textContent = `Stage ${bottleneck.stage}`;
    document.getElementById("croCapacityPct").textContent = `${percent.toFixed(0)}%`;
    document.getElementById("croCapacityAbs").textContent = `${bottleneck.total_gib.toFixed(1)} / ${bottleneck.capacity_gib} GiB`;
    document.getElementById("croCapacityRatio").dataset.level = bottleneck.level;
    document.getElementById("croCapacityBadge").textContent = bottleneck.level;
    document.getElementById("croCapacityVerdictText").textContent = "理论估算，不是实测峰值";
    document.getElementById("croCapacityVerdict").dataset.level = bottleneck.level;
    const scene = document.getElementById("croCapacityScene");
    scene.replaceChildren(memoryStack(bottleneck));
    const legend = document.getElementById("croCapacityLegend");
    legend.replaceChildren(...Object.entries(bottleneck.values_gib).map(([key, value]) => {
      const item = el("li", "crop-capacity-legend-item");
      item.style.setProperty("--crop-memory-color", MEMORY_COLORS[key] ?? "#64748B");
      item.append(el("span", "", memoryLabel(key)), el("strong", "", `${value.toFixed(1)} GiB`));
      return item;
    }));
    const stages = document.getElementById("croCapacityStages");
    stages.replaceChildren(...data.stages.map((stage) => {
      const item = el("button", "crop-capacity-stage");
      item.type = "button";
      item.dataset.level = stage.level;
      item.innerHTML = `<span>PP ${stage.stage}</span><i style="width:${Math.min(100, stage.total_gib / stage.capacity_gib * 100)}%"></i><b>${stage.total_gib.toFixed(1)}</b>`;
      item.addEventListener("click", () => selectStage(stage.stage));
      return item;
    }));
  }

  function memoryStack(stage) {
    const stack = el("div", "crop-memory-stack crop-memory-stack--scene");
    for (const [key, value] of Object.entries(stage.values_gib)) {
      const part = el("span", `crop-memory-part crop-memory-part--${key}`);
      part.style.flexGrow = String(Math.max(0, value));
      part.style.background = MEMORY_COLORS[key] ?? "#64748B";
      part.title = `${memoryLabel(key)} ${value.toFixed(2)} GiB`;
      stack.append(part);
    }
    return stack;
  }

  function memoryLabel(key) {
    return ({ weight: "权重", gradient: "梯度", optimizer: "优化器", activation: "激活", reserve: "预留" })[key] ?? key;
  }

  function renderPlane() {
    const data = state.topology;
    dom.world.replaceChildren();
    dom.rulerTop.replaceChildren();
    dom.rulerLeft.replaceChildren();
    if (!data?.valid || !data.layers?.length || !data.ranks?.length) {
      dom.empty.hidden = false;
      return;
    }
    dom.empty.hidden = true;
    const cellW = 46;
    const cellH = state.memory ? 30 : 24;
    const gap = 2;
    const top = 8;
    const left = 8;
    const ranksByStage = new Map(data.stages.map((stage) => [stage.stage, stage.ranks]));
    const rankMap = new Map(data.ranks.map((rank) => [rank.rank, rank]));
    const capacityMap = new Map((state.capacity?.stages ?? []).map((stage) => [stage.stage, stage]));
    const rows = Math.max(...data.stages.map((stage) => stage.ranks.length));
    const width = left + data.layers.length * (cellW + gap);
    const height = top + rows * (cellH + gap);
    dom.world.style.width = `${width}px`;
    dom.world.style.height = `${height}px`;

    const fragment = document.createDocumentFragment();
    for (const stage of data.stages) {
      const stageLayers = data.layers.filter((layer) => layer.stage === stage.stage);
      if (!stageLayers.length) continue;
      const startIndex = data.layers.indexOf(stageLayers[0]);
      const block = el("div", "crop-node crop-block");
      position(block, left + startIndex * (cellW + gap) - 3, top - 3, stageLayers.length * (cellW + gap) + 4, stage.ranks.length * (cellH + gap) + 4);
      block.dataset.stage = String(stage.stage);
      fragment.append(block);
    }
    for (let column = 0; column < data.layers.length; column += 1) {
      const layer = data.layers[column];
      const topTick = el("button", "crop-node crop-tick crop-tick--col", `L${layer.layer}`);
      topTick.type = "button";
      topTick.dataset.ffn = layer.ffn;
      topTick.style.left = `${left + column * (cellW + gap)}px`;
      topTick.style.width = `${cellW}px`;
      topTick.addEventListener("click", () => selectLayer(layer.layer));
      dom.rulerTop.append(topTick);
      const stageRanks = ranksByStage.get(layer.stage) ?? [];
      stageRanks.forEach((rankId, row) => {
        const rank = rankMap.get(rankId);
        if (!rank) return;
        const cell = el("button", "crop-node crop-cell");
        cell.type = "button";
        cell.dataset.ffn = layer.ffn;
        cell.dataset.rank = String(rank.rank);
        cell.dataset.layer = String(layer.layer);
        cell.dataset.stage = String(layer.stage);
        cell.style.setProperty("--crop-set", `var(--crop-set-${rank.ep_index % 4})`);
        position(cell, left + column * (cellW + gap), top + row * (cellH + gap), cellW, cellH);
        if (state.memory && capacityMap.has(layer.stage)) {
          cell.classList.add("is-memory");
          cell.append(memoryStack(capacityMap.get(layer.stage)));
        } else if (layer.ffn === "moe") {
          const slice = data.expert_slices?.find((item) => item.ep_index === rank.ep_index);
          cell.textContent = slice ? `E${slice.expert_start}–${slice.expert_end}` : `EP${rank.ep_index}`;
          cell.dataset.paint = "bg";
        } else {
          cell.textContent = "Dense";
        }
        cell.title = `Rank ${rank.rank} · Layer ${layer.layer} · PP ${rank.stage} · DP ${rank.dp_index} · TP ${rank.tp_index} · CP ${rank.cp_index} · EP ${rank.ep_index}`;
        cell.addEventListener("click", () => selectCell(cell, rank, layer));
        fragment.append(cell);
      });
    }
    const firstStageRanks = data.stages[0]?.ranks ?? [];
    firstStageRanks.forEach((rankId, row) => {
      const label = el("button", "crop-node crop-rowlabel", `R${rankId}`);
      label.type = "button";
      label.style.top = `${top + row * (cellH + gap)}px`;
      label.style.height = `${cellH}px`;
      label.addEventListener("click", () => selectRank(rankId));
      dom.rulerLeft.append(label);
    });
    dom.world.append(fragment);
    requestAnimationFrame(fit);
  }

  function position(node, x, y, width, height) {
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
  }

  function selectCell(cell, rank, layer) {
    clearSelection();
    state.selected = { rank: rank.rank, layer: layer.layer };
    cell.classList.add("is-selected");
    for (const node of dom.world.querySelectorAll(`[data-rank="${rank.rank}"], [data-layer="${layer.layer}"]`)) node.classList.add("is-related");
    dom.rightTitle.textContent = `Rank ${rank.rank} × Layer ${layer.layer}`;
    const capacity = state.capacity?.stages?.find((item) => item.stage === rank.stage);
    dom.facts.replaceChildren(
      fact("Rank", rank.rank), fact("Node", rank.node), fact("PP Stage", rank.stage),
      fact("DP / EDP", `${rank.dp_index} / ${rank.edp_index}`),
      fact("TP / CP / EP", `${rank.tp_index} / ${rank.cp_index} / ${rank.ep_index}`),
      fact("Layer", `${layer.layer} · ${layer.ffn.toUpperCase()}`),
      ...(capacity ? [fact("理论显存", `${capacity.total_gib.toFixed(1)} / ${capacity.capacity_gib} GiB`)] : []),
    );
    toggleRight(false);
  }

  function selectRank(rankId) {
    clearSelection();
    for (const node of dom.world.querySelectorAll(`[data-rank="${rankId}"]`)) node.classList.add("is-selected");
  }

  function selectLayer(layerId) {
    clearSelection();
    for (const node of dom.world.querySelectorAll(`[data-layer="${layerId}"]`)) node.classList.add("is-selected");
  }

  function selectStage(stageId) {
    clearSelection();
    for (const node of dom.world.querySelectorAll(`[data-stage="${stageId}"]`)) node.classList.add("is-related");
  }

  function clearSelection() {
    for (const node of dom.world.querySelectorAll(".is-selected, .is-related")) node.classList.remove("is-selected", "is-related");
  }

  function wireCanvas() {
    let dragging = null;
    dom.stage.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      dragging = { x: event.clientX, y: event.clientY, ox: state.x, oy: state.y };
      dom.stage.setPointerCapture(event.pointerId);
      dom.stage.classList.add("is-panning");
    });
    dom.stage.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      state.x = dragging.ox + event.clientX - dragging.x;
      state.y = dragging.oy + event.clientY - dragging.y;
      applyTransform();
    });
    dom.stage.addEventListener("pointerup", () => { dragging = null; dom.stage.classList.remove("is-panning"); });
    dom.stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.offsetX, event.offsetY);
    }, { passive: false });
    new ResizeObserver(() => { if (state.topology) fit(); }).observe(dom.stage);
  }

  function zoomAt(factor, anchorX = dom.stage.clientWidth / 2, anchorY = dom.stage.clientHeight / 2) {
    const previous = state.scale;
    state.scale = Math.min(3, Math.max(0.08, previous * factor));
    state.x = anchorX - (anchorX - state.x) * state.scale / previous;
    state.y = anchorY - (anchorY - state.y) * state.scale / previous;
    applyTransform();
  }

  function fit() {
    const width = Number.parseFloat(dom.world.style.width) || 1;
    const height = Number.parseFloat(dom.world.style.height) || 1;
    const availableW = Math.max(1, dom.stage.clientWidth - 112);
    const availableH = Math.max(1, dom.stage.clientHeight - 112);
    state.scale = Math.min(1.35, Math.max(0.08, Math.min(availableW / width, availableH / height)));
    state.x = 74 + Math.max(0, (availableW - width * state.scale) / 2);
    state.y = 64 + Math.max(0, (availableH - height * state.scale) / 2);
    applyTransform();
  }

  function applyTransform() {
    dom.world.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    dom.readout.textContent = `${Math.round(state.scale * 100)}%`;
  }
}
