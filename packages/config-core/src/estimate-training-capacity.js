import {
  EP_MF,
  dpReplica,
  expertDataParallel,
  readParallelConfig,
} from "./page-rules.js";
import { diagnostic, toolResult } from "./result.js";
import { validateParallelConfig } from "./validate-parallel-config.js";

const GIB = 1024 ** 3;
const THRESHOLDS = Object.freeze({ tight: 0.70, alert: 0.88 });
const RUNTIME = Object.freeze({
  base_gib: 2,
  hccl_buffer_gib: 0.2,
  hccl_double_buffer: 2,
  workspace_factor: 2,
  workspace_floor_gib: 1,
  fragmentation_ratio: 0.05,
  fsdp_prefetch_units: 2,
});
const CAPACITY_SOURCE = "compute-graph-viewer-wzh:config-relation-capacity.js:114-879@1e6bb6e";

function precisionBytes(input) {
  const master = input.memory.parameter_dtype;
  const compute = input.memory.compute_dtype;
  const fp8 = compute === "fp8";
  return {
    weight: master === "fp32" ? (fp8 ? 5 : 4) : (fp8 ? 1 : 2),
    grad: master === "fp32" ? 4 : 2,
    optim: master === "fp32" ? 8 : 12,
    activation: 2,
  };
}

function buildStages(totalLayers, pp) {
  const base = Math.floor(totalLayers / pp);
  const remainder = totalLayers % pp;
  const stages = [];
  let cursor = 0;
  for (let stage = 0; stage < pp; stage += 1) {
    const count = base + (stage < remainder ? 1 : 0);
    stages.push({ stage, start: cursor, end: cursor + count - 1, count });
    cursor += count;
  }
  return stages;
}

function isDenseLayer(input, layer) {
  if (input.model.routed_experts === 0) return true;
  return layer < (input.model.first_k_dense_layers ?? 0);
}

function paramsOfStage(input, stageInfo) {
  const { model, parallel } = input;
  const config = readParallelConfig(input);
  const hidden = model.hidden_size;
  const tp = parallel.tp;
  const expertTp = config.mode === EP_MF || !parallel.expert_tensor_parallel ? 1 : tp;
  const expertsPerEpRank = model.routed_experts > 0 ? model.routed_experts / parallel.ep : 0;
  let sharded = 0;
  let expert = 0;
  let intact = 0;
  let replicated = 0;
  let largestUnit = 0;
  let hasMoe = false;

  for (let layer = stageInfo.start; layer <= stageInfo.end; layer += 1) {
    const before = sharded / tp + expert / expertTp + intact;
    sharded += 4 * hidden * hidden;
    if (isDenseLayer(input, layer)) {
      sharded += 3 * hidden * (model.ffn_hidden_size ?? 4 * hidden);
    } else {
      hasMoe = true;
      expert += expertsPerEpRank * 3 * hidden * (model.expert_ffn_hidden_size ?? model.ffn_hidden_size ?? 4 * hidden);
      sharded += model.shared_experts * 3 * hidden
        * (model.expert_ffn_hidden_size ?? model.ffn_hidden_size ?? 4 * hidden);
      intact += hidden * model.routed_experts;
    }
    largestUnit = Math.max(largestUnit, sharded / tp + expert / expertTp + intact - before);
  }

  const embeddingAndHead = (stageInfo.stage === 0 ? model.vocab_size * hidden : 0)
    + (stageInfo.stage === parallel.pp - 1 ? model.vocab_size * hidden : 0);
  if (parallel.vocab_embedding_data_parallel) replicated += embeddingAndHead;
  else sharded += embeddingAndHead;
  const expertOnCard = expert / expertTp;
  const embeddingOnCard = parallel.vocab_embedding_data_parallel
    ? embeddingAndHead
    : embeddingAndHead / tp;

  return {
    total: sharded / tp + intact + replicated + expertOnCard,
    expert: expertOnCard,
    largest_unit: Math.max(largestUnit, embeddingOnCard),
    has_moe: hasMoe,
  };
}

