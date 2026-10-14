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
  const factor = features.hccl_ep_group_buffer_adaptive_factor ?? 1;
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
    groups.exp = ceilDouble(base / tp * topK);
    if (dispatcher === "alltoall_seq") {
      groups.tp = Math.max(groups.tp, ceilDouble(factor * base / tp * topK));
      if (features.moe_tp_extend_ep) groups.tp_exp = ceilDouble(factor * base / tp * topK);
    } else if (dispatcher === "allgather") {
      groups.tp_exp = ceilDouble(factor * base * ep);
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
    groups,
  };
}

export function staticStrategySuggestions(input) {
  const output = [];
  const cpSpace = cpSearchSpace(input);
  const hardware = hardwareProfile(input.cluster.card_model);
  const applicableHardware = [hardware?.label ?? input.cluster.card_model];

  output.push(suggestion({
    code: hardware
      ? "MINDSPEED_AUTO_SETTINGS_CP_SEARCH_SPACE"
      : "MINDSPEED_CP_DIVISIBILITY_SEARCH_SPACE",
    kind: "advisory",
    confidence: hardware ? "model-informed" : "theoretical",
    message: hardware
      ? `${hardware.label} 按每个 CP 分片至少 ${hardware.minimumSequencePerCp} tokens 的自动搜索启发式，可保留 CP 候选：${cpSpace.eligible_cp_degrees.join("、")}。`
      : `CP 候选范围（非性能推荐）：当前没有 ${input.cluster.card_model} 的实测性能阈值。仅按“序列长度可被 CP 整除”且“CP 不超过总 Rank/TP”筛选，CP 可取 ${cpSpace.eligible_cp_degrees.join("、")}；这些候选无法据此判断快慢，仍需通过 Profiling 或实测选择。`,
    fields: ["cluster.card_model", "cluster.total_ranks", "parallel.tp", "parallel.cp", "batch.sequence_length"],
    applicableHardware,
    applicableVersions: [MINDSPEED_VERSION],
    assumptions: [
      "候选裁剪复用 MindSpeed auto_settings 的第一阶段启发式，不代表候选间的最终性能排序。",
      "最终 TP/PP/DP/EP 组合仍需满足静态合法性约束，并使用 Profiling 或实测数据排序。",
    ],
    source: "mindspeed-rule",
    sourceRef: AUTO_SETTINGS_CP,
    formula: hardware
      ? `cp === 1 || sequence_length / cp >= ${hardware.minimumSequencePerCp}`
      : "sequence_length % cp === 0 && cp <= floor(total_ranks / tp)",
    data: cpSpace,
  }));

  if (hardware && !cpSpace.current_cp_eligible) {
    output.push(suggestion({
      code: "MINDSPEED_CP_SLICE_BELOW_DEVICE_HEURISTIC",
      kind: "suggestion",
      confidence: "model-informed",
      message: `当前 CP=${input.parallel.cp} 使每个分片只有 ${input.batch.sequence_length / input.parallel.cp} tokens，低于 ${hardware.label} 自动搜索使用的 ${hardware.minimumSequencePerCp} tokens 下限；建议从已保留候选中降低 CP。`,
      fields: ["parallel.cp", "batch.sequence_length", "cluster.card_model"],
      applicableHardware,
      applicableVersions: [MINDSPEED_VERSION],
      assumptions: ["这是性能搜索裁剪建议，不会把当前配置判为非法。"],
      source: "mindspeed-rule",
      sourceRef: AUTO_SETTINGS_CP,
      formula: `sequence_length / cp >= ${hardware.minimumSequencePerCp}`,
      data: { eligible_cp_degrees: cpSpace.eligible_cp_degrees },
    }));
  }

  const hccl = hcclBufferEstimate(input);
  output.push(suggestion({
    code: "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE",
    kind: input.features?.hccl_group_buffer_adaptive ? "advisory" : "suggestion",
    message: input.features?.hccl_group_buffer_adaptive
      ? "已启用 HCCL 通信域 Buffer 自适应；下列数值按当前统一配置静态复算。"
      : "可评估启用 --hccl-group-buffer-adaptive，按通信域而不是统一 200 MiB Buffer 配置显存。",
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
      `MoE EP 负载不均衡系数暂按 ${hccl.ep_load_imbalance_factor}；实际值过大可能引起 OOM。`,
      "该建议只描述静态配置方向，不代表性能收益已经通过 Profiling 校准。",
    ],
    source: "mindspeed-rule",
    sourceRef: `${HCCL_ADAPTIVE_DOC}; ${HCCL_ADAPTIVE_FORMULA}`,
    data: hccl,
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

