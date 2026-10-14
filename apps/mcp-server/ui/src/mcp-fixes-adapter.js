import { labelForPath, pageFieldForPath } from "./mcp-parse-adapter.js";

export const FIXABLE_FIELDS = Object.freeze([
  "model.num_attention_heads",
  "model.num_key_value_heads",
  "cluster.total_ranks",
  "parallel.dp",
  "parallel.pp",
  "parallel.tp",
  "parallel.cp",
  "parallel.ep",
  "parallel.vpp",
  "parallel.pipeline_layer_mode",
  "parallel.num_layer_list",
  "parallel.pipeline_layer_offsets",
  "rule_profile.framework",
  "model.top_k",
]);

export const FIX_OBJECTIVES = Object.freeze([
  ["mindspeed-compatible", "MindSpeed 兼容警告最少"],
  ["keep-current-resources", "保持资源规模"],
  ["memory-safe", "显存安全优先"],
  ["pipeline-balanced", "流水线均衡优先"],
]);

export function withLockedFields(input, lockedFields, objective = "mindspeed-compatible") {
  return {
    ...input,
    policy: {
      ...(input.policy ?? {}),
      locked_fields: [...lockedFields],
      objective,
    },
  };
}

function renderObjectiveControl(host, objective, onChange) {
  const label = element("label", "mcp-fixes__objective");
  const select = element("select", "mcp-fixes__objective-select");
  select.setAttribute("aria-label", "修复方案排序策略");
  for (const [value, text] of FIX_OBJECTIVES) {
    const option = element("option", "", text);
    option.value = value;
    option.selected = value === objective;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  label.append(select);
  host.append(label);
}

export function suggestionPagePartial(suggestion) {
  return Object.fromEntries((suggestion?.changes ?? []).flatMap((change) => {
    const field = pageFieldForPath(change.path);
    return field && field !== "mcpPipelineLayerMode" ? [[field, change.new_value]] : [];
  }));
}

export function suggestionPipelineSettings(suggestion) {
  const changesPipeline = (suggestion?.changes ?? []).some((change) => (
    change.path === "parallel.pipeline_layer_mode"
      || change.path === "parallel.num_layer_list"
      || change.path === "parallel.pipeline_layer_offsets"
      || change.path === "rule_profile.framework"
  ));
  if (!changesPipeline) return null;
  const proposed = suggestion?.proposed_config;
  if (!proposed?.parallel?.pipeline_layer_mode) return null;
  return {
    mode: proposed.parallel.pipeline_layer_mode,
    numLayerList: proposed.parallel.num_layer_list,
    layerOffsets: proposed.parallel.pipeline_layer_offsets,
    framework: proposed.rule_profile?.framework,
  };
}

export function changesLockedBySuggestion(suggestion, lockedFields) {
  const locked = new Set(lockedFields);
  return (suggestion?.changes ?? []).filter((change) => locked.has(change.path));
}

export function actionableLockFields(suggestions) {
  return new Set((suggestions ?? []).flatMap((suggestion) =>
    (suggestion.changes ?? []).map((change) => change.path)));
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function resultHost() {
  const container = document.getElementById("croConfigError");
  if (!container) return null;
  let host = document.getElementById("mcpFixesConclusion");
  if (!host) {
    host = element("section", "mcp-fixes");
    host.id = "mcpFixesConclusion";
    host.setAttribute("aria-live", "polite");
    container.append(host);
  }
  return host;
}

function renderLockPolicy(host, lockedFields, suggestions, onChange, open, onToggle) {
  const policy = element("details", "mcp-fixes__policy");
  policy.open = open;
  policy.addEventListener("toggle", () => onToggle(policy.open));
  const legend = element("summary", "mcp-fixes__policy-title", "锁定不可改字段");
  const fields = element("div", "mcp-fixes__locks");
  const locked = new Set(lockedFields);
  const actionable = actionableLockFields(suggestions);
  for (const path of FIXABLE_FIELDS) {
    const label = element("label", "mcp-fixes__lock");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = path;
    input.checked = locked.has(path);
    input.disabled = !input.checked && !actionable.has(path);
    if (input.disabled) label.title = "当前候选不会修改此字段，锁定它不会影响这些候选。";
    input.addEventListener("change", () => onChange(path, input.checked));
    label.append(input, document.createTextNode(labelForPath(path)));
    fields.append(label);
  }
  policy.append(legend, fields);
  host.append(policy);
}

function appendCancelAction(host, fallback) {
  const actions = document.querySelector("#croConfigError .cro-config-error__actions");
  const original = Array.from(actions?.querySelectorAll("button") ?? [])
    .find((button) => button.textContent?.trim() === "取消修改");
  if (!original && !fallback) return;
  const cancel = element("button", "btn btn-sm mcp-fixes__cancel", "取消修改");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    if (original) original.click();
    else fallback?.();
  });
  actions?.remove();
  host.append(cancel);
}

