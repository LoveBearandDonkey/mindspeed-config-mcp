import { toolReadinessForMissingFields } from "@mindspeed-config/config-core";

export { toolReadinessForMissingFields };

export const PAGE_FIELDS = Object.freeze({
  "model.total_layers": "totalLayer",
  "model.routed_experts": "routedExpert",
  "model.top_k": "topK",
  "model.shared_experts": "sharedExpert",
  "parallel.dp": "dp",
  "parallel.pp": "pp",
  "parallel.tp": "tp",
  "parallel.cp": "cp",
  "parallel.ep": "ep",
  "parallel.vpp": "vpp",
  "parallel.ep_mode": "epMode",
  "parallel.cp_mode": "cpMode",
  "parallel.sequence_parallel": "seqParallel",
  "parallel.vocab_embedding_data_parallel": "vocabEmbDp",
  "parallel.expert_tensor_parallel": "expertTp",
  "cluster.total_ranks": "totalRank",
  "batch.micro_batch_size": "microBatch",
  "batch.sequence_length": "seqLen",
  "batch.micro_batch_count": "microBatchNum",
  "memory.compute_dtype": "dtype",
  "memory.parameter_dtype": "paramsDtype",
  "memory.recompute_mode": "recomputeMode",
  "memory.recompute_layers": "recomputeLayers",
  "memory.shard_mode": "shardMode",
  "memory.lora_enabled": "lora",
  "memory.lora_rank": "loraRank",
});

const MCP_PAGE_FIELDS = Object.freeze({
  "parallel.pipeline_layer_mode": "mcpPipelineLayerMode",
  "parallel.num_layer_list": "mcpPipelineLayerMode",
  "parallel.pipeline_layer_offsets": "mcpPipelineLayerMode",
});

export const ANALYSIS_TOOL_LABELS = Object.freeze({
  validate_parallel_config: "配置校验",
  compute_rank_topology: "Rank 拓扑",
  suggest_config_fixes: "配置修复建议",
  estimate_training_capacity: "理论内存估算",
});

export function missingFieldImpactRows(missingFields = []) {
  const readiness = toolReadinessForMissingFields(missingFields);
  return [...new Set(missingFields)].map((path) => ({
    path,
    label: labelForPath(path),
    affected_tools: Object.entries(readiness)
      .filter(([, state]) => state.missing_fields.includes(path))
      .map(([tool]) => ({ tool, label: ANALYSIS_TOOL_LABELS[tool] })),
  }));
}

const PATH_LABELS = Object.freeze({
  "model.id": "模型标识",
  "model.total_layers": "Total Layer",
  "model.hidden_size": "Hidden Size",
  "model.num_attention_heads": "Attention Heads",
  "model.ffn_hidden_size": "Dense FFN Hidden Size",
  "model.expert_ffn_hidden_size": "Expert FFN Hidden Size",
  "model.vocab_size": "Vocab Size",
  "model.first_k_dense_layers": "前置 Dense 层数",
  "model.routed_experts": "Routed",
  "model.top_k": "Top-K",
  "model.shared_experts": "Shared",
  "parallel.dp": "DP",
  "parallel.pp": "PP",
  "parallel.tp": "TP",
  "parallel.cp": "CP",
  "parallel.ep": "EP",
  "parallel.vpp": "VPP",
  "parallel.pipeline_layer_mode": "PP 分层",
  "parallel.num_layer_list": "各 Stage 层数",
  "parallel.pipeline_layer_offsets": "MindFormers PP 层偏置矩阵",
  "rule_profile.framework": "规则口径",
  "rule_profile.version": "规则版本",
  "rule_profile.source_commit": "规则来源 Commit",
  "parallel.ep_mode": "EP 口径",
  "parallel.cp_mode": "CP 口径",
  "parallel.sequence_parallel": "序列并行 SP",
  "parallel.vocab_embedding_data_parallel": "词表走 DP",
  "parallel.expert_tensor_parallel": "专家切 TP",
  "cluster.total_ranks": "Total Rank",
  "cluster.ranks_per_node": "每节点 Rank 数",
  "cluster.card_model": "卡型号",
  "cluster.card_memory_gib": "单卡显存",
  "batch.micro_batch_size": "Micro Batch",
  "batch.sequence_length": "Seq Length",
  "batch.micro_batch_count": "micro_batch_num",
  "memory.compute_dtype": "计算精度",
  "memory.parameter_dtype": "主权重精度",
  "memory.recompute_mode": "重计算",
  "memory.recompute_layers": "重算层数",
  "memory.shard_mode": "权重分片",
  "memory.lora_enabled": "LoRA",
  "memory.lora_rank": "LoRA Rank",
});

