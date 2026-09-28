import assert from "node:assert/strict";
import test from "node:test";

import { parseTrainingConfig } from "../src/index.js";

function input(content, format = "auto", name) {
  return {
    schema_version: "1.0",
    rule_profile: {
      framework: "mindspeed-llm-mcore",
      version: "0.12.1"
    },
    source: { format, content, ...(name ? { name } : {}) }
  };
}

test("解析 MindSpeed/Megatron Shell 参数并显式报告未知字段", () => {
  const result = parseTrainingConfig(input(`
torchrun --nnodes 2 --nproc-per-node 8 pretrain_gpt.py \\
  --num-layers 32 --hidden-size 4096 --num-attention-heads 32 \\
  --tensor-model-parallel-size 2 --pipeline-model-parallel-size 2 \\
  --context-parallel-size 1 --expert-model-parallel-size 2 \\
  --num-experts 8 --moe-router-topk 2 --micro-batch-size 1 \\
  --seq-length 4096 --bf16 --sequence-parallel --custom-switch 7
`, "shell", "train.sh"));

  assert.equal(result.status, "valid");
  assert.equal(result.data.detected_format, "shell");
  assert.equal(result.data.normalized_config.model.total_layers, 32);
  assert.equal(result.data.normalized_config.parallel.tp, 2);
  assert.equal(result.data.normalized_config.cluster.total_ranks, 16);
  assert.equal(result.data.normalized_config.memory.compute_dtype, "bf16");
  assert.deepEqual(result.data.unmapped_fields.map((field) => field.source_key), ["custom-switch"]);
  assert.equal(result.data.complete, false);
});

test("解析嵌套 YAML 并保留来源路径", () => {
  const result = parseTrainingConfig(input(`
model:
  model_config:
    num_layers: 28
    hidden_size: 3584
    num_attention_heads: 28
parallel_config:
  tensor_model_parallel_size: 4
  pipeline_model_parallel_size: 2
runner_config:
  batch_size: 16
unknown_section:
  custom_value: keep-me
`, "yaml", "model.yaml"));

  assert.equal(result.data.normalized_config.model.total_layers, 28);
  assert.equal(result.data.normalized_config.parallel.tp, 4);
  assert.ok(result.data.mapped_fields.some((field) => field.source_key === "model.model_config.num_layers"));
  assert.ok(result.data.unmapped_fields.some((field) => field.source_key === "unknown_section.custom_value"));
});

test("JSON 语法错误返回结构化错误而不是抛出", () => {
  const result = parseTrainingConfig(input("{ broken", "json", "broken.json"));

  assert.equal(result.status, "error");
  assert.equal(result.errors[0].code, "PARSE_SYNTAX_ERROR");
  assert.equal(result.data.mapped_count, 0);
});
