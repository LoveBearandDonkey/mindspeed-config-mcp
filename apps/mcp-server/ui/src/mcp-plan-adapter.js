import { preparePlanningBaseConfig } from "@mindspeed-config/config-core";
import { diffApplied, toPagePartial } from "./mcp-parse-adapter.js";

const LEVELS = { safe: "safe · 余量充足", tight: "tight · 余量偏紧", alert: "alert · 接近上限", over: "over · 超出容量" };
const FIELD_NAMES = {
  "cluster.total_ranks": "NPU 总数", "batch.global_batch_size": "Global Batch",
  "batch.micro_batch_size": "Micro Batch", "batch.micro_batch_count": "累积次数",
  "parallel.tp": "TP", "parallel.pp": "PP", "parallel.ep": "EP", "parallel.dp": "DP",
  "parallel.cp": "CP", "parallel.vpp": "VPP", "parallel.num_layer_list": "各 Stage 层数",
  "parallel.sequence_parallel": "序列并行 SP", "model.total_layers": "模型总层数",
};
const fieldName = (path) => FIELD_NAMES[path] ?? path;
const ADVANCED = [
  ["micro_batch_size", "Micro Batch", "batch", "micro_batch_size", 1],
  ["sequence_length", "序列长度", "batch", "sequence_length", 4096],
  ["cp", "CP", "parallel", "cp", 1], ["vpp", "VPP", "parallel", "vpp", 1],
  ["compute_dtype", "计算精度", "memory", "compute_dtype", "bf16", ["bf16", "fp16", "fp8"]],
  ["parameter_dtype", "参数精度", "memory", "parameter_dtype", "bf16", ["bf16", "fp32"]],
  ["shard_mode", "分片方式", "memory", "shard_mode", "zero1", ["none", "zero1", "fsdp2"]],
  ["recompute_mode", "重计算方式", "memory", "recompute_mode", "full", ["none", "selective", "layers", "full"]],
  ["recompute_layers", "重计算层数（指定层数时）", "memory", "recompute_layers", 0],
  ["sequence_parallel", "序列并行 SP", "parallel", "sequence_parallel", false, ["true", "false"]],
];

function element(tag, className = "", value = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function field(label, input) {
  const wrapper = element("label", "mcp-plan__field");
  wrapper.append(element("span", "", label), input);
  return wrapper;
}

function numberInput(name, min, step = "1") {
  const input = document.createElement("input");
  input.name = name;
  input.type = "number";
  input.min = String(min);
  input.step = step;
  input.required = true;
  return input;
}

function formatValue(value) {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "未填写");
}