const KIND_LABELS = Object.freeze({
  explicit: "已映射 · 原文显式值",
  derived: "推导 · 由同一文件计算",
  default: "默认 · 配置方言省略态",
});

/* 分组标题与说明已经交代过的通用原因，不再在每个配置项后重复一遍。具体的转换
   失败、派生用途或关闭态原因仍逐项保留。配置下拉与导入面板共用这份报告。 */
const REDUNDANT_ITEM_REASONS = new Set([
  "没有已登记的字段映射",
  "不属于第一版统一训练配置契约",
]);

function conciseItemReason(reason) {
  const text = String(reason ?? "").trim();
  return REDUNDANT_ITEM_REASONS.has(text) ? "" : text;
}

export function pageFieldForPath(path) {
  return PAGE_FIELDS[path] ?? MCP_PAGE_FIELDS[path] ?? null;
}

export function fillableMappedPathCount(result) {
  return new Set((result?.data?.mapped_fields ?? [])
    .map((item) => item.target_path)
    .filter((path) => pageFieldForPath(path))).size;
}

export function formatFillCoverageScore(result) {
  if (!result || result.status === "error") return "— · 解析失败";
  const data = result.data ?? {};
  const sourceTotal = data.source_field_count ?? (
    (data.explicit_mapped_count ?? 0) + (data.unmapped_count ?? 0) + (data.ignored_count ?? 0)
  );
  const requiredTotal = data.required_field_count ?? 0;
  const filledRequired = data.filled_required_field_count ?? Math.max(
    0,
    requiredTotal - (data.missing_required_fields ?? []).length,
  );
  const gap = Math.max(0, requiredTotal - filledRequired);
  const sourceLabel = data.model_source_name ? "两份来源" : "本文件";
  return `${sourceLabel}共 ${sourceTotal} 个配置，其中 ${filledRequired} 项可回填 MCP，缺口 ${gap} 项。`
    + `MCP 校验必填项 ${filledRequired}/${requiredTotal}`
    + (gap > 0 ? "（补齐缺口后才能校验）" : "（已满足校验条件）");
}

export function labelForPath(path) {
  return PATH_LABELS[path] ?? path;
}

export function inferSourceFormat(name = "") {
  const extension = String(name).toLowerCase().split(".").at(-1);
  if (extension === "json") return "json";
  if (["sh", "bash"].includes(extension)) return "shell";
  if (["yaml", "yml"].includes(extension)) return "yaml";
  return "auto";
}

export function getPath(value, path) {
  return String(path).split(".").reduce((current, key) => current?.[key], value);
}

export function toPagePartial(normalized = {}) {
  const partial = {};
  for (const [path, field] of Object.entries(PAGE_FIELDS)) {
    const value = getPath(normalized, path);
    if (value !== undefined) partial[field] = value;
  }

  const totalRanks = getPath(normalized, "cluster.total_ranks");
  const ranksPerNode = getPath(normalized, "cluster.ranks_per_node");
  if (Number.isInteger(totalRanks) && totalRanks > 0
    && Number.isInteger(ranksPerNode) && ranksPerNode > 0) {
    partial.node = Math.ceil(totalRanks / ranksPerNode);
  }
  return partial;
}

/* 页面会把暂时不可用的控件停回默认档；这些档位在当前并行度下没有计算差异，
   不应冒充对用户配置的有效修改。控件重新可用时，真实差异仍由下方比较照常报告。 */
function isInactivePageNormalization(field, after) {
  if (field === "cpMode") return Number(after.cp) <= 1;
  if (["seqParallel", "vocabEmbDp"].includes(field)) return Number(after.tp) <= 1;
  if (field === "expertTp") return Number(after.tp) <= 1 || after.epMode === "mf";
  if (field === "shardMode") return Number(after.dp) <= 1;
  if (field === "recomputeLayers") return after.recomputeMode !== "layers";
  if (field === "loraRank") return !after.lora;
  return false;
}

