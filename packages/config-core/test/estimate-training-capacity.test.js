import assert from "node:assert/strict";
import test from "node:test";

import { estimateTrainingCapacity } from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

function denseConfig(overrides = {}) {
  const input = createTrainingConfig({
    model: {
      id: "small-dense",
      total_layers: 8,
      hidden_size: 512,
      num_attention_heads: 8,
      num_key_value_heads: 8,
      ffn_hidden_size: 2048,
      vocab_size: 32000,
      routed_experts: 0,
      top_k: 0,
      shared_experts: 0,
    },
    parallel: { ep: 1 },
  });
  for (const [section, values] of Object.entries(overrides)) {
    input[section] = values && typeof values === "object" && !Array.isArray(values)
      ? { ...input[section], ...values }
      : values;
  }
  return input;
}

test("容量估算返回逐 Stage 六段理论值", () => {
  const result = estimateTrainingCapacity(denseConfig());

  assert.equal(result.status, "estimated");
  assert.equal(result.confidence, "theoretical");
  assert.equal(result.data.stages.length, 2);
  for (const stage of result.data.stages) {
    assert.deepEqual(Object.keys(stage.values_gib), [
      "base", "weight", "gradient", "optimizer", "activation", "reserve",
    ]);
    assert.ok(stage.total_gib > 0);
  }
});

test("提高序列长度会提高激活和总容量", () => {
  const short = estimateTrainingCapacity(denseConfig({
    batch: { sequence_length: 2048 },
  })).data.stages[0];
  const long = estimateTrainingCapacity(denseConfig({
    batch: { sequence_length: 8192 },
  })).data.stages[0];

  assert.ok(long.values_gib.activation > short.values_gib.activation);
  assert.ok(long.total_gib > short.total_gib);
});

test("ZeRO-1 只切优化器，FSDP2 同时切权重和梯度", () => {
  const none = estimateTrainingCapacity(denseConfig({
    memory: { shard_mode: "none" },
  })).data.stages[0];
  const zero1 = estimateTrainingCapacity(denseConfig({
    memory: { shard_mode: "zero1" },
  })).data.stages[0];
  const fsdp2 = estimateTrainingCapacity(denseConfig({
    memory: { shard_mode: "fsdp2" },
  })).data.stages[0];

  assert.equal(zero1.values_gib.weight, none.values_gib.weight);
  assert.equal(zero1.values_gib.gradient, none.values_gib.gradient);
  assert.ok(zero1.values_gib.optimizer < none.values_gib.optimizer);
  assert.ok(fsdp2.values_gib.weight < none.values_gib.weight);
  assert.ok(fsdp2.values_gib.gradient < none.values_gib.gradient);
});

test("Embedding 和 LM Head 使流水线端点比中间 Stage 更重", () => {
  const result = estimateTrainingCapacity(denseConfig({
    parallel: { pp: 4 },
    cluster: { total_ranks: 32 },
  }));
  const stages = result.data.stages;

  assert.equal(stages.length, 4);
  assert.ok(stages[0].values_gib.weight > stages[1].values_gib.weight);
  assert.ok(stages[3].values_gib.weight > stages[2].values_gib.weight);
});

test("非法配置不返回容量数字", () => {
  const result = estimateTrainingCapacity(denseConfig({
    cluster: { total_ranks: 99 },
  }));

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.data, { valid: false });
});
