import { computeRankTopology } from "./compute-rank-topology.js";
import { estimateTrainingCapacity } from "./estimate-training-capacity.js";
import { parallelWorld } from "./page-rules.js";
import { diagnostic, toolResult } from "./result.js";
import { validateParallelConfig } from "./validate-parallel-config.js";

const POLICY_SOURCE = "mindspeed-config-mcp:packages/config-core/src/plan-training-config.js@0.2.0";
const REQUIRED_WITHOUT_BASE = [
  "rule_profile.framework", "model.id", "model.total_layers", "model.hidden_size",
  "model.num_attention_heads", "model.ffn_hidden_size", "model.vocab_size",
  "batch.sequence_length", "batch.global_batch_size", "batch.micro_batch_size",
  "memory.compute_dtype", "memory.parameter_dtype", "memory.shard_mode",
];
const RISK_ORDER = { safe: 0, tight: 1, alert: 2, over: 3 };

// Derived from confirmed baseline values, never from the newly requested resource count.
export function preparePlanningBaseConfig(base) {
  if (!base) return base;
  const output = structuredClone(base);
  const batch = output.batch;
  if (batch && (batch.global_batch_size === undefined || batch.global_batch_size === null
    || batch.global_batch_size === "")) {
    const factors = [batch.micro_batch_size, output.parallel?.dp, batch.micro_batch_count];
    if (factors.every((value) => Number.isInteger(value) && value > 0)) {
      batch.global_batch_size = factors.reduce((product, value) => product * value, 1);
    }
  }
  return output;
}

function adjustmentFor(fields, locks) {
  const locked = fields.filter((path) => locks.has(path));
  if (locked.length) return `先核对是否允许解除 ${locked.join("、")} 的锁定，再调整相关输入重新比较。`;
  if (fields.some((path) => path.startsWith("model."))) return "在工作台核对模型结构与层切分；规划不会自动改写模型结构。";
  if (fields.some((path) => path.startsWith("memory.") || path.startsWith("features."))) return "核对高级条件和工作台特性开关，按该约束调整后重新比较。";
  return "调整所列资源、批量或并行条件后重新比较；其他条件可返回工作台修改。";
}

function getPath(value, path) {
  return path.split(".").reduce((current, part) => current?.[part], value);
}

function missingEvidence(base) {
  if (!base) return REQUIRED_WITHOUT_BASE;
  const required = [...REQUIRED_WITHOUT_BASE];
  if (base.model?.routed_experts > 0) {
    required.push("model.expert_ffn_hidden_size", "model.first_k_dense_layers");
  }
  return required.filter((path) => {
    const value = getPath(base, path);
    return value === undefined || value === null || value === "" || (path === "rule_profile.framework" && value === "generic");
  });
}

function factors(limit, upperBound) {
  const values = [];
  for (let value = 1; value <= Math.min(limit, upperBound); value += 1) {
    if (limit % value === 0) values.push(value);
  }
  return values;
}

function options(path, base, values, locked) {
  const current = getPath(base, path);
  return locked.has(path) ? [current] : [...new Set([current, ...values])]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
}

function changeList(before, after) {
  const paths = [
    "cluster.total_ranks", "cluster.card_memory_gib", "cluster.ranks_per_node",
    "cluster.card_model", "parallel.tp", "parallel.pp", "parallel.ep", "parallel.dp",
    "batch.micro_batch_count",
  ];
  return paths.filter((path) => !Object.is(getPath(before, path), getPath(after, path)))
    .map((path) => ({ path, old_value: getPath(before, path), new_value: getPath(after, path) }));
}

function compareCandidates(left, right, goal) {
  const risk = RISK_ORDER[left.capacity.level] - RISK_ORDER[right.capacity.level];
  if (risk) return risk;
  if (goal === "pipeline-balanced") {
    const spread = left.capacity.stage_spread_gib - right.capacity.stage_spread_gib;
    if (Math.abs(spread) > 0.01) return spread;
  }
  if (goal === "memory-safe") {
    const ratio = left.capacity.bottleneck_ratio - right.capacity.bottleneck_ratio;
    if (Math.abs(ratio) > 0.001) return ratio;
  }
  if (left.changes.length !== right.changes.length) return left.changes.length - right.changes.length;
  return left.id.localeCompare(right.id);
}

function tradeoffs(base, candidate) {
  const notes = [];
  if (candidate.parallel.tp > base.parallel.tp) notes.push("TP 增大：理论模型状态分片可能降低，但通信代价需要 Profiling 验证。");
  if (candidate.parallel.pp > base.parallel.pp) notes.push("PP 增大：单 Stage 层数减少，流水线空泡与跨 Stage 通信需实测。");
  if (candidate.parallel.ep > base.parallel.ep) notes.push("EP 增大：每个专家切片更小，专家通信仍需实测。");
  if (candidate.parallel.dp !== base.parallel.dp) notes.push("DP 改变：为保持目标 Global Batch，已同步调整 micro batch count。");
  if (!notes.length) notes.push("保留当前并行切分；容量余量仍需在目标 NPU 上验证。");
  return notes;
}