export function diffApplied(partial, after = {}) {
  return Object.entries(partial).flatMap(([field, want]) => {
    const got = after[field];
    return Object.is(want, got) || isInactivePageNormalization(field, after)
      ? []
      : [{ field, want, got }];
  });
}

export function sourceMarks(result, adjusted = []) {
  const changed = new Map(adjusted.map((item) => [item.field, item.got]));
  return (result?.data?.mapped_fields ?? []).flatMap((item) => {
    const field = pageFieldForPath(item.target_path);
    if (!field) return [];
    return [{
      field,
      token: String(item.source_key ?? "").split(".").at(-1),
      label: labelForPath(item.target_path),
      value: item.value,
      got: changed.has(field) ? changed.get(field) : null,
    }];
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatValue(value) {
  if (typeof value === "boolean") return value ? "开" : "关";
  if (value === null) return "null";
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  return escapeHtml(value);
}

function labelForPageField(field) {
  if (field === "node") return "节点数";
  const path = Object.entries(PAGE_FIELDS).find(([, pageField]) => pageField === field)?.[0];
  return path ? labelForPath(path) : field;
}

function section(title, items, hint = "", className = "") {
  if (!items.length) return "";
  return `<div class="cro-import__block ${className}"><h4>${title} <span>${items.length}</span></h4>`
    + (hint ? `<p class="cro-import__hint">${hint}</p>` : "")
    + `<ul>${items.join("")}</ul></div>`;
}

export function renderParseReport(result, { adjusted = [] } = {}) {
  if (!result || result.status === "error") {
    const errors = result?.errors ?? [];
    const message = errors.length
      ? errors.map((item) => item.message).join("；")
      : "解析失败，MCP Tool 没有返回可用结果。";
    return `<p class="cro-import__empty" data-mcp-parse-report="error">解析失败：${escapeHtml(message)}</p>`;
  }

  const data = result.data ?? {};
  const mapped = data.mapped_fields ?? [];
  const partial = toPagePartial(data.normalized_config);
  const format = { yaml: "YAML", json: "JSON", shell: "Shell 命令行" }[data.detected_format]
    ?? data.detected_format ?? "未知格式";
  const modelFormat = { yaml: "YAML", json: "JSON", shell: "Shell 命令行" }[data.model_detected_format]
    ?? data.model_detected_format ?? "未知格式";
  const sourceSummary = data.model_source_name
    ? `训练配置 <b>${escapeHtml(format)}</b> + 模型结构 <b>${escapeHtml(modelFormat)}</b>`
    : `<b>${escapeHtml(format)}</b>`;
  const parseLead = data.model_source_name
    ? `MCP 已联动解析 ${sourceSummary}`
    : `MCP 识别为 ${sourceSummary}`;
  const output = [
    `<p class="cro-import__lede" data-mcp-parse-report="valid">${parseLead}：`
      + `原文映射 <b>${data.explicit_mapped_count ?? 0}</b> 项，`
      + `同文件推导 <b>${data.derived_count ?? 0}</b> 项，`
      + `省略态默认 <b>${data.defaulted_count ?? 0}</b> 项；`
      + `可回填当前表单 <b>${fillableMappedPathCount(result)}</b> 项，`
      + `未识别 <b>${data.unmapped_count ?? 0}</b> 项，`
      + `仍缺输入 <b>${(data.missing_required_fields ?? []).length}</b> 项。`
      + `解析过程<b>不启动训练</b>。</p>`,
  ];

  output.push(section(
    "来源冲突 · 已显式列出",
    (data.source_conflicts ?? []).map((item) => `<li><b>${escapeHtml(labelForPath(item.path))}</b>`
      + `<br><span class="cro-import__note">训练配置 ${escapeHtml(item.training.source_key)} = `
      + `<b>${formatValue(item.training.value)}</b>；模型结构 ${escapeHtml(item.model.source_key)} = `
      + `<b>${formatValue(item.model.value)}</b>。联合候选采用${item.resolution === "training_source" ? "训练配置" : "模型结构"}值。</span></li>`),
    "模型结构文件负责 model.*；冲突按 explicit > derived > default 合并，同级采用模型结构值，请在应用前核对。",
    "is-warn",
  ));

  if (adjusted.length) {
    output.push(`<div class="cro-import__block is-warn"><h4>已应用到表单；页面自动调整了 ${adjusted.length} 项</h4>`
      + `<p class="cro-import__hint">应用已经完成。为维持并行乘积和整除约束，表单采用了以下自洽值；无需再次点击“应用到表单”。</p><ul>`
      + adjusted.map((item) => `<li><code>${escapeHtml(item.field)}</code>：`
        + `输入 <b>${formatValue(item.want)}</b> → 页面采用 <b>${formatValue(item.got)}</b></li>`).join("")
      + `</ul></div>`);
  }

  for (const kind of ["explicit", "derived", "default"]) {
    const rows = mapped.filter((item) => item.mapping_kind === kind).map((item) =>
      `<li><b>${escapeHtml(labelForPath(item.target_path))}</b> = <b>${formatValue(item.value)}</b>`
        + `<span class="cro-import__from">← ${item.source_role === "model" ? "模型结构 · " : ""}${escapeHtml(item.source_key)}</span>`
        + `</li>`);
    output.push(section(KIND_LABELS[kind], rows));
  }

  output.push(section(
    "未识别 · 没有静默丢弃",
    (data.unmapped_fields ?? []).map((item) => {
      const reason = conciseItemReason(item.reason);
      const reasonNote = reason
        ? `<br><span class="cro-import__note">${escapeHtml(reason)}</span>` : "";
      return `<li><code>${item.source_role === "model" ? "模型结构 · " : ""}${escapeHtml(item.source_key)}</code> = `
        + `<b>${formatValue(item.value)}</b>${reasonNote}</li>`;
    }),
    "这些键没有已登记映射，保留在报告中供补规则或人工判断。",
    "is-unknown",
  ));
  output.push(section(
    "已识别 · 第一版暂不建模",
    (data.ignored_fields ?? []).map((item) => {
      const reason = conciseItemReason(item.reason);
      const reasonSuffix = reason
        ? `<span class="cro-import__from">${escapeHtml(reason)}</span>` : "";
      return `<li><code>${item.source_role === "model" ? "模型结构 · " : ""}${escapeHtml(item.source_key)}</code>`
        + `${reasonSuffix}</li>`;
    }),
    "训练路径、日志、优化器超参等不进入当前配置关系平面。",
    "is-skip",
  ));
  output.push(section(
    "仍缺输入",
    (data.missing_required_fields ?? []).map((path) => `<li><b>${escapeHtml(labelForPath(path))}</b>`
      + `<span class="cro-import__from">${escapeHtml(path)}</span></li>`),
    "解析本身已经完成；补齐这些字段后，统一配置才可直接交给后续校验、Rank 和容量 Tool。",
    "is-gap",
  ));

  return output.join("");
}

export function renderAppliedStatus(adjusted = []) {
  const changed = Array.isArray(adjusted) ? adjusted : [];
  const hasAdjustments = changed.length > 0;
  const title = hasAdjustments
    ? `配置已应用，页面自动调整了 ${changed.length} 项`
    : "配置已成功应用到表单";
  const description = hasAdjustments
    ? "表单已更新为满足并行乘积和整除约束的结果。"
    : "所有可回填项均已写入，可以继续检查或修改表单。";
  const details = hasAdjustments
    ? `<div class="mcp-import-applied__details"><ul>`
      + changed.map((item) => `<li><b>${escapeHtml(labelForPageField(item.field))}</b>：`
        + `输入 ${formatValue(item.want)} → 页面采用 ${formatValue(item.got)}</li>`).join("")
      + `</ul></div>`
    : "";
  return `<section class="mcp-import-applied ${hasAdjustments ? "is-adjusted" : "is-success"}" `
    + `id="mcpImportAppliedStatus" role="status" aria-live="polite" tabindex="-1">`
    + `<div class="mcp-import-applied__copy"><strong>${title}</strong><p>${description}</p></div>`
    + `<button class="btn btn-sm btn-ghost btn-icon mcp-import-applied__dismiss" type="button" `
    + `data-dismiss-mcp-import-applied aria-label="关闭应用结果">×</button>${details}</section>`;
}