export function installPlanAdapter(callPlanTool, getBaseConfig) {
  let dialog;
  let form;
  let feedback;
  let results;
  let requestToken = 0;
  let prefillNote;
  let generating = false;
  let generatedSignature = null;
  let generatedFeedback = null;

  function planningInput() {
    const baseConfig = preparePlanningBaseConfig(getBaseConfig());
    if (!baseConfig) throw new Error("当前模型配置尚未就绪，请先在工作台选择或导入配置。");
    baseConfig.batch.global_batch_size = Number(form.elements.global_batch_size.value);
    for (const [name, , group, key, , choices] of ADVANCED) {
      const value = form.elements[name].value;
      baseConfig[group][key] = name === "sequence_parallel" ? value === "true" : choices ? value : Number(value);
    }
    return {
      schema_version: "1.0",
      resources: {
        total_ranks: Number(form.elements.total_ranks.value),
        card_memory_gib: Number(form.elements.card_memory_gib.value),
      },
      goal: form.elements.goal.value,
      base_config: baseConfig,
      locked_fields: [...form.querySelectorAll('input[name="locked_fields"]:checked')].map((checkbox) => checkbox.value),
    };
  }

  function updateControls() {
    if (!form) return;
    let signature;
    try { signature = JSON.stringify(planningInput()); } catch { signature = null; }
    const unchanged = generatedSignature !== null && signature === generatedSignature;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = generating || unchanged;
    submit.title = unchanged ? "参数未变化，已有候选结果；修改条件后可重新生成。" : "";
    results.querySelectorAll(".mcp-plan__apply").forEach((button) => { button.disabled = generating || !unchanged; });
    const changedNotice = "参数已变化，请重新生成候选配置。";
    if (generatedSignature !== null && !unchanged && !generating) setFeedback(changedNotice);
    else if (unchanged && feedback.textContent === changedNotice && generatedFeedback) setFeedback(...generatedFeedback);
  }

  function applyCandidate(candidate, button) {
    try {
      if (generating || generatedSignature !== JSON.stringify(planningInput())) {
        updateControls();
        return;
      }
      const observer = window.croObserver;
      if (!observer?.importConfig) throw new Error("当前工作台尚未就绪，请稍后重试。");
      const config = structuredClone(candidate.proposed_config);
      const partial = toPagePartial(config);
      window.__mcpPipelinePolicy?.prepare?.(config);
      const applied = observer.importConfig(partial);
      observer.set("customCardMemoryGB", config.cluster.card_memory_gib);
      document.dispatchEvent(new CustomEvent("mcp:parsed-config-applied", { detail: {
        normalizedConfig: config, sourceNormalizedConfig: config, sourceKind: "planning",
      } }));
      const adjusted = diffApplied(partial, applied.after);
      if (adjusted.length) throw new Error(`工作台回填值发生调整，请核对：${adjusted.map(({ field }) => field).join("、")}。`);
      document.dispatchEvent(new CustomEvent("mcp:plan-applied", { detail: { candidate } }));
      button.disabled = true;
      dialog.close();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error), true);
    }
  }

  function setFeedback(text, warning = false) {
    feedback.textContent = text;
    feedback.classList.toggle("is-warning", warning);
  }

  function renderDiagnostics(result) {
    const issues = result.data?.diagnostics?.length ? result.data.diagnostics
      : (result.errors ?? []).map((issue) => ({ ...issue, suggestion: result.quick_assessment?.next_step }));
    const panel = element("section", "mcp-plan__diagnostics");
    panel.append(element("h3", "", "哪些条件需要调整"), element("p", "mcp-plan__note",
      "以下是被排除切分的原因与示例，可能涉及不同方案；有限搜索不代表不存在其他解。"));
    for (const issue of issues) {
      const row = element("article", "mcp-plan__diagnostic");
      row.append(element("strong", "", issue.message));
      row.append(element("p", "", `相关输入：${(issue.fields ?? []).map(fieldName).join("、")}`));
      if (issue.rejected_count) row.append(element("p", "", `${issue.rejected_count} 组切分触发此问题${issue.example
        ? `；示例 TP${issue.example.tp} / PP${issue.example.pp} / EP${issue.example.ep} / CP${issue.example.cp} / DP${issue.example.dp}` : ""}`));
      if (issue.suggestion) row.append(element("p", "", `建议：${issue.suggestion}`));
      panel.append(row);
      for (const path of issue.fields ?? []) {
        const input = form.elements[path.split(".").at(-1)];
        if ((input?.tagName === "INPUT" && input.type !== "checkbox") || input?.tagName === "SELECT") input.classList.add("is-warning");
      }
    }
    results.append(panel);
  }

  function renderResult(result) {
    document.dispatchEvent(new CustomEvent("mcp:plan-result", { detail: { result } }));
    results.replaceChildren();
    const data = result.data ?? {};
    generatedFeedback = [result.quick_assessment?.conclusion ?? "规划已结束。", !data.candidates?.length || !data.viable];
    setFeedback(...generatedFeedback);
    if (data.required_inputs?.length) {
      results.append(element("p", "mcp-plan__note is-warning", "先从工作台补齐以下条件，再重新规划："));
      const list = element("ul", "mcp-plan__missing");
      data.required_inputs.forEach((path) => list.append(element("li", "", path)));
      results.append(list);
      return;
    }
    if (!data.candidates?.length) {
      renderDiagnostics(result);
      return;
    }
    results.append(element("p", "mcp-plan__note",
      `共检查 ${data.considered} 组切分，${data.valid_candidate_count} 组通过静态校验。容量均为 theoretical；候选尚未写入源文件。`));
    results.append(element("p", "mcp-plan__note", `排序依据：${(data.ranking_basis ?? []).join("；")}。`));
    for (const candidate of data.candidates) {
      const card = element("article", "mcp-plan__candidate");
      const title = element("h3", "", `方案 ${candidate.rank}`);
      const capacity = candidate.capacity;
      card.dataset.level = capacity.level;
      const heading = element("div", "mcp-plan__candidate-heading");
      heading.append(title, element("span", "mcp-plan__badge", LEVELS[capacity.level] ?? capacity.level));
      card.append(heading, element("p", "mcp-plan__config", candidate.id), element("p", "mcp-plan__metric",
        `瓶颈 Stage ${capacity.bottleneck_stage} · ${capacity.bottleneck_gib.toFixed(1)} GiB / 卡 · ${(capacity.bottleneck_ratio * 100).toFixed(0)}% · ${capacity.level}`));
      const metrics = element("dl", "mcp-plan__decision");
      const batch = candidate.proposed_config.batch;
      for (const [label, value] of [
        [capacity.headroom_gib < 0 ? "超出容量" : "剩余容量", `${Math.abs(capacity.headroom_gib).toFixed(1)} GiB`],
        ["Stage 容量差", `${capacity.stage_spread_gib.toFixed(1)} GiB`],
        ["相对本次基线改动", `${candidate.changes.length} 项`],
        ["Micro Batch / 累积次数", `${batch.micro_batch_size} / ${batch.micro_batch_count}`],
        ["静态检查", `通过 · ${candidate.validation.warning_codes.length} 项提醒`],
      ]) metrics.append(element("dt", "", label), element("dd", "", value));
      card.append(metrics);
      const topology = candidate.topology;
      if (topology) card.append(element("p", "mcp-plan__topology",
        `${topology.rank_count} Rank · ${topology.stage_count} PP Stage · ${topology.node_count} 节点（${topology.semantics}）`));
      const changes = element("ul", "mcp-plan__changes");
      if (!candidate.changes.length) changes.append(element("li", "", "沿用当前配置字段"));
      candidate.changes.forEach((change) => changes.append(element("li", "",
        `${fieldName(change.path)}：${formatValue(change.old_value)} → ${formatValue(change.new_value)}`)));
      card.append(changes);
      const tradeoffs = element("ul", "mcp-plan__tradeoffs");
      candidate.tradeoffs.forEach((note) => tradeoffs.append(element("li", "", note)));
      (candidate.validation.warnings ?? []).slice(0, 2).forEach((issue) => tradeoffs.append(element("li", "is-warning", issue.message)));
      card.append(tradeoffs, element("p", "mcp-plan__note", `safe 线：低于 ${(capacity.safe_ratio * 100).toFixed(0)}%（未校准）；未实测吞吐与训练结果。`));
      const apply = element("button", "btn btn-sm mcp-plan__apply", "应用");
      apply.type = "button";
      apply.addEventListener("click", () => applyCandidate(candidate, apply));
      card.append(apply);
      results.append(card);
    }
  }

  function mount() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "mcp-plan";
    dialog.setAttribute("aria-labelledby", "mcpPlanTitle");
    const header = element("header", "mcp-plan__header");
    const title = element("h2", "", "按资源规划候选配置");
    title.id = "mcpPlanTitle";
    const close = element("button", "btn btn-sm mcp-plan__close");
    close.type = "button";
    close.setAttribute("aria-label", "关闭资源规划");
    close.title = "关闭";
    close.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    close.addEventListener("click", () => dialog.close());
    header.append(title, close);
    const intro = element("p", "mcp-plan__intro",
      "以当前模型和批量配置为基线，比较静态合法性、Rank 拓扑与 theoretical 容量。只生成候选，不修改工程文件。");
    form = element("form", "mcp-plan__form");
    const ranks = numberInput("total_ranks", 1);
    const memory = numberInput("card_memory_gib", 0.1, "0.1");
    const globalBatch = numberInput("global_batch_size", 1);
    const goal = document.createElement("select");
    goal.name = "goal";
    for (const [value, label] of [
      ["memory-safe", "显存余量优先"],
      ["pipeline-balanced", "Stage 容量均衡"],
      ["minimal-change", "改动最少"],
    ]) {
      const option = element("option", "", label);
      option.value = value;
      goal.append(option);
    }
    const inputs = element("div", "mcp-plan__inputs");
    inputs.append(field("NPU 总数", ranks), field("每卡可用 GiB", memory),
      field("目标 Global Batch", globalBatch), field("目标", goal));
    prefillNote = element("p", "mcp-plan__note");
    const advanced = element("details", "mcp-plan__advanced");
    advanced.append(element("summary", "", "更多测试条件"), element("p", "mcp-plan__note",
      "以下数值固定参与本次比较。自动搜索 TP / PP / EP，推导 DP 和累积次数；模型结构、CP 算法、EP 口径及特性开关沿用工作台，可返回工作台调整。非均匀 PP 沿用当前层列表和 PP。"));
    const advancedInputs = element("div", "mcp-plan__inputs");
    for (const [name, label, , , , choices] of ADVANCED) {
      let input;
      if (choices) {
        input = document.createElement("select");
        input.name = name;
        const labels = { none: "关闭", selective: "选择性", layers: "指定层数", full: "完整", true: "开启", false: "关闭" };
        choices.forEach((value) => { const option = element("option", "", labels[value] ?? value.toUpperCase()); option.value = value; input.append(option); });
      } else input = numberInput(name, name === "recompute_layers" ? 0 : 1);
      advancedInputs.append(field(label, input));
    }
    advanced.append(advancedInputs);
    const lockset = element("fieldset", "mcp-plan__locks");
    lockset.append(element("legend", "", "保持不变"));
    for (const [path, label] of [
      ["parallel.tp", "TP"], ["parallel.pp", "PP"],
      ["parallel.ep", "EP"], ["parallel.dp", "DP"],
    ]) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "locked_fields";
      checkbox.value = path;
      lockset.append(field(label, checkbox));
    }
    const submit = element("button", "btn btn-sm mcp-plan__submit", "生成候选配置");
    submit.type = "submit";
    form.append(inputs, prefillNote, advanced, lockset, submit);
    feedback = element("p", "mcp-plan__feedback", "输入资源和目标后生成候选配置。");
    feedback.setAttribute("role", "status");
    results = element("div", "mcp-plan__results");
    dialog.append(header, intro, form, feedback, results);
    document.body.append(dialog);
    form.addEventListener("input", updateControls);
    form.addEventListener("change", updateControls);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      updateControls();
      if (submit.disabled) return;
      const token = ++requestToken;
      generating = true;
      generatedSignature = null;
      updateControls();
      setFeedback("正在比较静态约束、Rank 和理论容量…");
      form.querySelectorAll(".is-warning").forEach((node) => node.classList.remove("is-warning"));
      results.replaceChildren();
      try {
        const input = planningInput();
        const signature = JSON.stringify(input);
        const result = await callPlanTool(input);
        if (token === requestToken) {
          generatedSignature = signature;
          renderResult(result);
        }
      } catch (error) {
        if (token === requestToken) setFeedback(error instanceof Error ? error.message : String(error), true);
      } finally {
        if (token === requestToken) {
          generating = false;
          updateControls();
        }
      }
    });
  }

  function reveal() {
    mount();
    requestToken += 1;
    generating = false;
    generatedSignature = null;
    form.querySelector('[type="submit"]').disabled = false;
    let base;
    try {
      base = preparePlanningBaseConfig(getBaseConfig());
      form.elements.total_ranks.value = base.cluster.total_ranks;
      form.elements.card_memory_gib.value = base.cluster.card_memory_gib;
      form.elements.global_batch_size.value = base.batch.global_batch_size
        ?? 32;
    } catch {
      form.elements.total_ranks.value = window.croObserver?.config?.totalRank ?? 64;
      form.elements.card_memory_gib.value = window.croObserver?.config?.customCardMemoryGB ?? 64;
      const page = window.croObserver?.config ?? {};
      const fallback = preparePlanningBaseConfig({ parallel: { dp: page.dp }, batch: {
        micro_batch_size: page.microBatch, micro_batch_count: page.microBatchNum, global_batch_size: page.globalBatch,
      } });
      form.elements.global_batch_size.value = fallback.batch.global_batch_size ?? 32;
    }
    prefillNote.textContent = base?.batch?.global_batch_size
      ? "Global Batch 已沿用当前配置；未显式填写时按当前 Micro Batch × DP × 累积次数推导，可修改后重新比较。"
      : "Global Batch 已预填参考值，请按真实目标确认；当前基线缺失的模型和批量条件仍需先补齐。";
    for (const [name, , group, key, defaultValue] of ADVANCED) form.elements[name].value = String(base?.[group]?.[key] ?? defaultValue);
    for (const checkbox of form.querySelectorAll('input[name="locked_fields"]')) checkbox.checked = base?.policy?.locked_fields?.includes(checkbox.value) ?? false;
    results.replaceChildren();
    form.querySelectorAll(".is-warning").forEach((node) => node.classList.remove("is-warning"));
    setFeedback("确认预填条件后生成候选配置。");
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("mcp:plan-open", reveal);
  for (const name of ["cro:config-change", "mcp:parsed-config-applied", "mcp:pipeline-settings-change"]) {
    document.addEventListener(name, () => queueMicrotask(updateControls));
  }
  return { reveal };
}
