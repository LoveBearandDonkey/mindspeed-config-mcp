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
const MEGATRON_PP = "Megatron-LM:megatron/training/arguments.py@core_v0.12.1";
const MINDSPEED_DYNAMIC_PP = "MindSpeed-LLM:mindspeed_llm/training/arguments.py@7826e88";
const MINDSPEED_CP = "MindSpeed:mindspeed/arguments.py:868-882@6563468";
const MINDFORMERS_OFFSET = "compute-graph-viewer-wzh:config-test/mf_pretrain_deepseek3_671b.yaml:model.model_config.offset";

function usesMindSpeedSemantics(input) {
  return input.rule_profile?.framework !== "generic";
}

function pipelineLayerMode(input) {
  if (input.parallel?.pipeline_layer_mode) return input.parallel.pipeline_layer_mode;
  return Array.isArray(input.parallel?.num_layer_list) ? "dynamic" : "uniform";
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
  const ppLayerMode = pipelineLayerMode(input);
  const numLayerList = parallel.num_layer_list;
  const layerOffsets = parallel.pipeline_layer_offsets;

  push(errors, config.layers < config.pp, diagnostic(
    "PAGE_LAYERS_AT_LEAST_PP",
    `总层数 ${config.layers} 少于 PP ${config.pp}，无法保证每个 Stage 至少一层。`,
    ["model.total_layers", "parallel.pp"],
    "page-rule",
    PAGE_RULES,
    "total_layers >= pp",
  ));

  if (ppLayerMode === "mindformers-offset") {
    push(errors, input.rule_profile?.framework !== "mindformers", diagnostic(
      "MINDFORMERS_OFFSET_REQUIRES_MINDFORMERS_PROFILE",
      "MindFormers PP 层偏置只按 MindFormers profile 校验。",
      ["rule_profile.framework", "parallel.pipeline_layer_mode", "parallel.pipeline_layer_offsets"],
      "compatibility-gap",
      MINDFORMERS_OFFSET,
      "framework === 'mindformers'",
    ));
    push(errors, !Array.isArray(layerOffsets) || !layerOffsets.length, diagnostic(
      "MINDFORMERS_OFFSET_REQUIRES_MATRIX",
      "选择 MindFormers PP 层偏置后必须提供 offset 矩阵。",
      ["parallel.pipeline_layer_mode", "parallel.pipeline_layer_offsets"],
      "compatibility-gap",
      MINDFORMERS_OFFSET,
    ));
    if (Array.isArray(layerOffsets) && layerOffsets.length) {
      const rectangular = layerOffsets.every((row) => Array.isArray(row) && row.length === config.pp);
      push(errors, !rectangular || layerOffsets.length !== config.vpp, diagnostic(
        "MINDFORMERS_OFFSET_SHAPE_MATCHES_VPP_PP",
        `offset 矩阵必须是 VPP×PP=${config.vpp}×${config.pp}，当前为 ${layerOffsets.length}×${layerOffsets[0]?.length ?? 0}。`,
        ["parallel.pp", "parallel.vpp", "parallel.pipeline_layer_offsets"],
        "compatibility-gap",
        MINDFORMERS_OFFSET,
        "offset.length === vpp && every(row.length === pp)",
      ));
      if (rectangular && layerOffsets.length === config.vpp) {
        const offsetSum = layerOffsets.flat().reduce((sum, value) => sum + value, 0);
        const base = (config.layers - offsetSum) / (config.pp * config.vpp);
        const positive = Number.isInteger(base) && layerOffsets.flat().every((value) => base + value > 0);
        push(errors, !positive, diagnostic(
          "MINDFORMERS_OFFSET_RESOLVES_ALL_LAYERS",
          `offset 矩阵无法把 ${config.layers} 层分配为正整数虚拟 Stage。`,
          ["model.total_layers", "parallel.pp", "parallel.vpp", "parallel.pipeline_layer_offsets"],
          "compatibility-gap",
          MINDFORMERS_OFFSET,
          "base=(total_layers-sum(offset))/(pp*vpp) is positive integer",
        ));
      }
    }
  } else if (ppLayerMode === "dynamic") {
    push(errors, input.rule_profile?.framework !== "mindspeed-llm-mcore", diagnostic(
      "MINDSPEED_DYNAMIC_PP_REQUIRES_MCORE_PROFILE",
      "动态 PP 的 num_layer_list 当前只按 MindSpeed-LLM MCore 口径校验。",
      ["rule_profile.framework", "parallel.pipeline_layer_mode", "parallel.num_layer_list"],
      "mindspeed-rule",
      MINDSPEED_DYNAMIC_PP,
      "framework === 'mindspeed-llm-mcore'",
    ));
    push(errors, !Array.isArray(numLayerList) || numLayerList.length === 0, diagnostic(
      "MINDSPEED_DYNAMIC_PP_REQUIRES_NUM_LAYER_LIST",
      "选择动态 PP 后，必须明确提供每个 Stage 的层数 num_layer_list。",
      ["parallel.pipeline_layer_mode", "parallel.num_layer_list"],
      "mindspeed-rule",
      MINDSPEED_DYNAMIC_PP,
      "num_layer_list.length === pp",
    ));
    if (Array.isArray(numLayerList) && numLayerList.length > 0) {
      push(errors, numLayerList.length !== config.pp, diagnostic(
        "MINDSPEED_DYNAMIC_PP_LIST_LENGTH_MATCHES_PP",
        `动态 PP 给了 ${numLayerList.length} 个 Stage 层数，但 PP 是 ${config.pp}。`,
        ["parallel.pp", "parallel.num_layer_list"],
        "mindspeed-rule",
        MINDSPEED_DYNAMIC_PP,
        "num_layer_list.length === pp",
      ));
      const listedLayers = numLayerList.reduce((sum, layers) => sum + layers, 0);
      push(errors, listedLayers !== config.layers, diagnostic(
        "MINDSPEED_DYNAMIC_PP_LIST_SUM_MATCHES_LAYERS",
        `动态 PP 的 Stage 层数之和是 ${listedLayers}，与总层数 ${config.layers} 不一致。`,
        ["model.total_layers", "parallel.num_layer_list"],
        "mindspeed-rule",
        MINDSPEED_DYNAMIC_PP,
        "sum(num_layer_list) === total_layers",
      ));
    }
  } else if (Array.isArray(numLayerList)) {
    errors.push(diagnostic(
      "CONFIG_NUM_LAYER_LIST_REQUIRES_DYNAMIC_PP",
      "已经提供 num_layer_list，但 PP 分层模式仍是均匀；请明确选择动态 PP，或移除该列表。",
      ["parallel.pipeline_layer_mode", "parallel.num_layer_list"],
      "compatibility-gap",
      MINDSPEED_DYNAMIC_PP,
      "num_layer_list === undefined || pipeline_layer_mode === 'dynamic'",
    ));
  }

  if (ppLayerMode === "uniform" && config.layers >= config.pp && config.layers % config.pp !== 0) {
    const issue = diagnostic(
      "MINDSPEED_LAYERS_DIVISIBLE_BY_PP",
      `均匀 PP 要求每个 Stage 层数相同，但总层数 ${config.layers} 不能被 PP ${config.pp} 整除。MindSpeed-LLM MCore 可改用动态 PP 并明确 num_layer_list。`,
      ["model.total_layers", "parallel.pp", "parallel.pipeline_layer_mode"],
      usesMindSpeedSemantics(input) ? "mindspeed-rule" : "compatibility-gap",
      MEGATRON_PP,
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
    push(errors, ppLayerMode === "dynamic", diagnostic(
      "MINDSPEED_DYNAMIC_PP_INCOMPATIBLE_WITH_VPP",
      `动态 PP 与 VPP ${config.vpp} 不能同时启用；请将 VPP 调回 1，或改回均匀 PP。`,
      ["parallel.pipeline_layer_mode", "parallel.num_layer_list", "parallel.vpp"],
      "mindspeed-rule",
      MINDSPEED_DYNAMIC_PP,
      "pipeline_layer_mode !== 'dynamic' || vpp === 1",
    ));
    push(errors, ppLayerMode === "uniform" && config.pp > 1
      && config.layers % (config.pp * config.vpp) !== 0, diagnostic(
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
      "只校验表单和 rule_profile 对应上游中已建模的静态约束，不代表目标环境已经实机运行通过。",
    ],
    data: {
      valid: errors.length === 0,
      world_size: world,
      ep_mode: config.mode,
      pipeline_layer_mode: ppLayerMode,
      pipeline_stage_layers: ppLayerMode === "dynamic" && Array.isArray(numLayerList)
        ? [...numLayerList]
        : (ppLayerMode === "mindformers-offset" && Array.isArray(layerOffsets)
          && layerOffsets.length === config.vpp
          && layerOffsets.every((row) => Array.isArray(row) && row.length === config.pp)
          ? Array.from({ length: config.pp }, (_, stage) => {
            const offsetSum = layerOffsets.flat().reduce((sum, value) => sum + value, 0);
            const base = (config.layers - offsetSum) / (config.pp * config.vpp);
            return layerOffsets.reduce((sum, row) => sum + base + row[stage], 0);
          })
          : null),
      ep_domain: epDomain(input),
      expert_data_parallel: Number.isInteger(expertDataParallel(input))
        ? expertDataParallel(input)
        : null,
    },
  });
}

