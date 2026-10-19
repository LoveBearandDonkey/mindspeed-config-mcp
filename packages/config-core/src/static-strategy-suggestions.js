import { suggestion } from "./result.js";

const MINDSPEED_VERSION = "MindSpeed 0.12.1@65634689bed75ee9b6df666d526f7f16051a3db5";
const AUTO_SETTINGS_CP = "MindSpeed:mindspeed/auto_settings/module/search/stage_1_prune.py:30-44@6563468";
const HCCL_ADAPTIVE_DOC = "MindSpeed:docs/zh/features/hccl-group-buffer-set.md@6563468";
const HCCL_ADAPTIVE_FORMULA = "MindSpeed:mindspeed/core/hccl_buffer/hccl_adaptive_func.py:83-263@6563468";
const CAPACITY_SOURCE = "mindspeed-config-mcp:estimate-training-capacity.js:activation-and-sharding@0.1.0";
const MIB = 1024 * 1024;

function ceilDouble(value) {
  return 2 * Math.ceil(value);
}

function hardwareProfile(cardModel) {
  const normalized = String(cardModel ?? "").toLowerCase();
  if (normalized.includes("910_93")) {
    return { id: "910_93", label: "昇腾 910_93", minimumSequencePerCp: 4 * 1024 };
  }
  if (normalized.includes("910b") || normalized.includes("a2g")) {
    return { id: "910B/A2G", label: "昇腾 910B/A2G", minimumSequencePerCp: 8 * 1024 };
  }
  return null;
}

function divisorsUpTo(value, maximum) {
  const output = new Set();
  for (let candidate = 1; candidate <= Math.sqrt(value); candidate += 1) {
    if (value % candidate !== 0) continue;
    if (candidate <= maximum) output.add(candidate);
    const paired = value / candidate;
    if (paired <= maximum) output.add(paired);
  }
  return [...output].sort((left, right) => left - right);
}

function cpSearchSpace(input) {
  const profile = hardwareProfile(input.cluster.card_model);
  const sequenceLength = input.batch.sequence_length;
  const maximum = Math.max(1, Math.floor(input.cluster.total_ranks / input.parallel.tp));
  const divisible = divisorsUpTo(sequenceLength, maximum);
  const eligible = divisible.filter((cp) => (
    cp === 1 || !profile || sequenceLength / cp >= profile.minimumSequencePerCp
  ));
  return {
    hardware_profile: profile?.id ?? "unclassified",
    minimum_sequence_per_cp: profile?.minimumSequencePerCp ?? null,
    maximum_cp_from_world_and_tp: maximum,
    divisible_cp_degrees: divisible,
    eligible_cp_degrees: eligible,
    current_cp_eligible: eligible.includes(input.parallel.cp),
  };
}

function hcclBufferEstimate(input) {
  const { model, parallel, batch, features = {} } = input;
  const sequence = batch.sequence_length;
  const microBatch = batch.micro_batch_size;
  const hidden = model.hidden_size;
  const cp = parallel.cp;
  const tp = parallel.tp;
  const ep = parallel.ep;
  const topK = model.top_k;
  const dispatcher = features.moe_token_dispatcher_type;
  const configuredFactor = features.hccl_ep_group_buffer_adaptive_factor;
  const factor = Number.isFinite(configuredFactor) && configuredFactor > 0
    ? configuredFactor
    : null;
  const base = sequence / cp * microBatch * hidden / MIB;
  const groups = {
    tp: ceilDouble(base) * (parallel.sequence_parallel ? 1 : 2),
    pp: parallel.sequence_parallel ? ceilDouble(base / tp) : ceilDouble(base),
    pp_new_stream: parallel.sequence_parallel ? ceilDouble(base / tp) : ceilDouble(base),
    mp: 10,
    mp_exp: 10,
    tp_cp: 10,
  };

  if (model.routed_experts > 0) {
    // 锁定版本只用 factor 是否为正数决定 exp 域是否进入自适应；exp 公式本身不乘 factor。
    groups.exp = factor === null ? 200 : ceilDouble(base / tp * topK);
    if (dispatcher === "alltoall_seq") {
      const moeBuffer = factor === null ? 200 : ceilDouble(factor * base / tp * topK);
      groups.tp = Math.max(groups.tp, moeBuffer);
      if (features.moe_tp_extend_ep) groups.tp_exp = moeBuffer;
    } else if (dispatcher === "allgather") {
      groups.tp_exp = factor === null ? 200 : ceilDouble(factor * base * ep);
    }
  }

  if (parallel.cp_mode === "ulysses") {
    groups.cp = ceilDouble(base / tp);
  } else if (parallel.cp_mode === "ring") {
    const kvHeads = model.num_key_value_heads ?? model.num_attention_heads;
    const ringBase = base / model.num_attention_heads * kvHeads / tp;
    groups.cp = 2 * ceilDouble(ringBase);
    if ((parallel.cp_window_size ?? 1) > 1 || features.use_cp_send_recv_overlap) {
      groups.cp2 = ceilDouble(ringBase);
    }
  } else if (parallel.cp_mode === "hybrid" && parallel.ulysses_degree_in_cp) {
    const ulyssesDegree = parallel.ulysses_degree_in_cp;
    const ringDegree = cp / ulyssesDegree;
    const kvHeads = model.num_key_value_heads ?? model.num_attention_heads;
    groups.cp = 10;
    groups.cp_ulysses = ceilDouble(sequence / ulyssesDegree * microBatch * hidden / tp / MIB);
    groups.cp_ring = ceilDouble(sequence / ringDegree * microBatch * hidden
      / model.num_attention_heads * kvHeads / tp / MIB) * 2;
  }

  return {
    unit: "MiB",
    ep_load_imbalance_factor: factor,
    ep_factor_configured: factor !== null,
    enabled: features.hccl_group_buffer_adaptive === true,
    groups,
  };
}

