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

  function renderResult(result) {
    document.dispatchEvent(new CustomEvent("mcp:plan-result", { detail: { result } }));
    results.replaceChildren();
    const data = result.data ?? {};
    feedback.textContent = result.quick_assessment?.conclusion ?? "规划已结束。";
    if (data.required_inputs?.length) {
      results.append(element("p", "mcp-plan__note", "先从工程补齐以下条件，再重新规划："));
      const list = element("ul", "mcp-plan__missing");
      data.required_inputs.forEach((path) => list.append(element("li", "", path)));
      results.append(list);
      return;
    }
    if (!data.candidates?.length) {
      results.append(element("p", "mcp-plan__note", result.errors?.[0]?.message ?? "当前约束下没有候选。"));
      return;
    }
    results.append(element("p", "mcp-plan__note",
      `共检查 ${data.considered} 组切分，${data.valid_candidate_count} 组通过静态校验。容量均为 theoretical；候选尚未写入源文件。`));
    for (const candidate of data.candidates) {
      const card = element("article", "mcp-plan__candidate");
      const title = element("h3", "", `方案 ${candidate.rank} · ${candidate.id}`);
      const capacity = candidate.capacity;
      card.append(title, element("p", "mcp-plan__metric",
        `瓶颈 Stage ${capacity.bottleneck_stage} · ${capacity.bottleneck_gib.toFixed(1)} GiB / 卡 · ${(capacity.bottleneck_ratio * 100).toFixed(0)}% · ${capacity.level}`));
      const topology = candidate.topology;
      if (topology) card.append(element("p", "mcp-plan__topology",
        `${topology.rank_count} Rank · ${topology.stage_count} PP Stage · ${topology.node_count} 节点（${topology.semantics}）`));
      const changes = element("ul", "mcp-plan__changes");
      if (!candidate.changes.length) changes.append(element("li", "", "沿用当前配置字段"));
      candidate.changes.forEach((change) => changes.append(element("li", "",
        `${change.path}: ${formatValue(change.old_value)} → ${formatValue(change.new_value)}`)));
      card.append(changes);
      const tradeoffs = element("ul", "mcp-plan__tradeoffs");
      candidate.tradeoffs.forEach((note) => tradeoffs.append(element("li", "", note)));
      card.append(tradeoffs);
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
    const close = element("button", "btn btn-sm", "关闭");
    close.type = "button";
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
    const submit = element("button", "btn btn-sm mcp-plan__submit", "比较候选");
    submit.type = "submit";
    form.append(inputs, lockset, submit);
    feedback = element("p", "mcp-plan__feedback", "输入资源和目标后比较候选。");
    feedback.setAttribute("role", "status");
    results = element("div", "mcp-plan__results");
    dialog.append(header, intro, form, feedback, results);
    document.body.append(dialog);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = ++requestToken;
      submit.disabled = true;
      feedback.textContent = "正在调用 MCP 比较静态约束、Rank 和理论容量…";
      results.replaceChildren();
      try {
        let baseConfig;
        try { baseConfig = getBaseConfig(); } catch { baseConfig = undefined; }
        if (baseConfig) {
          baseConfig = structuredClone(baseConfig);
          baseConfig.batch.global_batch_size = Number(globalBatch.value);
        }
        const input = {
          schema_version: "1.0",
          resources: {
            total_ranks: Number(ranks.value),
            card_memory_gib: Number(memory.value),
          },
          goal: goal.value,
          ...(baseConfig ? { base_config: baseConfig } : {}),
          locked_fields: [...form.querySelectorAll('input[name="locked_fields"]:checked')]
            .map((checkbox) => checkbox.value),
        };
        const result = await callPlanTool(input);
        if (token === requestToken) renderResult(result);
      } catch (error) {
        if (token === requestToken) feedback.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        if (token === requestToken) submit.disabled = false;
      }
    });
  }

  function reveal() {
    mount();
    try {
      const base = getBaseConfig();
      form.elements.total_ranks.value = base.cluster.total_ranks;
      form.elements.card_memory_gib.value = base.cluster.card_memory_gib;
      form.elements.global_batch_size.value = base.batch.global_batch_size
        ?? window.croObserver?.config?.globalBatch ?? "";
    } catch {
      form.elements.total_ranks.value = window.croObserver?.config?.totalRank ?? 64;
      form.elements.card_memory_gib.value = window.croObserver?.config?.customCardMemoryGB ?? 64;
      form.elements.global_batch_size.value = window.croObserver?.config?.globalBatch ?? "";
    }
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("mcp:plan-open", reveal);
  return { reveal };
}
