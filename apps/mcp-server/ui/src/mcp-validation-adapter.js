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
  "parallel.pipeline_layer_offsets": "mcpPipelineLayerMode",
});

// 这是预设自身的显式输入，不是浏览器根据层数和 PP 推导出的规则。
// 校验是否合法、以及是否需要修复，仍统一交给 validate_parallel_config。
const BUILTIN_PRESET_PIPELINE_SETTINGS = Object.freeze({
  cinnnnnndy: Object.freeze({
    mode: "dynamic",
    numLayerList: Object.freeze([12, 12, 11, 11]),
    framework: "mindspeed-llm-mcore",
  }),
  "openpangu-default": Object.freeze({
    mode: "dynamic",
    numLayerList: Object.freeze([12, 12, 11, 11]),
    framework: "mindspeed-llm-mcore",
  }),
  "qwen2-7b-default": Object.freeze({
    mode: "uniform",
    framework: "mindspeed-core",
  }),
});

export function pipelineSettingsForPreset(presetId) {
  const settings = BUILTIN_PRESET_PIPELINE_SETTINGS[presetId];
  if (!settings) return null;
  return {
    ...settings,
    numLayerList: Array.isArray(settings.numLayerList) ? [...settings.numLayerList] : null,
  };
}

export function createPagePresetContextTracker(onPresetApplied = () => {}) {
  let currentPresetId = null;

  function presetIdOf(config) {
    return config?.configPreset || null;
  }

  return {
    prime(config) {
      currentPresetId = presetIdOf(config);
    },
    observe(config) {
      const nextPresetId = presetIdOf(config);
      // 内置预设由“应用”按钮程序化落地，不保证产生 select/change；以配置身份变化为准。
      const presetApplied = Boolean(nextPresetId && nextPresetId !== currentPresetId);
      currentPresetId = nextPresetId;
      if (presetApplied) onPresetApplied(nextPresetId);
      return presetApplied;
    },
  };
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function configuredNumber(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalPositiveInteger(target, key, value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) target[key] = number;
}

function optionalNonNegativeInteger(target, key, value) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) target[key] = number;
}

function requiredCapacityModelPaths(input) {
  const paths = ["model.hidden_size", "model.vocab_size"];
  if (Number(input.model?.routed_experts) > 0) {
    paths.push("model.expert_ffn_hidden_size", "model.first_k_dense_layers");
    if (Number(input.model?.first_k_dense_layers) > 0) paths.push("model.ffn_hidden_size");
  } else {
    paths.push("model.ffn_hidden_size");
  }
  return paths;
}

export function capacityModelEvidenceGaps(input, evidencePaths, trustedPresetId = "") {
  const presetId = String(trustedPresetId).toLowerCase();
  const inputId = String(input.model?.id ?? "").toLowerCase();
  if (presetId && inputId === presetId) return [];
  return requiredCapacityModelPaths(input).filter((path) => !evidencePaths?.has(path));
}

