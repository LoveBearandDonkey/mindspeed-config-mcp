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
  missingFieldImpactRows,
  pageFieldForPath,
  renderAppliedStatus,
  renderParseReport,
  sourceMarks,
  toolReadinessForMissingFields,
  toPagePartial,
} from "@mcp-bridge/mcp-parse-adapter.js";
import {
  installValidationAdapter,
  pageConfigToTrainingConfig,
  parseValidationSummary,
  pipelineSettingsForPreset,
  renderParseValidationDetails,
} from "@mcp-bridge/mcp-validation-adapter.js";
import { installTopologyAdapter } from "@mcp-bridge/mcp-topology-adapter.js";
import { installFixesAdapter } from "@mcp-bridge/mcp-fixes-adapter.js";
import { installCapacityAdapter } from "@mcp-bridge/mcp-capacity-adapter.js";
import { createMcpHostInteraction } from "@mcp-bridge/mcp-host-interaction.js";

const staticDemoMode = __MCP_STATIC_DEMO__;
const previewMode = staticDemoMode || new URLSearchParams(window.location.search).has("preview");
const BUILTIN_SOURCES = __MCP_BUILTIN_SOURCES__;
const FILL_COVERAGE_HINT = "文件总项按源配置统计；MCP 校验必填项表示后续规则检查所需的固定输入，存在缺口时必须先补齐。";

if (staticDemoMode) {
  document.documentElement.dataset.mcpDistribution = "github-pages";
  document.documentElement.dataset.mcpWorkbench = "static-demo";
}

function installConfigErrorViewportLimit() {
  function mount() {
    const scrollHost = document.querySelector(".cro-board.is-plane .crop-left__body");
    if (!scrollHost) return;

    const syncLimit = () => {
      const height = scrollHost.clientHeight;
      if (height > 0) {
        scrollHost.style.setProperty("--mcp-config-error-max-height", `${height * 2 / 3}px`);
      }
    };

    syncLimit();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(syncLimit).observe(scrollHost);
    } else {
      window.addEventListener("resize", syncLimit);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}

installConfigErrorViewportLimit();

function parseInput(source) {
  const input = {
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "v1-workbench" },
    source: {
      format: inferSourceFormat(source.name),
      name: source.name,
      content: source.content,
    },
  };
  if (source.modelSource?.content?.trim()) {
    input.model_source = {
      format: inferSourceFormat(source.modelSource.name),
      name: source.modelSource.name,
      content: source.modelSource.content,
    };
  }
  return input;
}

