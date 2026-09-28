const REQUIRED_PATHS = new Set([
  "model.id", "model.total_layers", "model.hidden_size", "model.num_attention_heads",
  "model.routed_experts", "model.top_k", "model.shared_experts",
  "parallel.dp", "parallel.pp", "parallel.tp", "parallel.cp", "parallel.ep", "parallel.vpp",
  "parallel.ep_mode", "parallel.cp_mode", "parallel.sequence_parallel",
  "parallel.vocab_embedding_data_parallel", "parallel.expert_tensor_parallel",
  "cluster.total_ranks", "cluster.ranks_per_node", "cluster.card_model", "cluster.card_memory_gib",
  "batch.micro_batch_size", "batch.sequence_length", "batch.micro_batch_count",
  "memory.compute_dtype", "memory.parameter_dtype", "memory.recompute_mode",
  "memory.shard_mode", "memory.lora_enabled",
]);

const FIELD_GROUPS = [
  ["规则口径", [
    field("rule_profile.framework", "框架口径", "select", ["generic", "mindspeed-core", "mindspeed-llm-mcore", "mindspeed-llm-fsdp2", "mindspeed-bridge", "mindformers"]),
    field("rule_profile.version", "规则版本"),
  ]],
  ["模型结构", [
    field("model.id", "模型名称"), field("model.total_layers", "总层数", "number"),
    field("model.hidden_size", "隐藏维度", "number"), field("model.num_attention_heads", "注意力头数", "number"),
    field("model.num_key_value_heads", "KV 头数", "number", undefined, true),
    field("model.ffn_hidden_size", "FFN 隐藏维度", "number", undefined, true),
    field("model.expert_ffn_hidden_size", "专家 FFN 维度", "number", undefined, true),
    field("model.vocab_size", "词表大小", "number", undefined, true),
    field("model.routed_experts", "路由专家数", "number"), field("model.top_k", "TopK", "number"),
    field("model.shared_experts", "共享专家数", "number"),
  ]],
  ["并行策略", [
    field("parallel.dp", "DP", "number"), field("parallel.pp", "PP", "number"),
    field("parallel.tp", "TP", "number"), field("parallel.cp", "CP", "number"),
    field("parallel.ep", "EP", "number"), field("parallel.vpp", "VPP", "number"),
    field("parallel.ep_mode", "EP 口径", "select", ["split", "orthogonal", "mf"]),
    field("parallel.cp_mode", "CP 模式", "select", ["ulysses", "ring"]),
    field("parallel.sequence_parallel", "序列并行", "boolean"),
    field("parallel.vocab_embedding_data_parallel", "词表嵌入 DP", "boolean"),
    field("parallel.expert_tensor_parallel", "专家张量并行", "boolean"),
  ]],
  ["集群与批次", [
    field("cluster.total_ranks", "总 Rank", "number"), field("cluster.ranks_per_node", "每节点 Rank", "number"),
    field("cluster.card_model", "卡型号"), field("cluster.card_memory_gib", "单卡显存 GiB", "number"),
    field("batch.micro_batch_size", "Micro Batch", "number"), field("batch.sequence_length", "序列长度", "number"),
    field("batch.micro_batch_count", "Micro Batch 数", "number"),
    field("batch.global_batch_size", "Global Batch", "number", undefined, true),
  ]],
  ["精度与内存", [
    field("memory.compute_dtype", "计算精度", "select", ["bf16", "fp16", "fp8"]),
    field("memory.parameter_dtype", "参数精度", "select", ["bf16", "fp32"]),
    field("memory.recompute_mode", "重计算", "select", ["none", "selective", "layers", "full"]),
    field("memory.recompute_layers", "重计算层数", "number", undefined, true),
    field("memory.shard_mode", "权重分片", "select", ["none", "zero1", "fsdp2"]),
    field("memory.lora_enabled", "启用 LoRA", "boolean"),
    field("memory.lora_rank", "LoRA Rank", "number", undefined, true),
  ]],
];

const DEFAULTS = {
  "rule_profile.framework": "generic",
  "rule_profile.version": "v1-workbench",
  "model.routed_experts": 0,
  "model.top_k": 0,
  "model.shared_experts": 0,
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
  "cluster.ranks_per_node": 8,
  "batch.micro_batch_size": 1,
  "batch.micro_batch_count": 1,
  "memory.compute_dtype": "bf16",
  "memory.parameter_dtype": "fp32",
  "memory.recompute_mode": "none",
  "memory.shard_mode": "none",
  "memory.lora_enabled": false,
};

