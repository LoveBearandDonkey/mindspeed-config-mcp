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
  const input = denseConfig();
  const result = estimateTrainingCapacity(input);

  assert.equal(result.status, "estimated");
  assert.equal(result.confidence, "theoretical");
  assert.deepEqual(result.data.thresholds, { tight: 0.80, alert: 0.88 });
  assert.deepEqual(result.data.threshold_policy, {
    classification: "heuristic",
    calibration: "uncalibrated",
    warning_headroom_ratio: 0.20,
    sources: [
      "PyTorch:docs/notes/cuda.html#memory-management:garbage_collection_threshold-example-0.8",
      "DeepSpeed:docs/memory.html:additional_buffer_factor-1.5",
    ],
  });
  assert.ok(result.assumptions.some((item) => item.includes("它不是框架 OOM 标准")));
  assert.equal(result.data.stages.length, 2);
  assert.equal(result.data.stages[0].micro_batch_count, input.batch.micro_batch_count);
  assert.equal(result.data.stages[0].vpp_chunks, input.parallel.vpp);
  assert.equal(result.data.stages[0].recomputed_layers, 0);
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

test("容量估算按动态 PP 的显式 Stage 层数计算而不是退回均分", () => {
  const result = estimateTrainingCapacity(denseConfig({
    rule_profile: { framework: "mindspeed-llm-mcore", version: "master@7826e88" },
    model: { total_layers: 8 },
    parallel: {
      pipeline_layer_mode: "dynamic",
      num_layer_list: [6, 2],
      vpp: 1,
    },
  }));

  assert.equal(result.status, "estimated");
  assert.deepEqual(result.data.stages.map((stage) => stage.layers), [6, 2]);
  assert.ok(result.data.stages[0].values_gib.activation > result.data.stages[1].values_gib.activation);
  assert.match(result.data.pipeline_layout_sources.dynamic, /MindSpeed-LLM/);
});

test("非法配置不返回容量数字", () => {
  const result = estimateTrainingCapacity(denseConfig({
    cluster: { total_ranks: 99 },
  }));

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.data, { valid: false });
});
