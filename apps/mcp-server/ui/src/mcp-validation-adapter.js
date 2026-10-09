import { pageFieldForPath } from "./mcp-parse-adapter.js";

const CARD_FALLBACKS = Object.freeze({
  "910b-32": { model: "昇腾 910", memory: 32, ranksPerNode: 8 },
  "910b-64": { model: "昇腾 910B", memory: 64, ranksPerNode: 8 },
  "950": { model: "昇腾 950PR", memory: 128, ranksPerNode: 8 },
});

const NON_STEPPER_FIELDS = Object.freeze({
  "model.id": "model",
  "model.hidden_size": "model",
  "model.num_attention_heads": "model",
  "model.num_key_value_heads": "model",
  "model.ffn_hidden_size": "model",
  "model.expert_ffn_hidden_size": "model",
  "model.vocab_size": "model",
  "cluster.ranks_per_node": "card",
  "cluster.card_model": "card",
  "cluster.card_memory_gib": "card",
  "parallel.pipeline_layer_mode": "mcpPipelineLayerMode",
  "parallel.num_layer_list": "mcpPipelineLayerMode",
});

export function balancedPipelineLayers(totalLayers, pipelineParallel) {
  const total = positiveInteger(totalLayers);
  const pp = positiveInteger(pipelineParallel);
  const base = Math.floor(total / pp);
  const remainder = total % pp;
  return Array.from({ length: pp }, (_, index) => base + (index < remainder ? 1 : 0));
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function optionalPositiveInteger(target, key, value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) target[key] = number;
}

function optionalNonNegativeInteger(target, key, value) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) target[key] = number;
}

export function pageConfigToTrainingConfig(config, topologyApi, pipelineSettings = {}) {
  if (!config || !topologyApi?.MODEL_PRESETS) {
    throw new Error("原页面配置尚未初始化。");
  }

  const preset = topologyApi.MODEL_PRESETS[config.model];
  if (!preset) throw new Error(`找不到模型预设：${config.model ?? "未选择"}`);
  const topology = typeof topologyApi.derive === "function" ? topologyApi.derive(config) : null;
  const fallbackCard = CARD_FALLBACKS[config.card] ?? CARD_FALLBACKS["910b-64"];
  const card = topology?.card ?? {};
  const dense = Boolean(preset.noMoe);
  const totalRanks = positiveInteger(config.totalRank);
  const ranksPerNode = positiveInteger(
    card.ranksPerNode,
    Number.isInteger(config.node) && config.node > 0
      ? Math.max(1, Math.ceil(totalRanks / config.node))
      : fallbackCard.ranksPerNode,
  );

  const model = {
    id: preset.id ?? config.model,
    total_layers: positiveInteger(config.totalLayer),
    hidden_size: positiveInteger(preset.hidden),
    num_attention_heads: positiveInteger(preset.heads),
    routed_experts: dense ? 0 : Math.max(0, Number(config.routedExpert) || 0),
    top_k: dense ? 0 : Math.max(0, Number(config.topK) || 0),
    shared_experts: dense ? 0 : Math.max(0, Number(config.sharedExpert) || 0),
  };
  optionalPositiveInteger(model, "num_key_value_heads", preset.kvHeads);
  optionalPositiveInteger(model, "ffn_hidden_size", preset.denseIntermediate);
  if (!dense) optionalPositiveInteger(model, "expert_ffn_hidden_size", preset.moeIntermediate);
  optionalPositiveInteger(model, "vocab_size", preset.vocab);
  optionalNonNegativeInteger(model, "first_k_dense_layers", preset.firstKDense);

  const memory = {
    compute_dtype: config.dtype ?? "bf16",
    parameter_dtype: config.paramsDtype ?? "bf16",
    recompute_mode: config.recomputeMode ?? "none",
    shard_mode: config.shardMode ?? "none",
    lora_enabled: Boolean(config.lora),
  };
  optionalNonNegativeInteger(memory, "recompute_layers", config.recomputeLayers);
  optionalPositiveInteger(memory, "lora_rank", config.loraRank);

  const epMode = ["split", "orthogonal", "mf"].includes(config.epMode)
    ? config.epMode
    : (config.moeOrthogonal ? "orthogonal" : "split");
  const dp = positiveInteger(config.dp);
  const microBatchSize = positiveInteger(config.microBatch);
  const microBatchCount = positiveInteger(config.microBatchNum);
  const pp = positiveInteger(config.pp);
  const requestedMode = pipelineSettings.mode;
  const pipelineLayerMode = requestedMode === "uniform" || requestedMode === "dynamic"
    ? requestedMode
    : (model.total_layers % pp === 0 ? "uniform" : "dynamic");
  const importedLayers = pipelineSettings.numLayerList;
  const numLayerList = pipelineLayerMode === "dynamic"
    ? (Array.isArray(importedLayers) && importedLayers.length
      ? importedLayers.map(Number)
      : balancedPipelineLayers(model.total_layers, pp))
    : undefined;
  const framework = epMode === "mf"
    ? "mindformers"
    : (pipelineLayerMode === "dynamic" ? "mindspeed-llm-mcore" : "mindspeed-core");
  const ruleVersion = framework === "mindspeed-llm-mcore"
    ? "master@7826e88"
    : (framework === "mindspeed-core" ? "0.12.1" : "page-baseline");
  const ruleCommit = framework === "mindspeed-llm-mcore"
    ? "7826e883ab40f06dd54f0fa2ce6508d18036843c"
    : (framework === "mindspeed-core" ? "65634689bed75ee9b6df666d526f7f16051a3db5" : "page-form");

  return {
    schema_version: "1.0",
    rule_profile: {
      framework,
      version: ruleVersion,
      source_commit: ruleCommit,
    },
    model,
    parallel: {
      dp,
      pp,
      tp: positiveInteger(config.tp),
      cp: positiveInteger(config.cp),
      ep: positiveInteger(config.ep),
      vpp: positiveInteger(config.vpp),
      pipeline_layer_mode: pipelineLayerMode,
      ...(numLayerList ? { num_layer_list: numLayerList } : {}),
      ep_mode: epMode,
      cp_mode: config.cpMode === "ring" ? "ring" : "ulysses",
      sequence_parallel: Boolean(config.seqParallel),
      vocab_embedding_data_parallel: Boolean(config.vocabEmbDp),
      expert_tensor_parallel: Boolean(config.expertTp),
    },
    cluster: {
      total_ranks: totalRanks,
      ranks_per_node: ranksPerNode,
      card_model: card.label ?? fallbackCard.model,
      card_memory_gib: Number(card.hbmGB) || fallbackCard.memory,
    },
    batch: {
      micro_batch_size: microBatchSize,
      sequence_length: positiveInteger(config.seqLen),
      micro_batch_count: microBatchCount,
      global_batch_size: microBatchSize * dp * microBatchCount,
    },
    memory,
  };
}