export function staticStrategySuggestions(input) {
  // Every strategy below is backed by MindSpeed or the MindSpeed workbench's
  // capacity model; none is an NVIDIA Megatron recommendation.
  if (input.rule_profile?.framework === "generic") return [];
  const output = [];
  const cpSpace = cpSearchSpace(input);
  const hardware = hardwareProfile(input.cluster.card_model);
  const applicableHardware = [hardware?.label ?? input.cluster.card_model];

  if (hardware && !cpSpace.current_cp_eligible) {
    output.push(suggestion({
      code: "MINDSPEED_CP_SLICE_BELOW_DEVICE_HEURISTIC",
      kind: "suggestion",
      confidence: "model-informed",
      message: `当前 CP=${input.parallel.cp} 使每个分片只有 ${input.batch.sequence_length / input.parallel.cp} tokens，低于 ${hardware.label} 自动搜索使用的 ${hardware.minimumSequencePerCp} tokens 下限。`,
      fields: ["parallel.cp", "batch.sequence_length", "cluster.card_model"],
      applicableHardware,
      applicableVersions: [MINDSPEED_VERSION],
      assumptions: ["这是性能搜索裁剪建议，不会把当前配置判为非法。"],
      source: "mindspeed-rule",
      sourceRef: AUTO_SETTINGS_CP,
      formula: `sequence_length / cp >= ${hardware.minimumSequencePerCp}`,
      data: {
        ...cpSpace,
        action: `优先从 ${cpSpace.eligible_cp_degrees.join("、")} 中选择更低 CP，并重新配平其余并行度后做 Profiling。`,
        impact_if_ignored: "配置仍然合法，但可能因分片过小和 CP 通信开销导致吞吐下降。",
      },
    }));
  }

  const hccl = hcclBufferEstimate(input);
  output.push(suggestion({
    code: "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE",
    kind: "advisory",
    message: input.features?.hccl_group_buffer_adaptive
      ? "已启用 HCCL 通信域 Buffer 自适应；可展开查看各通信域的静态估算。"
      : "HCCL 通信域当前使用统一 200 MiB Buffer；仅在显存偏满或 OOM 时评估自适应。",
    fields: [
      "batch.sequence_length",
      "batch.micro_batch_size",
      "model.hidden_size",
      "parallel.tp",
      "parallel.cp",
      "parallel.ep",
      "features.hccl_group_buffer_adaptive",
    ],
    applicableHardware: ["昇腾 NPU"],
    applicableVersions: [MINDSPEED_VERSION, "TorchNPU FrameworkPTAdapter >= 7.0.RC1.B020"],
    assumptions: [
      "Buffer 数值单位为 MiB，并按 MindSpeed 锁定版本中的自适应公式计算。",
      hccl.ep_factor_configured
        ? `MoE EP 负载不均衡系数按显式配置 ${hccl.ep_load_imbalance_factor} 计算；实际值过大可能引起 OOM。`
        : "未显式配置 MoE EP 负载不均衡系数；按 MindSpeed 默认行为将 EP 相关通信域保留为 200 MiB。",
      "该建议只描述静态配置方向，不代表性能收益已经通过 Profiling 校准。",
    ],
    source: "mindspeed-rule",
    sourceRef: `${HCCL_ADAPTIVE_DOC}; ${HCCL_ADAPTIVE_FORMULA}`,
    data: {
      ...hccl,
      action: input.features?.hccl_group_buffer_adaptive
        ? "无需操作；用 Profiling 核对峰值显存和吞吐即可。"
        : "仅当理论容量偏满、实测显存紧张或发生 OOM 时，确认版本兼容后试加 --hccl-group-buffer-adaptive，并对比峰值显存与吞吐。",
      impact_if_ignored: "配置和训练正确性不受影响；显存紧张时可能错失通信 Buffer 的节省空间。",
    },
  }));

  const localSequence = input.batch.sequence_length / input.parallel.cp;
  if (input.memory.recompute_mode === "none" && localSequence >= 8 * 1024) {
    output.push(suggestion({
      code: "CONFIG_LONG_SEQUENCE_RECOMPUTE_CAPACITY_DIRECTION",
      kind: "suggestion",
      message: "当前长序列未启用重计算；若理论容量接近卡上限，可用 estimate_training_capacity 对比 selective/full 重计算后再决定。",
      fields: ["batch.sequence_length", "parallel.cp", "memory.recompute_mode"],
      applicableHardware,
      applicableVersions: ["mindspeed-config-mcp 0.1.x"],
      assumptions: ["这是容量方向建议；吞吐代价和真实峰值必须通过目标环境 Profiling 校准。"],
      source: "page-rule",
      sourceRef: CAPACITY_SOURCE,
      data: { sequence_per_cp: localSequence, compare_recompute_modes: ["selective", "full"] },
    }));
  }

  if (input.memory.shard_mode === "none" && input.parallel.dp > 1) {
    output.push(suggestion({
      code: "CONFIG_DP_OPTIMIZER_SHARD_CAPACITY_DIRECTION",
      kind: "suggestion",
      message: "DP>1 且优化器状态未分片；若容量受优化器状态主导，可用 estimate_training_capacity 对比 zero1/fsdp2。",
      fields: ["parallel.dp", "memory.shard_mode"],
      applicableHardware,
      applicableVersions: ["mindspeed-config-mcp 0.1.x"],
      assumptions: ["这是理论容量方向，不表示目标框架、版本和 checkpoint 流程已兼容对应分片模式。"],
      source: "page-rule",
      sourceRef: CAPACITY_SOURCE,
      data: { compare_shard_modes: ["zero1", "fsdp2"] },
    }));
  }

  return output;
}