function planningInput(input) {
  return { rule_profile: input.base_config?.rule_profile ?? { framework: "generic", version: "planning-v1" } };
}

export function planTrainingConfig(input) {
  const base = preparePlanningBaseConfig(input.base_config);
  const requiredInputs = missingEvidence(base);
  const locks = new Set([...(base?.policy?.locked_fields ?? []), ...(input.locked_fields ?? [])]);
  if (requiredInputs.length) {
    return toolResult({
      tool: "plan_training_config", input: planningInput(input), status: "invalid",
      warnings: [diagnostic("PLAN_NEEDS_CONTEXT",
        `规划缺少 ${requiredInputs.length} 项模型、批量或框架条件；资源数量不能唯一确定训练配置。`,
        requiredInputs, "compatibility-gap", POLICY_SOURCE)],
      confidence: "model-informed",
      data: { ready: false, required_inputs: requiredInputs, candidates: [], resources: input.resources, goal: input.goal },
    });
  }

  const requested = {
    "cluster.total_ranks": input.resources.total_ranks,
    "cluster.card_memory_gib": input.resources.card_memory_gib,
    ...(input.resources.ranks_per_node ? { "cluster.ranks_per_node": input.resources.ranks_per_node } : {}),
    ...(input.resources.card_model ? { "cluster.card_model": input.resources.card_model } : {}),
  };
  const conflicts = Object.entries(requested)
    .filter(([path, value]) => locks.has(path) && !Object.is(getPath(base, path), value))
    .map(([path]) => path);
  if (conflicts.length) {
    return toolResult({
      tool: "plan_training_config", input: planningInput(input), status: "invalid",
      errors: [diagnostic("PLAN_LOCKED_RESOURCE_CONFLICT",
        `请求资源与锁定字段冲突：${conflicts.join("、")}。`, conflicts, "compatibility-gap", POLICY_SOURCE)],
      confidence: "model-informed",
      data: { ready: false, required_inputs: [], candidates: [], resources: input.resources, goal: input.goal },
    });
  }

  const seed = structuredClone(base);
  Object.assign(seed.cluster, {
    total_ranks: input.resources.total_ranks,
    card_memory_gib: input.resources.card_memory_gib,
    ...(input.resources.ranks_per_node ? { ranks_per_node: input.resources.ranks_per_node } : {}),
    ...(input.resources.card_model ? { card_model: input.resources.card_model } : {}),
  });
  const totalRanks = seed.cluster.total_ranks;
  const tpValues = options("parallel.tp", base, factors(totalRanks, 16), locks);
  const ppValues = options("parallel.pp", base,
    seed.parallel.pipeline_layer_mode === "uniform"
      ? factors(seed.model.total_layers, Math.min(totalRanks, 8)) : [], locks);
  const epValues = options("parallel.ep", base,
    seed.model.routed_experts > 0 ? factors(seed.model.routed_experts, 8) : [1], locks);
  const candidates = [];
  const rejections = new Map();
  function reject(code, message, fields, candidate, sourceRef = POLICY_SOURCE) {
    const prior = rejections.get(code);
    if (prior) { prior.rejected_count += 1; return; }
    rejections.set(code, {
      code, message, fields, rejected_count: 1,
      suggestion: adjustmentFor(fields, locks), source_ref: sourceRef,
      example: { tp: candidate.parallel.tp, pp: candidate.parallel.pp, ep: candidate.parallel.ep,
        cp: candidate.parallel.cp, dp: candidate.parallel.dp },
    });
  }
  let considered = 0;
  for (const tp of tpValues) for (const pp of ppValues) for (const ep of epValues) {
    if (input.goal === "pipeline-balanced" && base.parallel.pp > 1 && pp === 1) continue;
    considered += 1;
    const candidate = structuredClone(seed);
    Object.assign(candidate.parallel, { tp, pp, ep, dp: 1 });
    const rankPerDp = parallelWorld(candidate);
    const dp = totalRanks / rankPerDp;
    if (!Number.isInteger(dp) || dp < 1) {
      reject("PLAN_RANKS_NOT_DIVISIBLE", `目标 ${totalRanks} Rank 无法按示例 TP=${tp}、PP=${pp}、CP=${candidate.parallel.cp}、EP=${ep}（${candidate.parallel.ep_mode} 口径）得到正整数 DP。`,
        ["cluster.total_ranks", "parallel.tp", "parallel.pp", "parallel.cp", "parallel.ep"], candidate);
      continue;
    }
    candidate.parallel.dp = dp;
    if (locks.has("parallel.dp") && dp !== base.parallel.dp) {
      reject("PLAN_LOCKED_DP_CONFLICT", `示例切分要求 DP=${dp}，但 DP 已锁定为 ${base.parallel.dp}。`, ["parallel.dp", "cluster.total_ranks"], candidate);
      continue;
    }
    const batchCount = candidate.batch.global_batch_size
      / (candidate.batch.micro_batch_size * dp);
    if (!Number.isInteger(batchCount) || batchCount < 1) {
      reject("PLAN_BATCH_NOT_DIVISIBLE", `Global Batch=${candidate.batch.global_batch_size} 不能被 Micro Batch=${candidate.batch.micro_batch_size} × DP=${dp} 整除，无法得到正整数累积次数。`,
        ["batch.global_batch_size", "batch.micro_batch_size", "parallel.dp"], candidate);
      continue;
    }
    if (locks.has("batch.micro_batch_count") && batchCount !== base.batch.micro_batch_count) {
      reject("PLAN_LOCKED_ACCUMULATION_CONFLICT", `示例切分需要累积 ${batchCount} 次，但累积次数已锁定为 ${base.batch.micro_batch_count}。`, ["batch.micro_batch_count", "batch.global_batch_size", "parallel.dp"], candidate);
      continue;
    }
    candidate.batch.micro_batch_count = batchCount;
    const changes = changeList(base, candidate);
    if (changes.some(({ path }) => locks.has(path))) {
      reject("PLAN_LOCKED_FIELD_CONFLICT", "示例候选需要改动已锁定字段。", changes.filter(({ path }) => locks.has(path)).map(({ path }) => path), candidate);
      continue;
    }
    const validation = validateParallelConfig(candidate);
    if (validation.status !== "valid" || validation.errors.length) {
      for (const issue of validation.errors) reject(issue.code, issue.message, issue.fields ?? [], candidate, issue.source_ref);
      continue;
    }
    const estimate = estimateTrainingCapacity(candidate);
    if (estimate.status !== "estimated") {
      for (const issue of estimate.errors) reject(issue.code, issue.message, issue.fields ?? [], candidate, issue.source_ref);
      continue;
    }
    const stages = estimate.data.stages;
    const totals = stages.map(({ total_gib }) => total_gib);
    const bottleneck = stages[estimate.data.bottleneck_stage];
    candidates.push({
      id: `tp${tp}-pp${pp}-ep${ep}-dp${dp}`,
      changes,
      proposed_config: candidate,
      validation: { status: validation.status, warning_codes: validation.warnings.map(({ code }) => code), warnings: validation.warnings },
      capacity: {
        confidence: "theoretical",
        bottleneck_stage: bottleneck.stage,
        bottleneck_gib: bottleneck.total_gib,
        bottleneck_ratio: bottleneck.ratio,
        level: bottleneck.level,
        stage_spread_gib: Math.max(...totals) - Math.min(...totals),
        available_gib: seed.cluster.card_memory_gib,
        headroom_gib: seed.cluster.card_memory_gib - bottleneck.total_gib,
        thresholds: estimate.data.thresholds,
        safe_ratio: estimate.data.thresholds.tight,
      },
      tradeoffs: tradeoffs(base, candidate),
    });
  }

  candidates.sort((left, right) => compareCandidates(left, right, input.goal));
  const shortlisted = candidates.slice(0, 3).map((candidate, index) => {
    const topology = computeRankTopology(candidate.proposed_config);
    return {
      ...candidate,
      rank: index + 1,
      topology: topology.status === "valid" ? {
        rank_count: topology.data.ranks.length,
        stage_count: topology.data.stages.length,
        node_count: topology.data.nodes.length,
        semantics: topology.data.semantics,
      } : null,
    };
  });
  const viable = shortlisted.some(({ capacity }) => capacity.level === "safe");
  return toolResult({
    tool: "plan_training_config", input: planningInput(input),
    status: shortlisted.length ? "estimated" : "invalid",
    errors: shortlisted.length ? [] : [diagnostic("PLAN_NO_VALID_CANDIDATE",
      "当前资源、目标、锁定字段与模型条件下没有找到通过静态校验的候选。",
      ["resources.total_ranks", "locked_fields"], "compatibility-gap", POLICY_SOURCE)],
    warnings: viable ? [] : [diagnostic("PLAN_NO_SAFE_CAPACITY",
      "当前搜索范围内没有低于理论 80% 显存警戒线的候选。",
      ["resources.card_memory_gib"], "compatibility-gap", POLICY_SOURCE)],
    assumptions: [
      "候选只在 TP、PP、EP、DP 与 micro batch count 的有限范围内搜索，未覆盖全部策略。",
      "容量为 theoretical；并行通信、流水线空泡和吞吐收益需要目标 NPU 实测。",
      ...(!input.resources.card_model ? ["卡型名称沿用基线配置；仅按用户给定的可用显存比较。"] : []),
    ],
    confidence: "model-informed",
    data: {
      ready: true,
      viable,
      goal: input.goal,
      resources: input.resources,
      locked_fields: [...locks].sort(),
      required_inputs: [],
      considered,
      valid_candidate_count: candidates.length,
      candidates: shortlisted,
      diagnostics: [...rejections.values()].sort((left, right) => right.rejected_count - left.rejected_count).slice(0, 6),
      ranking_basis: ["优先比较理论容量风险等级", input.goal === "memory-safe" ? "同风险等级下优先降低瓶颈占用比例"
        : input.goal === "pipeline-balanced" ? "同风险等级下优先缩小 Stage 容量差距" : "同风险等级下优先减少字段改动",
      "其余条件相同时优先减少字段改动；未预测吞吐"],
      policy_source: POLICY_SOURCE,
    },
  });
}