export function pageConfigToTrainingConfig(config, topologyApi, pipelineSettings = {}) {
  if (!config || !topologyApi?.MODEL_PRESETS) {
    throw new Error("原页面配置尚未初始化。");
  }

  const preset = topologyApi.MODEL_PRESETS[config.model];
  if (!preset) throw new Error(`找不到模型预设：${config.model ?? "未选择"}`);
  const fallbackCard = CARD_FALLBACKS[config.card] ?? CARD_FALLBACKS["910b-64"];
  const dense = Boolean(preset.noMoe);
  const totalRanks = configuredNumber(config.totalRank, 1);
  const ranksPerNode = fallbackCard.ranksPerNode;

  const model = {
    id: preset.id ?? config.model,
    total_layers: configuredNumber(config.totalLayer, 1),
    hidden_size: positiveInteger(preset.hidden),
    num_attention_heads: positiveInteger(preset.heads),
    routed_experts: dense ? 0 : configuredNumber(config.routedExpert, 0),
    top_k: dense ? 0 : configuredNumber(config.topK, 0),
    shared_experts: dense ? 0 : configuredNumber(config.sharedExpert, 0),
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
  if (config.recomputeLayers !== undefined) {
    memory.recompute_layers = configuredNumber(config.recomputeLayers, 0);
  }
  if (config.loraRank !== undefined) memory.lora_rank = configuredNumber(config.loraRank, 1);

  const epMode = ["split", "orthogonal", "mf"].includes(config.epMode)
    ? config.epMode
    : (config.moeOrthogonal ? "orthogonal" : "split");
  const dp = configuredNumber(config.dp, 1);
  const microBatchSize = configuredNumber(config.microBatch, 1);
  const microBatchCount = configuredNumber(config.microBatchNum, 1);
  const pp = configuredNumber(config.pp, 1);
  const requestedMode = pipelineSettings.mode;
  const pipelineLayerMode = ["uniform", "dynamic", "mindformers-offset"].includes(requestedMode)
    ? requestedMode
    : "uniform";
  const importedLayers = pipelineSettings.numLayerList;
  const numLayerList = pipelineLayerMode === "dynamic"
    && Array.isArray(importedLayers)
    ? importedLayers.map(Number)
    : undefined;
  const pipelineLayerOffsets = pipelineLayerMode === "mindformers-offset"
    && Array.isArray(pipelineSettings.layerOffsets)
    ? pipelineSettings.layerOffsets.map((row) => [...row])
    : undefined;
  const framework = pipelineSettings.framework
    ?? (pipelineLayerMode === "mindformers-offset" ? "mindformers" : (epMode === "mf"
    ? "mindformers"
    : (pipelineLayerMode === "dynamic" ? "mindspeed-llm-mcore" : "mindspeed-core")));
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
      tp: configuredNumber(config.tp, 1),
      cp: configuredNumber(config.cp, 1),
      ep: configuredNumber(config.ep, 1),
      vpp: configuredNumber(config.vpp, 1),
      pipeline_layer_mode: pipelineLayerMode,
      ...(numLayerList ? { num_layer_list: numLayerList } : {}),
      ...(pipelineLayerOffsets ? { pipeline_layer_offsets: pipelineLayerOffsets } : {}),
      ep_mode: epMode,
      cp_mode: config.cpMode === "ring" ? "ring" : "ulysses",
      sequence_parallel: Boolean(config.seqParallel),
      vocab_embedding_data_parallel: Boolean(config.vocabEmbDp),
      expert_tensor_parallel: Boolean(config.expertTp),
    },
    cluster: {
      total_ranks: totalRanks,
      ranks_per_node: ranksPerNode,
      card_model: fallbackCard.model,
      card_memory_gib: configuredNumber(
        config.customCardMemoryGB,
        fallbackCard.memory,
      ),
    },
    batch: {
      micro_batch_size: microBatchSize,
      sequence_length: configuredNumber(config.seqLen, 1),
      micro_batch_count: microBatchCount,
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

export function clearValidationMarks(root = document) {
  root.querySelectorAll(".cro-stepper.is-mcp-invalid, .cro-stepper.is-mcp-warning").forEach((element) => {
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
  clearValidationMarks();
  for (const [field, state] of validationMarks(result)) {
    const element = fieldElement(field);
    if (!element) continue;
    element.classList.add(state === "invalid" ? "is-mcp-invalid" : "is-mcp-warning");
    element.dataset.mcpValidation = state === "invalid" ? "违反 MCP 静态约束" : "MCP 静态校验提醒";
    if (state === "invalid") exposeMarkedField(element);
  }
}

export function isDismissibleValidationState(state) {
  return state === "valid" || state === "warning";
}

export function clearValidationPresentation(container) {
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
  clearValidationPresentation(container);
  const holder = document.createElement("div");
  holder.id = "mcpValidationConclusion";
  holder.className = hadPageResult ? "mcp-validation-host is-with-page-result" : "mcp-validation-host";
  holder.innerHTML = html;
  if (isDismissibleValidationState(state)) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "mcp-validation__close";
    close.setAttribute("aria-label", state === "warning" ? "关闭静态校验提醒" : "关闭静态校验结果");
    close.title = "关闭";
    close.textContent = "×";
    close.addEventListener("click", () => {
      document.getElementById("mcpFixesConclusion")?.remove();
      clearValidationPresentation(container);
      clearValidationMarks();
    });
    holder.append(close);
  }
  container.insertBefore(holder, container.querySelector("#mcpFixesConclusion"));
  container.classList.add(`is-mcp-${state}`);
}

export function installValidationAdapter(callValidateTool) {
  let token = 0;
  let debounceTimer = 0;
  let pendingTimer = 0;
  const pipelineSettings = {
    mode: null,
    numLayerList: null,
    layerOffsets: null,
    framework: null,
    confirmed: false,
  };
  let supplementOverrides = {};
  let importedModelEvidence = null;
  const pipelinePolicy = {
    mode: null,
    prepare(normalizedConfig) {
      this.mode = normalizedConfig?.parallel?.pipeline_layer_mode ?? null;
    },
    ownsValidation() {
      return this.mode === "mindformers-offset";
    },
  };
  window.__mcpPipelinePolicy = pipelinePolicy;

  function resetImportedContext() {
    supplementOverrides = {};
    pipelineSettings.mode = null;
    pipelineSettings.numLayerList = null;
    pipelineSettings.layerOffsets = null;
    pipelineSettings.framework = null;
    pipelineSettings.confirmed = false;
    pipelinePolicy.mode = null;
    importedModelEvidence = null;
  }

  function applyPresetPipelineContext(presetId) {
    const settings = pipelineSettingsForPreset(presetId);
    if (!settings) return false;
    pipelineSettings.mode = settings.mode;
    pipelineSettings.numLayerList = settings.numLayerList;
    pipelineSettings.layerOffsets = null;
    pipelineSettings.framework = settings.framework;
    pipelineSettings.confirmed = settings.mode === "dynamic" && Array.isArray(settings.numLayerList);
    pipelinePolicy.mode = settings.mode;
    return true;
  }

  const pagePresetContext = createPagePresetContextTracker((presetId) => {
    resetImportedContext();
    applyPresetPipelineContext(presetId);
    syncPipelineControl(window.croObserver?.config);
  });

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

  function leafPaths(value, prefix = "", output = new Set()) {
    if (Array.isArray(value) || value === null || typeof value !== "object") {
      if (prefix) output.add(prefix);
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      leafPaths(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }

  function capacityConfigFor(config) {
    const input = trainingConfigFor(config);
    if (!importedModelEvidence) return input;
    const preset = window.CroTopology?.MODEL_PRESETS?.[config.model];
    const presetId = String(preset?.id ?? config.model ?? "").toLowerCase();
    const missing = capacityModelEvidenceGaps(input, importedModelEvidence, presetId);
    if (!missing.length) return input;
    throw new Error(
      `容量估算已停止：导入模型缺少 ${missing.join("、")} 的可信结构值。`
      + "无需提供模型源码；请再导入该模型的 config.json，或在源配置中明确这些数值。",
    );
  }

  function collectImportedOverrides(value, prefix = "", output = {}) {
    if (Array.isArray(value) || value === null || typeof value !== "object") {
      if (prefix && !pageFieldForPath(prefix)) output[prefix] = structuredClone(value);
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      collectImportedOverrides(child, path, output);
    }
    return output;
  }

  function resolvedPipelineSettings(config) {
    if (!pipelineSettings.mode) {
      applyPresetPipelineContext(config?.configPreset);
      if (!pipelineSettings.mode) pipelineSettings.mode = "uniform";
    }
    if (pipelineSettings.mode === "mindformers-offset") {
      return {
        mode: "mindformers-offset",
        layerOffsets: pipelineSettings.layerOffsets,
        framework: pipelineSettings.framework ?? "mindformers",
      };
    }
    if (pipelineSettings.mode !== "dynamic") {
      return { mode: "uniform", framework: pipelineSettings.framework };
    }
    const imported = pipelineSettings.numLayerList;
    return {
      mode: "dynamic",
      numLayerList: Array.isArray(imported) ? imported : undefined,
      framework: pipelineSettings.framework,
      confirmed: Array.isArray(imported) && pipelineSettings.confirmed,
    };
  }

  function syncPipelineControl(config) {
    const root = document.getElementById("mcpPipelineLayerMode");
    if (!root || !config) return;
    const settings = resolvedPipelineSettings(config);
    root.dataset.pipelineEvidence = settings.mode === "dynamic"
      ? (settings.confirmed ? "mcp-confirmed" : "workbench-derived")
      : (settings.mode === "mindformers-offset"
        ? (Array.isArray(settings.layerOffsets) ? "mcp-confirmed" : "workbench-derived")
        : "not-applicable");
    const label = root.querySelector(".cro-stepper__label");
    if (label) {
      label.title = settings.mode === "mindformers-offset"
        ? (Array.isArray(settings.layerOffsets)
          ? `MindFormers PP 层偏置矩阵：${JSON.stringify(settings.layerOffsets)}`
          : "尚未提供 MindFormers PP 层偏置矩阵；MCP 将生成尽量均衡的 VPP×PP 修复候选。")
        : (settings.mode === "dynamic" ? (settings.confirmed
          ? `已由导入配置或 MCP 补齐方案确认：${settings.numLayerList.join(", ")}`
          : "尚未提供 num_layer_list；将由 MCP 校验并给出修复候选。")
          : "当前使用标准均匀 PP。");
    }
    root.querySelectorAll("button[data-value]").forEach((button) => {
      const selected = button.dataset.value === settings.mode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function applyPipelineSettings(settings = {}) {
    const mode = settings.mode;
    if (!["uniform", "dynamic", "mindformers-offset"].includes(mode)) return false;
    pipelineSettings.mode = mode;
    pipelinePolicy.mode = mode;
    pipelineSettings.numLayerList = Array.isArray(settings.numLayerList)
      ? [...settings.numLayerList]
      : null;
    pipelineSettings.layerOffsets = Array.isArray(settings.layerOffsets)
      ? settings.layerOffsets.map((row) => [...row])
      : null;
    pipelineSettings.framework = settings.framework ?? null;
    pipelineSettings.confirmed = mode === "dynamic" && Array.isArray(settings.numLayerList);
    syncPipelineControl(window.croObserver?.config);
    document.dispatchEvent(new CustomEvent("mcp:pipeline-settings-change"));
    return true;
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
    for (const [value, text] of [["uniform", "均分"], ["dynamic", "动态"], ["mindformers-offset", "MF 层偏置"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-sm";
      button.dataset.value = value;
      button.textContent = text;
      button.title = value === "dynamic"
        ? "MindSpeed-LLM MCore 动态 PP：使用 num_layer_list 明确每个 Stage 的层数；不能与 VPP 同时启用。"
        : (value === "mindformers-offset"
          ? "MindFormers 的 PP/VPP 非均匀层分配：使用源配置 offset 矩阵；只影响各虚拟 Stage 的层数，不改变 MoE 的 EP Rank 口径，与「MF EP 域」互相独立。手动选择后由 MCP 生成尽量均衡的 VPP×PP 修复候选。"
          : "标准均匀 PP：总层数必须能被 PP 整除。");
      button.addEventListener("click", () => {
        applyPipelineSettings({ mode: value });
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
      clearValidationMarks();
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
    const container = document.getElementById("croConfigError");
    clearValidationPresentation(container);
    clearValidationMarks();
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

  document.addEventListener("cro:config-change", () => {
    pagePresetContext.observe(window.croObserver?.config);
    schedule(40);
  });
  document.addEventListener("cro:source", () => {
    resetImportedContext();
    schedule(0);
  });
  document.addEventListener("mcp:pipeline-settings-change", () => schedule(0));
  document.addEventListener("mcp:parsed-config-applied", (event) => {
    const normalized = event.detail?.normalizedConfig ?? {};
    pipelinePolicy.prepare(normalized);
    supplementOverrides = collectImportedOverrides(normalized);
    const sourcePaths = leafPaths(event.detail?.sourceNormalizedConfig ?? normalized);
    for (const path of event.detail?.userEditedPaths ?? []) sourcePaths.add(path);
    /* 第三栏的预填结构值只有在用户完成确认后才会随 parsed-config-applied 到达这里；
       因此 supplements 中的模型字段可作为本次容量估算的显式确认，而不是页面兜底。 */
    for (const path of Object.keys(event.detail?.supplements ?? {})) sourcePaths.add(path);
    importedModelEvidence = sourcePaths;
    for (const [path, value] of Object.entries(event.detail?.supplements ?? {})) {
      if (!pageFieldForPath(path)) supplementOverrides[path] = value;
    }
    const parallel = normalized.parallel;
    if (!parallel) return;
    const importedMode = parallel.pipeline_layer_mode
      ?? (Array.isArray(parallel.num_layer_list) ? "dynamic" : null);
    if (["uniform", "dynamic", "mindformers-offset"].includes(importedMode)) {
      pipelineSettings.mode = importedMode;
      pipelineSettings.numLayerList = Array.isArray(parallel.num_layer_list)
        ? [...parallel.num_layer_list] : null;
      pipelineSettings.layerOffsets = Array.isArray(parallel.pipeline_layer_offsets)
        ? parallel.pipeline_layer_offsets.map((row) => [...row]) : null;
      pipelineSettings.framework = normalized.rule_profile?.framework ?? null;
      pipelineSettings.confirmed = Array.isArray(parallel.num_layer_list);
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
    if (!relevantControl(event)) return;
    schedule();
  });
  const start = () => {
    const config = window.croObserver?.config;
    pagePresetContext.prime(config);
    applyPresetPipelineContext(config?.configPreset);
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
    capacityConfigFor,
    applyPipelineSettings,
    reveal: () => {
      schedule(0);
      window.setTimeout(() => document.getElementById("croConfigError")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }), 80);
    },
  };
}
