import { App } from "@modelcontextprotocol/ext-apps";
import {
  computeRankTopology,
  estimateTrainingCapacity,
  parseTrainingConfig,
  suggestConfigFixes,
  validateParallelConfig,
} from "@mindspeed-config/config-core";
import "@mcp-bridge/mcp-shell.css";
import {
  diffApplied,
  formatFillCoverageScore,
  inferSourceFormat,
  labelForPath,
  pageFieldForPath,
  renderParseReport,
  sourceMarks,
  toPagePartial,
} from "@mcp-bridge/mcp-parse-adapter.js";
import { installValidationAdapter } from "@mcp-bridge/mcp-validation-adapter.js";
import { installTopologyAdapter } from "@mcp-bridge/mcp-topology-adapter.js";
import { installFixesAdapter } from "@mcp-bridge/mcp-fixes-adapter.js";
import { installCapacityAdapter } from "@mcp-bridge/mcp-capacity-adapter.js";
import { createMcpHostInteraction } from "@mcp-bridge/mcp-host-interaction.js";

const previewMode = new URLSearchParams(window.location.search).has("preview");
const BUILTIN_SOURCES = __MCP_BUILTIN_SOURCES__;
const FILL_COVERAGE_HINT = "文件总项按源配置统计；总适配度按 MCP 后续工具所需的固定必填字段集合统计。";

function parseInput(source) {
  return {
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "v1-workbench" },
    source: {
      format: inferSourceFormat(source.name),
      name: source.name,
      content: source.content,
    },
  };
}

if (previewMode) {
  document.documentElement.dataset.mcpPreview = "local-core";
  installParseAdapter(async (source) => parseTrainingConfig(parseInput(source)));
  const validationAdapter = installValidationAdapter(async (input) => validateParallelConfig(input));
  installFixesAdapter(
    async (input) => suggestConfigFixes(input),
    (config) => validationAdapter.trainingConfigFor(config),
  );
  installTopologyAdapter(
    async (input) => computeRankTopology(input),
    (config) => validationAdapter.trainingConfigFor(config),
  );
  installCapacityAdapter(
    async (input) => estimateTrainingCapacity(input),
    (config) => validationAdapter.trainingConfigFor(config),
  );
} else {
  const app = new App({ name: "MindSpeed Config Plane", version: "0.1.0" });
  const hostInteraction = createMcpHostInteraction();
  let connected = false;
  let validationAdapter = null;
  let topologyAdapter = null;
  let fixesAdapter = null;
  let capacityAdapter = null;
  let connectionInFlight = null;

  async function callServerTool(name, args) {
    if (!connected) throw new Error("MCP App 正在连接，请稍后再试。");
    return hostInteraction.run(name, async (options) => {
      const response = await app.callServerTool({ name, arguments: args }, options);
      if (response.isError || !response.structuredContent) {
        const message = response.content?.find((item) => item.type === "text")?.text;
        const error = new Error(message || `${name} 调用失败。`);
        error.code = "MCP_TOOL_ERROR";
        throw error;
      }
      return response.structuredContent;
    });
  }

  app.ontoolresult = (response) => {
    if (response.structuredContent?.tool === "open_config_workbench") {
      document.documentElement.dataset.mcpWorkbench = "ready";
      const targetTool = response.structuredContent.data?.target_tool;
      if (targetTool === "parse_training_config") {
        document.getElementById("croImportConfig")?.click();
      }
      if (targetTool === "validate_parallel_config") validationAdapter?.reveal();
      if (targetTool === "compute_rank_topology") topologyAdapter?.reveal();
      if (targetTool === "suggest_config_fixes") fixesAdapter?.reveal();
      if (targetTool === "estimate_training_capacity") capacityAdapter?.reveal();
    }
  };
  app.onerror = (error) => {
    hostInteraction.report(error);
    console.error("MindSpeed Config MCP App:", error);
  };
  installParseAdapter(async (source) => callServerTool("parse_training_config", parseInput(source)));
  validationAdapter = installValidationAdapter(
    async (input) => callServerTool("validate_parallel_config", input),
  );
  fixesAdapter = installFixesAdapter(
    async (input) => callServerTool("suggest_config_fixes", input),
    (config) => validationAdapter.trainingConfigFor(config),
  );
  topologyAdapter = installTopologyAdapter(
    async (input) => callServerTool("compute_rank_topology", input),
    (config) => validationAdapter.trainingConfigFor(config),
  );
  capacityAdapter = installCapacityAdapter(
    async (input) => callServerTool("estimate_training_capacity", input),
    (config) => validationAdapter.trainingConfigFor(config),
  );
  function connectHost() {
    if (connectionInFlight) return connectionInFlight;
    connected = false;
    hostInteraction.beginConnection();
    connectionInFlight = app.connect().then(() => {
      connected = true;
      hostInteraction.connected();
      validationAdapter.refresh();
      topologyAdapter.refresh();
      fixesAdapter.refresh();
      capacityAdapter.refresh();
    }).catch(app.onerror).finally(() => { connectionInFlight = null; });
    return connectionInFlight;
  }
  document.addEventListener("mcp:retry-requested", (event) => {
    if (event.detail?.tool === "host") connectHost();
  });
  connectHost();
}