const OPTION_LABELS = {
  generic: "通用页面口径",
  "mindspeed-core": "MindSpeed Core",
  "mindspeed-llm-mcore": "MindSpeed-LLM MCore",
  "mindspeed-llm-fsdp2": "MindSpeed-LLM FSDP2",
  "mindspeed-bridge": "MindSpeed Bridge",
  mindformers: "MindFormers",
  split: "切分域",
  orthogonal: "正交域",
  mf: "MindFormers 口径",
  ulysses: "Ulysses",
  ring: "Ring",
  bf16: "BF16",
  fp16: "FP16",
  fp8: "FP8",
  fp32: "FP32",
  none: "关闭",
  selective: "选择性重计算",
  layers: "按层重计算",
  full: "全量重计算",
  zero1: "ZeRO-1",
  fsdp2: "FSDP2",
};

function field(path, label, type = "text", options, optional = false) {
  return { path, label, type, options, optional };
}

export function createWorkbench({ app, renderResult }) {
  const root = document.getElementById("workbench");
  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const pasteName = document.getElementById("pasteName");
  const pasteFormat = document.getElementById("pasteFormat");
  const pasteContent = document.getElementById("pasteContent");
  const sourceList = document.getElementById("sourceList");
  const sourceMessage = document.getElementById("sourceMessage");
  const configPanel = document.getElementById("configPanel");
  const configForm = document.getElementById("configForm");
  const coverageSummary = document.getElementById("coverageSummary");
  const conflictList = document.getElementById("conflictList");
  const actionPanel = document.getElementById("actionPanel");
  const actionHint = document.getElementById("actionHint");
  const actionMessage = document.getElementById("actionMessage");
  const state = { sources: [], config: emptyConfig(), provenance: new Map(), conflicts: [], active: false };

  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.dataset.dragging = "true";
  });
  dropZone.addEventListener("dragleave", () => delete dropZone.dataset.dragging);
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    delete dropZone.dataset.dragging;
    addFiles(event.dataTransfer.files);
  });
  document.getElementById("addPaste").addEventListener("click", addPastedSource);
  document.getElementById("parseSources").addEventListener("click", parseSources);
  document.getElementById("fillDefaults").addEventListener("click", fillDefaults);
  for (const button of document.querySelectorAll("[data-tool]")) {
    button.addEventListener("click", () => runAnalysis(button.dataset.tool));
  }

  return {
    open() {
      state.active = true;
      root.hidden = false;
      document.getElementById("title").textContent = "中文训练配置工作台";
      document.getElementById("summary").textContent = "上传或粘贴真实配置，自动识别字段；缺什么会直接在表单中标出来。无需手写 MCP JSON。";
      const status = document.getElementById("status");
      status.textContent = "可以开始";
      status.dataset.status = "valid";
      if (!state.sources.length) renderSources();
    },
    get active() { return state.active; },
  };

  async function addFiles(fileList) {
    const files = [...fileList];
    if (state.sources.length + files.length > 12) {
      showMessage(sourceMessage, "一次最多加入 12 个文件。", "error");
      return;
    }
    for (const file of files) {
      if (file.size > 1024 * 1024) {
        showMessage(sourceMessage, `${file.name} 超过 1 MiB，未加入。`, "error");
        continue;
      }
      state.sources.push({ id: crypto.randomUUID(), name: file.name, format: "auto", content: await file.text() });
    }
    fileInput.value = "";
    showMessage(sourceMessage, files.length ? `已加入 ${files.length} 个文件，请点击“解析全部配置”。` : "", "ok");
    renderSources();
  }

  function addPastedSource() {
    const content = pasteContent.value.trim();
    if (!content) {
      showMessage(sourceMessage, "请先粘贴配置内容。", "error");
      pasteContent.focus();
      return;
    }
    state.sources.push({
      id: crypto.randomUUID(),
      name: pasteName.value.trim() || "pasted-config.txt",
      format: pasteFormat.value,
      content,
    });
    pasteContent.value = "";
    renderSources();
    showMessage(sourceMessage, "粘贴内容已加入，请点击“解析全部配置”。", "ok");
  }

  function renderSources() {
    sourceList.replaceChildren();
    if (!state.sources.length) {
      sourceList.append(make("div", "source-empty", "尚未加入配置文件。"));
      return;
    }
    for (const source of state.sources) {
      const row = make("article", "source-item");
      const header = make("div", "source-main");
      const detail = make("div", "source-name");
      detail.append(make("strong", "", source.name), make("span", "", `${formatLabel(source)} · ${formatBytes(source.content.length)}`));
      if (source.result) detail.append(make("span", "source-result", `映射 ${source.result.mapped_count} · 未识别 ${source.result.unmapped_count} · 忽略 ${source.result.ignored_count}`));
      const remove = make("button", "icon-button", "移除");
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.sources = state.sources.filter(({ id }) => id !== source.id);
        renderSources();
      });
      header.append(detail, remove);
      row.append(header);
      if (source.result?.unmapped_fields?.length) {
        const details = make("details", "source-details");
        details.append(make("summary", "", `查看 ${source.result.unmapped_fields.length} 个未识别字段`));
        const list = make("div", "source-detail-list");
        for (const item of source.result.unmapped_fields) {
          list.append(make("div", "", `${item.source_key}：${item.reason}`));
        }
        details.append(list);
        row.append(details);
      }
      sourceList.append(row);
    }
  }

  async function parseSources() {
    if (!state.sources.length) {
      showMessage(sourceMessage, "请先选择文件或加入粘贴内容。", "error");
      return;
    }
    setBusy(true, "正在解析配置……");
    state.config = emptyConfig();
    state.provenance = new Map();
    state.conflicts = [];
    let mapped = 0;
    let unmapped = 0;
    try {
      for (const source of state.sources) {
        const response = await app.callServerTool({
          name: "parse_training_config",
          arguments: {
            schema_version: "1.0",
            rule_profile: { framework: "generic", version: "v1-workbench" },
            source: { format: source.format, name: source.name, content: source.content },
          },
        });
        if (response.isError || !response.structuredContent?.data) throw new Error(toolError(response));
        const data = response.structuredContent.data;
        source.result = data;
        mapped += data.mapped_count;
        unmapped += data.unmapped_count;
        for (const item of data.mapped_fields) mergeValue(item.target_path, item.value, source.name);
      }
      if (!getPath(state.config, "model.id")) {
        setPath(state.config, "model.id", state.sources[0].name.replace(/\.[^.]+$/, ""));
        state.provenance.set("model.id", "由首个文件名生成，请确认");
      }
      renderSources();
      renderConfigForm();
      configPanel.hidden = false;
      actionPanel.hidden = false;
      coverageSummary.textContent = `共识别 ${mapped} 个字段，未识别 ${unmapped} 个；合并后仍缺 ${missingPaths(state.config).length} 个必填项`;
      showMessage(sourceMessage, "解析完成。请在第二步核对自动合并结果，并补齐红色必填项。", "ok");
    } catch (error) {
      showMessage(sourceMessage, `解析失败：${error.message}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function mergeValue(path, value, sourceName) {
    const previous = getPath(state.config, path);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(value)) {
      state.conflicts.push({ path, previous, next: value, previousSource: state.provenance.get(path), nextSource: sourceName });
    }
    setPath(state.config, path, value);
    state.provenance.set(path, sourceName);
  }

  function renderConfigForm() {
    configForm.replaceChildren();
    renderConflicts();
    for (const [groupName, fields] of FIELD_GROUPS) {
      const group = make("section", "field-group");
      group.append(make("h3", "", groupName));
      const grid = make("div", "field-grid");
      for (const definition of fields) grid.append(renderField(definition));
      group.append(grid);
      configForm.append(group);
    }
    updateActions();
  }

  function renderField(definition) {
    const wrapper = make("label", "config-field");
    wrapper.dataset.missing = String(REQUIRED_PATHS.has(definition.path) && getPath(state.config, definition.path) === undefined);
    const caption = make("span", "field-label", definition.label);
    if (definition.optional) caption.append(make("small", "", "可选"));
    const control = createControl(definition, getPath(state.config, definition.path));
    control.dataset.path = definition.path;
    control.addEventListener("change", () => {
      const value = readControl(control, definition.type);
      if (value === undefined) deletePath(state.config, definition.path);
      else setPath(state.config, definition.path, value);
      state.provenance.set(definition.path, "用户填写");
      wrapper.dataset.missing = String(REQUIRED_PATHS.has(definition.path) && value === undefined);
      source.textContent = value === undefined ? "缺少" : "用户填写";
      updateActions();
    });
    const source = make("small", "field-source", state.provenance.get(definition.path) ?? (definition.optional ? "未提供（可选）" : "缺少"));
    wrapper.append(caption, control, source);
    return wrapper;
  }

  function createControl(definition, value) {
    let control;
    if (definition.type === "select" || definition.type === "boolean") {
      control = document.createElement("select");
      control.append(new Option("请选择", ""));
      const options = definition.type === "boolean"
        ? [["是", "true"], ["否", "false"]]
        : definition.options.map((item) => [OPTION_LABELS[item] ?? item, item]);
      for (const [label, optionValue] of options) control.append(new Option(label, optionValue));
      if (value !== undefined) control.value = String(value);
    } else {
      control = document.createElement("input");
      control.type = definition.type;
      if (definition.type === "number") { control.min = "0"; control.step = "1"; }
      if (value !== undefined) control.value = value;
    }
    return control;
  }

  function fillDefaults() {
    let count = 0;
    for (const [path, value] of Object.entries(DEFAULTS)) {
      if (getPath(state.config, path) !== undefined) continue;
      setPath(state.config, path, value);
      state.provenance.set(path, "工作台默认值，请确认");
      count += 1;
    }
    renderConfigForm();
    coverageSummary.textContent = `填入 ${count} 个常用默认值；仍缺 ${missingPaths(state.config).length} 个必填项`;
  }

  function renderConflicts() {
    conflictList.replaceChildren();
    for (const conflict of state.conflicts) {
      conflictList.append(make("div", "conflict-item", `⚠ ${conflict.path}：${conflict.previousSource} 的 ${JSON.stringify(conflict.previous)} 被 ${conflict.nextSource} 的 ${JSON.stringify(conflict.next)} 覆盖，请确认。`));
    }
  }

  function updateActions() {
    const missing = missingPaths(state.config);
    actionHint.textContent = missing.length ? `还缺 ${missing.length} 个必填项：${missing.slice(0, 4).join("、")}${missing.length > 4 ? "……" : ""}` : "输入已完整，可以选择分析";
    for (const button of document.querySelectorAll("[data-tool]")) button.disabled = missing.length > 0;
  }

  async function runAnalysis(toolName) {
    const missing = missingPaths(state.config);
    if (missing.length) {
      showMessage(actionMessage, `还不能运行，请补齐：${missing.join("、")}`, "error");
      return;
    }
    setBusy(true, "正在分析……");
    showMessage(actionMessage, "正在调用 MCP Tool……", "ok");
    try {
      const response = await app.callServerTool({ name: toolName, arguments: cleanConfig(state.config) });
      if (response.isError || !response.structuredContent) throw new Error(toolError(response));
      renderResult(response.structuredContent);
      showMessage(actionMessage, "分析完成，结果显示在下方。", "ok");
      document.getElementById("metrics").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showMessage(actionMessage, `分析失败：${error.message}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function setBusy(busy, message = "") {
    for (const button of root.querySelectorAll("button")) button.disabled = busy;
    if (!busy) updateActions();
    if (message) showMessage(sourceMessage, message, "ok");
  }
}

function emptyConfig() {
  return {
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "v1-workbench" },
    policy: { locked_fields: [], objective: "minimal-change" },
  };
}

function missingPaths(config) {
  return [...REQUIRED_PATHS].filter((path) => getPath(config, path) === undefined);
}

function cleanConfig(value) {
  if (Array.isArray(value)) return value.map(cleanConfig);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, cleanConfig(child)]));
}

function getPath(target, path) {
  return path.split(".").reduce((cursor, part) => cursor?.[part], target);
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = value;
}

function deletePath(target, path) {
  const parts = path.split(".");
  const parent = parts.slice(0, -1).reduce((cursor, part) => cursor?.[part], target);
  if (parent) delete parent[parts.at(-1)];
}

function readControl(control, type) {
  if (control.value === "") return undefined;
  if (type === "number") return Number(control.value);
  if (type === "boolean") return control.value === "true";
  return control.value;
}

function formatLabel(source) {
  if (source.format !== "auto") return source.format.toUpperCase();
  const extension = source.name.toLowerCase().split(".").at(-1);
  if (extension === "json") return "JSON（自动）";
  if (["yaml", "yml"].includes(extension)) return "YAML（自动）";
  if (["sh", "bash"].includes(extension)) return "Shell（自动）";
  return "自动判断";
}

function formatBytes(length) {
  return length < 1024 ? `${length} 字符` : `${(length / 1024).toFixed(1)} KiB`;
}

function toolError(response) {
  return response?.content?.find(({ type }) => type === "text")?.text ?? "Tool 返回错误";
}

function showMessage(node, text, kind) {
  node.textContent = text;
  node.dataset.kind = kind;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