function shardPlan(input) {
  const dataShards = {
    other: Math.max(1, dpReplica(input)),
    expert: Math.max(1, expertDataParallel(input)),
  };
  const none = { other: 1, expert: 1 };
  if (input.memory.shard_mode === "fsdp2") {
    return { weight: dataShards, grad: dataShards, optim: dataShards };
  }
  if (input.memory.shard_mode === "zero1") {
    return { weight: none, grad: none, optim: dataShards };
  }
  return { weight: none, grad: none, optim: none };
}

function shardedBytes(params, shards, bytes) {
  return ((params.total - params.expert) / shards.other + params.expert / shards.expert) * bytes;
}

function activationCoefficient(input, stageInfo) {
  const tp = input.parallel.tp;
  const sequenceParallel = input.parallel.sequence_parallel;
  const coefficients = {
    none: sequenceParallel ? 34 : 10 * tp + 24,
    selective: sequenceParallel ? 17 : 9 * tp + 8,
    full: sequenceParallel ? 2 : 2 * tp,
  };
  const mode = input.memory.recompute_mode;
  if (mode !== "layers") return stageInfo.count * coefficients[mode];
  const recomputed = Math.min(stageInfo.count, input.memory.recompute_layers ?? 0);
  return recomputed * coefficients.full + (stageInfo.count - recomputed) * coefficients.none;
}

function inflightMicroBatches(input, stage) {
  const pp = input.parallel.pp;
  const vpp = input.parallel.vpp;
  const raw = vpp <= 1
    ? Math.max(1, pp - stage)
    : (2 * (pp - stage - 1) + (vpp - 1) * pp + 1) / vpp;
  return {
    actual: Math.min(raw, input.batch.micro_batch_count),
    full_pipeline: raw,
  };
}

function levelOf(ratio) {
  if (ratio > 1) return "over";
  if (ratio > THRESHOLDS.alert) return "alert";
  if (ratio > THRESHOLDS.tight) return "tight";
  return "safe";
}

function gib(bytes) {
  return bytes / GIB;
}