export function validationPageField(path) {
  return pageFieldForPath(path) ?? NON_STEPPER_FIELDS[path] ?? null;
}

export function validationMarks(result) {
  const marks = new Map();
  for (const diagnostic of result?.warnings ?? []) {
    for (const path of diagnostic.fields ?? []) {
      const field = validationPageField(path);
      if (field && !marks.has(field)) marks.set(field, "warning");
    }
  }
  for (const diagnostic of result?.errors ?? []) {
    for (const path of diagnostic.fields ?? []) {
      const field = validationPageField(path);
      if (field) marks.set(field, "invalid");
    }
  }
  return marks;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function diagnosticItems(items) {
  return items.map((item) => `<li class="mcp-validation__diagnostic">`
    + `<span>${escapeHtml(item.message)}</span>`
    + (item.formula
      ? `<code class="mcp-validation__formula">约束：${escapeHtml(item.formula)}</code>`
      : "")
    + `</li>`).join("");
}

export function renderValidationConclusion(result) {
  if (!result) return "";
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  const valid = result.status === "valid" && errors.length === 0;
  const title = warnings.length ? `静态校验通过 · ${warnings.length} 条提醒` : "静态校验通过";
  const state = valid ? (warnings.length ? "warning" : "valid") : "invalid";
  const problem = !valid
    ? `<p class="cro-config-error__msg" role="alert">`
      + `<b class="cro-config-error__title is-error">配置出错，图形未更新</b></p>`
    : "";

  return problem + `<section class="mcp-validation is-${state}" data-mcp-validation-result="${state}">`
    + (valid && warnings.length
      ? `<div class="mcp-validation__head"><strong>${escapeHtml(title)}</strong></div>`
      : "")
    + (valid
      ? `<p class="mcp-validation__summary">配置合法，符合已建模的数学约束</p>`
      : "")
    + (errors.length ? `<ol class="mcp-validation__list">${diagnosticItems(errors)}</ol>` : "")
    + (warnings.length
      ? `<div class="mcp-validation__warnings"><b>提醒</b><ul>${diagnosticItems(warnings)}</ul></div>`
      : "")
    + `</section>`;
}

function fieldElement(field) {
  if (field === "model") return document.getElementById("croModelSelect")?.closest(".cro-stepper");
  if (field === "card") return document.getElementById("croCardSelect")?.closest(".cro-stepper");
  return document.querySelector(`.cro-stepper[data-field="${CSS.escape(field)}"]`);
}

function clearMarks() {
  document.querySelectorAll(".cro-stepper.is-mcp-invalid, .cro-stepper.is-mcp-warning").forEach((element) => {
    element.classList.remove("is-mcp-invalid", "is-mcp-warning");
    delete element.dataset.mcpValidation;
  });
}

function exposeMarkedField(element) {
  const panel = element?.closest(".cro-advanced-panel");
  if (!panel?.hidden) return;
  const toggle = document.querySelector(`[aria-controls="${CSS.escape(panel.id)}"]`);
  panel.hidden = false;
  toggle?.setAttribute("aria-expanded", "true");
  toggle?.classList.add("is-open");
  document.dispatchEvent(new CustomEvent("cro:layout", {
    detail: { source: "mcp-validation", group: panel.id, open: true },
  }));
}

function applyMarks(result) {
  clearMarks();
  for (const [field, state] of validationMarks(result)) {
    const element = fieldElement(field);
    if (!element) continue;
    element.classList.add(state === "invalid" ? "is-mcp-invalid" : "is-mcp-warning");
    element.dataset.mcpValidation = state === "invalid" ? "违反 MCP 静态约束" : "MCP 静态校验提醒";
    if (state === "invalid") exposeMarkedField(element);
  }
}

function clearMcpResult(container) {
  container?.querySelector("#mcpValidationConclusion")?.remove();
  container?.classList.remove(
    "is-mcp-valid",
    "is-mcp-warning",
    "is-mcp-invalid",
    "is-mcp-pending",
    "is-mcp-unavailable",
  );
}

function appendResult(container, html, state) {
  const hadPageResult = Array.from(container.children)
    .some((child) => !["mcpValidationConclusion", "mcpFixesConclusion"].includes(child.id));
  clearMcpResult(container);
  const holder = document.createElement("div");
  holder.id = "mcpValidationConclusion";
  holder.className = hadPageResult ? "mcp-validation-host is-with-page-result" : "mcp-validation-host";
  holder.innerHTML = html;
  if (state === "valid") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "mcp-validation__close";
    close.setAttribute("aria-label", "关闭静态校验结果");
    close.title = "关闭";
    close.textContent = "×";
    close.addEventListener("click", () => {
      document.getElementById("mcpFixesConclusion")?.remove();
      clearMcpResult(container);
    });
    holder.append(close);
  }
  container.insertBefore(holder, container.querySelector("#mcpFixesConclusion"));
  container.classList.add(`is-mcp-${state}`);
  container.classList.toggle("is-blocking", state === "invalid");
  if (state !== "invalid") container.classList.remove("is-guidance");
}

