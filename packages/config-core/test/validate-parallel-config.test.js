import assert from "node:assert/strict";
import test from "node:test";

import { validateParallelConfig } from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

test("合法配置返回可追溯的确定性结论", () => {
  const result = validateParallelConfig(createTrainingConfig());

  assert.equal(result.status, "valid");
  assert.equal(result.confidence, "deterministic");
  assert.equal(result.data.valid, true);
  assert.equal(result.data.world_size, 16);
  assert.equal(result.data.expert_data_parallel, 2);
  assert.deepEqual(result.errors, []);
  assert.match(result.assumptions[0], /不代表.*实机运行通过/);
});

test("并行度乘积与总 Rank 不一致时返回公式和字段", () => {
  const result = validateParallelConfig(createTrainingConfig({
    cluster: { total_ranks: 32 },
  }));
  const issue = result.errors.find((item) => item.code === "PAGE_WORLD_SIZE_MATCHES_TOTAL_RANKS");

  assert.equal(result.status, "invalid");
  assert.ok(issue);
  assert.match(issue.formula, /total_ranks/);
  assert.ok(issue.fields.includes("parallel.dp"));
});

test("均匀 PP 口径下层数必须被 PP 整除", () => {
  const result = validateParallelConfig(createTrainingConfig({
    model: { total_layers: 30 },
  }));

  assert.ok(result.errors.some((item) => item.code === "MINDSPEED_LAYERS_DIVISIBLE_BY_PP") === false);

  const invalid = validateParallelConfig(createTrainingConfig({
    model: { total_layers: 31 },
  }));
  assert.ok(invalid.errors.some((item) => item.code === "MINDSPEED_LAYERS_DIVISIBLE_BY_PP"));
});

test("MindSpeed-LLM MCore 动态 PP 接受 46 层按 12/12/11/11 分给 PP4", () => {
  const result = validateParallelConfig(createTrainingConfig({
    rule_profile: { framework: "mindspeed-llm-mcore", version: "master" },
    model: { total_layers: 46 },
    parallel: {
      pp: 4,
      dp: 2,
      pipeline_layer_mode: "dynamic",
      num_layer_list: [12, 12, 11, 11],
    },
  }));

  assert.equal(result.status, "valid");
  assert.equal(result.data.pipeline_layer_mode, "dynamic");
  assert.deepEqual(result.data.pipeline_stage_layers, [12, 12, 11, 11]);
  assert.equal(result.errors.some((item) => item.code === "MINDSPEED_LAYERS_DIVISIBLE_BY_PP"), false);
});

test("动态 PP 校验 Stage 数量、层数总和以及与 VPP 的互斥关系", () => {
  const result = validateParallelConfig(createTrainingConfig({
    rule_profile: { framework: "mindspeed-llm-mcore", version: "master" },
    model: { total_layers: 46 },
    parallel: {
      pp: 4,
      dp: 2,
      vpp: 2,
      pipeline_layer_mode: "dynamic",
      num_layer_list: [12, 12, 11],
    },
  }));

  const codes = new Set(result.errors.map((item) => item.code));
  assert.ok(codes.has("MINDSPEED_DYNAMIC_PP_LIST_LENGTH_MATCHES_PP"));
  assert.ok(codes.has("MINDSPEED_DYNAMIC_PP_LIST_SUM_MATCHES_LAYERS"));
  assert.ok(codes.has("MINDSPEED_DYNAMIC_PP_INCOMPATIBLE_WITH_VPP"));
});

test("MindFormers offset 矩阵支持 61 层、PP8、VPP2 的非均匀流水线", () => {
  const result = validateParallelConfig(createTrainingConfig({
    rule_profile: { framework: "mindformers", version: "page-baseline" },
    model: {
      total_layers: 61,
      num_attention_heads: 128,
      routed_experts: 256,
      top_k: 8,
      shared_experts: 1,
    },
    parallel: {
      dp: 4,
      pp: 8,
      tp: 8,
      ep: 32,
      vpp: 2,
      ep_mode: "mf",
      pipeline_layer_mode: "mindformers-offset",
      pipeline_layer_offsets: [
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, -2],
      ],
    },
    cluster: { total_ranks: 256 },
  }));

  assert.equal(result.status, "valid");
  assert.deepEqual(result.data.pipeline_stage_layers, [8, 8, 8, 8, 8, 8, 8, 5]);
});

test("generic 页面口径保留不均匀 Stage，但显式报告兼容差异", () => {
  const result = validateParallelConfig(createTrainingConfig({
    rule_profile: { framework: "generic", version: "page-baseline" },
    model: { total_layers: 31 },
  }));

  assert.equal(result.status, "valid");
  assert.ok(result.warnings.some((item) => (
    item.code === "MINDSPEED_LAYERS_DIVISIBLE_BY_PP"
      && item.source === "compatibility-gap"
  )));
});