function renderChanges(suggestion) {
  const list = element("ul", "mcp-fixes__changes");
  for (const change of suggestion.changes ?? []) {
    const item = element("li");
    const label = element("b", "", labelForPath(change.path));
    const oldValue = Array.isArray(change.old_value) ? JSON.stringify(change.old_value) : change.old_value;
    const newValue = Array.isArray(change.new_value) ? JSON.stringify(change.new_value) : change.new_value;
    item.append(label, document.createTextNode(` ${oldValue ?? "未设置"} → ${newValue}`));
    list.append(item);
  }
  return list;
}

function formatScore(score) {
  return Number(score).toFixed(3).replace(/\.000$/, "");
}

export function hasSuggestionScore(suggestion) {
  return Number.isFinite(suggestion?.score);
}

export function fixesResultAlreadyValid(result) {
  return result?.status === "valid" || result?.data?.already_valid === true;
}

function renderCandidate(suggestion, applySuggestion, totalSuggestions) {
  const card = element(
    "article",
    "mcp-fixes__candidate mcp-parse-banner cro-config-error is-blocking is-guidance is-mcp-invalid",
  );
  const title = element("div", "mcp-fixes__candidate-title");
  const name = element("div", "mcp-fixes__candidate-name");
  const single = totalSuggestions === 1;
  name.append(element("strong", "", single ? "修改方案" : `方案 ${suggestion.rank}`));
  if (!single && suggestion.rank === 1) {
    name.append(element("span", "mcp-fixes__recommended", "推荐"));
  }
  title.append(name);
  if (!single && hasSuggestionScore(suggestion)) {
    const score = element("span", "mcp-fixes__score", `评分 ${formatScore(suggestion.score)}`);
    const details = suggestion.score_details;
    score.title = details
      ? `${details.objective_label}；主指标 ${details.primary_metric}=${details.primary_value}；分数越低越优。`
      : "分数越低越优。";
    title.append(score);
  }
  const apply = element(
    "button",
    `btn btn-sm${suggestion.rank === 1 ? " btn-solid" : ""}`,
    "应用并重新校验",
  );
  apply.type = "button";
  apply.addEventListener("click", () => applySuggestion(suggestion, apply));
  card.append(title, renderChanges(suggestion), apply);
  return card;
}