export function installValidationAdapter(callValidateTool) {
  let token = 0;
  let debounceTimer = 0;
  let pendingTimer = 0;
  const pipelineSettings = { mode: null, numLayerList: null };
  let supplementOverrides = {};

  function setPath(target, path, value) {
    const keys = String(path).split(".");
    let cursor = target;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) cursor[key] = value;
      else cursor = cursor[key] ??= {};
    });
  }

  function trainingConfigFor(config) {
    const input = pageConfigToTrainingConfig(config, window.CroTopology, resolvedPipelineSettings(config));
    for (const [path, value] of Object.entries(supplementOverrides)) setPath(input, path, value);
    return input;
  }

  function resolvedPipelineSettings(config) {
    if (!pipelineSettings.mode) {
      pipelineSettings.mode = Number(config.totalLayer) % positiveInteger(config.pp) === 0
        ? "uniform" : "dynamic";
    }
    if (pipelineSettings.mode !== "dynamic") return { mode: "uniform" };
    const imported = pipelineSettings.numLayerList;
    const matchesCurrent = Array.isArray(imported)
      && imported.length === positiveInteger(config.pp)
      && imported.reduce((sum, value) => sum + Number(value), 0) === positiveInteger(config.totalLayer);
    return {
      mode: "dynamic",
      numLayerList: matchesCurrent
        ? imported
        : balancedPipelineLayers(config.totalLayer, config.pp),
    };
  }

  function syncPipelineControl(config) {
    const root = document.getElementById("mcpPipelineLayerMode");
    if (!root || !config) return;
    const settings = resolvedPipelineSettings(config);
    root.querySelectorAll("button[data-value]").forEach((button) => {
      const selected = button.dataset.value === settings.mode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function mountPipelineControl() {
    if (document.getElementById("mcpPipelineLayerMode")) return true;
    const panel = document.getElementById("croParallelAdvanced");
    if (!panel) return false;
    const wrap = document.createElement("div");
    wrap.id = "mcpPipelineLayerMode";
    wrap.className = "cro-stepper cro-stepper--choice mcp-pipeline-layer-mode";
    wrap.dataset.field = "mcpPipelineLayerMode";
    const label = document.createElement("span");
    label.className = "cro-stepper__label";
    label.textContent = "PP 分层";
    const group = document.createElement("div");
    group.className = "segmented-control segmented-control-muted cro-flag-choice";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "PP 分层模式");
    for (const [value, text] of [["uniform", "均分"], ["dynamic", "动态"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-sm";
      button.dataset.value = value;
      button.textContent = text;
      button.title = value === "dynamic"
        ? "MindSpeed-LLM MCore 动态 PP：使用 num_layer_list 明确每个 Stage 的层数；不能与 VPP 同时启用。"
        : "标准均匀 PP：总层数必须能被 PP 整除。";
      button.addEventListener("click", () => {
        pipelineSettings.mode = value;
        pipelineSettings.numLayerList = null;
        syncPipelineControl(window.croObserver?.config);
        document.dispatchEvent(new CustomEvent("mcp:pipeline-settings-change"));
      });
      group.append(button);
    }
    wrap.append(label, group);
    panel.prepend(wrap);
    syncPipelineControl(window.croObserver?.config);
    return true;
  }

  function waitForPipelineControl() {
    if (mountPipelineControl()) return;
    const observer = new MutationObserver(() => {
      if (!mountPipelineControl()) return;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function validateCurrent() {
    const controller = window.croObserver;
    const container = document.getElementById("croConfigError");
    if (!controller?.config || !window.CroTopology || !container) return;
    const currentToken = ++token;
    clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      if (currentToken !== token) return;
      appendResult(container,
        `<p class="mcp-validation__pending">正在调用 <code>validate_parallel_config</code>…</p>`,
        "pending");
    }, 160);

    try {
      const settings = resolvedPipelineSettings(controller.config);
      syncPipelineControl(controller.config);
      const input = trainingConfigFor(controller.config);
      const result = await callValidateTool(input);
      if (currentToken !== token) return;
      clearTimeout(pendingTimer);
      const state = result.status === "valid"
        ? ((result.warnings ?? []).length ? "warning" : "valid")
        : "invalid";
      appendResult(container, renderValidationConclusion(result), state);
      applyMarks(result);
    } catch (error) {
      if (currentToken !== token) return;
      clearTimeout(pendingTimer);
      clearMarks();
      const message = error instanceof Error ? error.message : String(error);
      appendResult(container,
        `<section class="mcp-validation is-unavailable" data-mcp-validation-result="unavailable">`
          + `<div class="mcp-validation__head"><strong>暂时不可用</strong></div>`
          + `<p class="mcp-validation__assumption">${escapeHtml(message)}</p></section>`,
        "unavailable");
    }
  }

  function schedule(delay = 90) {
    token += 1;
    clearTimeout(debounceTimer);
    clearTimeout(pendingTimer);
    debounceTimer = window.setTimeout(validateCurrent, delay);
  }

  function relevantControl(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest("#croImportPanel")) return false;
    return Boolean(target.closest(
      ".cro-stepper, #croModelSelect, #croCardSelect, #croConfigPresetSelect, #croConfigPresetMenu",
    ));
  }

  document.addEventListener("cro:change", () => schedule(40));
  document.addEventListener("mcp:pipeline-settings-change", () => schedule(0));
  document.addEventListener("mcp:parsed-config-applied", (event) => {
    supplementOverrides = Object.fromEntries(Object.entries(event.detail?.supplements ?? {})
      .filter(([path]) => !pageFieldForPath(path)));
    const parallel = event.detail?.normalizedConfig?.parallel;
    if (!parallel) return;
    const importedMode = parallel.pipeline_layer_mode
      ?? (Array.isArray(parallel.num_layer_list) ? "dynamic" : null);
    if (importedMode === "uniform" || importedMode === "dynamic") {
      pipelineSettings.mode = importedMode;
      pipelineSettings.numLayerList = Array.isArray(parallel.num_layer_list)
        ? [...parallel.num_layer_list] : null;
      syncPipelineControl(window.croObserver?.config);
      schedule(0);
    }
  });
  document.addEventListener("mcp:retry-requested", (event) => {
    if (event.detail?.tool === "validate_parallel_config") schedule(0);
  });
  document.addEventListener("input", (event) => {
    if (relevantControl(event)) schedule();
  });
  document.addEventListener("change", (event) => {
    if (relevantControl(event)) schedule();
  });
  const start = () => {
    waitForPipelineControl();
    schedule(0);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  return {
    refresh: () => schedule(0),
    trainingConfigFor,
    reveal: () => {
      schedule(0);
      window.setTimeout(() => document.getElementById("croConfigError")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }), 80);
    },
  };
}
