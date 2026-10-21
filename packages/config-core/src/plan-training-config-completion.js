import { suggestConfigFixes } from "./suggest-config-fixes.js";
import { estimateTrainingCapacity } from "./estimate-training-capacity.js";
import { validateParallelConfig } from "./validate-parallel-config.js";
import { parallelWorld } from "./page-rules.js";

const COMPLETION_SOURCE = "mindspeed-config-mcp:plan-training-config-completion@0.3.2";
const DEEPSEEK_SOURCE = "compute-graph-viewer-wzh:config-test/hf_deepseekv3_config.json";
const EDITABLE_STRUCTURE_PRESET_SOURCE = "mindspeed-config-mcp:editable-model-structure-preset@0.3.1";
const EDITABLE_MODEL_STRUCTURE_PRESET = Object.freeze({
  "model.id": "editable-moe-structure-preset",
  "model.total_layers": 46,
  "model.hidden_size": 2560,
  "model.num_attention_heads": 48,
  "model.ffn_hidden_size": 9216,
  "model.expert_ffn_hidden_size": 1024,
  "model.vocab_size": 151552,
  "model.first_k_dense_layers": 2,
  "model.routed_experts": 256,
  "model.top_k": 8,
  "model.shared_experts": 1,
});
const REVIEWABLE_REPAIR_PATHS = Object.freeze([
  "model.total_layers",
  "model.hidden_size",
  "model.num_attention_heads",
  "model.routed_experts",
  "model.top_k",
  "model.shared_experts",
  "parallel.dp",
  "parallel.pp",
  "parallel.tp",
  "parallel.cp",
  "parallel.ep",
  "parallel.vpp",
  "parallel.pipeline_layer_mode",
  "rule_profile.framework",
  "cluster.total_ranks",
  "cluster.ranks_per_node",
  "cluster.card_memory_gib",
  "batch.micro_batch_size",
  "batch.sequence_length",
  "batch.micro_batch_count",
]);

const MODEL_PROFILES = Object.freeze([
  {
    matches: (id) => /deepseek[\s_/-]*v?3/i.test(id),
    values: {
      "model.num_attention_heads": 128,
      "model.routed_experts": 256,
      "model.top_k": 8,
      "model.shared_experts": 1,
    },
    source_ref: DEEPSEEK_SOURCE,
    reason: "由已登记的 DeepSeek-V3 模型结构补齐，而不是复用当前页面模型。",
  },
]);

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function setPath(value, path, next) {
  const keys = path.split(".");
  let current = value;
  for (const key of keys.slice(0, -1)) current = current[key] ??= {};
  current[keys.at(-1)] = next;
}

function deletePath(value, path) {
  const keys = path.split(".");
  const parent = keys.slice(0, -1).reduce((current, key) => current?.[key], value);
  if (parent) delete parent[keys.at(-1)];
}

function completion(path, value, reason, confidence = "model-informed", sourceRef = COMPLETION_SOURCE) {
  return { path, value, reason, confidence, source_ref: sourceRef };
}