test("Ulysses 和 Ring 使用各自的 CP 约束", () => {
  const ulysses = validateParallelConfig(createTrainingConfig({
    model: { num_attention_heads: 30, ffn_hidden_size: 11010 },
    parallel: { tp: 2, cp: 4 },
    cluster: { total_ranks: 64 },
  }));
  assert.ok(ulysses.errors.some((item) => item.code === "MINDSPEED_ULYSSES_HEADS_DIVISIBLE_BY_TP_CP"));

  const ring = validateParallelConfig(createTrainingConfig({
    parallel: { cp: 4, cp_mode: "ring" },
    cluster: { total_ranks: 64 },
    batch: { sequence_length: 4098 },
  }));
  assert.ok(ring.errors.some((item) => item.code === "MINDSPEED_RING_SEQUENCE_DIVISIBLE_BY_2CP"));
});

test("Hybrid 与 Adaptive CP 使用锁定 MindSpeed 版本的独立约束", () => {
  const hybrid = validateParallelConfig(createTrainingConfig({
    parallel: {
      cp: 8,
      cp_mode: "hybrid",
      ulysses_degree_in_cp: 2,
      cp_window_size: 2,
    },
    cluster: { total_ranks: 128, card_model: "昇腾 910B" },
    batch: { sequence_length: 32768 },
  }));
  assert.equal(hybrid.status, "valid");

  const invalid = validateParallelConfig(createTrainingConfig({
    parallel: {
      cp: 8,
      cp_mode: "hybrid-adaptive",
      ulysses_degree_in_cp: 3,
    },
    cluster: { total_ranks: 128 },
    batch: { sequence_length: 32770 },
  }));
  const codes = new Set(invalid.errors.map(({ code }) => code));
  assert.ok(codes.has("MINDSPEED_HYBRID_CP_DEGREES_FORM_CP"));
  assert.ok(codes.has("MINDSPEED_HYBRID_CP_HEADS_DIVISIBLE_BY_ULYSSES_TP"));
  assert.ok(codes.has("MINDSPEED_HYBRID_ADAPTIVE_CP_SEQUENCE_DIVISIBLE_BY_CP"));
});

test("MC2/CoC、AMPipe、2D TP 与 ND MatMul 返回稳定诊断码", () => {
  const featureCases = [
    [
      { model: { routed_experts: 0, top_k: 0, shared_experts: 0 }, parallel: { ep: 1 }, features: { use_ascend_mc2: true, use_ascend_coc: true } },
      "MINDSPEED_MC2_COC_MUTUALLY_EXCLUSIVE",
    ],
    [
      { features: { ampipe_degree: 2, moe_model_type: "megatron_moe" } },
      "MINDSPEED_AMPIPE_REQUIRES_FLASH_ATTENTION",
    ],
    [
      { features: { tp_2d: true, tp_x: 1, tp_y: 2 } },
      "MINDSPEED_TP2D_INCOMPATIBLE_WITH_SEQUENCE_PARALLEL",
    ],
    [
      { features: { use_nd_matmul: true, normalization: "layernorm", loading_checkpoint: true } },
      "MINDSPEED_ND_MATMUL_INCOMPATIBLE_WITH_LAYERNORM",
    ],
  ];

  for (const [overrides, expectedCode] of featureCases) {
    const result = validateParallelConfig(createTrainingConfig(overrides));
    assert.ok(result.errors.some(({ code }) => code === expectedCode), expectedCode);
  }
});

test("MoE dispatcher overlap 校验 dispatcher、异步置换、grouped GEMM 与 TP extend EP", () => {
  const invalid = validateParallelConfig(createTrainingConfig({
    features: {
      moe_token_dispatcher_type: "alltoall",
      moe_alltoall_overlap_comm: true,
    },
  }));
  const codes = new Set(invalid.errors.map(({ code }) => code));
  assert.ok(codes.has("MINDSPEED_MOE_ALLTOALL_OVERLAP_REQUIRES_ALLTOALL_SEQ"));
  assert.ok(codes.has("MINDSPEED_MOE_OVERLAP_REQUIRES_ASYNC_PERMUTATION"));
  assert.ok(codes.has("MINDSPEED_MOE_OVERLAP_REQUIRES_GROUPED_GEMM"));
  assert.ok(codes.has("MINDSPEED_MOE_ALLTOALL_OVERLAP_TP_REQUIRES_EXTEND_EP"));

  const valid = validateParallelConfig(createTrainingConfig({
    features: {
      moe_token_dispatcher_type: "alltoall_seq",
      moe_alltoall_overlap_comm: true,
      moe_permutation_async_comm: true,
      moe_grouped_gemm: true,
      moe_tp_extend_ep: true,
    },
  }));
  assert.equal(valid.status, "valid");
});