function installParseAdapter(callParseTool) {
  const imported = { token: 0, current: null, lastSource: null };
  const sample = { token: 0, current: null, lastFile: null, lastCard: null };
  let lastParseKind = null;

  const BOOLEAN_PATHS = new Set([
    "parallel.sequence_parallel",
    "parallel.vocab_embedding_data_parallel",
    "parallel.expert_tensor_parallel",
    "memory.lora_enabled",
  ]);
  const ENUM_OPTIONS = Object.freeze({
    "parallel.ep_mode": [["split", "切分域"], ["orthogonal", "正交域"], ["mf", "MindFormers 口径"]],
    "parallel.cp_mode": [["ulysses", "Ulysses"], ["ring", "Ring"]],
    "memory.compute_dtype": [["bf16", "BF16"], ["fp16", "FP16"], ["fp8", "FP8"]],
    "memory.parameter_dtype": [["bf16", "BF16"], ["fp32", "FP32"]],
    "memory.recompute_mode": [["none", "不重计算"], ["selective", "选择性"], ["layers", "按层数"], ["full", "全量"]],
    "memory.shard_mode": [["none", "不分片"], ["zero1", "ZeRO-1"], ["fsdp2", "FSDP2"]],
  });
  const CARD_OPTIONS = Object.freeze([
    { value: "昇腾 910", label: "910 · 32G", memory: 32, ranksPerNode: 8 },
    { value: "昇腾 910B", label: "910B · 64G", memory: 64, ranksPerNode: 8 },
    { value: "昇腾 950PR", label: "950PR · 128G", memory: 128, ranksPerNode: 8 },
  ]);
  const MINUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5.5 12h13"></path></svg>';
  const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5.5v13"></path><path d="M5.5 12h13"></path></svg>';
  const FALLBACK_VALUES = Object.freeze({
    "model.id": "openpangu-flash",
    "model.total_layers": 46,
    "model.hidden_size": 7168,
    "model.num_attention_heads": 128,
    "model.routed_experts": 256,
    "model.top_k": 8,
    "model.shared_experts": 1,
    "parallel.dp": 1,
    "parallel.pp": 1,
    "parallel.tp": 1,
    "parallel.cp": 1,
    "parallel.ep": 1,
    "parallel.vpp": 1,
    "parallel.ep_mode": "split",
    "parallel.cp_mode": "ulysses",
    "parallel.sequence_parallel": false,
    "parallel.vocab_embedding_data_parallel": false,
    "parallel.expert_tensor_parallel": false,
    "cluster.total_ranks": 8,
    "cluster.ranks_per_node": 8,
    "cluster.card_model": "昇腾 910B",
    "cluster.card_memory_gib": 64,
    "batch.micro_batch_size": 1,
    "batch.sequence_length": 4096,
    "batch.micro_batch_count": 1,
    "memory.compute_dtype": "bf16",
    "memory.parameter_dtype": "bf16",
    "memory.recompute_mode": "none",
    "memory.shard_mode": "none",
    "memory.lora_enabled": false,
  });

  const importUi = () => ({
    file: document.getElementById("croImportFile"),
    name: document.getElementById("croImportName"),
    text: document.getElementById("croImportText"),
    parse: document.getElementById("croImportParse"),
    apply: document.getElementById("croImportApply"),
    report: document.getElementById("croImportReport"),
    clear: document.getElementById("croImportClear"),
    score: document.getElementById("mcpImportScore"),
  });

  function createParseBanner(score) {
    const banner = document.createElement("div");
    banner.className = "mcp-parse-banner cro-config-error is-blocking is-guidance is-mcp-invalid";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const title = document.createElement("b");
    title.className = "cro-config-error__title";
    title.textContent = "配置解析";
    score.classList.add("mcp-parse-banner__body");
    banner.append(title, score);
    return banner;
  }

  function mountPreviewParseBanner() {
    const score = document.getElementById("croPreviewName");
    const head = score?.closest(".cro-import__head");
    if (!score || !head || score.closest(".mcp-parse-banner")) return;
    head.insertAdjacentElement("afterend", createParseBanner(score));

    const menuBody = document.querySelector("#croYamlMenu .cro-yaml__menu-body");
    if (menuBody && !document.getElementById("mcpPreviewMissingPane")) {
      menuBody.append(createMissingPane("mcpPreviewMissingPane"));
    }
  }

  function createMissingPane(id) {
    const pane = document.createElement("section");
    pane.id = id;
    pane.className = "mcp-missing-pane";
    pane.hidden = true;
    const title = document.createElement("h3");
    title.className = "mcp-import__pane-title cro-config-error__title";
    title.textContent = "MCP缺口配置补齐方案";
    const hint = document.createElement("p");
    hint.className = "cro-import__hint";
    hint.textContent = "系统已填入当前页面的默认配置；可直接确认，也可修改后再应用。";
    const fields = document.createElement("div");
    fields.className = "mcp-missing-pane__fields";
    pane.append(title, hint, fields);
    return pane;
  }

  function mountConfigImportEntry() {
    if (document.getElementById("mcpConfigImportRow")) return true;
    const openButton = document.getElementById("croImportConfig");
    const trigger = document.getElementById("croConfigPresetTrigger");
    const configStepper = document.getElementById("croConfigPresetSelect")?.closest(".cro-stepper");
    if (!openButton || !trigger || !configStepper) return false;
    const label = openButton.querySelector("span");
    if (label) label.textContent = "导入";
    openButton.classList.remove("cro-export-btn");
    openButton.classList.add("mcp-config-import-button");
    const row = document.createElement("div");
    row.id = "mcpConfigImportRow";
    row.className = "mcp-config-import-row";
    trigger.replaceWith(row);
    row.append(trigger, openButton);
    return true;
  }

  function waitForConfigImportEntry() {
    if (mountConfigImportEntry()) return;
    const root = document.getElementById("croConfigPresetSelect")?.closest(".cro-stepper") ?? document.body;
    const observer = new MutationObserver(() => {
      if (!mountConfigImportEntry()) return;
      observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function mountImportUi() {
    waitForConfigImportEntry();
    mountPreviewParseBanner();

    const panel = document.getElementById("croImportPanel");
    const box = panel?.querySelector(".cro-import__box");
    const head = panel?.querySelector(".cro-import__head");
    const body = panel?.querySelector(".cro-import__body");
    const intro = body?.querySelector(".cro-import__intro");
    const name = document.getElementById("croImportName");
    const close = document.getElementById("croImportClose");
    const actions = body?.querySelector(".cro-import__actions");
    const text = document.getElementById("croImportText");
    const report = document.getElementById("croImportReport");
    const apply = document.getElementById("croImportApply");
    if (!box || !head || !body || !intro || !actions || !text || !report || !apply
      || document.getElementById("mcpImportWorkspace")) return;

    box.classList.add("mcp-import__box");
    name.hidden = true;
    intro.textContent = "支持三种方言：MindFormers / LLaMA-Factory 的 YAML、Megatron 的 Shell、HF config.json 与 DeepSpeed JSON。";
    head.append(intro);
    close.classList.add("btn-icon");
    close.title = "关闭";
    close.setAttribute("aria-label", "关闭导入配置");
    close.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">`
      + `<path d="M6 6l12 12M18 6 6 18"></path></svg>`;
    let clear = document.getElementById("croImportClear");
    if (!clear) {
      clear = document.createElement("button");
      clear.id = "croImportClear";
      clear.className = "btn btn-sm btn-ghost";
      clear.type = "button";
      clear.textContent = "清空";
      clear.hidden = true;
      document.getElementById("croImportParse")?.insertAdjacentElement("afterend", clear);
    }

    const workspace = document.createElement("div");
    workspace.id = "mcpImportWorkspace";
    workspace.className = "mcp-import__workspace";
    const codePane = document.createElement("section");
    codePane.className = "mcp-import__pane mcp-import__code-pane";
    codePane.setAttribute("aria-labelledby", "mcpImportCodeTitle");
    const codeTitle = document.createElement("h3");
    codeTitle.id = "mcpImportCodeTitle";
    codeTitle.className = "mcp-import__pane-title";
    codeTitle.textContent = "配置代码";
    const resultPane = document.createElement("section");
    resultPane.className = "mcp-import__pane mcp-import__result-pane";
    resultPane.setAttribute("aria-labelledby", "mcpImportResultTitle");
    const resultTitle = document.createElement("h3");
    resultTitle.id = "mcpImportResultTitle";
    resultTitle.className = "mcp-import__pane-title";
    resultTitle.textContent = "校验结果";
    const resultHead = document.createElement("div");
    resultHead.className = "mcp-import__pane-head";
    const resultScore = document.createElement("span");
    resultScore.id = "mcpImportScore";
    resultScore.className = "mcp-import__score";
    resultScore.textContent = "— · 等待解析";
    resultScore.title = FILL_COVERAGE_HINT;
    const resultBanner = createParseBanner(resultScore);
    codePane.append(codeTitle, actions, text);
    resultHead.append(resultTitle);
    resultPane.append(resultHead, resultBanner, report);
    workspace.append(codePane, resultPane, createMissingPane("mcpImportMissingPane"));
    body.append(workspace);

    const footer = document.createElement("footer");
    footer.className = "mcp-import__footer";
    apply.classList.add("btn-solid");
    footer.append(apply);
    box.append(footer);
    resetImported({ focus: false });

    /* 基础页面的 open() 只知道原来的输入框与报告，不知道 MCP 新增的解析横幅和
       第三栏。监听器注册顺序在基础页面之后，因此这里能在每次打开时做最终重置。 */
    document.getElementById("croImportConfig")?.addEventListener("click", () => {
      resetImported();
    });
    close.addEventListener("click", () => resetImported({ focus: false }));
  }

  function syncClearButton() {
    const ui = importUi();
    const hasContent = Boolean(ui.text?.value?.trim());
    if (ui.clear) ui.clear.hidden = !hasContent;
    ui.parse?.classList.toggle("btn-solid", hasContent);
  }

  function resetImported({ focus = true } = {}) {
    const ui = importUi();
    imported.token += 1;
    imported.current = null;
    imported.lastSource = null;
    if (lastParseKind === "imported") lastParseKind = null;
    ui.text.value = "";
    ui.file.value = "";
    ui.name.textContent = "未选择文件";
    ui.parse.disabled = false;
    ui.apply.disabled = true;
    ui.report.innerHTML = `<p class="cro-import__empty">选择 YAML、JSON 或 Shell 文件后会自动解析；也可以粘贴配置代码后点击“解析”。</p>`;
    ui.score.textContent = "— · 等待解析";
    renderMissingInputs(null, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
    syncClearButton();
    if (focus) ui.text.focus();
  }

  function currentPageValues() {
    const config = window.croObserver?.config ?? {};
    const topologyApi = window.CroTopology;
    const preset = topologyApi?.MODEL_PRESETS?.[config.model] ?? {};
    let topology = null;
    try { topology = topologyApi?.derive?.(config) ?? null; } catch { topology = null; }
    const card = topology?.card ?? {};
    const ranksPerNode = Number(card.ranksPerNode)
      || (Number(config.node) > 0 ? Math.ceil(Number(config.totalRank) / Number(config.node)) : 8);
    return {
      "model.id": preset.id ?? config.model,
      "model.hidden_size": preset.hidden,
      "model.num_attention_heads": preset.heads,
      "cluster.ranks_per_node": ranksPerNode,
      "cluster.card_model": card.label,
      "cluster.card_memory_gib": card.hbmGB,
      ...Object.fromEntries(Object.keys(FALLBACK_VALUES).flatMap((path) => {
        const field = pageFieldForPath(path);
        return field && config[field] !== undefined ? [[path, config[field]]] : [];
      })),
    };
  }

  function defaultValueFor(path) {
    const pageValue = currentPageValues()[path];
    return pageValue !== undefined && pageValue !== null && pageValue !== ""
      ? pageValue : FALLBACK_VALUES[path];
  }

  function optionsFor(path, value) {
    if (BOOLEAN_PATHS.has(path)) return [[false, "关"], [true, "开"]];
    if (path === "cluster.card_model") return CARD_OPTIONS.map((card) => [card.value, card.label]);
    if (path === "model.id") {
      const presets = window.CroTopology?.MODEL_PRESETS ?? {};
      const options = Object.entries(presets).map(([id, preset]) => [preset.id ?? id, preset.label ?? id]);
      if (value !== undefined && !options.some(([candidate]) => String(candidate) === String(value))) {
        options.unshift([value, value]);
      }
      return options;
    }
    return ENUM_OPTIONS[path] ?? null;
  }

  function controlValue(control) {
    if (control.dataset.valueType === "boolean") return control.value === "true";
    if (control.type === "number") return control.value === "" ? undefined : Number(control.value);
    return control.value;
  }

  function syncApplyState(state, button) {
    if (!button) return;
    const valid = state.current?.result?.status !== "error"
      && state.current?.supplementsValid !== false;
    const normalized = state.current ? materializedConfig(state.current) : null;
    button.disabled = !valid || !Object.keys(toPagePartial(normalized ?? {})).length;
  }

  function renderMissingInputs(result, state, pane, applyButton) {
    if (!pane) return;
    const paths = result?.status === "error" ? [] : (result?.data?.missing_required_fields ?? []);
    pane.hidden = paths.length === 0;
    pane.parentElement?.classList.toggle("has-missing-inputs", paths.length > 0);
    const fields = pane.querySelector(".mcp-missing-pane__fields");
    fields.replaceChildren();
    if (!state.current) return;
    state.current.supplements = new Map();
    state.current.supplementsValid = true;
    for (const path of paths) {
      const value = defaultValueFor(path);
      state.current.supplements.set(path, value);
      const row = document.createElement("div");
      row.className = "cro-stepper mcp-missing-field";
      const name = document.createElement("label");
      name.className = "cro-stepper__label mcp-missing-field__label";
      name.innerHTML = `<span class="cro-stepper__label-text"><b>${escapeHtml(labelForPath(path))}</b>`
        + `<code>${escapeHtml(path)}</code></span>`;
      const choices = optionsFor(path, value);
      let control;
      if (choices?.length) {
        control = document.createElement("select");
        control.className = "cro-select mcp-missing-field__control";
        for (const [optionValue, optionLabel] of choices) {
          const option = document.createElement("option");
          option.value = String(optionValue);
          option.textContent = String(optionLabel);
          option.selected = String(optionValue) === String(value);
          control.append(option);
        }
        if (BOOLEAN_PATHS.has(path)) control.dataset.valueType = "boolean";
      } else {
        control = document.createElement("input");
        control.className = "zoom-control-readout cro-stepper__input mcp-missing-field__input";
        control.type = typeof value === "number" ? "number" : "text";
        if (control.type === "number") { control.min = "0"; control.step = "1"; }
        control.value = value ?? "";
      }
      control.id = `${pane.id}-${path.replaceAll(".", "-")}`;
      name.htmlFor = control.id;
      control.dataset.missingPath = path;
      control.setAttribute("aria-label", labelForPath(path));
      control.addEventListener("input", () => {
        const next = controlValue(control);
        const invalid = next === undefined || (control.type === "number" && !Number.isFinite(next));
        control.setAttribute("aria-invalid", String(invalid));
        if (invalid) state.current.supplements.delete(path);
        else state.current.supplements.set(path, next);
        state.current.supplementsValid = !pane.querySelector('[aria-invalid="true"]');
        syncApplyState(state, applyButton);
      });
      if (path === "cluster.card_model") {
        control.addEventListener("change", () => {
          const card = CARD_OPTIONS.find((option) => option.value === control.value);
          if (!card) return;
          const memory = pane.querySelector('[data-missing-path="cluster.card_memory_gib"]');
          const ranks = pane.querySelector('[data-missing-path="cluster.ranks_per_node"]');
          if (memory) { memory.value = String(card.memory); memory.dispatchEvent(new Event("input")); }
          if (ranks) { ranks.value = String(card.ranksPerNode); ranks.dispatchEvent(new Event("input")); }
        });
      }
      let controlHost = control;
      if (control.tagName === "INPUT") {
        controlHost = document.createElement("div");
        controlHost.className = "zoom-control-group cro-stepper__control mcp-missing-field__control";
        if (control.type === "number") {
          const decrement = document.createElement("button");
          decrement.type = "button";
          decrement.className = "btn btn-ghost btn-icon btn-sm";
          decrement.innerHTML = MINUS_ICON;
          decrement.setAttribute("aria-label", `减少 ${labelForPath(path)}`);
          const increment = document.createElement("button");
          increment.type = "button";
          increment.className = "btn btn-ghost btn-icon btn-sm";
          increment.innerHTML = PLUS_ICON;
          increment.setAttribute("aria-label", `增加 ${labelForPath(path)}`);
          const step = path === "batch.sequence_length" ? 512 : 1;
          const adjust = (direction) => {
            const current = Number(control.value);
            control.value = String(Math.max(Number(control.min) || 0, (Number.isFinite(current) ? current : 0) + direction * step));
            control.dispatchEvent(new Event("input"));
            control.focus();
          };
          decrement.addEventListener("click", () => adjust(-1));
          increment.addEventListener("click", () => adjust(1));
          controlHost.append(decrement, control, increment);
        } else {
          controlHost.append(control);
        }
      }
      row.append(name, controlHost);
      fields.append(row);
    }
    syncApplyState(state, applyButton);
  }

  function setPath(target, path, value) {
    const keys = String(path).split(".");
    let cursor = target;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) cursor[key] = value;
      else cursor = cursor[key] ??= {};
    });
  }

  function materializedConfig(current) {
    const normalized = structuredClone(current?.result?.data?.normalized_config ?? {});
    for (const [path, value] of current?.supplements ?? []) setPath(normalized, path, value);
    return normalized;
  }

  function errorHtml(error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<p class="cro-import__empty" data-mcp-parse-report="error">MCP 解析失败：${escapeHtml(message)}</p>`;
  }

  async function parseImported(source) {
    const ui = importUi();
    const token = ++imported.token;
    lastParseKind = "imported";
    imported.lastSource = source;
    imported.current = null;
    ui.apply.disabled = true;
    ui.parse.disabled = true;
    ui.score.textContent = "解析中…";
    ui.report.innerHTML = `<p class="cro-import__empty">正在调用 <code>parse_training_config</code>，不启动训练…</p>`;
    renderMissingInputs(null, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
    syncClearButton();
    try {
      const result = await callParseTool(source);
      if (token !== imported.token) return;
      const partial = toPagePartial(result.data?.normalized_config);
      imported.current = { source, result, partial };
      ui.score.textContent = formatFillCoverageScore(result);
      ui.report.innerHTML = renderParseReport(result);
      renderMissingInputs(result, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
      ui.report.scrollTop = 0;
    } catch (error) {
      if (token !== imported.token) return;
      ui.score.textContent = "— · MCP 调用失败";
      ui.report.innerHTML = errorHtml(error);
      renderMissingInputs(null, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
    } finally {
      if (token === imported.token) ui.parse.disabled = false;
    }
  }

  async function parseSample(file, card) {
    const report = document.getElementById("croPreviewReport");
    const apply = document.getElementById("croPreviewApply");
    const score = document.getElementById("croPreviewName");
    const sourceLine = document.getElementById("croPreviewSource");
    const token = ++sample.token;
    lastParseKind = "sample";
    sample.lastFile = file;
    sample.lastCard = card;
    const content = BUILTIN_SOURCES[file];
    sample.current = null;
    document.querySelectorAll("#croYamlOptions .cro-yaml__opt").forEach((item) => {
      const selected = item === card;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    apply.disabled = true;
    score.textContent = "MCP 解析中…";
    sourceLine.innerHTML = `<b>来源</b> config-test/${escapeHtml(file)} · 由 parse_training_config 解析，不启动训练`;
    report.innerHTML = `<p class="cro-import__empty">正在调用 <code>parse_training_config</code>…</p>`;
    renderMissingInputs(null, sample, document.getElementById("mcpPreviewMissingPane"), apply);
    if (content === undefined) {
      report.innerHTML = errorHtml(new Error(`单文件 App 中缺少内置样例 ${file}`));
      score.textContent = "— · 样例缺失";
      return;
    }
    try {
      const result = await callParseTool({ name: file, content });
      if (token !== sample.token) return;
      const partial = toPagePartial(result.data?.normalized_config);
      sample.current = { file, content, result, partial, card };
      score.textContent = result.status === "error"
        ? "— · 解析失败"
        : formatFillCoverageScore(result);
      score.title = FILL_COVERAGE_HINT;
      report.innerHTML = renderParseReport(result);
      renderMissingInputs(result, sample, document.getElementById("mcpPreviewMissingPane"), apply);
      report.scrollTop = 0;
    } catch (error) {
      if (token !== sample.token) return;
      score.textContent = "— · MCP 调用失败";
      report.innerHTML = errorHtml(error);
      renderMissingInputs(null, sample, document.getElementById("mcpPreviewMissingPane"), apply);
    }
  }

  function applyParsed(current, report) {
    if (!current || !window.croObserver?.importConfig) return null;
    const normalizedConfig = materializedConfig(current);
    const partial = toPagePartial(normalizedConfig);
    const applied = window.croObserver.importConfig(partial);
    const adjusted = diffApplied(partial, applied.after);
    document.dispatchEvent(new CustomEvent("mcp:parsed-config-applied", { detail: {
      normalizedConfig,
      supplements: Object.fromEntries(current.supplements ?? []),
    } }));
    report.innerHTML = renderParseReport(current.result, { adjusted });
    report.scrollTop = 0;
    document.dispatchEvent(new CustomEvent("cro:source", { detail: {
      name: current.source?.name ?? `config-test/${current.file}`,
      label: current.source?.name ?? current.file,
      dialect: current.result.data?.detected_format === "shell"
        ? "sh" : current.result.data?.detected_format,
      text: current.source?.content ?? current.content,
      marks: sourceMarks(current.result, adjusted),
    } }));
    return adjusted;
  }

  document.addEventListener("change", (event) => {
    if (event.target?.id !== "croImportFile") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const file = event.target.files?.[0];
    if (!file) return;
    const ui = importUi();
    file.text().then((content) => {
      ui.text.value = content;
      ui.name.textContent = file.name;
      syncClearButton();
      parseImported({ name: file.name, content });
    }).catch((error) => { ui.report.innerHTML = errorHtml(error); });
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target?.id !== "croImportText") return;
    imported.token += 1;
    imported.current = null;
    const ui = importUi();
    ui.apply.disabled = true;
    ui.score.textContent = "— · 等待解析";
    ui.report.innerHTML = event.target.value
      ? `<p class="cro-import__empty">配置代码已修改，点击“解析”查看最新校验结果。</p>`
      : `<p class="cro-import__empty">选择 YAML、JSON 或 Shell 文件后会自动解析；也可以粘贴配置代码后点击“解析”。</p>`;
    renderMissingInputs(null, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
    syncClearButton();
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target;
    const parseButton = target?.closest?.("#croImportParse");
    if (parseButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const ui = importUi();
      const content = ui.text.value ?? "";
      if (!content.trim()) {
        ui.apply.disabled = true;
        ui.report.innerHTML = `<p class="cro-import__empty">先贴一份配置，或选一个文件。</p>`;
        return;
      }
      const visibleName = ui.name.textContent?.trim();
      const name = visibleName && visibleName !== "未选择文件" ? visibleName : "粘贴的训练配置.txt";
      parseImported({ name, content });
      return;
    }

    const importApply = target?.closest?.("#croImportApply");
    if (importApply) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyParsed(imported.current, importUi().report);
      return;
    }

    const clearButton = target?.closest?.("#croImportClear");
    if (clearButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      resetImported();
      return;
    }

    const sampleCard = target?.closest?.("#croYamlOptions .cro-yaml__opt");
    const file = sampleCard?.dataset.file;
    if (file && !file.startsWith("__")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      parseSample(file, sampleCard);
      return;
    }

    const sampleApply = target?.closest?.("#croPreviewApply");
    if (sampleApply && sample.current) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyParsed(sample.current, document.getElementById("croPreviewReport"));
      document.getElementById("croPreviewCancel")?.click();
      const select = document.getElementById("croConfigPresetSelect");
      const optionValue = `__yaml_sample__:${sample.current.file}`;
      if (select && Array.from(select.options).some((option) => option.value === optionValue)) {
        select.value = optionValue;
        const option = select.selectedOptions[0];
        const trigger = document.getElementById("croConfigPresetTrigger");
        if (trigger && option) {
          trigger.textContent = option.textContent;
          trigger.title = option.textContent;
        }
      }
      sample.current = null;
    }
  }, true);

  document.addEventListener("mcp:retry-requested", (event) => {
    if (event.detail?.tool !== "parse_training_config") return;
    if (lastParseKind === "sample" && sample.lastFile) parseSample(sample.lastFile, sample.lastCard);
    else if (imported.lastSource) parseImported(imported.lastSource);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountImportUi, { once: true });
  } else {
    mountImportUi();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
