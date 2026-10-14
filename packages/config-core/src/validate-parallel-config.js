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
import { staticStrategySuggestions } from "./static-strategy-suggestions.js";

const PAGE_RULES = "compute-graph-viewer-wzh:shared/plane-rules.js@1e6bb6e";
const PAGE_VALIDATOR = "compute-graph-viewer-wzh:config-relation-observer.js:1519@1e6bb6e";
const PAGE_MODEL_STRUCTURE = "mindspeed-config-mcp:config-relation-observer.js:model-structure@2026-10-14";
const MEGATRON_PP = "Megatron-LM:megatron/training/arguments.py@core_v0.12.1";
const MINDSPEED_DYNAMIC_PP = "MindSpeed-LLM:mindspeed_llm/training/arguments.py@7826e88";
const MINDSPEED_CP = "MindSpeed:mindspeed/arguments.py:868-882@6563468";
const MINDSPEED_ADVANCED_CP = "MindSpeed:mindspeed/arguments.py:896-949@6563468";
const MINDSPEED_FEATURE_COMPATIBILITY = "MindSpeed:mindspeed/arguments.py:796-1128@6563468";
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

function enabled(features, key) {
  return features?.[key] === true;
}

function pushFeatureError(errors, condition, code, message, fields, formula) {
  push(errors, condition, diagnostic(
    code,
    message,
    fields,
    "mindspeed-rule",
    MINDSPEED_FEATURE_COMPATIBILITY,
    formula,
  ));
}

