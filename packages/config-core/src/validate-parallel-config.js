import {
  EP_MF,
  EP_ORTHOGONAL,
  epDomain,
  epInWorld,
  expertDataParallel,
  parallelWorld,
  readParallelConfig,
} from "./page-rules.js";
import { diagnostic, toolResult } from "./result.js";

const PAGE_RULES = "compute-graph-viewer-wzh:shared/plane-rules.js@1e6bb6e";
const PAGE_VALIDATOR = "compute-graph-viewer-wzh:config-relation-observer.js:1519@1e6bb6e";
const MINDSPEED_PP = "MindSpeed:mindspeed/arguments.py:719-734@6563468";
const MINDSPEED_CP = "MindSpeed:mindspeed/arguments.py:868-882@6563468";

function usesMindSpeedSemantics(input) {
  return input.rule_profile?.framework !== "generic";
}

function push(errors, condition, value) {
  if (condition) errors.push(value);
}

export function validateParallelConfig(input) {
  const config = readParallelConfig(input);
  const model = input.model;
  const parallel = input.parallel;
  const cluster = input.cluster;
  const batch = input.batch;
  const errors = [];
  const warnings = [];

  push(errors, config.layers < config.pp, diagnostic(
    "PAGE_LAYERS_AT_LEAST_PP",
    `总层数 ${config.layers} 少于 PP ${config.pp}，无法保证每个 Stage 至少一层。`,
    ["model.total_layers", "parallel.pp"],
    "page-rule",
    PAGE_RULES,
    "total_layers >= pp",
  ));

  if (config.layers >= config.pp && config.layers % config.pp !== 0) {
    const issue = diagnostic(
      "MINDSPEED_LAYERS_DIVISIBLE_BY_PP",
      `总层数 ${config.layers} 不能被 PP ${config.pp} 整除。页面可以画出不均匀 Stage，但当前 MindSpeed 规则口径要求整除。`,
      ["model.total_layers", "parallel.pp"],
      usesMindSpeedSemantics(input) ? "mindspeed-rule" : "compatibility-gap",
      MINDSPEED_PP,
      "total_layers % pp === 0",
    );
    (usesMindSpeedSemantics(input) ? errors : warnings).push(issue);
  }

  push(errors, model.num_attention_heads % config.tp !== 0, diagnostic(
    "PAGE_HEADS_DIVISIBLE_BY_TP",
    `注意力头 ${model.num_attention_heads} 不能被 TP ${config.tp} 整除。`,
    ["model.num_attention_heads", "parallel.tp"],
    "page-rule",
    PAGE_VALIDATOR,
    "num_attention_heads % tp === 0",
  ));

  if (model.ffn_hidden_size) {
    push(errors, model.ffn_hidden_size % config.tp !== 0, diagnostic(
      "PAGE_DENSE_FFN_DIVISIBLE_BY_TP",
      `Dense FFN intermediate ${model.ffn_hidden_size} 不能被 TP ${config.tp} 整除。`,
      ["model.ffn_hidden_size", "parallel.tp"],
      "page-rule",
      PAGE_VALIDATOR,
      "ffn_hidden_size % tp === 0",
    ));
  }

  if (parallel.expert_tensor_parallel && model.expert_ffn_hidden_size && model.routed_experts > 0) {
    push(errors, model.expert_ffn_hidden_size % config.tp !== 0, diagnostic(
      "PAGE_EXPERT_FFN_DIVISIBLE_BY_TP",
      `MoE 专家 intermediate ${model.expert_ffn_hidden_size} 不能被 TP ${config.tp} 整除。`,
      ["model.expert_ffn_hidden_size", "parallel.tp", "parallel.expert_tensor_parallel"],
      "page-rule",
      PAGE_VALIDATOR,
      "expert_ffn_hidden_size % tp === 0",
    ));
  }

  if (config.cp > 1 && parallel.cp_mode === "ulysses") {
    push(errors, model.num_attention_heads % (config.tp * config.cp) !== 0, diagnostic(
      "MINDSPEED_ULYSSES_HEADS_DIVISIBLE_BY_TP_CP",
      `Ulysses 口径下，注意力头 ${model.num_attention_heads} 不能被 TP×CP=${config.tp * config.cp} 整除。`,
      ["model.num_attention_heads", "parallel.tp", "parallel.cp"],
      "mindspeed-rule",
      MINDSPEED_CP,
      "num_attention_heads % (tp * cp) === 0",
    ));
    push(errors, batch.sequence_length % config.cp !== 0, diagnostic(
      "MINDSPEED_ULYSSES_SEQUENCE_DIVISIBLE_BY_CP",
      `Ulysses 口径下，序列长度 ${batch.sequence_length} 不能被 CP ${config.cp} 整除。`,
      ["batch.sequence_length", "parallel.cp"],
      "mindspeed-rule",
      MINDSPEED_CP,
      "sequence_length % cp === 0",
    ));
  }

  if (config.cp > 1 && parallel.cp_mode === "ring") {
    push(errors, batch.sequence_length % (2 * config.cp) !== 0, diagnostic(
      "MINDSPEED_RING_SEQUENCE_DIVISIBLE_BY_2CP",
      `Ring 口径下，序列长度 ${batch.sequence_length} 不能被 2×CP=${2 * config.cp} 整除。`,
      ["batch.sequence_length", "parallel.cp"],
      "mindspeed-rule",
      MINDSPEED_CP,
      "sequence_length % (2 * cp) === 0",
    ));
  }

  if (config.vpp > 1) {
    push(errors, config.pp <= 1, diagnostic(
      "PAGE_VPP_REQUIRES_PP",
      `PP ${config.pp} 时没有可供 VPP ${config.vpp} 交错的流水线。`,
      ["parallel.pp", "parallel.vpp"],
      "page-rule",
      PAGE_VALIDATOR,
      "vpp === 1 || pp > 1",
    ));
    push(errors, config.pp > 1 && config.layers % (config.pp * config.vpp) !== 0, diagnostic(
      "PAGE_LAYERS_DIVISIBLE_BY_PP_VPP",
      `总层数 ${config.layers} 不能被 PP×VPP=${config.pp * config.vpp} 整除。`,
      ["model.total_layers", "parallel.pp", "parallel.vpp"],
      "page-rule",
      PAGE_VALIDATOR,
      "total_layers % (pp * vpp) === 0",
    ));
  }

  if (model.routed_experts > 0) {
    push(errors, model.routed_experts % config.ep !== 0, diagnostic(
      "PAGE_EXPERTS_DIVISIBLE_BY_EP",
      `路由专家 ${model.routed_experts} 不能被 EP ${config.ep} 整除。`,
      ["model.routed_experts", "parallel.ep"],
      "page-rule",
      PAGE_RULES,
      "routed_experts % ep === 0",
    ));
    push(errors, model.top_k > model.routed_experts, diagnostic(
      "PAGE_TOPK_WITHIN_EXPERTS",
      `Top-K ${model.top_k} 超过路由专家总数 ${model.routed_experts}。`,
      ["model.top_k", "model.routed_experts"],
      "page-rule",
      PAGE_RULES,
      "top_k <= routed_experts",
    ));
  } else {
    push(errors, config.ep !== 1, diagnostic(
      "CONFIG_DENSE_MODEL_REQUIRES_EP_ONE",
      "Dense 模型没有路由专家，EP 必须为 1。",
      ["model.routed_experts", "parallel.ep"],
      "page-rule",
      PAGE_RULES,
      "routed_experts > 0 || ep === 1",
    ));
    push(errors, model.top_k !== 0, diagnostic(
      "CONFIG_DENSE_MODEL_REQUIRES_TOPK_ZERO",
      "Dense 模型没有路由专家，Top-K 必须为 0。",
      ["model.routed_experts", "model.top_k"],
      "page-rule",
      PAGE_RULES,
      "routed_experts > 0 || top_k === 0",
    ));
  }

  if (config.mode !== EP_ORTHOGONAL) {
    push(errors, epDomain(input) % config.ep !== 0, diagnostic(
      "PAGE_EP_DOMAIN_DIVISIBLE_BY_EP",
      config.mode === EP_MF
        ? `MindFormers 口径下，DP×TP=${epDomain(input)} 不能被 EP ${config.ep} 整除。`
        : `切出口径下，DP ${config.dp} 不能被 EP ${config.ep} 整除。`,
      config.mode === EP_MF
        ? ["parallel.dp", "parallel.tp", "parallel.ep"]
        : ["parallel.dp", "parallel.ep"],
      "page-rule",
      PAGE_RULES,
      config.mode === EP_MF ? "(dp * tp) % ep === 0" : "dp % ep === 0",
    ));
  }

  const world = parallelWorld(input);
  push(errors, world !== cluster.total_ranks, diagnostic(
    "PAGE_WORLD_SIZE_MATCHES_TOTAL_RANKS",
    `并行度乘积为 ${world}，与总 Rank ${cluster.total_ranks} 不一致。`,
    ["parallel.dp", "parallel.pp", "parallel.tp", "parallel.cp", "parallel.ep", "cluster.total_ranks"],
    "page-rule",
    PAGE_RULES,
    `dp * pp * tp * cp${epInWorld(input) === 1 ? "" : " * ep"} === total_ranks`,
  ));

  if (cluster.total_ranks % cluster.ranks_per_node !== 0) {
    warnings.push(diagnostic(
      "PAGE_PARTIAL_LAST_NODE",
      `总 Rank ${cluster.total_ranks} 不能整除每节点 ${cluster.ranks_per_node} 卡，最后一个节点只使用部分卡。`,
      ["cluster.total_ranks", "cluster.ranks_per_node"],
      "page-rule",
      PAGE_RULES,
      "total_ranks % ranks_per_node === 0",
    ));
  }

  return toolResult({
    tool: "validate_parallel_config",
    input,
    status: errors.length ? "invalid" : "valid",
    errors,
    warnings,
    assumptions: [
      "只校验表单和 MindSpeed 0.12.1 中已建模的静态约束，不代表目标环境已经实机运行通过。",
    ],
    data: {
      valid: errors.length === 0,
      world_size: world,
      ep_mode: config.mode,
      ep_domain: epDomain(input),
      expert_data_parallel: Number.isInteger(expertDataParallel(input))
        ? expertDataParallel(input)
        : null,
    },
  });
}