test("静态策略建议不改变合法性，并携带硬件、版本、假设和来源", () => {
  const result = validateParallelConfig(createTrainingConfig({
    parallel: { cp: 8 },
    cluster: { total_ranks: 128, card_model: "昇腾 910B" },
    batch: { sequence_length: 32768 },
  }));

  assert.equal(result.status, "valid");
  const cpSuggestion = result.suggestions.find(({ code }) => (
    code === "MINDSPEED_CP_SLICE_BELOW_DEVICE_HEURISTIC"
  ));
  const hcclReference = result.suggestions.find(({ code }) => (
    code === "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE"
  ));
  assert.equal(cpSuggestion.kind, "suggestion");
  assert.match(cpSuggestion.data.action, /重新配平/);
  assert.match(cpSuggestion.data.impact_if_ignored, /配置仍然合法/);
  assert.equal(hcclReference.kind, "advisory");
  assert.ok(result.suggestions.every((item) => (
    item.applicable_hardware.length > 0
      && item.applicable_versions.length > 0
      && item.assumptions.length > 0
      && item.source_ref
  )));
  assert.equal(result.warnings.some(({ code }) => code.includes("CP_SLICE")), false);
});

test("当前 CP 无需修改时不返回 CP 静态建议", () => {
  const knownCard = validateParallelConfig(createTrainingConfig({
    cluster: { total_ranks: 16, card_model: "昇腾 910B" },
    parallel: { tp: 2, cp: 1 },
    batch: { sequence_length: 8192 },
  }));
  assert.equal(knownCard.suggestions.some(({ code }) => (
    code === "MINDSPEED_AUTO_SETTINGS_CP_SEARCH_SPACE"
  )), false);

  const unknownCard = validateParallelConfig(createTrainingConfig({
    cluster: { total_ranks: 16, card_model: "昇腾 950PR" },
    parallel: { tp: 2, cp: 1 },
    batch: { sequence_length: 8192 },
  }));
  const cpSuggestion = unknownCard.suggestions.find(({ code }) => (
    code === "MINDSPEED_CP_DIVISIBILITY_SEARCH_SPACE"
  ));

  assert.equal(cpSuggestion, undefined);
});

test("HCCL 自适应未显式配置 EP factor 时保持 MindSpeed 的 200 MiB 默认值", () => {
  const defaultFactor = validateParallelConfig(createTrainingConfig({
    features: { moe_token_dispatcher_type: "alltoall_seq" },
  })).suggestions.find(({ code }) => code === "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE");
  assert.equal(defaultFactor.kind, "advisory");
  assert.equal(defaultFactor.data.ep_load_imbalance_factor, null);
  assert.equal(defaultFactor.data.ep_factor_configured, false);
  assert.equal(defaultFactor.data.groups.exp, 200);
  assert.equal(defaultFactor.data.groups.tp, 200);

  const explicitFactor = validateParallelConfig(createTrainingConfig({
    features: {
      moe_token_dispatcher_type: "alltoall_seq",
      hccl_ep_group_buffer_adaptive_factor: 1.5,
    },
  })).suggestions.find(({ code }) => code === "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE");
  assert.equal(explicitFactor.data.ep_load_imbalance_factor, 1.5);
  assert.equal(explicitFactor.data.ep_factor_configured, true);
  assert.equal(explicitFactor.data.groups.exp, 32);
  assert.equal(explicitFactor.data.groups.tp, 48);
});

test("Attention Heads 必须能均分到 KV Heads", () => {
  const result = validateParallelConfig(createTrainingConfig({
    model: { num_attention_heads: 32, num_key_value_heads: 6 },
  }));
  const issue = result.errors.find((item) => (
    item.code === "MODEL_ATTENTION_HEADS_DIVISIBLE_BY_KV_HEADS"
  ));

  assert.ok(issue);
  assert.deepEqual(issue.fields, ["model.num_attention_heads", "model.num_key_value_heads"]);
  assert.match(issue.formula, /num_key_value_heads/);
  assert.match(issue.source_ref, /model-structure@2026-10-14/);
});

test("不同 EP 口径使用正确的 world 与切分域", () => {
  const orthogonal = validateParallelConfig(createTrainingConfig({
    parallel: { dp: 2, ep_mode: "orthogonal" },
    cluster: { total_ranks: 16 },
  }));
  assert.equal(orthogonal.data.world_size, 16);
  assert.equal(orthogonal.status, "valid");

  const mindformers = validateParallelConfig(createTrainingConfig({
    rule_profile: { framework: "mindformers", version: "page-baseline" },
    parallel: { dp: 2, tp: 2, ep: 4, ep_mode: "mf" },
    cluster: { total_ranks: 8 },
  }));
  assert.equal(mindformers.data.ep_domain, 4);
  assert.equal(mindformers.status, "valid");
});