export function validateParallelConfig(input) {
  const config = readParallelConfig(input);
  const model = input.model;
  const parallel = input.parallel;
  const cluster = input.cluster;
  const batch = input.batch;
  const features = input.features ?? {};
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

  if (model.num_key_value_heads) {
    push(errors, model.num_attention_heads % model.num_key_value_heads !== 0, diagnostic(
      "MODEL_ATTENTION_HEADS_DIVISIBLE_BY_KV_HEADS",
      `注意力头 ${model.num_attention_heads} 不能被 KV 头 ${model.num_key_value_heads} 整除，GQA/MQA 分组不完整。`,
      ["model.num_attention_heads", "model.num_key_value_heads"],
      "page-rule",
      PAGE_MODEL_STRUCTURE,
      "num_attention_heads % num_key_value_heads === 0",
    ));
  }

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

  if (config.cp > 1 && ["hybrid", "hybrid-adaptive"].includes(parallel.cp_mode)) {
    const ulyssesDegree = parallel.ulysses_degree_in_cp;
    push(errors, !ulyssesDegree, diagnostic(
      "MINDSPEED_HYBRID_CP_REQUIRES_ULYSSES_DEGREE",
      `${parallel.cp_mode === "hybrid" ? "Hybrid" : "Hybrid Adaptive"} CP 必须提供 Ulysses 度数。`,
      ["parallel.cp_mode", "parallel.cp", "parallel.ulysses_degree_in_cp"],
      "mindspeed-rule",
      MINDSPEED_ADVANCED_CP,
      "ulysses_degree_in_cp is required",
    ));
    if (ulyssesDegree) {
      const ringDegree = config.cp / ulyssesDegree;
      push(errors, config.cp % ulyssesDegree !== 0 || ringDegree <= 1, diagnostic(
        "MINDSPEED_HYBRID_CP_DEGREES_FORM_CP",
        `CP ${config.cp} 必须由 Ulysses 度数 ${ulyssesDegree} 与大于 1 的 Ring 度数整数组合。`,
        ["parallel.cp", "parallel.ulysses_degree_in_cp"],
        "mindspeed-rule",
        MINDSPEED_ADVANCED_CP,
        "cp % ulysses_degree_in_cp === 0 && cp / ulysses_degree_in_cp > 1",
      ));
      push(errors, model.num_attention_heads % (ulyssesDegree * config.tp) !== 0, diagnostic(
        "MINDSPEED_HYBRID_CP_HEADS_DIVISIBLE_BY_ULYSSES_TP",
        `注意力头 ${model.num_attention_heads} 不能被 Ulysses×TP=${ulyssesDegree * config.tp} 整除。`,
        ["model.num_attention_heads", "parallel.ulysses_degree_in_cp", "parallel.tp"],
        "mindspeed-rule",
        MINDSPEED_ADVANCED_CP,
        "num_attention_heads % (ulysses_degree_in_cp * tp) === 0",
      ));
      const window = parallel.cp_window_size ?? 1;
      if (parallel.cp_mode === "hybrid" && Number.isInteger(ringDegree) && ringDegree > 1) {
        push(errors, window >= ringDegree || ringDegree % window !== 0, diagnostic(
          "MINDSPEED_HYBRID_CP_WINDOW_DIVIDES_RING_DEGREE",
          `Hybrid CP 的 window ${window} 必须小于 Ring 度数 ${ringDegree}，且能整除 Ring 度数。`,
          ["parallel.cp", "parallel.ulysses_degree_in_cp", "parallel.cp_window_size"],
          "mindspeed-rule",
          MINDSPEED_ADVANCED_CP,
          "1 <= cp_window_size < ring_degree && ring_degree % cp_window_size === 0",
        ));
      }
    }
    const sequenceDivisor = parallel.cp_mode === "hybrid" ? 2 * config.cp : config.cp;
    push(errors, batch.sequence_length % sequenceDivisor !== 0, diagnostic(
      parallel.cp_mode === "hybrid"
        ? "MINDSPEED_HYBRID_CP_SEQUENCE_DIVISIBLE_BY_2CP"
        : "MINDSPEED_HYBRID_ADAPTIVE_CP_SEQUENCE_DIVISIBLE_BY_CP",
      `${parallel.cp_mode === "hybrid" ? "Hybrid" : "Hybrid Adaptive"} CP 要求序列长度 ${batch.sequence_length} 能被 ${sequenceDivisor} 整除。`,
      ["batch.sequence_length", "parallel.cp", "parallel.cp_mode"],
      "mindspeed-rule",
      MINDSPEED_ADVANCED_CP,
      parallel.cp_mode === "hybrid"
        ? "sequence_length % (2 * cp) === 0"
        : "sequence_length % cp === 0",
    ));
  }

  if (config.cp > 1 && parallel.cp_mode === "adaptive") {
    push(errors, batch.sequence_length % config.cp !== 0, diagnostic(
      "MINDSPEED_ADAPTIVE_CP_SEQUENCE_DIVISIBLE_BY_CP",
      `Adaptive CP 要求序列长度 ${batch.sequence_length} 能被 CP ${config.cp} 整除。`,
      ["batch.sequence_length", "parallel.cp", "parallel.cp_mode"],
      "mindspeed-rule",
      MINDSPEED_ADVANCED_CP,
      "sequence_length % cp === 0",
    ));
  }

  if (config.cp > 1 && parallel.cp_mode === "ring" && (parallel.cp_window_size ?? 1) > 1) {
    const window = parallel.cp_window_size;
    push(errors, window >= config.cp || config.cp % window !== 0, diagnostic(
      "MINDSPEED_RING_CP_WINDOW_DIVIDES_CP",
      `Ring CP 的 window ${window} 必须小于 CP ${config.cp}，且能整除 CP。`,
      ["parallel.cp", "parallel.cp_window_size"],
      "mindspeed-rule",
      MINDSPEED_ADVANCED_CP,
      "1 <= cp_window_size < cp && cp % cp_window_size === 0",
    ));
  }

  pushFeatureError(
    errors,
    enabled(features, "use_ascend_mc2") && enabled(features, "use_ascend_coc"),
    "MINDSPEED_MC2_COC_MUTUALLY_EXCLUSIVE",
    "Ascend MC2 与 CoC 不能同时启用。",
    ["features.use_ascend_mc2", "features.use_ascend_coc"],
    "!(use_ascend_mc2 && use_ascend_coc)",
  );

  if (model.routed_experts > 0) {
    pushFeatureError(
      errors,
      enabled(features, "use_ascend_mc2"),
      "MINDSPEED_MC2_INCOMPATIBLE_WITH_MOE",
      "当前 MindSpeed 规则不允许在 MoE 模型上启用通用 Ascend MC2。",
      ["model.routed_experts", "features.use_ascend_mc2"],
      "routed_experts === 0 || !use_ascend_mc2",
    );
    pushFeatureError(
      errors,
      enabled(features, "use_ascend_coc"),
      "MINDSPEED_COC_INCOMPATIBLE_WITH_MOE",
      "当前 MindSpeed 规则不允许在 MoE 模型上启用 CoC。",
      ["model.routed_experts", "features.use_ascend_coc"],
      "routed_experts === 0 || !use_ascend_coc",
    );
  }

  const ampipeDegree = features.ampipe_degree ?? 1;
  if (ampipeDegree > 1) {
    pushFeatureError(errors, !enabled(features, "use_flash_attention"),
      "MINDSPEED_AMPIPE_REQUIRES_FLASH_ATTENTION", "AMPipe 必须启用 FlashAttention。",
      ["features.ampipe_degree", "features.use_flash_attention"], "use_flash_attention === true");
    pushFeatureError(errors, model.routed_experts <= 0,
      "MINDSPEED_AMPIPE_REQUIRES_MOE", "AMPipe 只支持 MoE 模型。",
      ["features.ampipe_degree", "model.routed_experts"], "routed_experts > 0");
    pushFeatureError(errors, config.ep <= 1,
      "MINDSPEED_AMPIPE_REQUIRES_EP", "AMPipe 要求 EP 大于 1。",
      ["features.ampipe_degree", "parallel.ep"], "ep > 1");
    pushFeatureError(errors, features.moe_model_type !== "deepspeed_moe",
      "MINDSPEED_AMPIPE_REQUIRES_DEEPSPEED_MOE", "AMPipe 当前只支持 deepspeed_moe。",
      ["features.ampipe_degree", "features.moe_model_type"], "moe_model_type === 'deepspeed_moe'");
    for (const [key, code, label] of [
      ["use_ascend_mc2", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_MC2", "Ascend MC2"],
      ["add_bias_linear", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_BIAS", "bias linear"],
      ["overlap_grad_reduce", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_GRAD_OVERLAP", "overlap_grad_reduce"],
      ["overlap_param_gather", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_PARAM_OVERLAP", "overlap_param_gather"],
      ["use_nanopipe", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_NANOPIPE", "NanoPipe"],
      ["recompute_in_bubble", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_BUBBLE_RECOMPUTE", "recompute_in_bubble"],
      ["recompute_in_advance", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_ADVANCE_RECOMPUTE", "recompute_in_advance"],
      ["adaptive_recompute", "MINDSPEED_AMPIPE_INCOMPATIBLE_WITH_ADAPTIVE_RECOMPUTE", "adaptive recompute"],
    ]) {
      pushFeatureError(errors, enabled(features, key), code, `AMPipe 当前不支持 ${label}。`,
        ["features.ampipe_degree", `features.${key}`], `!${key}`);
    }
    if (parallel.sequence_parallel) {
      pushFeatureError(errors, batch.sequence_length % (ampipeDegree * config.tp) !== 0,
        "MINDSPEED_AMPIPE_SEQUENCE_DIVISIBLE_BY_DEGREE_TP",
        `启用 sequence parallel 时，序列长度 ${batch.sequence_length} 必须能被 AMPipe×TP=${ampipeDegree * config.tp} 整除。`,
        ["batch.sequence_length", "features.ampipe_degree", "parallel.tp", "parallel.sequence_parallel"],
        "sequence_length % (ampipe_degree * tp) === 0");
    }
    if (config.cp > 1) {
      pushFeatureError(errors, parallel.cp_mode !== "ring",
        "MINDSPEED_AMPIPE_CP_REQUIRES_RING", "AMPipe 与 CP 同用时只支持 Ring/megatron CP。",
        ["features.ampipe_degree", "parallel.cp", "parallel.cp_mode"], "cp <= 1 || cp_mode === 'ring'");
      pushFeatureError(errors, ampipeDegree !== 2,
        "MINDSPEED_AMPIPE_CP_REQUIRES_DEGREE_TWO", "AMPipe 与 CP 同用时 AMPipe degree 必须为 2。",
        ["features.ampipe_degree", "parallel.cp"], "cp <= 1 || ampipe_degree === 2");
      const divisor = 2 * ampipeDegree * config.cp * (parallel.sequence_parallel ? config.tp : 1);
      pushFeatureError(errors, batch.sequence_length % divisor !== 0,
        "MINDSPEED_AMPIPE_CP_SEQUENCE_DIVISIBILITY",
        `当前 AMPipe/CP 组合要求序列长度 ${batch.sequence_length} 能被 ${divisor} 整除。`,
        ["batch.sequence_length", "features.ampipe_degree", "parallel.cp", "parallel.tp", "parallel.sequence_parallel"],
        "sequence_length % (2 * ampipe_degree * cp * (sequence_parallel ? tp : 1)) === 0");
    }
  }

  if (enabled(features, "tp_2d")) {
    const tpX = features.tp_x ?? 1;
    const tpY = features.tp_y ?? 1;
    pushFeatureError(errors, parallel.sequence_parallel, "MINDSPEED_TP2D_INCOMPATIBLE_WITH_SEQUENCE_PARALLEL",
      "2D TP 不支持 sequence parallel。", ["features.tp_2d", "parallel.sequence_parallel"], "!sequence_parallel");
    pushFeatureError(errors, enabled(features, "use_fused_rmsnorm"), "MINDSPEED_TP2D_INCOMPATIBLE_WITH_FUSED_RMSNORM",
      "2D TP 不支持 fused RMSNorm。", ["features.tp_2d", "features.use_fused_rmsnorm"], "!use_fused_rmsnorm");
    pushFeatureError(errors, enabled(features, "use_nanopipe"), "MINDSPEED_TP2D_INCOMPATIBLE_WITH_NANOPIPE",
      "2D TP 不支持 NanoPipe。", ["features.tp_2d", "features.use_nanopipe"], "!use_nanopipe");
    pushFeatureError(errors, ampipeDegree > 1, "MINDSPEED_TP2D_INCOMPATIBLE_WITH_AMPIPE",
      "2D TP 不支持 AMPipe。", ["features.tp_2d", "features.ampipe_degree"], "ampipe_degree <= 1");
    pushFeatureError(errors, !["ring", "ulysses"].includes(parallel.cp_mode), "MINDSPEED_TP2D_CP_MODE_LIMIT",
      "2D TP 当前只支持 Ring 或 Ulysses CP。", ["features.tp_2d", "parallel.cp_mode"],
      "cp_mode in ['ring', 'ulysses']");
    pushFeatureError(errors, enabled(features, "use_ascend_coc"), "MINDSPEED_TP2D_INCOMPATIBLE_WITH_COC",
      "2D TP 不支持 Ascend CoC。", ["features.tp_2d", "features.use_ascend_coc"], "!use_ascend_coc");
    pushFeatureError(errors, config.tp !== tpX * tpY, "MINDSPEED_TP2D_FACTORS_MATCH_TP",
      `2D TP 要求 TP=${config.tp} 等于 tp_x×tp_y=${tpX * tpY}。`,
      ["parallel.tp", "features.tp_x", "features.tp_y"], "tp === tp_x * tp_y");
    pushFeatureError(errors, config.ep > 1 || model.routed_experts > 0, "MINDSPEED_TP2D_INCOMPATIBLE_WITH_MOE",
      "2D TP 当前不支持 MoE/EP。", ["features.tp_2d", "model.routed_experts", "parallel.ep"],
      "routed_experts === 0 && ep === 1");
  }

  if (enabled(features, "use_nd_matmul")) {
    pushFeatureError(errors, features.normalization === "layernorm", "MINDSPEED_ND_MATMUL_INCOMPATIBLE_WITH_LAYERNORM",
      "ND MatMul 当前不支持 LayerNorm。", ["features.use_nd_matmul", "features.normalization"],
      "normalization !== 'layernorm'");
    pushFeatureError(errors, enabled(features, "loading_checkpoint"), "MINDSPEED_ND_MATMUL_INCOMPATIBLE_WITH_CHECKPOINT_LOAD",
      "ND MatMul 训练当前不支持加载权重或预训练 checkpoint。",
      ["features.use_nd_matmul", "features.loading_checkpoint"], "!loading_checkpoint");
    for (const key of ["nd1_dim1_size", "nd2_dim1_size"]) {
      const dimension = features[key] ?? 1;
      pushFeatureError(errors, config.tp % dimension !== 0, `MINDSPEED_ND_MATMUL_TP_DIVISIBLE_BY_${key.startsWith("nd1") ? "ND1" : "ND2"}`,
        `TP ${config.tp} 必须能被 ${key}=${dimension} 整除。`, ["parallel.tp", `features.${key}`], `tp % ${key} === 0`);
    }
  }

  const alltoallOverlap = enabled(features, "moe_alltoall_overlap_comm");
  const allgatherOverlap = enabled(features, "moe_allgather_overlap_comm");
  pushFeatureError(errors, alltoallOverlap && features.moe_token_dispatcher_type !== "alltoall_seq",
    "MINDSPEED_MOE_ALLTOALL_OVERLAP_REQUIRES_ALLTOALL_SEQ",
    "MoE AllToAll overlap 只支持 alltoall_seq dispatcher。",
    ["features.moe_alltoall_overlap_comm", "features.moe_token_dispatcher_type"],
    "moe_token_dispatcher_type === 'alltoall_seq'");
  pushFeatureError(errors, allgatherOverlap && features.moe_token_dispatcher_type !== "allgather",
    "MINDSPEED_MOE_ALLGATHER_OVERLAP_REQUIRES_ALLGATHER",
    "MoE AllGather overlap 只支持 allgather dispatcher。",
    ["features.moe_allgather_overlap_comm", "features.moe_token_dispatcher_type"],
    "moe_token_dispatcher_type === 'allgather'");
  pushFeatureError(errors, enabled(features, "moe_adaptive_recompute_activation")
    && features.moe_token_dispatcher_type === "alltoall_seq",
  "MINDSPEED_MOE_ADAPTIVE_RECOMPUTE_REQUIRES_ALLGATHER",
  "MoE adaptive recompute activation 不支持 alltoall_seq，当前规则要求 allgather。",
  ["features.moe_adaptive_recompute_activation", "features.moe_token_dispatcher_type"],
  "moe_token_dispatcher_type === 'allgather'");
  if (alltoallOverlap || allgatherOverlap) {
    pushFeatureError(errors, !enabled(features, "moe_permutation_async_comm"),
      "MINDSPEED_MOE_OVERLAP_REQUIRES_ASYNC_PERMUTATION", "MoE dispatcher overlap 必须启用 permutation async communication。",
      ["features.moe_alltoall_overlap_comm", "features.moe_allgather_overlap_comm", "features.moe_permutation_async_comm"],
      "moe_permutation_async_comm === true");
    pushFeatureError(errors, !enabled(features, "moe_grouped_gemm"),
      "MINDSPEED_MOE_OVERLAP_REQUIRES_GROUPED_GEMM", "MoE dispatcher overlap 必须启用 grouped GEMM。",
      ["features.moe_alltoall_overlap_comm", "features.moe_allgather_overlap_comm", "features.moe_grouped_gemm"],
      "moe_grouped_gemm === true");
  }
  pushFeatureError(errors, alltoallOverlap && config.tp > 1 && !enabled(features, "moe_tp_extend_ep"),
    "MINDSPEED_MOE_ALLTOALL_OVERLAP_TP_REQUIRES_EXTEND_EP",
    "TP>1 的 MoE AllToAll overlap 必须启用 moe_tp_extend_ep。",
    ["parallel.tp", "features.moe_alltoall_overlap_comm", "features.moe_tp_extend_ep"],
    "tp === 1 || moe_tp_extend_ep");
  if (enabled(features, "moe_tp_extend_ep")) {
    pushFeatureError(errors, model.routed_experts % (config.tp * config.ep) !== 0,
      "MINDSPEED_MOE_TP_EXTEND_EP_EXPERT_DIVISIBILITY",
      `moe_tp_extend_ep 要求路由专家 ${model.routed_experts} 能被 TP×EP=${config.tp * config.ep} 整除。`,
      ["model.routed_experts", "parallel.tp", "parallel.ep", "features.moe_tp_extend_ep"],
      "routed_experts % (tp * ep) === 0");
    pushFeatureError(errors, !enabled(features, "moe_permutation_async_comm") || !enabled(features, "moe_grouped_gemm"),
      "MINDSPEED_MOE_TP_EXTEND_EP_REQUIRES_ASYNC_GROUPED_GEMM",
      "moe_tp_extend_ep 必须同时启用 permutation async communication 和 grouped GEMM。",
      ["features.moe_tp_extend_ep", "features.moe_permutation_async_comm", "features.moe_grouped_gemm"],
      "moe_permutation_async_comm && moe_grouped_gemm");
  }
  if (enabled(features, "moe_bmm_mc2")) {
    pushFeatureError(errors, features.moe_model_type !== "megatron_moe"
      || features.moe_token_dispatcher_type !== "alltoall",
    "MINDSPEED_MOE_BMM_MC2_REQUIRES_MCORE_ALLTOALL",
    "MoE BMM MC2 只支持 megatron_moe 与 alltoall dispatcher。",
    ["features.moe_bmm_mc2", "features.moe_model_type", "features.moe_token_dispatcher_type"],
    "moe_model_type === 'megatron_moe' && moe_token_dispatcher_type === 'alltoall'");
    pushFeatureError(errors, !enabled(features, "moe_grouped_gemm"),
      "MINDSPEED_MOE_BMM_MC2_REQUIRES_GROUPED_GEMM", "MoE BMM MC2 必须启用 grouped GEMM。",
      ["features.moe_bmm_mc2", "features.moe_grouped_gemm"], "moe_grouped_gemm === true");
    pushFeatureError(errors, enabled(features, "moe_tp_extend_ep") || alltoallOverlap,
      "MINDSPEED_MOE_BMM_MC2_OVERLAP_CONFLICT",
      "MoE BMM MC2 不支持 moe_tp_extend_ep 或 MoE AllToAll overlap。",
      ["features.moe_bmm_mc2", "features.moe_tp_extend_ep", "features.moe_alltoall_overlap_comm"],
      "!moe_tp_extend_ep && !moe_alltoall_overlap_comm");
  }

  pushFeatureError(errors, enabled(features, "adaptive_recompute") && input.memory.recompute_mode !== "none",
    "MINDSPEED_ADAPTIVE_RECOMPUTE_CONFLICTS_WITH_STATIC_RECOMPUTE",
    "Adaptive recompute 不能与静态 recompute mode 同时启用。",
    ["features.adaptive_recompute", "memory.recompute_mode"], "!adaptive_recompute || recompute_mode === 'none'");
  if (enabled(features, "adaptive_memory_optimization")) {
    pushFeatureError(errors, ampipeDegree > 1, "MINDSPEED_ADAPTIVE_MEMORY_INCOMPATIBLE_WITH_AMPIPE",
      "Adaptive memory optimization 不支持 AMPipe。",
      ["features.adaptive_memory_optimization", "features.ampipe_degree"], "ampipe_degree <= 1");
    pushFeatureError(errors, enabled(features, "adaptive_recompute"),
      "MINDSPEED_ADAPTIVE_MEMORY_INCOMPATIBLE_WITH_ADAPTIVE_RECOMPUTE",
      "Adaptive memory optimization 不支持 adaptive recompute。",
      ["features.adaptive_memory_optimization", "features.adaptive_recompute"], "!adaptive_recompute");
    pushFeatureError(errors, input.memory.recompute_mode !== "none",
      "MINDSPEED_ADAPTIVE_MEMORY_INCOMPATIBLE_WITH_STATIC_RECOMPUTE",
      "Adaptive memory optimization 不支持静态 recompute mode。",
      ["features.adaptive_memory_optimization", "memory.recompute_mode"], "recompute_mode === 'none'");
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
    suggestions: errors.length ? [] : staticStrategySuggestions(input),
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