export function installFixesAdapter(callFixesTool, trainingConfigFor, applyPipelineSettings) {
  const lockedFields = new Set();
  let token = 0;
  let debounceTimer = 0;
  let pendingTimer = 0;
  let lastAppliedRank = null;
  let lastValidPageConfig = null;
  let lockPolicyOpen = false;
  let objective = "mindspeed-compatible";

  function renderFrame(status, state, showSubtitle = true) {
    const host = resultHost();
    if (!host) return null;
    host.replaceChildren();
    host.dataset.state = state;
    const head = element("div", "mcp-fixes__head");
    head.append(element("strong", "mcp-fixes__title", "MCP 修复建议"));
    if (showSubtitle) {
      head.append(element("span", "mcp-fixes__subtitle", "已限制检索4个字段以内的修改方案保障性能，评分越低越优"));
    }
    host.append(head);
    if (status && state !== "ready") host.append(element("p", "mcp-fixes__status", status));
    return host;
  }

  function changeLock(path, checked) {
    if (checked) lockedFields.add(path);
    else lockedFields.delete(path);
    lastAppliedRank = null;
    schedule(0);
  }

  function changeObjective(next) {
    if (!FIX_OBJECTIVES.some(([value]) => value === next)) return;
    objective = next;
    lastAppliedRank = null;
    schedule(0);
  }

  function cancelChanges() {
    if (window.croObserver?.cancelInvalidConfig?.()) return;
    if (lastValidPageConfig && window.croObserver?.importConfig) {
      window.croObserver.importConfig(lastValidPageConfig);
    }
  }

  function renderResult(result, pageConfig) {
    if (fixesResultAlreadyValid(result)) {
      lastValidPageConfig = { ...pageConfig };
      document.getElementById("mcpFixesConclusion")?.remove();
      lastAppliedRank = null;
      return;
    }

    const suggestions = result.data?.suggestions ?? [];
    const host = renderFrame(
      suggestions.length ? "" : "当前锁定条件下没有可行候选",
      suggestions.length ? "ready" : "empty",
      suggestions.length !== 1,
    );
    if (!host) return;
    if (!suggestions.length) {
      appendCancelAction(host, cancelChanges);
      return;
    }
    if (suggestions.length > 1) {
      renderObjectiveControl(host, objective, changeObjective);
      renderLockPolicy(
        host,
        lockedFields,
        suggestions,
        changeLock,
        lockPolicyOpen,
        (open) => { lockPolicyOpen = open; },
      );
    }
    const cards = element("div", "mcp-fixes__candidates");
    for (const suggestion of suggestions.slice(0, 3)) {
      cards.append(renderCandidate(suggestion, applySuggestion, suggestions.length));
    }
    host.append(cards);
    const otherSuggestions = suggestions.slice(3);
    if (otherSuggestions.length) {
      const details = element("details", "mcp-fixes__other");
      const summary = element("summary", "mcp-fixes__other-summary", `其他 ${otherSuggestions.length} 项方案`);
      const otherCards = element("div", "mcp-fixes__candidates mcp-fixes__candidates--other");
      for (const suggestion of otherSuggestions) {
        otherCards.append(renderCandidate(suggestion, applySuggestion, suggestions.length));
      }
      details.append(summary, otherCards);
      host.append(details);
    }
    appendCancelAction(host, cancelChanges);
  }

  function applySuggestion(suggestion, button) {
    const violations = changesLockedBySuggestion(suggestion, lockedFields);
    if (violations.length) {
      const host = renderFrame("候选与当前锁定字段冲突，已拒绝回填", "error");
      host?.append(element("p", "mcp-fixes__empty", violations.map((item) => labelForPath(item.path)).join("、")));
      return;
    }
    const partial = suggestionPagePartial(suggestion);
    const pipelineSettings = suggestionPipelineSettings(suggestion);
    if ((!Object.keys(partial).length && !pipelineSettings) || !window.croObserver?.importConfig) return;
    button.disabled = true;
    const applied = Object.keys(partial).length
      ? window.croObserver.importConfig(partial)
      : { after: window.croObserver.config };
    const mismatches = Object.entries(partial).filter(
      ([field, value]) => !Object.is(applied?.after?.[field], value),
    );
    if (mismatches.length) {
      const host = renderFrame("回填结果与 MCP 候选不一致，未宣称修复完成", "error");
      host?.append(element("p", "mcp-fixes__empty", "表单没有完整保留 Tool 返回值，请检查高亮字段。"));
      return;
    }
    if (pipelineSettings && !applyPipelineSettings?.(pipelineSettings)) {
      const host = renderFrame("PP 分层方案回填失败", "error");
      host?.append(element("p", "mcp-fixes__empty", "PP 分层设置应用通道不可用，请刷新工作台后重试。"));
      return;
    }
    lastAppliedRank = suggestion.rank;
    schedule(0);
  }

  async function requestCurrent() {
    const config = window.croObserver?.config;
    if (!config) return;
    const currentToken = ++token;
    clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      if (currentToken !== token) return;
      renderFrame("正在调用 suggest_config_fixes 生成候选；不会修改当前配置。", "pending");
    }, 160);
    try {
      const input = withLockedFields(trainingConfigFor(config), lockedFields, objective);
      const result = await callFixesTool(input);
      if (currentToken !== token) return;
      clearTimeout(pendingTimer);
      renderResult(result, config);
    } catch (error) {
      if (currentToken !== token) return;
      clearTimeout(pendingTimer);
      const host = renderFrame("修复建议暂时不可用", "error");
      host?.append(element("p", "mcp-fixes__empty", errorText(error)));
    }
  }

  function schedule(delay = 90) {
    token += 1;
    clearTimeout(debounceTimer);
    clearTimeout(pendingTimer);
    document.getElementById("mcpFixesConclusion")?.remove();
    debounceTimer = window.setTimeout(requestCurrent, delay);
  }

  function relevantControl(event) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("#mcpFixesConclusion, #croImportPanel")) return false;
    return Boolean(target.closest(
      ".cro-stepper, #croModelSelect, #croCardSelect, #croConfigPresetSelect, #croConfigPresetMenu",
    ));
  }

  document.addEventListener("cro:config-change", () => schedule(40));
  document.addEventListener("mcp:pipeline-settings-change", () => schedule(0));
  document.addEventListener("mcp:parsed-config-applied", () => schedule(0));
  document.addEventListener("mcp:retry-requested", (event) => {
    if (event.detail?.tool === "suggest_config_fixes") schedule(0);
  });
  for (const eventName of ["input", "change"]) {
    document.addEventListener(eventName, (event) => {
      if (relevantControl(event)) schedule();
    });
  }

  window.__mcpFixesAdapter = { refresh: () => schedule(0) };
  const start = () => schedule(0);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  return {
    refresh: () => schedule(0),
    reveal: () => {
      schedule(0);
      window.setTimeout(() => resultHost()?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    },
  };
}