function capacityAssessment(config) {
  const result = estimateTrainingCapacity(config);
  const stages = result.data?.stages ?? [];
  if (result.status !== "estimated" || result.data?.valid !== true || !stages.length) {
    return {
      status: "unavailable",
      confidence: "theoretical",
      launch_feasible: false,
      recommendation_eligible: false,
      level: "unavailable",
      warning_codes: (result.warnings ?? []).map((warning) => warning.code),
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
    bottleneck_ratio: Number(bottleneck.ratio.toFixed(6)),
    estimated_gib: Number(bottleneck.total_gib.toFixed(3)),
    capacity_gib: bottleneck.capacity_gib,
    thresholds: { ...result.data.thresholds },
    warning_codes: (result.warnings ?? []).map((warning) => warning.code),
  };
}

function finalizePlans(plans) {
  const eligible = plans.filter((candidate) => (
    candidate.capacity_assessment.recommendation_eligible
  ));
  const recommended = eligible.find((candidate) => candidate.recommendation_requested) ?? null;
  return [...plans]
    .sort((left, right) => (
      Number(right === recommended) - Number(left === recommended)
    ))
    .map((candidate) => {
      const isRecommended = candidate === recommended;
      const { recommendation_requested: ignored, ...output } = candidate;
      return { ...output, recommended: isRecommended };
    });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function completionValuesForCandidate(baseValues, base, candidate, diagnostics = []) {
  const output = new Map(baseValues.map((item) => [item.path, item]));
  for (const path of REVIEWABLE_REPAIR_PATHS) {
    const previous = getPath(base, path);
    const value = getPath(candidate, path);
    if (value === undefined || sameValue(previous, value)) continue;
    const related = diagnostics.filter((item) => item.fields?.includes(path));
    const reason = related.length
      ? `为消除静态约束冲突：${related.map((item) => item.message).join("；")}`
      : `为使完整候选通过静态复验，将 ${path} 从 ${JSON.stringify(previous)} 调整为 ${JSON.stringify(value)}。`;
    output.set(path, completion(
      path,
      value,
      reason,
      "requires-confirmation",
      related[0]?.source_ref ?? COMPLETION_SOURCE,
    ));
  }
  return [...output.values()];
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : fallback;
}

function greatestCompatibleAtMost(value, predicates) {
  const upperBound = Math.min(positiveInteger(value), 65_536);
  for (let candidate = upperBound; candidate >= 1; candidate -= 1) {
    if (predicates.every((predicate) => predicate(candidate))) return candidate;
  }
  return 1;
}

/**
 * 最小修改搜索覆盖不了的组合，退到一个仍尽量保留源值的确定性静态合法候选。
 * 这里只消解 validate-parallel-config.js 已建模的约束；所有改值会进入 values 供页面审核。
 */
function staticSafeFallback(base) {
  const candidate = structuredClone(base);
  candidate.model ??= {};
  candidate.parallel ??= {};
  candidate.cluster ??= {};
  candidate.batch ??= {};
  candidate.memory ??= {};

  candidate.model.total_layers = positiveInteger(candidate.model.total_layers);
  candidate.model.hidden_size = positiveInteger(candidate.model.hidden_size);
  candidate.model.num_attention_heads = positiveInteger(candidate.model.num_attention_heads);
  candidate.model.routed_experts = Math.max(0, Number.isInteger(Number(candidate.model.routed_experts))
    ? Number(candidate.model.routed_experts) : 0);
  candidate.model.shared_experts = Math.max(0, Number.isInteger(Number(candidate.model.shared_experts))
    ? Number(candidate.model.shared_experts) : 0);
  candidate.model.top_k = candidate.model.routed_experts > 0
    ? Math.min(candidate.model.routed_experts, Math.max(0, Number(candidate.model.top_k) || 0))
    : 0;

  const tpDimensions = [candidate.model.num_attention_heads];
  if (candidate.model.ffn_hidden_size) tpDimensions.push(candidate.model.ffn_hidden_size);
  if (candidate.parallel.expert_tensor_parallel && candidate.model.expert_ffn_hidden_size
    && candidate.model.routed_experts > 0) tpDimensions.push(candidate.model.expert_ffn_hidden_size);
  candidate.parallel.tp = greatestCompatibleAtMost(
    candidate.parallel.tp,
    tpDimensions.map((dimension) => (value) => dimension % value === 0),
  );

  candidate.batch.sequence_length = positiveInteger(candidate.batch.sequence_length, 4096);
  candidate.parallel.cp = greatestCompatibleAtMost(candidate.parallel.cp, [
    (value) => candidate.parallel.cp_mode === "ring"
      ? candidate.batch.sequence_length % (2 * value) === 0
      : candidate.batch.sequence_length % value === 0,
    (value) => candidate.parallel.cp_mode !== "ulysses"
      || candidate.model.num_attention_heads % (candidate.parallel.tp * value) === 0,
  ]);

  candidate.parallel.pp = greatestCompatibleAtMost(candidate.parallel.pp, [
    (value) => value <= candidate.model.total_layers,
    (value) => candidate.model.total_layers % value === 0,
  ]);
  candidate.parallel.vpp = candidate.parallel.pp > 1
    ? greatestCompatibleAtMost(candidate.parallel.vpp, [
      (value) => candidate.model.total_layers % (candidate.parallel.pp * value) === 0,
    ])
    : 1;
  candidate.parallel.pipeline_layer_mode = "uniform";
  deletePath(candidate, "parallel.num_layer_list");
  deletePath(candidate, "parallel.pipeline_layer_offsets");

  candidate.parallel.ep = candidate.model.routed_experts > 0
    ? greatestCompatibleAtMost(candidate.parallel.ep, [
      (value) => candidate.model.routed_experts % value === 0,
    ])
    : 1;
  candidate.parallel.dp = positiveInteger(candidate.parallel.dp);
  if (candidate.parallel.ep_mode !== "orthogonal") {
    const domainFactor = candidate.parallel.ep_mode === "mf" ? candidate.parallel.tp : 1;
    const neededDpMultiple = candidate.parallel.ep / gcd(candidate.parallel.ep, domainFactor);
    candidate.parallel.dp = Math.ceil(candidate.parallel.dp / neededDpMultiple) * neededDpMultiple;
  }
  candidate.parallel.vpp = positiveInteger(candidate.parallel.vpp);

  candidate.cluster.ranks_per_node = positiveInteger(candidate.cluster.ranks_per_node, 8);
  candidate.cluster.card_memory_gib = Number(candidate.cluster.card_memory_gib) > 0
    ? Number(candidate.cluster.card_memory_gib) : 128;
  candidate.batch.micro_batch_size = positiveInteger(candidate.batch.micro_batch_size);
  candidate.batch.micro_batch_count = positiveInteger(candidate.batch.micro_batch_count);
  candidate.cluster.total_ranks = parallelWorld(candidate);
  return candidate;
}

function runtimeDefault(path, config, context) {
  const parallel = config.parallel ?? {};
  const tp = Number(config.parallel?.tp) || 1;
  const ep = Number(config.parallel?.ep) || 1;
  const pp = Number(config.parallel?.pp) || 1;
  const cp = Number(config.parallel?.cp) || 1;
  const totalRanks = Number(config.cluster?.total_ranks);
  const epMode = parallel.ep_mode
    ?? (config.rule_profile?.framework === "mindformers" ? "mf" : "split");
  const epFactor = epMode === "orthogonal" ? ep : 1;
  const inferredDp = totalRanks / (pp * tp * cp * epFactor);
  const routed = Number(config.model?.routed_experts);
  const microBatch = Number(config.batch?.micro_batch_size) || 1;
  const globalBatch = Number(config.batch?.global_batch_size);
  const hidden = Number(config.model?.hidden_size) || 1;
  const defaultDp = context.sourceHadParallelTopology ? 1 : 8;
  const dp = Number(config.parallel?.dp)
    || (Number.isInteger(inferredDp) && inferredDp >= 1 ? inferredDp : defaultDp);
  const inferredMicroBatchCount = globalBatch / (microBatch * dp);
  if (path === "cluster.card_model") {
    const declaredMemory = Number(config.cluster?.card_memory_gib);
    if (declaredMemory > 0 && declaredMemory <= 32) return "昇腾 910";
    if (declaredMemory > 32 && declaredMemory <= 64) return "昇腾 910B";
    return "昇腾 950PR";
  }
  if (path === "cluster.card_memory_gib") {
    const declaredModel = String(config.cluster?.card_model ?? "");
    if (declaredModel === "昇腾 910") return 32;
    if (declaredModel === "昇腾 910B") return 64;
    return 128;
  }
  const defaults = {
    "model.id": String(context.sourceName ?? "imported-model").replace(/\.[^.]+$/, ""),
    "model.total_layers": 1,
    "model.hidden_size": 1,
    "model.ffn_hidden_size": hidden * 4,
    "model.expert_ffn_hidden_size": Number(config.model?.ffn_hidden_size) || hidden * 4,
    "model.vocab_size": 32000,
    "model.first_k_dense_layers": 0,
    "cluster.ranks_per_node": 8,
    "batch.micro_batch_size": 1,
    "batch.sequence_length": 4096,
    "batch.micro_batch_count": Number.isInteger(inferredMicroBatchCount)
      && inferredMicroBatchCount >= 1 ? inferredMicroBatchCount : 1,
    "model.num_attention_heads": tp,
    "model.routed_experts": ep > 1 ? ep : 0,
    "model.top_k": (Number.isFinite(routed) ? routed : (ep > 1 ? ep : 0)) > 0 ? 1 : 0,
    "model.shared_experts": 0,
    "parallel.dp": Number.isInteger(inferredDp) && inferredDp >= 1 ? inferredDp : defaultDp,
    "parallel.pp": 1,
    "parallel.tp": 1,
    "parallel.cp": 1,
    "parallel.ep": 1,
    "parallel.vpp": 1,
    "parallel.ep_mode": epMode,
    "parallel.cp_mode": "ulysses",
    "parallel.sequence_parallel": false,
    "parallel.vocab_embedding_data_parallel": false,
    "parallel.expert_tensor_parallel": false,
    "cluster.total_ranks": null,
    "memory.compute_dtype": "bf16",
    "memory.parameter_dtype": "bf16",
    "memory.recompute_mode": "none",
    "memory.shard_mode": "none",
    "memory.lora_enabled": false,
  };
  if (path === "cluster.total_ranks") {
    const candidate = structuredClone(config);
    candidate.parallel ??= {};
    for (const [key, value] of Object.entries({ dp, pp, tp, cp, ep })) {
      candidate.parallel[key] ??= value;
    }
    candidate.parallel.ep_mode ??= epMode;
    return parallelWorld(candidate);
  }
  return defaults[path];
}

function balancedLayers(totalLayers, pp) {
  const base = Math.floor(totalLayers / pp);
  const remainder = totalLayers % pp;
  return Array.from({ length: pp }, (_, index) => base + (index < remainder ? 1 : 0));
}

function gcd(left, right) {
  let a = Math.abs(Number(left) || 0);
  let b = Math.abs(Number(right) || 0);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function completionReason(path, config, context) {
  if (path === "cluster.total_ranks") {
    return "由本次候选的 DP、PP、TP、CP、EP 口径即时计算 world size。";
  }
  if (path === "cluster.ranks_per_node") {
    return "源文件未声明单机卡数；采用可编辑的单机 8 卡工作台假设。";
  }
  if (["cluster.card_model", "cluster.card_memory_gib"].includes(path)) {
    const hasNoDeclaredCard = config.cluster?.card_model === undefined
      && config.cluster?.card_memory_gib === undefined;
    const capacityPriority = hasNoDeclaredCard
      || config.cluster?.card_model === "昇腾 950PR"
      || Number(config.cluster?.card_memory_gib) === 128;
    return capacityPriority
      ? "源文件未声明完整机器规格；采用可编辑的昇腾 950PR 128G 容量优先假设。"
      : "源文件只声明了部分机器规格；按已声明卡型或显存补齐匹配值。";
  }
  if (path === "batch.micro_batch_size") {
    return "源文件未声明单卡 micro batch；采用保守起点 1，并在应用前做完整静态复验。";
  }
  if (path === "batch.micro_batch_count" && config.batch?.global_batch_size) {
    return "由 global_batch_size ÷ (micro_batch_size × DP) 即时推导。";
  }
  if (path === "parallel.dp" && config.cluster?.total_ranks) {
    return "由 total_ranks ÷ 其余并行维度即时推导，并在完整候选中复验。";
  }
  if (path === "parallel.dp" && !context.sourceHadParallelTopology) {
    return "源文件未声明并行拓扑；采用可编辑的昇腾单机 8 Rank 起点，并在完整候选中复验。";
  }
  if (path === "memory.parameter_dtype") {
    return "源文件只声明计算精度；采用 BF16 参数存储假设，可在应用前修改。";
  }
  if (path.startsWith("model.")) {
    return "源文件没有足够模型结构证据；填入最小可校验占位，应用前必须由用户确认。";
  }
  return "由本次解析得到的字段和约束即时推导；不是预置配置答案。";
}

function plan(id, label, summary, config, values, recommended = false) {
  const validation = validateParallelConfig(config);
  return {
    id,
    label,
    summary,
    recommendation_requested: recommended,
    confidence: values.some((item) => item.confidence === "requires-confirmation")
      ? "requires-confirmation"
      : (values.some((item) => item.confidence === "model-informed")
        ? "model-informed" : "deterministic"),
    values,
    proposed_config: config,
    validation: {
      status: validation.status,
      errors: validation.errors,
      warnings: validation.warnings,
      suggestions: validation.suggestions,
    },
    capacity_assessment: capacityAssessment(config),
  };
}

function isDynamicPipelineSuggestion(suggestion) {
  return suggestion.changes.some((change) => (
    change.path === "parallel.pipeline_layer_mode" && change.new_value === "dynamic"
  ));
}

function isDynamicProfileSuggestion(suggestion) {
  return suggestion.changes.some((change) => (
    change.path === "rule_profile.framework" && change.new_value === "mindspeed-llm-mcore"
  ));
}

function suggestionPlanCopy(suggestion) {
  if (isDynamicProfileSuggestion(suggestion)) {
    return {
      label: "切换到 MindSpeed-LLM MCore 规则口径",
      summary: "保留当前动态 PP 与逐 Stage 层数，修正规则 profile、版本和来源 Commit。",
    };
  }
  if (!isDynamicPipelineSuggestion(suggestion)) {
    return {
      label: `静态约束修复方案 ${suggestion.rank}`,
      summary: suggestion.changes
        .map((change) => `${change.path}: ${change.old_value} → ${change.new_value}`)
        .join("；"),
    };
  }
  const { pp, num_layer_list: stageLayers } = suggestion.proposed_config.parallel;
  return {
    label: "切换到动态 PP",
    summary: `保持 PP=${pp}，改用 MindSpeed-LLM MCore 动态分层：${stageLayers.join(" / ")}。`,
  };
}

function editableModelStructurePresetPlan(base, recommended = true) {
  const candidate = structuredClone(base);
  const values = [];
  for (const [path, value] of Object.entries(EDITABLE_MODEL_STRUCTURE_PRESET)) {
    setPath(candidate, path, value);
    values.push(completion(
      path,
      value,
      "采用工作台提供的可编辑模型结构候选值；该值仅用于补齐校验输入，不是从当前训练配置推断或还原的。",
      "requires-confirmation",
      EDITABLE_STRUCTURE_PRESET_SOURCE,
    ));
  }
  return plan(
    "editable-model-structure-preset",
    "采用可编辑模型结构预置（需确认）",
    "当前训练配置没有给全模型结构；使用工作台提供的可编辑候选值后，可继续执行并行校验与理论容量估算。",
    candidate,
    values,
    recommended,
  );
}

/**
 * 为 parse_training_config 的缺口生成完整候选，并用同一核心校验器逐个复验。
 * 页面只展示这里返回的 structuredContent，不自行复制补齐或修复公式。
 */
export function planTrainingConfigCompletion(normalizedConfig, missingRequiredFields = [], context = {}) {
  // Generic inputs have no framework or device-specific completion rules. In particular,
  // an imported NVIDIA configuration must not inherit the MindSpeed workstation presets.
  if (normalizedConfig.rule_profile?.framework === "generic") {
    return {
      computation: "runtime-per-parse",
      strategy: "requires-confirmed-framework-and-resources",
      complete: false,
      launch_feasible: null,
      recommended_plan_id: null,
      unresolved_fields: [...missingRequiredFields],
      plans: [],
    };
  }
  const base = structuredClone(normalizedConfig);
  const values = [];
  const profile = MODEL_PROFILES.find((item) => item.matches(String(base.model?.id ?? "")));
  const completionContext = {
    ...context,
    sourceHadParallelTopology: ["dp", "pp", "tp", "cp", "ep"]
      .some((key) => normalizedConfig.parallel?.[key] !== undefined),
  };

  for (const path of missingRequiredFields) {
    let value = profile?.values[path];
    let reason = profile?.reason;
    let sourceRef = profile?.source_ref;
    let confidence = "model-informed";
    if (value === undefined) {
      value = runtimeDefault(path, base, completionContext);
      reason = completionReason(path, base, completionContext);
      sourceRef = COMPLETION_SOURCE;
      confidence = path.startsWith("model.")
        ? "requires-confirmation"
        : (path.startsWith("cluster.") ? "model-informed" : "deterministic");
    }
    if (value === undefined) continue;
    setPath(base, path, value);
    values.push(completion(path, value, reason, confidence, sourceRef));
  }

  const unresolved = missingRequiredFields.filter((path) => getPath(base, path) === undefined);
  if (unresolved.length) return {
    computation: "runtime-per-parse",
    strategy: "evidence-plus-constraint-solver",
    complete: false,
    unresolved_fields: unresolved,
    plans: [],
  };

  if (!base.parallel.pipeline_layer_mode) {
    base.parallel.pipeline_layer_mode = base.model.total_layers % base.parallel.pp === 0
      ? "uniform" : "dynamic";
  }
  if (base.parallel.pipeline_layer_mode === "dynamic" && !base.parallel.num_layer_list) {
    base.parallel.num_layer_list = balancedLayers(base.model.total_layers, base.parallel.pp);
    base.parallel.vpp = 1;
    base.rule_profile = {
      framework: "mindspeed-llm-mcore",
      version: "master@7826e88",
      source_commit: "7826e883ab40f06dd54f0fa2ce6508d18036843c",
    };
  }

  const plans = [];
  const lacksEssentialModelStructure = missingRequiredFields.includes("model.total_layers")
    || missingRequiredFields.includes("model.hidden_size");
  const lacksAnyModelStructure = missingRequiredFields.some((path) => path.startsWith("model."));
  if (lacksEssentialModelStructure) {
    const presetPlan = editableModelStructurePresetPlan(base, true);
    if (presetPlan.validation.status === "valid") plans.push(presetPlan);
  }
  const needsConfirmation = values.some((item) => item.confidence === "requires-confirmation");
  const sourcePlan = plan(
    "source-faithful",
    needsConfirmation ? "最小可校验起点（需确认）" : "保留源配置语义",
    needsConfirmation
      ? "源代码不足以恢复真实模型结构；MCP 已即时生成静态合法的最小起点，结构占位必须由用户确认。"
      : (base.parallel.pipeline_layer_mode === "mindformers-offset"
      ? "保留 MindFormers PP 层偏置与 VPP，并按源文件的非均匀流水线分层复验。"
      : "保留源文件已声明的并行配置，仅补齐缺失字段。"),
    base,
    values,
    !lacksEssentialModelStructure,
  );
  if (!missingRequiredFields.length && sourcePlan.validation.status === "valid"
    && sourcePlan.capacity_assessment.recommendation_eligible) {
    return {
      computation: "runtime-per-parse",
      strategy: "evidence-plus-constraint-solver-and-theoretical-capacity-gate",
      complete: true,
      launch_feasible: sourcePlan.capacity_assessment.launch_feasible,
      recommended_plan_id: null,
      unresolved_fields: [],
      plans: [],
    };
  }
  if (sourcePlan.validation.status === "valid") plans.push(sourcePlan);
  if (lacksAnyModelStructure && !lacksEssentialModelStructure) {
    const presetPlan = editableModelStructurePresetPlan(base, false);
    if (presetPlan.validation.status === "valid") plans.push(presetPlan);
  }

  const errorCodes = new Set(sourcePlan.validation.errors.map((item) => item.code));
  if (!plans.length && errorCodes.has("PAGE_EP_DOMAIN_DIVISIBLE_BY_EP")) {
    const expanded = structuredClone(base);
    const mode = expanded.parallel.ep_mode;
    const domainFactor = mode === "mf" ? expanded.parallel.tp : 1;
    const neededDpMultiple = expanded.parallel.ep / gcd(expanded.parallel.ep, domainFactor);
    expanded.parallel.dp = Math.ceil(expanded.parallel.dp / neededDpMultiple) * neededDpMultiple;
    expanded.cluster.total_ranks = parallelWorld(expanded);
    const expandedPlan = plan(
      "preserve-parallel-expansion",
      "保留并行切分并扩容",
      `保留 EP=${expanded.parallel.ep} 等源配置切分，把 DP 调整为 ${expanded.parallel.dp}，总 Rank 调整为 ${expanded.cluster.total_ranks}。`,
      expanded,
      completionValuesForCandidate(values, base, expanded, sourcePlan.validation.errors),
      true,
    );
    if (expandedPlan.validation.status === "valid") plans.push(expandedPlan);
  }

  if (base.parallel.pipeline_layer_mode === "mindformers-offset" && base.parallel.pp > 1) {
    const fallback = structuredClone(base);
    const totalRanks = Number(fallback.cluster.total_ranks);
    const factor = Number(fallback.parallel.tp) * Number(fallback.parallel.cp);
    fallback.parallel.pp = 1;
    fallback.parallel.vpp = 1;
    fallback.parallel.pipeline_layer_mode = "uniform";
    deletePath(fallback, "parallel.pipeline_layer_offsets");
    if (Number.isInteger(totalRanks / factor)) fallback.parallel.dp = totalRanks / factor;
    const fallbackPlan = plan(
      "mindformers-uniform-fallback",
      "改为 MindFormers 均匀 PP",
      "保留总 Rank 和 MindFormers profile，但改为 PP=1、VPP=1，并重算 DP；适合作为不使用 offset 的兼容性保底。",
      fallback,
      completionValuesForCandidate(values, base, fallback, sourcePlan.validation.errors),
    );
    if (fallbackPlan.validation.status === "valid") plans.push(fallbackPlan);
  }

  if (!plans.length) {
    const fixes = suggestConfigFixes(base);
    for (const suggestion of fixes.data?.suggestions ?? []) {
      const copy = suggestionPlanCopy(suggestion);
      plans.push(plan(
        `validated-fix-${suggestion.rank}`,
        copy.label,
        copy.summary,
        suggestion.proposed_config,
        completionValuesForCandidate(values, base, suggestion.proposed_config, sourcePlan.validation.errors),
        suggestion.rank === 1,
      ));
    }
  }

  if (!plans.length) {
    const fallback = staticSafeFallback(base);
    const fallbackPlan = plan(
      "static-safe-fallback",
      "静态安全兜底方案",
      "常规最小修改搜索没有得到完整候选；MCP 已消解所有已建模冲突，并把改动逐项列出供审核。",
      fallback,
      completionValuesForCandidate(values, base, fallback, sourcePlan.validation.errors),
      true,
    );
    if (fallbackPlan.validation.status === "valid") plans.push(fallbackPlan);
  }

  const finalizedPlans = finalizePlans(plans);
  return {
    computation: "runtime-per-parse",
    strategy: "evidence-plus-constraint-solver-and-theoretical-capacity-gate",
    complete: finalizedPlans.length > 0,
    launch_feasible: finalizedPlans.some((candidate) => (
      candidate.capacity_assessment.launch_feasible
    )),
    recommended_plan_id: finalizedPlans.find((candidate) => candidate.recommended)?.id ?? null,
    unresolved_fields: [],
    plans: finalizedPlans,
  };
}
