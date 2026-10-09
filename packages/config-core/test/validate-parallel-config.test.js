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