export function estimateTrainingCapacity(input) {
  const validation = validateParallelConfig(input);
  if (validation.errors.length) {
    return toolResult({
      tool: "estimate_training_capacity",
      input,
      status: "invalid",
      errors: validation.errors,
      warnings: validation.warnings,
      assumptions: validation.assumptions,
      confidence: "theoretical",
      data: { valid: false },
    });
  }

  const bytes = precisionBytes(input);
  const stages = buildStages(input.model.total_layers, input.parallel.pp);
  const plan = shardPlan(input);
  const loraEnabled = input.memory.lora_enabled;
  const communicationDomains = [
    input.parallel.tp,
    input.parallel.pp,
    input.parallel.dp,
    input.parallel.cp,
    input.parallel.ep,
  ].filter((value) => value > 1).length + (input.parallel.ep > 1 ? 1 : 0);

  const measurements = stages.map((stageInfo) => {
    const params = paramsOfStage(input, stageInfo);
    const adapterParams = loraEnabled
      ? stageInfo.count * 8 * (input.memory.lora_rank ?? 1) * input.model.hidden_size / input.parallel.tp
      : 0;
    const trainable = loraEnabled ? { total: adapterParams, expert: 0 } : params;
    const weight = shardedBytes(params, plan.weight, bytes.weight)
      + (loraEnabled ? shardedBytes({ total: adapterParams, expert: 0 }, plan.weight, bytes.weight) : 0);
    const grad = shardedBytes(trainable, plan.grad, bytes.grad);
    const optim = shardedBytes(trainable, plan.optim, bytes.optim);
    const inflight = inflightMicroBatches(input, stageInfo.stage);
    const activation = activationCoefficient(input, stageInfo)
      * input.batch.micro_batch_size
      * (input.batch.sequence_length / input.parallel.cp)
      * input.model.hidden_size
      / input.parallel.tp
      * inflight.actual;
    const core = weight + grad + optim + activation;
    const base = RUNTIME.base_gib * GIB;
    const communication = communicationDomains * RUNTIME.hccl_buffer_gib
      * RUNTIME.hccl_double_buffer * GIB;
    const tokenBytes = input.batch.micro_batch_size
      * (input.batch.sequence_length / input.parallel.cp)
      * input.model.hidden_size * bytes.activation / input.parallel.tp;
    const workspace = params.has_moe
      ? Math.max(RUNTIME.workspace_floor_gib * GIB,
        RUNTIME.workspace_factor * input.model.top_k * tokenBytes)
      : RUNTIME.workspace_floor_gib * GIB;
    const fragmentation = core * RUNTIME.fragmentation_ratio;
    const unshard = input.memory.shard_mode === "fsdp2"
      ? params.largest_unit * RUNTIME.fsdp_prefetch_units * bytes.weight
      : 0;
    const reserve = communication + workspace + fragmentation + unshard;
    const capacity = input.cluster.card_memory_gib * GIB;
    const total = base + core + reserve;
    const ratio = total / capacity;

    return {
      stage: stageInfo.stage,
      layers: stageInfo.count,
      parameter_count_on_card: params.total,
      trainable_parameter_count_on_card: trainable.total,
      capacity_gib: input.cluster.card_memory_gib,
      total_gib: gib(total),
      ratio,
      level: levelOf(ratio),
      inflight_micro_batches: inflight.actual,
      full_pipeline_inflight: inflight.full_pipeline,
      micro_batch_count: input.batch.micro_batch_count,
      vpp_chunks: input.parallel.vpp,
      recomputed_layers: input.memory.recompute_mode === "layers"
        ? Math.min(stageInfo.count, input.memory.recompute_layers ?? 0)
        : 0,
      values_gib: {
        base: gib(base),
        weight: gib(weight),
        gradient: gib(grad),
        optimizer: gib(optim),
        activation: gib(activation),
        reserve: gib(reserve),
      },
      reserve_parts_gib: {
        communication: gib(communication),
        workspace: gib(workspace),
        fragmentation: gib(fragmentation),
        fsdp_unshard: gib(unshard),
      },
    };
  });

  const bottleneck = measurements.reduce((largest, current) => (
    current.total_gib > largest.total_gib ? current : largest
  ));
  const warnings = [...validation.warnings];
  if (bottleneck.level === "over") {
    warnings.push(diagnostic(
      "CAPACITY_THEORETICAL_OOM",
      `理论估算中 Stage ${bottleneck.stage} 使用 ${bottleneck.total_gib.toFixed(1)} GiB，超过单卡 ${bottleneck.capacity_gib} GiB。`,
      ["cluster.card_memory_gib", "batch.micro_batch_size", "batch.sequence_length", "memory.shard_mode"],
      "page-rule",
      CAPACITY_SOURCE,
    ));
  }

  const inferredMoeLayout = input.model.routed_experts > 0
    && input.model.first_k_dense_layers === undefined;
  return toolResult({
    tool: "estimate_training_capacity",
    input,
    status: "estimated",
    warnings,
    assumptions: [
      "结果复现页面六段容量口径，属于理论估算，不是设备实测峰值。",
      "运行时底座、HCCL buffer、workspace、碎片率和 FSDP2 预取深度使用页面经验系数。",
      ...(inferredMoeLayout ? ["未提供 first_k_dense_layers，按所有 Transformer 层均为 MoE 层估算。"] : []),
    ],
    confidence: "theoretical",
    data: {
      valid: true,
      thresholds: THRESHOLDS,
      runtime_coefficients: RUNTIME,
      bottleneck_stage: bottleneck.stage,
      bottleneck_level: bottleneck.level,
      stages: measurements,
    },
  });
}