if (previewMode) {
  document.documentElement.dataset.mcpPreview = "local-core";
  installParseAdapter(
    async (source) => parseTrainingConfig(parseInput(source)),
    async (input) => validateParallelConfig(input),
    async (input) => estimateTrainingCapacity(input),
  );
  const validationAdapter = installValidationAdapter(async (input) => validateParallelConfig(input));
  // Preview must use the same pipeline/profile write-back path as the MCP host.
  installFixesAdapter(
    async (input) => suggestConfigFixes(input),
    (config) => validationAdapter.trainingConfigFor(config, "suggest_config_fixes"),
    (settings) => validationAdapter.applyPipelineSettings(settings),
  );
  installTopologyAdapter(
    async (input) => computeRankTopology(input),
    (config) => validationAdapter.trainingConfigFor(config, "compute_rank_topology"),
  );
  installCapacityAdapter(
    async (input) => estimateTrainingCapacity(input),
    (config) => validationAdapter.capacityConfigFor(config),
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
  installParseAdapter(
    async (source) => callServerTool("parse_training_config", parseInput(source)),
    async (input) => callServerTool("validate_parallel_config", input),
    async (input) => callServerTool("estimate_training_capacity", input),
  );
  validationAdapter = installValidationAdapter(
    async (input) => callServerTool("validate_parallel_config", input),
  );
  fixesAdapter = installFixesAdapter(
    async (input) => callServerTool("suggest_config_fixes", input),
    (config) => validationAdapter.trainingConfigFor(config, "suggest_config_fixes"),
    (settings) => validationAdapter.applyPipelineSettings(settings),
  );
  topologyAdapter = installTopologyAdapter(
    async (input) => callServerTool("compute_rank_topology", input),
    (config) => validationAdapter.trainingConfigFor(config, "compute_rank_topology"),
  );
  capacityAdapter = installCapacityAdapter(
    async (input) => callServerTool("estimate_training_capacity", input),
    (config) => validationAdapter.capacityConfigFor(config),
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

function installParseAdapter(callParseTool, callValidateTool, callCapacityTool) {
  const imported = { token: 0, current: null, lastSource: null };
  const sample = { token: 0, current: null, lastFile: null, lastCard: null };
  const appliedImport = { current: null, signature: null, adjusted: [], source: null };
  let lastParseKind = null;
  let liveParseTimer = 0;
  let presetPreviewToken = 0;
  const LIVE_PARSE_DELAY_MS = 450;
  const APPLIED_STATUS_DURATION_MS = 3000;
  let appliedStatusSignature = null;
  let appliedStatusTimer = 0;
  let issueDialogContext = null;

  const BOOLEAN_PATHS = new Set([
    "parallel.sequence_parallel",
    "parallel.vocab_embedding_data_parallel",
    "parallel.expert_tensor_parallel",
    "memory.lora_enabled",
  ]);
  const ENUM_OPTIONS = Object.freeze({
    "rule_profile.framework": [["mindspeed-core", "MindSpeed Core"], ["mindspeed-llm-mcore", "MindSpeed-LLM MCore"], ["mindformers", "MindFormers"]],
    "parallel.pipeline_layer_mode": [["uniform", "均匀 PP"], ["dynamic", "动态 PP"], ["mindformers-offset", "MindFormers PP 层偏置"]],
    "parallel.ep_mode": [["split", "切分域"], ["orthogonal", "正交域"], ["mf", "MindFormers EP 域"]],
    "parallel.cp_mode": [
      ["ulysses", "Ulysses"],
      ["ring", "Ring"],
      ["hybrid", "Hybrid"],
      ["adaptive", "Adaptive"],
      ["hybrid-adaptive", "Hybrid Adaptive"],
    ],
    "memory.compute_dtype": [["bf16", "BF16"], ["fp16", "FP16"], ["fp8", "FP8"]],
    "memory.parameter_dtype": [["bf16", "BF16"], ["fp32", "FP32"]],
    "memory.recompute_mode": [["none", "不重计算"], ["selective", "选择性"], ["layers", "按层数"], ["full", "全量"]],
    "memory.shard_mode": [["none", "不分片"], ["zero1", "ZeRO-1"], ["fsdp2", "FSDP2"]],
  });
  const CARD_OPTIONS = Object.freeze([
    { id: "910b-32", value: "昇腾 910", label: "910 · 32G", memory: 32, ranksPerNode: 8 },
    { id: "910b-64", value: "昇腾 910B", label: "910B · 64G", memory: 64, ranksPerNode: 8 },
    { id: "950", value: "昇腾 950PR", label: "950PR · 128G", memory: 128, ranksPerNode: 8 },
  ]);
  const MINUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5.5 12h13"></path></svg>';
  const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5.5v13"></path><path d="M5.5 12h13"></path></svg>';
  const FALLBACK_VALUES = Object.freeze({
    "model.id": "openpangu-flash",
    "model.total_layers": 46,
    "model.hidden_size": 7168,
    "model.num_attention_heads": 128,
    "model.num_key_value_heads": 0,
    "model.ffn_hidden_size": 28672,
    "model.expert_ffn_hidden_size": 2048,
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
    "cluster.card_model": "昇腾 950PR",
    "cluster.card_memory_gib": 128,
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
    workspace: document.getElementById("mcpImportWorkspace"),
    resultPane: document.querySelector("#mcpImportWorkspace > .mcp-import__result-pane"),
    file: document.getElementById("croImportFile"),
    name: document.getElementById("croImportName"),
    text: document.getElementById("croImportText"),
    modelFile: document.getElementById("mcpImportModelFile"),
    modelName: document.getElementById("mcpImportModelName"),
    modelText: document.getElementById("mcpImportModelText"),
    modelClear: document.getElementById("mcpImportModelClear"),
    apply: document.getElementById("croImportApply"),
    report: document.getElementById("croImportReport"),
    clear: document.getElementById("croImportClear"),
    score: document.getElementById("mcpImportScore"),
  });

  function setImportValidationStarted(started) {
    const ui = importUi();
    ui.workspace?.classList.toggle("is-awaiting-validation", !started);
    if (ui.resultPane) ui.resultPane.hidden = !started;
    const banner = ui.workspace?.querySelector(":scope > .mcp-parse-banner");
    if (banner) banner.hidden = !started;
  }

  function createParseBanner(score) {
    const banner = document.createElement("div");
    banner.className = "mcp-parse-banner cro-config-error is-blocking is-guidance is-mcp-invalid";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const title = document.createElement("b");
    title.className = "cro-config-error__title";
    title.textContent = "配置智能解析";
    const body = document.createElement("div");
    body.className = "mcp-parse-banner__body";
    const scoreLine = document.createElement("p");
    scoreLine.className = "mcp-parse-banner__line";
    score.classList.add("mcp-parse-banner__text");
    scoreLine.append(score);
    const validationLine = document.createElement("div");
    validationLine.className = "mcp-parse-banner__line mcp-completion-status is-pending";
    validationLine.dataset.mcpParseValidation = "";
    validationLine.innerHTML = '<span class="mcp-parse-banner__text">等待 MCP 规则检查…</span>';
    const capacityLine = document.createElement("p");
    capacityLine.className = "mcp-parse-banner__line mcp-completion-status mcp-completion-capacity-status is-pending";
    capacityLine.dataset.mcpParseCapacity = "";
    capacityLine.innerHTML = '<span class="mcp-parse-banner__text">等待理论显存估算…</span>';
    body.append(scoreLine, validationLine, capacityLine);
    banner.append(title, body);
    return banner;
  }

  function mountPreviewParseBanner() {
    const score = document.getElementById("croPreviewName");
    const head = score?.closest(".cro-import__head");
    if (!score || !head || score.closest(".mcp-parse-banner")) return;
    const menuBody = document.querySelector("#croYamlMenu .cro-yaml__menu-body");
    if (!menuBody) return;
    menuBody.insertBefore(createParseBanner(score), head.closest(".cro-yaml__preview"));
    if (!document.getElementById("mcpPreviewMissingPane")) {
      menuBody.append(createMissingPane("mcpPreviewMissingPane"));
    }
    const applyButton = document.getElementById("croPreviewApply");
    ensureConfirmApplyButton(applyButton);
    ensureDirectImportButton(applyButton);
    const pane = document.getElementById("mcpPreviewMissingPane");
    if (sample.current && pane) renderMissingInputs(sample.current.result, sample, pane, applyButton);
  }

  function createMissingPane(id) {
    const pane = document.createElement("section");
    pane.id = id;
    pane.className = "mcp-missing-pane";
    pane.hidden = true;
    const title = document.createElement("h3");
    title.className = "mcp-import__pane-title";
    title.dataset.mcpCompletionTitle = "";
    title.textContent = "MCP缺口配置推荐补齐方案";
    const plans = document.createElement("div");
    plans.className = "mcp-completion-plans";
    const fields = document.createElement("div");
    fields.className = "mcp-missing-pane__fields";
    pane.append(title, plans, fields);
    return pane;
  }

  function ensureConfirmApplyButton(applyButton) {
    if (!applyButton) return null;
    const id = `${applyButton.id}Confirmed`;
    const existing = document.getElementById(id);
    if (existing) return existing;
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "btn btn-sm mcp-confirm-apply";
    button.dataset.applyTarget = applyButton.id;
    button.textContent = "核对并应用";
    button.hidden = true;
    button.disabled = true;
    applyButton.insertAdjacentElement("afterend", button);
    return button;
  }

  function confirmApplyButtonFor(applyButton) {
    return applyButton ? document.getElementById(`${applyButton.id}Confirmed`) : null;
  }

  function ensureDirectImportButton(applyButton) {
    if (!applyButton) return null;
    const id = `${applyButton.id}Direct`;
    const existing = document.getElementById(id);
    if (existing) return existing;
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "btn btn-sm mcp-direct-import";
    button.dataset.applyTarget = applyButton.id;
    button.hidden = true;
    button.disabled = true;
    button.textContent = "无需补缺，直接导入";
    applyButton.insertAdjacentElement("afterend", button);
    return button;
  }

  function directImportButtonFor(applyButton) {
    return applyButton ? document.getElementById(`${applyButton.id}Direct`) : null;
  }

  function syncDirectImportState(state, applyButton) {
    const button = ensureDirectImportButton(applyButton);
    if (!button) return;
    const result = state.current?.result;
    const missing = result?.data?.missing_required_fields ?? [];
    const hasSourceValues = (result?.data?.mapped_fields?.length ?? 0) > 0;
    const available = result?.status !== "error" && missing.length > 0 && hasSourceValues;
    button.hidden = !available;
    button.disabled = !available;
    button.textContent = `无需${missing.length}项补缺，直接导入`;
  }

  function ensureIssueDialog() {
    const existing = document.getElementById("mcpImportIssueDialog");
    if (existing) return existing;
    const dialog = document.createElement("div");
    dialog.id = "mcpImportIssueDialog";
    dialog.className = "mcp-import-issues";
    dialog.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "mcpImportIssueTitle");
    dialog.innerHTML = `
      <section class="mcp-import-issues__box">
        <header class="mcp-import-issues__head">
          <div>
            <h2 id="mcpImportIssueTitle">配置解析问题告知</h2>
            <p data-mcp-issue-summary></p>
          </div>
          <button class="btn btn-sm btn-icon btn-ghost mcp-import-issues__close" type="button"
                  aria-label="关闭并返回上一层" title="关闭并返回上一层">×</button>
        </header>
        <div class="mcp-import-issues__body">
          <table>
            <thead><tr><th>缺少配置</th><th>无法使用的 MCP 功能</th></tr></thead>
            <tbody data-mcp-issue-rows></tbody>
          </table>
        </div>
        <footer class="mcp-import-issues__footer">
          <button class="btn btn-sm mcp-import-issues__continue" type="button">继续导入</button>
          <button class="btn btn-sm mcp-import-issues__complete" type="button">补齐后导入</button>
          <button class="btn btn-sm mcp-import-issues__cancel" type="button">取消导入</button>
        </footer>
      </section>`;
    document.body.append(dialog);

    // 配置下拉依靠 document click 判断是否点到了面板外。二次确认弹窗虽然挂在 body，
    // 但它仍是下拉流程的一部分；在这里截住冒泡，关闭二次弹窗时保留原下拉面板。
    dialog.addEventListener("click", (event) => event.stopPropagation());

    dialog.querySelector(".mcp-import-issues__close")?.addEventListener("click", () => {
      closeIssueDialog({ restoreFocus: true });
    });
    dialog.querySelector(".mcp-import-issues__cancel")?.addEventListener("click", () => {
      const context = issueDialogContext;
      closeIssueDialog();
      if (context?.applyButton?.id === "croImportApply") {
        document.getElementById("croImportClose")?.click();
      } else {
        document.getElementById("croPreviewCancel")?.click();
      }
    });
    dialog.querySelector(".mcp-import-issues__complete")?.addEventListener("click", () => {
      const context = issueDialogContext;
      if (!context) return;
      const applyButton = context.applyButton;
      const confirmButton = confirmApplyButtonFor(applyButton);
      closeIssueDialog();
      if (!applyButton.disabled) applyButton.click();
      else if (confirmButton && !confirmButton.hidden && !confirmButton.disabled) confirmButton.click();
    });
    dialog.querySelector(".mcp-import-issues__continue")?.addEventListener("click", () => {
      const context = issueDialogContext;
      if (!context?.state?.current) return;
      const missingRequiredFields = [
        ...(context.state.current.result?.data?.missing_required_fields ?? []),
      ];
      closeIssueDialog();
      const report = context.applyButton.id === "croImportApply"
        ? importUi().report : document.getElementById("croPreviewReport");
      const appliedCurrent = context.state.current;
      const adjusted = applyParsed(appliedCurrent, report, { useCompletion: false });
      if (context.applyButton.id === "croImportApply") {
        if (adjusted) rememberAppliedImport(appliedCurrent, adjusted);
        document.getElementById("croImportClose")?.click();
      } else {
        window.croImport?.selectAppliedSample?.(context.state.current.file);
        document.getElementById("croPreviewCancel")?.click();
        context.state.current = null;
      }
      if (adjusted) {
        returnToFormAfterApply(adjusted, missingRequiredFields);
      }
    });
    return dialog;
  }

  function closeIssueDialog({ restoreFocus = false } = {}) {
    const dialog = document.getElementById("mcpImportIssueDialog");
    const trigger = issueDialogContext?.trigger;
    if (dialog) dialog.hidden = true;
    issueDialogContext = null;
    if (restoreFocus) trigger?.focus();
  }

  function openIssueDialog(state, applyButton, trigger) {
    const result = state.current?.result;
    const missing = result?.data?.missing_required_fields ?? [];
    if (!state.current || result?.status === "error" || !missing.length) return;
    const dialog = ensureIssueDialog();
    const rows = missingFieldImpactRows(missing);
    issueDialogContext = { state, applyButton, trigger };
    dialog.querySelector("[data-mcp-issue-summary]").textContent =
      `当前配置缺少 ${missing.length} 项。继续导入不会使用上一份配置补缺，受影响的 MCP 功能将停止计算。`;
    const body = dialog.querySelector("[data-mcp-issue-rows]");
    body.innerHTML = rows.map((row) => `<tr><td><b>${escapeHtml(row.label)}</b><code>${escapeHtml(row.path)}</code></td>`
      + `<td>${row.affected_tools.map((tool) => `<span>${escapeHtml(tool.label)}</span>`).join("")}</td></tr>`).join("");
    const completeButton = dialog.querySelector(".mcp-import-issues__complete");
    const confirmButton = confirmApplyButtonFor(applyButton);
    completeButton.disabled = applyButton.disabled
      && (!confirmButton || confirmButton.hidden || confirmButton.disabled);
    dialog.hidden = false;
    dialog.querySelector(".mcp-import-issues__continue")?.focus();
  }

  function mountConfigImportEntry() {
    if (document.getElementById("mcpConfigImportRow")) return true;
    const openButton = document.getElementById("croImportConfig");
    const trigger = document.getElementById("croConfigPresetTrigger");
    const configStepper = document.getElementById("croConfigPresetSelect")?.closest(".cro-stepper");
    if (!openButton || !trigger || !configStepper) return false;
    const configLabel = configStepper.querySelector(".cro-stepper__label");
    if (configLabel) configLabel.textContent = "训练配置";
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
    body?.querySelector(".cro-import__intro")?.remove();
    const name = document.getElementById("croImportName");
    const close = document.getElementById("croImportClose");
    const actions = body?.querySelector(".cro-import__actions");
    const text = document.getElementById("croImportText");
    const report = document.getElementById("croImportReport");
    const apply = document.getElementById("croImportApply");
    if (!box || !head || !body || !actions || !text || !report || !apply
      || document.getElementById("mcpImportWorkspace")) return;

    box.classList.add("mcp-import__box");
    name.hidden = false;
    name.classList.add("mcp-import__source-name");
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
    clear.classList.add("mcp-import__source-clear");
    /* 原页面的导入脚本会在 DOMContentLoaded 时给这枚按钮注册事件；直接删除会让
       boot() 提前异常，连带阻断配置预置选择器的创建。保留兼容节点但不展示，
       实际解析仍只由下面的上传 / 输入自动触发。 */
    const legacyParse = document.getElementById("croImportParse");
    if (legacyParse) {
      legacyParse.hidden = true;
      legacyParse.setAttribute("aria-hidden", "true");
      legacyParse.tabIndex = -1;
    }

    const workspace = document.createElement("div");
    workspace.id = "mcpImportWorkspace";
    workspace.className = "mcp-import__workspace";
    const codePane = document.createElement("section");
    codePane.className = "mcp-import__pane mcp-import__code-pane";
    codePane.setAttribute("aria-label", "配置输入");
    const trainingSource = document.createElement("section");
    trainingSource.className = "mcp-import__source mcp-import__training-source";
    const trainingHead = document.createElement("div");
    trainingHead.className = "mcp-import__source-head";
    const trainingTitle = document.createElement("h4");
    trainingTitle.className = "mcp-import__source-title";
    trainingTitle.textContent = "训练配置";
    const trainingUpload = actions.querySelector('label[for="croImportFile"]');
    if (trainingUpload) {
      trainingUpload.classList.add("mcp-import__source-upload");
      const uploadText = trainingUpload.querySelector("span");
      if (uploadText) uploadText.textContent = "上传训练配置";
    }
    text.placeholder = "上传或粘贴 YAML、Shell 或 JSON 训练配置内容…";
    trainingHead.append(trainingTitle, name, clear);
    if (trainingUpload) trainingHead.append(trainingUpload);
    trainingSource.append(trainingHead, text, document.getElementById("croImportFile"));

    const modelSource = document.createElement("section");
    modelSource.className = "mcp-import__source mcp-import__model-source";
    const modelHead = document.createElement("div");
    modelHead.className = "mcp-import__source-head";
    const modelTitle = document.createElement("h4");
    modelTitle.className = "mcp-import__source-title";
    modelTitle.innerHTML = `模型结构 <span>（可选）</span>`;
    const modelFile = document.createElement("input");
    modelFile.id = "mcpImportModelFile";
    modelFile.type = "file";
    modelFile.accept = ".json,.yaml,.yml,.txt,application/json,text/yaml";
    modelFile.hidden = true;
    const modelUpload = document.createElement("label");
    modelUpload.className = "btn btn-sm mcp-import__source-upload";
    modelUpload.htmlFor = modelFile.id;
    modelUpload.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" `
      + `stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"></path>`
      + `<path d="M5 12h14"></path></svg><span>上传模型结构</span>`;
    const modelClear = document.createElement("button");
    modelClear.id = "mcpImportModelClear";
    modelClear.type = "button";
    modelClear.className = "btn btn-sm btn-ghost mcp-import__source-clear";
    modelClear.textContent = "清空";
    modelClear.hidden = true;
    const modelName = document.createElement("span");
    modelName.id = "mcpImportModelName";
    modelName.className = "mcp-import__source-name";
    modelName.textContent = "未选择文件";
    const modelText = document.createElement("textarea");
    modelText.id = "mcpImportModelText";
    modelText.className = "cro-import__text cro-code mcp-import__model-text";
    modelText.setAttribute("aria-label", "可选的模型结构配置代码");
    modelText.spellcheck = false;
    modelText.wrap = "off";
    modelText.placeholder = "上传或粘贴 config.json 文件内容…";
    modelHead.append(modelTitle, modelName, modelClear, modelUpload);
    modelSource.append(modelHead, modelText, modelFile);
    const resultPane = document.createElement("section");
    resultPane.className = "mcp-import__pane mcp-import__result-pane";
    resultPane.hidden = true;
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
    resultBanner.hidden = true;
    codePane.append(trainingSource, modelSource);
    resultHead.append(resultTitle);
    resultPane.append(resultHead, report);
    workspace.append(codePane, resultBanner, resultPane, createMissingPane("mcpImportMissingPane"));
    body.append(workspace);

    const footer = document.createElement("footer");
    footer.className = "mcp-import__footer";
    apply.classList.add("btn-solid");
    const cancel = document.createElement("button");
    cancel.id = "mcpImportCancel";
    cancel.type = "button";
    cancel.className = "btn btn-sm";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => close.click());
    footer.append(
      apply,
      ensureConfirmApplyButton(apply),
      ensureDirectImportButton(apply),
      cancel,
    );
    box.append(footer);
    resetImported({ focus: false });

    /* 基础页面的 open() 只知道原来的输入框与报告，不知道 MCP 新增的解析横幅和
       第三栏。监听器注册顺序在基础页面之后，因此这里能在每次打开时做最终重置。 */
    document.getElementById("croImportConfig")?.addEventListener("click", () => {
      resetImported();
    });
    close.addEventListener("click", () => {
      closeIssueDialog();
      resetImported({ focus: false });
    });
  }

  function syncClearButton() {
    const ui = importUi();
    if (ui.clear) ui.clear.hidden = !ui.text?.value?.trim();
    if (ui.modelClear) ui.modelClear.hidden = !ui.modelText?.value?.trim();
  }

  function importedSourceFromUi() {
    const ui = importUi();
    const visibleName = ui.name.textContent?.trim();
    const name = visibleName && visibleName !== "未选择文件"
      ? visibleName : "粘贴的训练配置.txt";
    const visibleModelName = ui.modelName?.textContent?.trim();
    const modelName = visibleModelName && visibleModelName !== "未选择文件"
      ? visibleModelName : "粘贴的模型结构 config.json";
    const modelContent = ui.modelText?.value ?? "";
    return {
      name,
      content: ui.text.value ?? "",
      ...(modelContent.trim() ? { modelSource: { name: modelName, content: modelContent } } : {}),
    };
  }

  function resetImported({ focus = true } = {}) {
    clearTimeout(liveParseTimer);
    const ui = importUi();
    imported.token += 1;
    imported.current = null;
    imported.lastSource = null;
    if (lastParseKind === "imported") lastParseKind = null;
    ui.text.value = "";
    ui.file.value = "";
    ui.modelText.value = "";
    ui.modelFile.value = "";
    ui.name.textContent = "未选择文件";
    ui.modelName.textContent = "未选择文件";
    ui.apply.disabled = true;
    ui.report.innerHTML = `<p class="cro-import__empty">先提供训练配置；模型结构可选。上传文件后会立即解析，停止输入后自动解析两个输入框中的现有内容。</p>`;
    ui.score.textContent = "— · 等待解析";
    syncParseScoreState(ui.score, null);
    setImportValidationStarted(false);
    renderMissingInputs(null, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
    syncClearButton();
    if (focus) ui.text.focus();
  }

  function currentPageValues() {
    const config = window.croObserver?.config ?? {};
    const topologyApi = window.CroTopology;
    const preset = topologyApi?.MODEL_PRESETS?.[config.model] ?? {};
    const card = CARD_OPTIONS.find((option) => option.id === config.card) ?? CARD_OPTIONS[1];
    const customMemory = config.customCardMemoryGB;
    const cardMemory = customMemory !== null && customMemory !== undefined
      && Number.isFinite(Number(customMemory))
      ? Number(customMemory)
      : card.memory;
    return {
      "model.id": preset.id ?? config.model,
      "model.hidden_size": config.hidden ?? preset.hidden,
      "model.num_attention_heads": config.heads ?? preset.heads,
      "model.num_key_value_heads": config.kvHeads ?? preset.kvHeads,
      "model.ffn_hidden_size": config.denseIntermediate ?? preset.denseIntermediate,
      "model.expert_ffn_hidden_size": config.moeIntermediate ?? preset.moeIntermediate,
      "cluster.ranks_per_node": card.ranksPerNode,
      "cluster.card_model": card.value,
      "cluster.card_memory_gib": cardMemory,
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

  function renderParseReportWithoutLede(report, result, options) {
    report.innerHTML = renderParseReport(result, options);
    report.querySelector(":scope > .cro-import__lede")?.remove();
  }

  function parseBannerForPane(pane) {
    return pane?.parentElement?.querySelector(":scope > .mcp-parse-banner") ?? null;
  }

  function completionStatusForPane(pane) {
    return parseBannerForPane(pane)?.querySelector("[data-mcp-parse-validation]") ?? null;
  }

  function capacityStatusForPane(pane) {
    return parseBannerForPane(pane)?.querySelector("[data-mcp-parse-capacity]") ?? null;
  }

  function setParseBannerMode(pane, hasCompletionPane) {
    const title = parseBannerForPane(pane)?.querySelector(".cro-config-error__title");
    if (title) title.textContent = hasCompletionPane ? "配置智能解析与补齐" : "配置智能解析";
  }

  function setParseBannerLine(line, state, copy) {
    if (!line) return;
    line.classList.remove("is-pending", "is-review", "is-valid", "is-danger");
    if (state) line.classList.add(`is-${state}`);
    const text = line.querySelector(".mcp-parse-banner__text");
    if (text) text.textContent = String(copy).replace(/。$/, "");
    if (["pending", "danger"].includes(state)) {
      line.querySelector("[data-mcp-parse-validation-details]")?.remove();
      line.classList.remove("has-validation-details");
    }
  }

  function syncParseValidationDetails(line, result) {
    if (!line) return;
    line.querySelector("[data-mcp-parse-validation-details]")?.remove();
    line.classList.remove("has-validation-details");
    const errors = result?.errors ?? [];
    const body = renderParseValidationDetails(result);
    if (!body) return;
    const details = document.createElement("details");
    details.className = "mcp-parse-validation-details";
    details.dataset.mcpParseValidationDetails = "";
    details.open = errors.length > 0;
    const summary = document.createElement("summary");
    summary.textContent = parseValidationSummary(result);
    const content = document.createElement("div");
    content.className = "mcp-parse-validation-details__body";
    content.innerHTML = body;
    details.append(summary, content);
    line.append(details);
    line.classList.add("has-validation-details");
  }

  function syncParseScoreState(score, result) {
    const line = score?.closest(".mcp-parse-banner__line");
    if (!line) return;
    const required = result?.data?.required_field_count ?? 0;
    const filled = result?.data?.filled_required_field_count
      ?? Math.max(0, required - (result?.data?.missing_required_fields?.length ?? 0));
    const missing = Math.max(0, required - filled);
    const state = !result ? "pending" : (result.status === "error" ? "danger" : "valid");
    line.classList.remove("is-pending", "is-review", "is-valid", "is-danger");
    line.classList.add(`is-${state}`);
    if (result?.status !== "error" && missing > 0) {
      const copy = score.textContent ?? "";
      const gapCopy = `缺口 ${missing} 项`;
      const gapIndex = copy.indexOf(gapCopy);
      if (gapIndex >= 0) {
        const warning = document.createElement("span");
        warning.className = "mcp-parse-banner__inline-warning";
        warning.textContent = gapCopy;
        score.replaceChildren(
          document.createTextNode(copy.slice(0, gapIndex)),
          warning,
          document.createTextNode(copy.slice(gapIndex + gapCopy.length)),
        );
      }
    }
  }

  function syncApplyState(state, button) {
    if (!button) return;
    const requiresConfirmation = requiresExplicitConfirmation(state.current);
    const awaitingModelStructureUpload = state.current?.modelStructureMode === "upload"
      && (state.current?.modelStructurePaths?.length ?? 0) > 0
      && state.current?.modelStructureUploadStatus !== "ready";
    const valid = Boolean(state.current)
      && state.current?.result?.status !== "error"
      && state.current?.supplementsValid !== false
      && state.current?.completionValidation === "valid"
      && !awaitingModelStructureUpload;
    const normalized = state.current ? materializedConfig(state.current) : null;
    const canApply = valid && Object.keys(toPagePartial(normalized ?? {})).length > 0;
    button.disabled = !canApply || (requiresConfirmation && state.current?.planConfirmed !== true);
    const confirmButton = confirmApplyButtonFor(button);
    if (confirmButton) {
      confirmButton.hidden = !requiresConfirmation || state.current?.planConfirmed === true;
      confirmButton.disabled = !canApply;
      confirmButton.textContent = "核对风险并应用";
    }
    syncDirectImportState(state, button);
  }

  function renderCompletionLoading(pane, applyButton, message = "MCP 正在计算补齐方案…") {
    if (!pane) return;
    pane.hidden = false;
    pane.setAttribute("aria-busy", "true");
    pane.parentElement?.classList.add("has-missing-inputs");
    setParseBannerMode(pane, true);
    const title = pane.querySelector("[data-mcp-completion-title]");
    if (title) title.textContent = "MCP缺口配置推荐补齐方案";
    pane.querySelector(".mcp-completion-plans")?.replaceChildren();
    pane.querySelector(".mcp-missing-pane__fields")?.replaceChildren();
    setParseBannerLine(completionStatusForPane(pane), "pending", message);
    setParseBannerLine(capacityStatusForPane(pane), "pending", "正在估算理论显存…");
    if (applyButton) {
      applyButton.disabled = true;
      const confirmButton = confirmApplyButtonFor(applyButton);
      if (confirmButton) {
        confirmButton.hidden = true;
        confirmButton.disabled = true;
      }
      const directButton = directImportButtonFor(applyButton);
      if (directButton) {
        directButton.hidden = true;
        directButton.disabled = true;
      }
    }
  }

  function selectedCompletionPlan(current) {
    const plans = current?.result?.data?.completion?.plans ?? [];
    return plans.find((plan) => plan.id === current.selectedPlanId)
      ?? plans.find((plan) => plan.recommended)
      ?? plans[0]
      ?? null;
  }

  function capacityAssessmentFromResult(result) {
    const stages = result?.data?.stages ?? [];
    if (result?.status !== "estimated" || result.data?.valid !== true || !stages.length) {
      return {
        status: "unavailable",
        confidence: "theoretical",
        launch_feasible: false,
        recommendation_eligible: false,
        level: "unavailable",
      };
    }
    const bottleneck = stages.find((stage) => stage.stage === result.data.bottleneck_stage)
      ?? stages.reduce((largest, current) => current.ratio > largest.ratio ? current : largest);
    return {
      status: "estimated",
      confidence: result.confidence,
      launch_feasible: bottleneck.ratio <= 1,
      recommendation_eligible: bottleneck.ratio <= result.data.thresholds.tight,
      level: bottleneck.level,
      bottleneck_stage: bottleneck.stage,
      bottleneck_ratio: Number(bottleneck.ratio),
      estimated_gib: Number(bottleneck.total_gib),
      capacity_gib: Number(bottleneck.capacity_gib),
      thresholds: { ...result.data.thresholds },
    };
  }

  function currentCapacityAssessment(current) {
    return current?.capacityAssessment
      ?? selectedCompletionPlan(current)?.capacity_assessment
      ?? null;
  }

  function requiresExplicitConfirmation(current) {
    const plan = selectedCompletionPlan(current);
    const capacity = currentCapacityAssessment(current);
    return plan?.confidence === "requires-confirmation"
      || capacity?.recommendation_eligible !== true;
  }

  function capacityPercent(capacity) {
    return Number.isFinite(capacity?.bottleneck_ratio)
      ? `${(capacity.bottleneck_ratio * 100).toFixed(1)}%`
      : "无法估算";
  }

  function capacityStatusCopy(capacity) {
    if (!capacity || capacity.status !== "estimated") {
      return "理论容量尚未完成，当前候选不能作为可启动推荐。";
    }
    const detail = `理论瓶颈 Stage ${capacity.bottleneck_stage}：${capacityPercent(capacity)}`
      + `（${capacity.estimated_gib.toFixed(1)} / ${capacity.capacity_gib} GiB）`;
    if (!capacity.launch_feasible) return `${detail}，预计 OOM。`;
    if (!capacity.recommendation_eligible) return `${detail}，已超过 80% 保守推荐线。`;
    return `${detail}，处于保守推荐范围内。`;
  }

  function capacityReviewCopy(capacity, subject = "原配置与补填项合并后的完整配置") {
    if (!capacity || capacity.status !== "estimated") {
      return `${subject}，理论显存暂不可判断，请核对风险。`;
    }
    if (!capacity.launch_feasible) {
      return `${subject}，理论显存预计超限（${capacityPercent(capacity)}），请核对风险。`;
    }
    return `${subject}，理论显存占用偏高（${capacityPercent(capacity)}），请核对风险。`;
  }

  function capacityBannerCopy(capacity, subject = "原配置与补填项合并后的完整配置") {
    if (capacity?.recommendation_eligible !== true) return capacityReviewCopy(capacity, subject);
    return `${subject}，理论显存占用处于保守推荐范围内（${capacityPercent(capacity)}）。`;
  }

  function appendCapacityBadge(parent, capacity) {
    if (capacity?.status !== "estimated" || capacity.recommendation_eligible === true) return;
    const badge = document.createElement("em");
    badge.className = `mcp-completion-plan__capacity is-${capacity.level}`;
    badge.textContent = `HBM ${capacityPercent(capacity)}`;
    badge.title = capacityStatusCopy(capacity);
    parent.append(badge);
  }

  function syncSelectedCapacityBadge(current, pane) {
    const heading = pane?.querySelector(
      ".mcp-completion-plan__card.is-selected > .mcp-completion-plan__card-heading",
    );
    if (!heading) return;
    for (const child of [...heading.children]) {
      if (child.classList.contains("mcp-completion-plan__capacity")) child.remove();
    }
    appendCapacityBadge(heading, currentCapacityAssessment(current));
  }

  function completionPlanLabel(plan) {
    return String(plan?.label ?? "MCP 处理方案")
      .replace(/\s*[（(](?:推荐|需确认)[）)]\s*/g, "")
      .trim();
  }

  function isModelStructurePath(path) {
    return String(path).startsWith("model.");
  }

  function fieldList(paths) {
    return paths.map((path) => `${labelForPath(path)}（${path}）`).join("、");
  }

  function inlineValue(value) {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      return JSON.stringify(value);
    }
    return String(value);
  }

  function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function confirmationCopy(preferred, missingModelPaths, adjustedPaths, {
    modelStructureMode = "prefill",
    uploadedName = "",
    capacity = null,
  } = {}) {
    const parts = [];

    if (missingModelPaths.length) {
      const missingCopy = "源文件缺少模型结构参数。";
      if (modelStructureMode === "upload") {
        parts.push(missingCopy + (uploadedName
          ? `已从 ${uploadedName} 读取这些模型结构字段。`
          : "请在“上传模型结构”页签上传包含这些字段的配置文件。"));
      } else {
        parts.push(missingCopy
          + "本栏已为缺失项提供可编辑候选值；候选值仅用于补齐 MCP 规则检查与理论容量估算所需输入，请按实际模型结构确认。");
      }
    }
    if (adjustedPaths.length) {
      parts.push(`以下候选值已与源文件显式值或初始推导值不同，需要额外确认：${fieldList(adjustedPaths)}。`);
    }
    if (!missingModelPaths.length && !adjustedPaths.length) {
      parts.push("此方案包含需要人工确认的预填或修复值，具体字段和原因已列在本栏。");
    }
    if (capacity?.recommendation_eligible !== true) {
      parts.push(capacityReviewCopy(capacity));
    }
    parts.push("确认并应用后，本栏当前值会补入配置。");
    return parts.join("");
  }

  function syncCompletionConfirmation(current, pane) {
    const confirmation = pane?.querySelector(".mcp-completion-plan__confirmation");
    if (!confirmation || !current) return;
    const required = requiresExplicitConfirmation(current);
    confirmation.hidden = !required;
    const checkbox = confirmation.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = current.planConfirmed === true;
    const copy = confirmation.querySelector("span");
    if (copy) {
      copy.textContent = confirmationCopy(
        selectedCompletionPlan(current),
        current.modelStructurePaths ?? [],
        current.adjustedCandidatePaths ?? [],
        {
          modelStructureMode: current.modelStructureMode,
          uploadedName: current.modelStructureUploadStatus === "ready"
            ? current.modelStructureUploadedName : "",
          capacity: currentCapacityAssessment(current),
        },
      );
    }
  }

  function syncCompletionCapacityStatus(current, pane) {
    const capacityStatus = capacityStatusForPane(pane);
    if (!capacityStatus || !current) return;
    const capacity = currentCapacityAssessment(current);
    const showCapacityReview = capacity?.recommendation_eligible !== true;
    const state = capacity?.status === "estimated" && capacity.launch_feasible === false
      ? "danger"
      : (showCapacityReview ? "review" : "valid");
    setParseBannerLine(
      capacityStatus,
      state,
      capacityBannerCopy(capacity),
    );
    syncSelectedCapacityBadge(current, pane);
  }

  function syncCompletionStatus(current, pane) {
    const status = completionStatusForPane(pane);
    if (!status || !current) return;
    if (current.completionValidation !== "valid") {
      setParseBannerLine(
        status,
        "review",
        current.completionResult
          ? "完整候选配置尚未通过 MCP 规则检查；可展开查看静态规则问题。"
          : "MCP 已列出缺失项和冲突项；补齐前不会执行高级静态规则与策略建议。",
      );
    } else {
      setParseBannerLine(
        status,
        "valid",
        "原配置与补填项合并后的完整配置，已通过 MCP 规则检查。",
      );
    }
    syncParseValidationDetails(status, current.completionResult);
    syncCompletionCapacityStatus(current, pane);
  }

  function applyModelStructureValues(current, paths, values) {
    for (const path of paths) {
      if (values?.has(path)) current.supplements.set(path, values.get(path));
    }
  }

  async function uploadModelStructure(file, state, pane, applyButton, missingModelPaths) {
    const current = state.current;
    if (!current || !file) return;
    const token = (current.modelStructureUploadToken ?? 0) + 1;
    current.modelStructureUploadToken = token;
    current.modelStructureUploadStatus = "loading";
    current.modelStructureUploadedName = "";
    const uploadStatus = pane.querySelector(".mcp-model-structure-upload__status");
    if (uploadStatus) {
      uploadStatus.className = "mcp-model-structure-upload__status is-loading";
      uploadStatus.textContent = `正在解析 ${file.name}…`;
    }
    syncApplyState(state, applyButton);

    try {
      const content = await file.text();
      const result = await callParseTool({ name: file.name, content });
      if (state.current !== current || current.modelStructureUploadToken !== token) return;
      if (result?.status === "error") throw new Error("文件未能解析为有效配置");
      const normalized = result?.data?.normalized_config ?? {};
      const uploadedValues = new Map();
      const stillMissing = [];
      for (const path of missingModelPaths) {
        const value = getPath(normalized, path);
        if (value === undefined || value === null || value === "") stillMissing.push(path);
        else uploadedValues.set(path, value);
      }
      if (stillMissing.length) {
        throw new Error(`文件仍缺少：${fieldList(stillMissing)}`);
      }
      current.modelStructureUploadedValues = uploadedValues;
      current.modelStructureUploadedName = file.name;
      current.modelStructureUploadedSource = { name: file.name, content };
      current.modelStructureUploadStatus = "ready";
      current.planConfirmed = false;
      current.confirmedPlanId = null;
      applyModelStructureValues(current, missingModelPaths, uploadedValues);
      missingModelPaths.forEach((path) => current.userEditedPaths.add(path));
      if (uploadStatus) {
        uploadStatus.className = "mcp-model-structure-upload__status is-ready";
        uploadStatus.textContent = `已读取 ${file.name}，${missingModelPaths.length} 个模型结构字段已就绪。`;
      }
      const confirmationText = pane.querySelector(".mcp-completion-plan__confirmation > span");
      if (confirmationText) {
        confirmationText.textContent = confirmationCopy(
          selectedCompletionPlan(current),
          missingModelPaths,
          current.adjustedCandidatePaths ?? [],
          {
            modelStructureMode: "upload",
            uploadedName: file.name,
            capacity: currentCapacityAssessment(current),
          },
        );
      }
      await validateCompletion(state, pane, applyButton);
    } catch (error) {
      if (state.current !== current || current.modelStructureUploadToken !== token) return;
      current.modelStructureUploadStatus = "invalid";
      current.modelStructureUploadedName = "";
      current.modelStructureUploadedValues = null;
      current.modelStructureUploadedSource = null;
      if (uploadStatus) {
        uploadStatus.className = "mcp-model-structure-upload__status is-invalid";
        uploadStatus.textContent = `无法使用该文件：${error instanceof Error ? error.message : String(error)}`;
      }
      syncApplyState(state, applyButton);
    }
  }

  function renderModelStructureChooser(
    state,
    pane,
    applyButton,
    preferred,
    missingModelPaths,
    adjustedCandidatePaths,
  ) {
    const current = state.current;
    if (!current || !missingModelPaths.length) return;
    if (pane.id === "mcpImportMissingPane" && document.getElementById("mcpImportModelText")) return;
    const fields = pane.querySelector(".mcp-missing-pane__fields");
    if (!fields) return;

    const chooser = document.createElement("section");
    chooser.className = "mcp-model-structure-source";
    chooser.setAttribute("aria-label", "模型结构来源");
    const tabs = document.createElement("div");
    tabs.className = "mcp-model-structure-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "模型结构补齐方式");
    const prefillTab = document.createElement("button");
    prefillTab.type = "button";
    prefillTab.className = "mcp-model-structure-tabs__tab";
    prefillTab.dataset.modelStructureMode = "prefill";
    prefillTab.setAttribute("role", "tab");
    prefillTab.textContent = "预填模型结构";
    const uploadTab = document.createElement("button");
    uploadTab.type = "button";
    uploadTab.className = "mcp-model-structure-tabs__tab";
    uploadTab.dataset.modelStructureMode = "upload";
    uploadTab.setAttribute("role", "tab");
    uploadTab.textContent = "上传模型结构";
    tabs.append(prefillTab, uploadTab);

    const uploadPanel = document.createElement("div");
    uploadPanel.className = "mcp-model-structure-upload";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "mcp-model-structure-upload__input";
    fileInput.accept = ".json,.yaml,.yml,.sh,application/json,text/yaml,text/x-shellscript";
    fileInput.hidden = true;
    const uploadButton = document.createElement("button");
    uploadButton.type = "button";
    uploadButton.className = "btn btn-sm btn-ghost mcp-model-structure-import";
    uploadButton.title = "上传包含模型结构字段的 config.json、YAML 或 Shell 配置";
    const uploadIcon = document.createElement("span");
    uploadIcon.className = "mcp-model-structure-import__icon";
    uploadIcon.setAttribute("aria-hidden", "true");
    uploadIcon.textContent = "+";
    const uploadCopy = document.createElement("span");
    uploadCopy.className = "mcp-model-structure-import__copy";
    const uploadTitle = document.createElement("strong");
    uploadTitle.textContent = "上传模型结构文件";
    const uploadFormats = document.createElement("span");
    uploadFormats.append("支持 ");
    const uploadCode = document.createElement("code");
    uploadCode.textContent = "config.json / YAML / Shell";
    uploadFormats.append(uploadCode);
    uploadCopy.append(uploadTitle, uploadFormats);
    uploadButton.append(uploadIcon, uploadCopy);
    const uploadStatus = document.createElement("p");
    uploadStatus.className = "mcp-model-structure-upload__status";
    uploadPanel.append(fileInput, uploadButton, uploadStatus);
    chooser.append(tabs, uploadPanel);
    fields.prepend(chooser);

    const syncPresentation = ({ validate = false } = {}) => {
      const mode = current.modelStructureMode === "upload" ? "upload" : "prefill";
      for (const tab of [prefillTab, uploadTab]) {
        const selected = tab.dataset.modelStructureMode === mode;
        tab.classList.toggle("is-selected", selected);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      uploadPanel.hidden = mode !== "upload";
      pane.querySelectorAll(".mcp-missing-field.is-model-structure").forEach((row) => {
        row.hidden = mode === "upload";
      });
      const values = mode === "upload"
        ? current.modelStructureUploadedValues
        : current.modelStructurePrefillValues;
      applyModelStructureValues(current, missingModelPaths, values);
      uploadStatus.className = "mcp-model-structure-upload__status";
      if (mode === "upload") {
        if (current.modelStructureUploadStatus === "ready") {
          uploadStatus.classList.add("is-ready");
          uploadStatus.textContent = `已读取 ${current.modelStructureUploadedName}，${missingModelPaths.length} 个模型结构字段已就绪。`;
        } else if (current.modelStructureUploadStatus === "invalid") {
          uploadStatus.classList.add("is-invalid");
          uploadStatus.textContent = "上次上传未提供完整模型结构，请重新上传；完成前不能应用。";
        } else {
          uploadStatus.textContent = "请上传包含全部缺失模型结构字段的配置文件；完成前不能应用。";
        }
      }
      const confirmationText = pane.querySelector(".mcp-completion-plan__confirmation > span");
      if (confirmationText) {
        confirmationText.textContent = confirmationCopy(
          preferred,
          missingModelPaths,
          adjustedCandidatePaths,
          {
            modelStructureMode: mode,
            uploadedName: mode === "upload" && current.modelStructureUploadStatus === "ready"
              ? current.modelStructureUploadedName : "",
            capacity: currentCapacityAssessment(current),
          },
        );
      }
      if (validate && (mode === "prefill" || current.modelStructureUploadStatus === "ready")) {
        validateCompletion(state, pane, applyButton);
      } else {
        syncApplyState(state, applyButton);
      }
    };

    for (const tab of [prefillTab, uploadTab]) {
      tab.addEventListener("click", () => {
        const nextMode = tab.dataset.modelStructureMode;
        if (current.modelStructureMode === nextMode) return;
        if (nextMode === "prefill" && current.modelStructureUploadStatus === "loading") {
          current.modelStructureUploadToken = (current.modelStructureUploadToken ?? 0) + 1;
          current.modelStructureUploadStatus = "idle";
        }
        current.modelStructureMode = nextMode;
        current.planConfirmed = false;
        current.confirmedPlanId = null;
        syncPresentation({ validate: true });
      });
    }
    uploadButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) uploadModelStructure(file, state, pane, applyButton, missingModelPaths);
      fileInput.value = "";
    });
    syncPresentation();
  }

  async function validateCompletion(state, pane, applyButton) {
    if (!state.current) return;
    const current = state.current;
    const token = (current.completionToken ?? 0) + 1;
    current.completionToken = token;
    current.completionValidation = "pending";
    pane.setAttribute("aria-busy", "true");
    const status = completionStatusForPane(pane);
    const capacityStatus = capacityStatusForPane(pane);
    setParseBannerLine(status, "pending", "正在检查完整配置…");
    setParseBannerLine(capacityStatus, "pending", "正在估算理论显存…");
    syncApplyState(state, applyButton);
    try {
      const config = materializedConfig(current);
      const [result, capacityResult] = await Promise.all([
        callValidateTool(config),
        callCapacityTool(config),
      ]);
      if (state.current !== current || current.completionToken !== token) return;
      const valid = result.status === "valid" && !(result.errors ?? []).length;
      current.completionValidation = valid ? "valid" : "invalid";
      current.completionResult = result;
      const previousCapacity = currentCapacityAssessment(current);
      current.capacityAssessment = capacityAssessmentFromResult(capacityResult);
      if (current.capacityAssessment.recommendation_eligible !== true
        && previousCapacity?.recommendation_eligible === true) {
        current.planConfirmed = false;
        current.confirmedPlanId = null;
      }
      if (!requiresExplicitConfirmation(current)) current.planConfirmed = true;
      if (!valid && status) {
        setParseBannerLine(
          status,
          "review",
          `当前填写值仍需调整：${(result.errors ?? []).map((item) => item.message).join("；")}`,
        );
        syncParseValidationDetails(status, result);
        syncCompletionCapacityStatus(current, pane);
      } else syncCompletionStatus(current, pane);
      syncCompletionConfirmation(current, pane);
    } catch (error) {
      if (state.current !== current || current.completionToken !== token) return;
      current.completionValidation = "invalid";
      current.completionResult = null;
      if (status) {
        setParseBannerLine(
          status,
          "review",
          `暂时无法完成复验，请保留当前填写项后重试：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      setParseBannerLine(
        capacityStatus,
        "danger",
        "原配置与补填项合并后的完整配置，理论显存暂不可判断，请核对风险。",
      );
    }
    if (state.current === current && current.completionToken === token) {
      pane.removeAttribute("aria-busy");
    }
    syncApplyState(state, applyButton);
  }

  function renderMissingInputs(result, state, pane, applyButton) {
    if (!pane) return;
    pane.removeAttribute("aria-busy");
    const missingPaths = result?.status === "error" ? [] : (result?.data?.missing_required_fields ?? []);
    const plans = result?.data?.completion?.plans ?? [];
    const preferred = state.current
      ? (plans.find((plan) => plan.id === state.current.selectedPlanId)
        ?? plans.find((plan) => plan.recommended)
        ?? plans[0])
      : null;
    const preserveRenderedState = state.current?.renderedPlanId != null
      && state.current.renderedPlanId === preferred?.id;
    const preservedSupplements = preserveRenderedState && state.current?.supplements instanceof Map
      ? new Map(state.current.supplements)
      : null;
    const missingModelPaths = missingPaths.filter(isModelStructurePath);
    const missingModelPathSet = new Set(missingModelPaths);
    const sourceValueByPath = new Map((result?.data?.mapped_fields ?? [])
      .filter((item) => ["explicit", "derived"].includes(item.mapping_kind))
      .map((item) => [item.target_path, item.value]));
    const adjustedCandidatePaths = [...new Set((preferred?.values ?? [])
      .filter((item) => item.confidence === "requires-confirmation"
        && sourceValueByPath.has(item.path)
        && !sameValue(sourceValueByPath.get(item.path), item.value))
      .map((item) => item.path))];
    const adjustedCandidatePathSet = new Set(adjustedCandidatePaths);
    const paths = [...new Set([
      ...missingModelPaths,
      ...missingPaths,
      ...(preferred?.values ?? []).map((item) => item.path),
    ])];
    const showPane = paths.length > 0 || plans.length > 1;
    pane.hidden = !showPane;
    pane.parentElement?.classList.toggle("has-missing-inputs", showPane);
    setParseBannerMode(pane, showPane);
    const plansHost = pane.querySelector(".mcp-completion-plans");
    plansHost.replaceChildren();
    pane.querySelector(":scope > .mcp-completion-plan__confirmation")?.remove();
    const fields = pane.querySelector(".mcp-missing-pane__fields");
    fields.replaceChildren();
    const title = pane.querySelector("[data-mcp-completion-title]");
    if (title) title.textContent = `MCP缺口（${paths.length}）配置推荐补齐方案`;
    if (!state.current) {
      setParseBannerLine(completionStatusForPane(pane), "pending", "等待 MCP 规则检查…");
      setParseBannerLine(capacityStatusForPane(pane), "pending", "等待理论显存估算…");
      syncApplyState(state, applyButton);
      return;
    }
    state.current.selectedPlanId = preferred?.id ?? null;
    state.current.renderedPlanId = preferred?.id ?? null;
    state.current.userEditedPaths ??= new Set();
    state.current.modelStructureMode ??= "prefill";
    state.current.modelStructurePaths = [...missingModelPaths];
    state.current.adjustedCandidatePaths = [...adjustedCandidatePaths];
    if (!preserveRenderedState) {
      state.current.capacityAssessment = preferred?.capacity_assessment ?? null;
    }
    const requiresConfirmation = requiresExplicitConfirmation(state.current);
    if (state.current.confirmedPlanId !== preferred?.id) {
      state.current.planConfirmed = !requiresConfirmation;
    }
    if (plans.length > 1) {
      const group = document.createElement("div");
      group.className = "mcp-completion-plan";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "MCP 缺口与冲突处理方案");
      const cards = document.createElement("div");
      cards.className = "mcp-completion-plan__cards";
      for (const plan of plans) {
        const card = document.createElement("button");
        const selected = plan.id === state.current.selectedPlanId;
        card.type = "button";
        card.className = `mcp-completion-plan__card${selected ? " is-selected" : ""}`;
        card.dataset.planId = plan.id;
        card.setAttribute("aria-pressed", String(selected));
        const heading = document.createElement("span");
        heading.className = "mcp-completion-plan__card-heading";
        const name = document.createElement("strong");
        name.textContent = completionPlanLabel(plan);
        heading.append(name);
        if (plan.recommended) {
          const recommended = document.createElement("em");
          recommended.className = "mcp-completion-plan__recommended";
          recommended.textContent = "推荐";
          heading.append(recommended);
        }
        appendCapacityBadge(heading, plan.capacity_assessment);
        const description = document.createElement("span");
        description.textContent = plan.summary ?? "";
        card.append(heading, description);
        card.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.current.selectedPlanId = plan.id;
          state.current.confirmedPlanId = null;
          state.current.modelStructureMode = "prefill";
          state.current.modelStructureUploadStatus = "idle";
          state.current.modelStructureUploadedName = "";
          state.current.modelStructureUploadedValues = null;
          state.current.modelStructureUploadedSource = null;
          renderMissingInputs(result, state, pane, applyButton);
        });
        cards.append(card);
      }
      group.append(cards);
      plansHost.append(group);
    }
    const confirmation = document.createElement("label");
    confirmation.className = "mcp-completion-plan__confirmation";
    confirmation.hidden = !requiresConfirmation;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.current.planConfirmed === true;
    const text = document.createElement("span");
    text.textContent = confirmationCopy(preferred, missingModelPaths, adjustedCandidatePaths, {
      modelStructureMode: state.current.modelStructureMode,
      uploadedName: state.current.modelStructureUploadStatus === "ready"
        ? state.current.modelStructureUploadedName : "",
      capacity: currentCapacityAssessment(state.current),
    });
    checkbox.addEventListener("change", () => {
      state.current.planConfirmed = checkbox.checked;
      state.current.confirmedPlanId = checkbox.checked ? preferred.id : null;
      syncApplyState(state, applyButton);
    });
    confirmation.append(checkbox, text);
    /* 方案卡与补齐字段共用第三栏滚动区；确认条单独作为 pane 的直接子项，
       到达滚动区顶部后才能在后续全部字段滚动期间持续吸附。 */
    plansHost.insertAdjacentElement("afterend", confirmation);
    state.current.supplements = new Map();
    state.current.supplementsValid = true;
    const prefillModelValues = new Map();
    for (const path of paths) {
      const value = preservedSupplements?.has(path)
        ? preservedSupplements.get(path)
        : (getPath(preferred?.proposed_config, path) ?? defaultValueFor(path));
      state.current.supplements.set(path, value);
      if (missingModelPathSet.has(path)) prefillModelValues.set(path, value);
      const row = document.createElement("div");
      const missingModelStructure = missingModelPathSet.has(path);
      const adjustedCandidate = adjustedCandidatePathSet.has(path);
      row.className = "cro-stepper mcp-missing-field"
        + (missingModelStructure ? " is-model-structure" : "")
        + (adjustedCandidate ? " is-adjusted-candidate" : "");
      row.dataset.missingKind = missingModelStructure
        ? "model-structure" : (adjustedCandidate ? "candidate-change" : "config");
      const name = document.createElement("label");
      name.className = "cro-stepper__label mcp-missing-field__label";
      const evidence = preferred?.values?.find((item) => item.path === path);
      const reasonParts = [];
      if (adjustedCandidate) {
        reasonParts.push(`原值：${inlineValue(sourceValueByPath.get(path))}`);
      }
      if (evidence) reasonParts.push(`${evidence.reason} · ${evidence.confidence}`);
      name.innerHTML = `<span class="cro-stepper__label-text"><b>${escapeHtml(labelForPath(path))}</b>`
        + `<code>${escapeHtml(path)}</code>`
        + (adjustedCandidate
          ? `<small class="mcp-missing-field__kind">候选值已调整 · 需确认</small>` : "")
        + (reasonParts.length
          ? `<small class="mcp-missing-field__reason">${escapeHtml(reasonParts.join("；"))}</small>` : "")
        + `</span>`;
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
        state.current.planConfirmed = false;
        state.current.confirmedPlanId = null;
        const next = controlValue(control);
        const invalid = next === undefined || (control.type === "number" && !Number.isFinite(next));
        control.setAttribute("aria-invalid", String(invalid));
        if (invalid) state.current.supplements.delete(path);
        else {
          state.current.supplements.set(path, next);
          state.current.userEditedPaths.add(path);
          if (missingModelStructure && state.current.modelStructureMode === "prefill") {
            state.current.modelStructurePrefillValues?.set(path, next);
          }
        }
        state.current.supplementsValid = !pane.querySelector('[aria-invalid="true"]');
        validateCompletion(state, pane, applyButton);
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
    state.current.modelStructurePrefillValues = prefillModelValues;
    if (state.current.modelStructureMode === "upload") {
      applyModelStructureValues(
        state.current,
        missingModelPaths,
        state.current.modelStructureUploadedValues,
      );
    }
    renderModelStructureChooser(
      state,
      pane,
      applyButton,
      preferred,
      missingModelPaths,
      adjustedCandidatePaths,
    );
    if (!preserveRenderedState) {
      state.current.completionValidation = preferred?.validation?.status === "valid" ? "valid" : "invalid";
      state.current.completionResult = preferred?.validation ?? null;
    }
    syncCompletionStatus(state.current, pane);
    syncCompletionConfirmation(state.current, pane);
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

  function getPath(target, path) {
    return String(path).split(".").reduce((current, key) => current?.[key], target);
  }

  function materializedConfig(current) {
    const selected = selectedCompletionPlan(current);
    const normalized = structuredClone(
      selected?.proposed_config ?? current?.result?.data?.normalized_config ?? {},
    );
    for (const [path, value] of current?.supplements ?? []) setPath(normalized, path, value);
    return normalized;
  }

  function resetSampleCompletion() {
    presetPreviewToken += 1;
    sample.token += 1;
    sample.current = null;
    sample.lastFile = null;
    sample.lastCard = null;
    if (lastParseKind === "sample") lastParseKind = null;
    const pane = document.getElementById("mcpPreviewMissingPane");
    const applyButton = document.getElementById("croPreviewApply");
    resetPreviewApplyPresentation();
    renderMissingInputs(null, sample, pane, applyButton);
  }

  async function validateConfigPresetPreview(detail) {
    const pane = document.getElementById("mcpPreviewMissingPane");
    const status = completionStatusForPane(pane);
    const capacityStatus = capacityStatusForPane(pane);
    const token = ++presetPreviewToken;
    if (!detail?.config || !status || !capacityStatus) return;
    setParseBannerMode(pane, false);
    setParseBannerLine(status, "pending", "正在检查内置预设…");
    setParseBannerLine(capacityStatus, "pending", "正在估算理论显存…");
    try {
      const config = pageConfigToTrainingConfig(
        detail.config,
        window.CroTopology,
        pipelineSettingsForPreset(detail.presetId) ?? {},
      );
      const [result, capacityResult] = await Promise.all([
        callValidateTool(config),
        callCapacityTool(config),
      ]);
      if (token !== presetPreviewToken) return;
      const valid = result.status === "valid" && !(result.errors ?? []).length;
      setParseBannerLine(
        status,
        valid ? "valid" : "review",
        valid
          ? "当前内置预设已通过 MCP 规则检查"
          : `当前内置预设仍需调整：${(result.errors ?? []).map((item) => item.message).join("；")}`,
      );
      syncParseValidationDetails(status, result);
      const capacity = capacityAssessmentFromResult(capacityResult);
      const capacityState = capacity?.status === "estimated" && capacity.launch_feasible === false
        ? "danger"
        : (capacity?.recommendation_eligible === true ? "valid" : "review");
      setParseBannerLine(
        capacityStatus,
        capacityState,
        capacityBannerCopy(capacity, "当前内置预设"),
      );
    } catch (error) {
      if (token !== presetPreviewToken) return;
      setParseBannerLine(
        status,
        "danger",
        `当前内置预设检查失败：${error instanceof Error ? error.message : String(error)}`,
      );
      setParseBannerLine(capacityStatus, "danger", "当前内置预设的理论显存暂不可判断，请核对风险");
    }
  }

  function appliedImportSource(current) {
    const name = current?.source?.name ?? current?.file ?? "已导入配置";
    return { name, label: name };
  }

  function rememberAppliedImport(current, adjusted) {
    if (!current) return;
    appliedImport.current = current;
    appliedImport.signature = currentPageConfigSignature();
    appliedImport.adjusted = [...(adjusted ?? [])];
    appliedImport.source = appliedImportSource(current);
    window.croImport?.selectAppliedImport?.(appliedImport.source);
  }

  function resetPreviewApplyPresentation() {
    const pane = document.getElementById("mcpPreviewMissingPane");
    pane?.classList.remove("is-applied-snapshot");
    pane?.removeAttribute("data-applied-snapshot");
    const applyButton = document.getElementById("croPreviewApply");
    if (applyButton) applyButton.textContent = "应用";
  }

  function renderAppliedImportPreview(event) {
    const current = appliedImport.current;
    if (!current || appliedImport.signature !== currentPageConfigSignature()) return false;
    event.preventDefault();
    const report = document.getElementById("croPreviewReport");
    const applyButton = document.getElementById("croPreviewApply");
    const score = document.getElementById("croPreviewName");
    const sourceLine = document.getElementById("croPreviewSource");
    const pane = document.getElementById("mcpPreviewMissingPane");
    if (!report || !applyButton || !score || !sourceLine || !pane) return true;

    score.textContent = formatFillCoverageScore(current.result);
    syncParseScoreState(score, current.result);
    score.title = FILL_COVERAGE_HINT;
    sourceLine.innerHTML = `<b>来源</b> ${escapeHtml(appliedImport.source?.label ?? "已导入配置")}`
      + "　·　已应用的导入快照；内容与补齐结果保持只读";
    renderParseReportWithoutLede(report, current.result, { adjusted: appliedImport.adjusted });
    renderMissingInputs(current.result, appliedImport, pane, applyButton);
    report.scrollTop = 0;

    pane.classList.add("is-applied-snapshot");
    pane.dataset.appliedSnapshot = "true";
    pane.querySelectorAll("input, select, button").forEach((control) => { control.disabled = true; });
    const confirmation = pane.querySelector(".mcp-completion-plan__confirmation");
    if (confirmation) confirmation.hidden = true;
    applyButton.textContent = "已应用";
    applyButton.disabled = true;
    const confirmButton = confirmApplyButtonFor(applyButton);
    if (confirmButton) confirmButton.hidden = true;
    const directImportButton = directImportButtonFor(applyButton);
    if (directImportButton) directImportButton.hidden = true;
    return true;
  }

  function clearIncompleteImportMarks() {
    document.querySelectorAll(".is-mcp-import-missing").forEach((element) => {
      element.classList.remove("is-mcp-import-missing");
      element.removeAttribute("data-mcp-missing-paths");
      element.querySelector(":scope > .mcp-import-missing-badge")?.remove();
    });
  }

  function missingFieldHost(path) {
    const pageField = pageFieldForPath(path);
    if (pageField) {
      return [...document.querySelectorAll(".cro-stepper[data-field]")]
        .find((element) => element.dataset.field === pageField) ?? null;
    }
    if (path.startsWith("model.")) {
      return document.getElementById("croModelSelect")?.closest(".cro-stepper") ?? null;
    }
    if (path.startsWith("cluster.")) {
      return document.getElementById("croCardSelect")?.closest(".cro-stepper") ?? null;
    }
    return null;
  }

  function markIncompleteImportFields(missingFields) {
    clearIncompleteImportMarks();
    const grouped = new Map();
    for (const path of missingFields) {
      const host = missingFieldHost(path);
      if (!host) continue;
      const paths = grouped.get(host) ?? [];
      paths.push(path);
      grouped.set(host, paths);
    }
    for (const [host, paths] of grouped) {
      host.classList.add("is-mcp-import-missing");
      host.dataset.mcpMissingPaths = paths.join(",");
      const badge = document.createElement("span");
      badge.className = "mcp-import-missing-badge";
      badge.textContent = paths.length === 1 ? "未提供" : `缺少${paths.length}项`;
      badge.title = paths.map((path) => `${labelForPath(path)}（${path}）`).join("\n");
      host.append(badge);
    }
  }

  function errorHtml(error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<p class="cro-import__empty" data-mcp-parse-report="error">MCP 解析失败：${escapeHtml(message)}</p>`;
  }

  async function parseImported(source) {
    clearTimeout(liveParseTimer);
    const ui = importUi();
    const token = ++imported.token;
    lastParseKind = "imported";
    imported.lastSource = source;
    imported.current = null;
    setImportValidationStarted(true);
    ui.apply.disabled = true;
    ui.score.textContent = "解析中…";
    syncParseScoreState(ui.score, null);
    ui.report.innerHTML = `<p class="cro-import__empty">正在调用 <code>parse_training_config</code>，不启动训练…</p>`;
    renderCompletionLoading(
      document.getElementById("mcpImportMissingPane"),
      ui.apply,
      "计算中… MCP 正在解析当前代码并求解完整候选。",
    );
    syncClearButton();
    try {
      const result = await callParseTool(source);
      if (token !== imported.token) return;
      const partial = toPagePartial(result.data?.normalized_config);
      imported.current = { source, result, partial };
      ui.score.textContent = formatFillCoverageScore(result);
      syncParseScoreState(ui.score, result);
      renderParseReportWithoutLede(ui.report, result);
      renderMissingInputs(result, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
      ui.report.scrollTop = 0;
    } catch (error) {
      if (token !== imported.token) return;
      ui.score.textContent = "— · MCP 调用失败";
      syncParseScoreState(ui.score, { status: "error" });
      ui.report.innerHTML = errorHtml(error);
      renderMissingInputs(null, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
    }
  }

  async function parseSample(file, card) {
    const report = document.getElementById("croPreviewReport");
    const apply = document.getElementById("croPreviewApply");
    const score = document.getElementById("croPreviewName");
    const sourceLine = document.getElementById("croPreviewSource");
    const token = ++sample.token;
    resetPreviewApplyPresentation();
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
    syncParseScoreState(score, null);
    sourceLine.innerHTML = `<b>来源</b> config-test/${escapeHtml(file)} · 由 parse_training_config 解析，不启动训练`;
    report.innerHTML = `<p class="cro-import__empty">正在调用 <code>parse_training_config</code>…</p>`;
    renderCompletionLoading(
      document.getElementById("mcpPreviewMissingPane"),
      apply,
      "计算中… MCP 正在解析预置配置并求解完整候选。",
    );
    if (content === undefined) {
      report.innerHTML = errorHtml(new Error(`单文件 App 中缺少内置样例 ${file}`));
      score.textContent = "— · 样例缺失";
      syncParseScoreState(score, { status: "error" });
      renderMissingInputs(null, sample, document.getElementById("mcpPreviewMissingPane"), apply);
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
      syncParseScoreState(score, result);
      score.title = FILL_COVERAGE_HINT;
      renderParseReportWithoutLede(report, result);
      renderMissingInputs(result, sample, document.getElementById("mcpPreviewMissingPane"), apply);
      report.scrollTop = 0;
    } catch (error) {
      if (token !== sample.token) return;
      score.textContent = "— · MCP 调用失败";
      syncParseScoreState(score, { status: "error" });
      report.innerHTML = errorHtml(error);
      renderMissingInputs(null, sample, document.getElementById("mcpPreviewMissingPane"), apply);
    }
  }

  function applyParsed(current, report, { useCompletion = true } = {}) {
    if (!current || !window.croObserver?.importConfig) return null;
    clearIncompleteImportMarks();
    const sourceNormalizedConfig = current.result?.data?.normalized_config ?? {};
    const normalizedConfig = useCompletion
      ? materializedConfig(current)
      : structuredClone(sourceNormalizedConfig);
    /* “应用”表示用户确认采用第三栏当前补齐结果；只有明确选择“继续导入”时，
       才保留源文件缺口并阻止相关 Tool，避免误把已确认的补值判成未提供。 */
    const missingRequiredFields = useCompletion
      ? [] : [...(current.result?.data?.missing_required_fields ?? [])];
    const toolReadiness = useCompletion
      ? toolReadinessForMissingFields([])
      : (current.result?.data?.tool_readiness
        ?? toolReadinessForMissingFields(missingRequiredFields));
    const partial = toPagePartial(normalizedConfig);
    window.__mcpPipelinePolicy?.prepare?.(normalizedConfig);
    const modelId = normalizedConfig.model?.id;
    if (modelId && window.CroTopology?.MODEL_PRESETS?.[modelId]
      && window.croObserver.config?.model !== modelId) {
      window.croObserver.setModel(modelId);
    }
    const applied = window.croObserver.importConfig(partial);
    const importedCard = CARD_OPTIONS.find(({ value }) => value === normalizedConfig.cluster?.card_model);
    if (importedCard) window.croObserver.set("card", importedCard.id);
    const importedMemory = Number(normalizedConfig.cluster?.card_memory_gib);
    if (Number.isFinite(importedMemory)) {
      window.croObserver.set(
        "customCardMemoryGB",
        importedCard && importedMemory === importedCard.memory ? null : importedMemory,
      );
    }
    const adjusted = diffApplied(partial, applied.after);
    renderParseReportWithoutLede(report, current.result, { adjusted });
    report.scrollTop = 0;
    const suppliedModelSource = current.source?.modelSource
      ?? (current.modelStructureMode === "upload" ? current.modelStructureUploadedSource : null)
      ?? null;
    const manuallyEnteredModel = {};
    for (const path of current.userEditedPaths ?? []) {
      if (!path.startsWith("model.")) continue;
      const value = getPath(normalizedConfig, path);
      if (value !== undefined) manuallyEnteredModel[path.slice("model.".length)] = value;
    }
    const modelSource = suppliedModelSource?.content?.trim()
      ? {
        name: suppliedModelSource.name,
        dialect: inferSourceFormat(suppliedModelSource.name),
        text: suppliedModelSource.content,
      }
      : (Object.keys(manuallyEnteredModel).length
        ? {
          name: "手动填写的模型结构.json",
          dialect: "json",
          text: JSON.stringify(manuallyEnteredModel, null, 2),
        }
        : null);
    document.dispatchEvent(new CustomEvent("cro:source", { detail: {
      name: current.source?.name ?? `config-test/${current.file}`,
      label: current.source?.name ?? current.file,
      dialect: current.result.data?.detected_format === "shell"
        ? "sh" : current.result.data?.detected_format,
      text: current.source?.content ?? current.content,
      marks: sourceMarks(current.result, adjusted),
      modelSource,
    } }));
    document.dispatchEvent(new CustomEvent("mcp:parsed-config-applied", { detail: {
      normalizedConfig,
      supplements: useCompletion ? Object.fromEntries(current.supplements ?? []) : {},
      sourceNormalizedConfig,
      userEditedPaths: useCompletion ? [...(current.userEditedPaths ?? [])] : [],
      sourceKind: current.file ? "sample" : "imported",
      incompleteImport: !useCompletion,
      missingRequiredFields,
      toolReadiness,
    } }));
    if (!useCompletion) markIncompleteImportFields(missingRequiredFields);
    return adjusted;
  }

  function returnToFormAfterApply(adjusted, incompleteMissingFields = []) {
    const left = document.getElementById("cropLeft");
    const formTab = document.querySelector('#cropLeftTabs [data-pane="form"]')
      ?? left?.querySelector('[data-pane="form"]');
    formTab?.click();

    if (left?.classList.contains("is-collapsed")) {
      const toggle = document.querySelector('[aria-label="显示 / 收起配置栏"]');
      if (toggle) toggle.click();
      else {
        left.classList.remove("is-collapsed");
        document.getElementById("croBoard")?.classList.remove("is-left-collapsed");
      }
    }

    const pane = left?.querySelector(".crop-pane--form")
      ?? document.querySelector(".crop-pane--form");
    if (!pane) return;
    clearAppliedStatus();
    document.body.insertAdjacentHTML("beforeend", renderAppliedStatus(adjusted));
    if (incompleteMissingFields.length) {
      const status = document.getElementById("mcpImportAppliedStatus");
      status?.classList.add("is-adjusted");
      const title = status?.querySelector("strong");
      const message = status?.querySelector("p");
      if (title) title.textContent = "已直接导入不完整配置";
      if (message) {
        message.textContent = `仍缺少 ${incompleteMissingFields.length} 项；受影响的 MCP 功能已停止，且不会继承上一份配置。`;
      }
    }
    appliedStatusSignature = currentPageConfigSignature();
    const scrollHost = pane.closest(".crop-left__body");
    if (scrollHost) scrollHost.scrollTop = 0;
    appliedStatusTimer = window.setTimeout(clearAppliedStatus, APPLIED_STATUS_DURATION_MS);
  }

  function currentPageConfigSignature() {
    const config = window.croObserver?.config ?? {};
    return JSON.stringify(Object.keys(config).sort().map((key) => [key, config[key]]));
  }

  function clearAppliedStatus() {
    window.clearTimeout(appliedStatusTimer);
    appliedStatusTimer = 0;
    document.getElementById("mcpImportAppliedStatus")?.remove();
    appliedStatusSignature = null;
  }

  /* 这张卡只说明“刚刚导入的那份配置”发生了什么。切换预设或继续编辑任意字段后，
     当前表单已不再是那次应用的结果，旧差异必须立即失效，不能冒充当前配置的问题。
     MCP 拓扑完成后也会 refresh 同一份配置，因此按配置快照判断，不能见事件就清。 */
  document.addEventListener("cro:config-change", () => {
    if (window.croObserver?.config?.configPreset) clearIncompleteImportMarks();
    if (appliedStatusSignature !== null
      && appliedStatusSignature !== currentPageConfigSignature()) clearAppliedStatus();
    if (appliedImport.signature !== null
      && appliedImport.signature !== currentPageConfigSignature()) {
      appliedImport.current = null;
      appliedImport.signature = null;
      appliedImport.adjusted = [];
      appliedImport.source = null;
    }
  });

  document.addEventListener("change", (event) => {
    if (!new Set(["croImportFile", "mcpImportModelFile"]).has(event.target?.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const file = event.target.files?.[0];
    if (!file) return;
    const ui = importUi();
    file.text().then((content) => {
      if (event.target.id === "mcpImportModelFile") {
        ui.modelText.value = content;
        ui.modelName.textContent = file.name;
      } else {
        ui.text.value = content;
        ui.name.textContent = file.name;
      }
      syncClearButton();
      if (ui.text.value.trim()) parseImported(importedSourceFromUi());
    }).catch((error) => { ui.report.innerHTML = errorHtml(error); });
  }, true);

  document.addEventListener("cro:config-preview-change", () => {
    resetSampleCompletion();
  });

  document.addEventListener("cro:config-preset-preview-ready", (event) => {
    validateConfigPresetPreview(event.detail);
  });

  document.addEventListener("cro:imported-config-preview-requested", (event) => {
    renderAppliedImportPreview(event);
  });

  /* 应用样例后再次打开配置菜单时，基线选择器会自动预览当前项。单文件 App
     必须继续使用构建时内嵌的文本，不能回退到不存在的 ./config-test/ URL。 */
  document.addEventListener("cro:sample-preview-requested", (event) => {
    const file = event.detail?.file;
    if (!file) return;
    event.preventDefault();
    parseSample(file, event.detail?.card ?? null);
  });

  document.addEventListener("input", (event) => {
    if (!new Set(["croImportText", "mcpImportModelText"]).has(event.target?.id)) return;
    clearTimeout(liveParseTimer);
    imported.token += 1;
    imported.current = null;
    const ui = importUi();
    ui.apply.disabled = true;
    const hasTraining = Boolean(ui.text.value.trim());
    const hasAnyContent = hasTraining || Boolean(ui.modelText.value.trim());
    setImportValidationStarted(hasTraining);
    ui.score.textContent = hasAnyContent ? "等待输入完成…" : "— · 等待解析";
    syncParseScoreState(ui.score, null);
    ui.report.innerHTML = hasTraining
      ? `<p class="cro-import__empty">检测到输入变化，将联动解析训练配置与已有的模型结构内容…</p>`
      : `<p class="cro-import__empty">请先上传或粘贴训练配置；模型结构文件为可选输入。</p>`;
    if (hasTraining) {
      renderCompletionLoading(
        document.getElementById("mcpImportMissingPane"),
        ui.apply,
        "计算中… 等待输入结束后自动调用 MCP。",
      );
      liveParseTimer = window.setTimeout(() => {
        parseImported(importedSourceFromUi());
      }, LIVE_PARSE_DELAY_MS);
    } else {
      renderMissingInputs(null, imported, document.getElementById("mcpImportMissingPane"), ui.apply);
    }
    syncClearButton();
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target;
    const dismissApplied = target?.closest?.("[data-dismiss-mcp-import-applied]");
    if (dismissApplied) {
      clearAppliedStatus();
      return;
    }

    const confirmApply = target?.closest?.(".mcp-confirm-apply");
    if (confirmApply) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const applyButton = document.getElementById(confirmApply.dataset.applyTarget);
      const state = applyButton?.id === "croImportApply" ? imported : sample;
      const plan = selectedCompletionPlan(state.current);
      if (!state.current || !applyButton || !plan || !requiresExplicitConfirmation(state.current)) return;
      const pane = document.getElementById(
        applyButton.id === "croImportApply" ? "mcpImportMissingPane" : "mcpPreviewMissingPane",
      );
      const checkbox = pane?.querySelector('.mcp-completion-plan__confirmation input[type="checkbox"]');
      if (checkbox && !checkbox.checked) checkbox.click();
      else {
        state.current.planConfirmed = true;
        state.current.confirmedPlanId = plan.id;
        syncApplyState(state, applyButton);
      }
      if (state.current?.planConfirmed !== true) return;
      applyButton.click();
      return;
    }

    const directImport = target?.closest?.(".mcp-direct-import");
    if (directImport) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const applyButton = document.getElementById(directImport.dataset.applyTarget);
      const state = applyButton?.id === "croImportApply" ? imported : sample;
      if (state.current && applyButton) openIssueDialog(state, applyButton, directImport);
      return;
    }

    const importApply = target?.closest?.("#croImportApply");
    if (importApply) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const appliedCurrent = imported.current;
      const adjusted = applyParsed(appliedCurrent, importUi().report);
      if (adjusted) {
        rememberAppliedImport(appliedCurrent, adjusted);
        document.getElementById("croImportClose")?.click();
        returnToFormAfterApply(adjusted);
      }
      return;
    }

    const clearButton = target?.closest?.("#croImportClear");
    if (clearButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const ui = importUi();
      ui.text.value = "";
      ui.file.value = "";
      ui.name.textContent = "未选择文件";
      ui.text.dispatchEvent(new Event("input", { bubbles: true }));
      ui.text.focus();
      return;
    }

    const modelClearButton = target?.closest?.("#mcpImportModelClear");
    if (modelClearButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const ui = importUi();
      ui.modelText.value = "";
      ui.modelFile.value = "";
      ui.modelName.textContent = "未选择文件";
      ui.modelText.dispatchEvent(new Event("input", { bubbles: true }));
      ui.modelText.focus();
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
      const appliedSample = sample.current;
      const adjusted = applyParsed(appliedSample, document.getElementById("croPreviewReport"));
      window.croImport?.selectAppliedSample?.(appliedSample.file);
      document.getElementById("croPreviewCancel")?.click();
      sample.current = null;
      if (adjusted) returnToFormAfterApply(adjusted);
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
