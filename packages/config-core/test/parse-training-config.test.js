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
  assert.equal(result.data.required_field_count, 33);
  assert.equal(
    result.data.filled_required_field_count + result.data.missing_required_fields.length,
    result.data.required_field_count,
  );
  assert.equal(
    result.data.source_field_count,
    result.data.explicit_mapped_count + result.data.unmapped_count + result.data.ignored_count,
  );
});

test("联动解析训练配置与可选模型结构，并显式报告来源冲突", () => {
  const result = parseTrainingConfig({
    ...input(`
WORLD_SIZE=8
torchrun train.py \\
  --num-layers 44 --hidden-size 4096 --num-attention-heads 64 \\
  --num-experts 256 --moe-router-topk 6 --moe-ffn-hidden-size 2048 \\
  --tensor-model-parallel-size 2 --pipeline-model-parallel-size 2 \\
  --micro-batch-size 1 --seq-length 4096 --bf16
`, "shell", "train.sh"),
    model_source: {
      format: "json",
      name: "config.json",
      content: JSON.stringify({
        model_type: "deepseek_v4",
        num_hidden_layers: 43,
        hidden_size: 4096,
        num_attention_heads: 64,
        moe_intermediate_size: 2048,
        n_routed_experts: 256,
        n_shared_experts: 1,
        num_experts_per_tok: 6,
        vocab_size: 129280,
      }),
    },
  });

  assert.equal(result.status, "valid");
  assert.equal(result.data.model_source_name, "config.json");
  assert.equal(result.data.normalized_config.model.total_layers, 43);
  assert.equal(result.data.normalized_config.model.shared_experts, 1);
  assert.ok(result.data.source_conflicts.some((item) => item.path === "model.total_layers"));
  assert.ok(result.data.source_conflicts.some((item) => item.path === "model.shared_experts"));
  assert.ok(result.warnings.some((item) => item.code === "PARSE_SOURCE_CONFLICT"));
  assert.ok(result.data.mapped_fields.some((item) => (
    item.target_path === "model.total_layers" && item.source_role === "model"
  )));
});

test("GPT OSS 参数片段不补造并行度、昇腾容量或文件名来源冲突", () => {
  const result = parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "unknown" },
    source: {
      format: "shell",
      name: "D:\\samples\\nvidia_megatron_gpt_oss_20b_model_config.sh",
      content: 'MODEL_ARGS=" --num-layers 24 --hidden-size 2880 --num-attention-heads 64 --num-experts 32 --moe-router-topk 4 --max-position-embeddings 40960 --moe-aux-loss-coeff 0.0 --window-size 127,0 "',
    },
    model_source: {
      format: "json",
      name: "gpt_oss_20b_model_config.json",
      content: JSON.stringify({
        model_type: "gpt_oss", num_hidden_layers: 24, hidden_size: 2880,
        num_attention_heads: 64, num_local_experts: 32, num_experts_per_tok: 4,
        max_position_embeddings: 131072, router_aux_loss_coef: 0.9,
        sliding_window: 128, rope_scaling: { rope_type: "yarn" },
      }),
    },
  });

  assert.equal(result.status, "valid");
  assert.equal(result.data.complete, false);
  assert.equal(result.data.normalized_config.model.id, "gpt_oss");
  assert.equal(result.data.normalized_config.parallel?.tp, undefined);
  assert.deepEqual(result.data.source_conflicts, []);
  assert.equal(result.data.completion.complete, false);
  assert.equal(result.data.completion.launch_feasible, null);
  assert.deepEqual(result.data.completion.plans, []);
  assert.deepEqual(result.data.cross_source_observations.map((item) => item.relation), [
    "different", "different",
  ]);
  assert.ok(result.warnings.some((item) => item.code === "PARSE_SHELL_FRAGMENT"));
  assert.ok(result.warnings.some((item) => item.code === "PARSE_ARCHITECTURE_FIELDS_UNCHECKED"));
  assert.equal(result.data.source_snapshot.source.hash_basis, "submitted_utf8_text");
});

test("可选模型结构语法错误定位到 model_source", () => {
  const result = parseTrainingConfig({
    ...input("--num-layers 32", "shell", "train.sh"),
    model_source: { format: "json", name: "config.json", content: "{ broken" },
  });

  assert.equal(result.status, "error");
  assert.equal(result.errors[0].code, "PARSE_SYNTAX_ERROR");
  assert.deepEqual(result.errors[0].fields, ["model_source.content"]);
});

test("训练配置显式模型值不会被模型文件的省略态默认覆盖", () => {
  const result = parseTrainingConfig({
    ...input("--num-experts 8 --num-shared-experts 2", "shell", "train.sh"),
    model_source: {
      format: "json",
      name: "config.json",
      content: JSON.stringify({ model_type: "mixtral", num_local_experts: 8 }),
    },
  });

  assert.equal(result.data.normalized_config.model.shared_experts, 2);
  assert.equal(
    result.data.source_conflicts.find((item) => item.path === "model.shared_experts")?.resolution,
    "training_source",
  );
});

test("解析 MindSpeed-LLM num-layer-list 并推导为动态 PP", () => {
  const result = parseTrainingConfig(input(`
torchrun pretrain_gpt.py \\
  --num-layers 46 --pipeline-model-parallel-size 4 \\
  --num-layer-list 12,12,11,11
`, "shell", "dynamic-pp.sh"));

  assert.deepEqual(result.data.normalized_config.parallel.num_layer_list, [12, 12, 11, 11]);
  assert.equal(result.data.normalized_config.parallel.pipeline_layer_mode, "dynamic");
  assert.ok(result.data.mapped_fields.some((field) => (
    field.target_path === "parallel.pipeline_layer_mode" && field.mapping_kind === "derived"
  )));
});

test("解析高级静态约束字段并保留 Hybrid Adaptive CP 语义", () => {
  const result = parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: { framework: "mindspeed-core", version: "0.12.1" },
    source: {
      format: "shell",
      name: "advanced.sh",
      content: "python train.py --context-parallel-algo hybrid_adaptive_cp_algo --ulysses-degree-in-cp 2 --cp-window-size 1 --use-ascend-mc2 --tp-2d --tp-x 2 --tp-y 4 --moe-token-dispatcher-type alltoall_seq --moe-alltoall-overlap-comm --hccl-group-buffer-adaptive --hccl-ep-group-buffer-adaptive-factor 1.5 --load ckpt",
    },
  });

  assert.equal(result.data.normalized_config.parallel.cp_mode, "hybrid-adaptive");
  assert.equal(result.data.normalized_config.parallel.ulysses_degree_in_cp, 2);
  assert.deepEqual(result.data.normalized_config.features, {
    use_ascend_mc2: true,
    tp_2d: true,
    tp_x: 2,
    tp_y: 4,
    moe_token_dispatcher_type: "alltoall_seq",
    moe_alltoall_overlap_comm: true,
    hccl_group_buffer_adaptive: true,
    hccl_ep_group_buffer_adaptive_factor: 1.5,
    loading_checkpoint: true,
  });
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
  assert.match(result.errors[0].message, /^输入格式不合法，无法按 JSON 解析：/);
  assert.equal(result.data.source_field_count, 0);
  assert.equal(result.data.required_field_count, 30);
  assert.equal(result.data.filled_required_field_count, 0);
  assert.equal(result.data.mapped_count, 0);
});

test("YAML 语法错误明确提示输入格式不合法并保留解析细节", () => {
  const result = parseTrainingConfig(input("model:\n  hidden_size: [1, 2", "yaml", "broken.yaml"));

  assert.equal(result.status, "error");
  assert.equal(result.errors[0].code, "PARSE_SYNTAX_ERROR");
  assert.match(result.errors[0].message, /^输入格式不合法，无法按 YAML 解析：/);
  assert.ok(result.errors[0].message.length > "输入格式不合法，无法按 YAML 解析：".length);
});

test("识别 MindFormers 并行键、精度键并按 mf 口径派生 world size", () => {
  const result = parseTrainingConfig(input(`
parallel_config:
  data_parallel: 2
  model_parallel: 4
  pipeline_stage: 2
  expert_parallel: 8
  micro_batch_num: 16
  use_seq_parallel: true
parallel:
  enable_parallel_optimizer: true
model:
  model_config:
    model_type: qwen3_moe
    num_hidden_layers: 32
    hidden_size: 4096
    num_attention_heads: 32
    num_experts: 8
    num_experts_per_tok: 2
    params_dtype: float32
    compute_dtype: bfloat16
`, "yaml", "mindformers.yaml"));

  assert.equal(result.data.normalized_config.parallel.tp, 4);
  assert.equal(result.data.normalized_config.parallel.pp, 2);
  assert.equal(result.data.normalized_config.parallel.ep, 8);
  assert.equal(result.data.normalized_config.parallel.ep_mode, "mf");
  assert.equal(result.data.normalized_config.parallel.sequence_parallel, true);
  assert.equal(result.data.normalized_config.cluster.total_ranks, 16);
  assert.equal(result.data.normalized_config.batch.micro_batch_count, 16);
  assert.equal(result.data.normalized_config.memory.parameter_dtype, "fp32");
  assert.equal(result.data.normalized_config.memory.compute_dtype, "bf16");
  assert.equal(result.data.normalized_config.memory.shard_mode, "zero1");
});

test("Shell 解析只展开安全标量变量并忽略注释中的参数", () => {
  const result = parseTrainingConfig(input(`
GPUS_PER_NODE=8
NNODES=2
WORLD_SIZE=$(($GPUS_PER_NODE*$NNODES))
TP_SIZE=2
PP_SIZE=2
NUM_LAYERS=32
DTYPE=fp8
MODEL_ARGS=(
  --num-layers $NUM_LAYERS
  --hidden-size 4096
  --num-attention-heads 32
  --tensor-model-parallel-size $TP_SIZE
  --pipeline-model-parallel-size $PP_SIZE
  # --context-parallel-size 7
  --sequence-parallel
)
TRAINING_ARGS=(
  --micro-batch-size 1
  --global-batch-size 64
)
torchrun --nproc-per-node $GPUS_PER_NODE --nnodes $NNODES train.py
`, "shell", "variable-model.sh"));

  assert.equal(result.data.normalized_config.cluster.total_ranks, 16);
  assert.equal(result.data.normalized_config.parallel.dp, 4);
  assert.equal(result.data.normalized_config.parallel.cp, 1);
  assert.equal(result.data.normalized_config.parallel.sequence_parallel, true);
  assert.equal(result.data.normalized_config.batch.micro_batch_count, 16);
  assert.equal(result.data.normalized_config.memory.compute_dtype, "fp8");
  assert.equal(result.data.normalized_config.model.id, "variable-model");
});

test("识别 LLaMA-Factory 与 DeepSpeed 的路径相关字段", () => {
  const lora = parseTrainingConfig(input(`
model_name_or_path: Qwen/Qwen3-4B
finetuning_type: lora
lora_rank: 8
cutoff_len: 2048
per_device_train_batch_size: 1
gradient_accumulation_steps: 8
bf16: true
`, "yaml", "lora.yaml"));
  assert.equal(lora.data.normalized_config.model.id, "Qwen/Qwen3-4B");
  assert.equal(lora.data.normalized_config.memory.lora_enabled, true);
  assert.equal(lora.data.normalized_config.batch.sequence_length, 2048);
  assert.equal(lora.data.normalized_config.batch.micro_batch_count, 8);

  const zero3 = parseTrainingConfig(input(`{"zero_optimization":{"stage":3}}`, "json", "ds_z3.json"));
  assert.equal(zero3.data.normalized_config.memory.shard_mode, "fsdp2");
  assert.ok(zero3.warnings.some((warning) => warning.code === "PARSE_ZERO3_APPROXIMATED_AS_FSDP2"));
});

test("已知 MoE 架构补齐容量所需的专家 FFN 与前置 Dense 层语义", () => {
  const mixtral = parseTrainingConfig(input(JSON.stringify({
    model_type: "mixtral",
    num_hidden_layers: 32,
    hidden_size: 4096,
    num_attention_heads: 32,
    intermediate_size: 14336,
    num_local_experts: 8,
    num_experts_per_tok: 2,
    vocab_size: 32000,
  }), "json", "hf_mixtral_config.json"));
  assert.equal(mixtral.data.normalized_config.model.expert_ffn_hidden_size, 14336);
  assert.equal(mixtral.data.normalized_config.model.first_k_dense_layers, 0);
  assert.ok(!mixtral.data.missing_required_fields.includes("model.expert_ffn_hidden_size"));
  assert.ok(!mixtral.data.missing_required_fields.includes("model.first_k_dense_layers"));

  const deepseek = parseTrainingConfig(input(`
model:
  model_config:
    model_type: deepseek_v3
    num_hidden_layers: 61
    hidden_size: 7168
    intermediate_size: 18432
    moe_intermediate_size: 2048
    vocab_size: 129280
`, "yaml", "mf_pretrain_deepseek3_671b.yaml"));
  assert.equal(deepseek.data.normalized_config.model.first_k_dense_layers, 3);

  const qwen = parseTrainingConfig(input(`
model:
  model_config:
    model_type: qwen3_moe
    num_hidden_layers: 48
    hidden_size: 2048
    intermediate_size: 6144
    moe_intermediate_size: 768
    num_experts: 128
    num_experts_per_tok: 8
    vocab_size: 151936
`, "yaml", "mf_pretrain_qwen3_30b_a3b.yaml"));
  assert.equal(qwen.data.normalized_config.model.first_k_dense_layers, 0);
});

test("DeepSeek-V3 缺口由模型证据补齐，并返回经过复验的 MindFormers 方案", () => {
  const result = parseTrainingConfig(input(`
runner_config:
  batch_size: 1
parallel_config:
  data_parallel: 4
  model_parallel: 8
  pipeline_stage: 8
  expert_parallel: 32
  micro_batch_num: 32
model:
  model_config:
    model_type: deepseek_v3
    num_hidden_layers: 61
    hidden_size: 7168
    seq_length: 4096
    offset: [[1,1,1,1,1,1,1,1], [1,1,1,1,1,1,1,-2]]
    pp_interleave_num: 2
    params_dtype: float32
    compute_dtype: bfloat16
`, "yaml", "mf_pretrain_deepseek3_671b.yaml"));

  assert.equal(result.data.normalized_config.rule_profile.framework, "mindformers");
  assert.equal(result.data.normalized_config.parallel.pipeline_layer_mode, "mindformers-offset");
  assert.equal(result.data.normalized_config.batch.micro_batch_size, 1);
  assert.equal(result.data.completion.plans[0].proposed_config.model.num_attention_heads, 128);
  assert.equal(result.data.completion.plans[0].proposed_config.model.routed_experts, 256);
  assert.deepEqual(result.data.completion.plans.map((plan) => plan.id), [
    "source-faithful",
    "mindformers-uniform-fallback",
  ]);
  assert.ok(result.data.completion.plans.every((plan) => plan.validation.status === "valid"));
});

test("Megatron 命令行的缺口按本次输入即时求解，不依赖预置答案", () => {
  const result = parseTrainingConfig(input(`
WORLD_SIZE=8
torchrun train.py \\
  --num-layers 96 \\
  --hidden-size 12288 \\
  --num-attention-heads 96 \\
  --seq-length 2048 \\
  --micro-batch-size 1 \\
  --global-batch-size 1536 \\
  --tensor-model-parallel-size 8 \\
  --pipeline-model-parallel-size 16 \\
  --fp16
`, "shell", "unknown-megatron-command.sh"));

  assert.equal(result.data.completion.computation, "runtime-per-parse");
  assert.equal(
    result.data.completion.strategy,
    "evidence-plus-constraint-solver-and-theoretical-capacity-gate",
  );
  assert.ok(result.data.completion.plans.length > 0);
  assert.ok(result.data.completion.plans.every((plan) => plan.validation.status === "valid"));
  assert.ok(result.data.completion.plans.every((plan) => (
    plan.capacity_assessment.confidence === "theoretical"
  )));
  assert.equal(result.data.completion.plans[0].proposed_config.cluster.total_ranks, 128);
  assert.equal(result.data.completion.plans[0].proposed_config.memory.parameter_dtype, "bf16");
  assert.ok(result.data.missing_required_fields.includes("model.vocab_size"));
  assert.ok(result.data.missing_required_fields.includes("model.ffn_hidden_size"));
  assert.ok(result.data.completion.plans[0].values.some((item) => (
    item.path === "model.vocab_size" && item.confidence === "requires-confirmation"
  )));
});

test("未知 MoE 命令行优先给出保留 EP 的扩容方案", () => {
  const result = parseTrainingConfig(input(`
WORLD_SIZE=8
torchrun train.py \\
  --num-layers 32 \\
  --hidden-size 4096 \\
  --num-attention-heads 32 \\
  --num-experts 8 \\
  --moe-router-topk 2 \\
  --seq-length 4096 \\
  --micro-batch-size 1 \\
  --global-batch-size 256 \\
  --pipeline-model-parallel-size 4 \\
  --expert-model-parallel-size 8 \\
  --bf16
`, "shell", "unknown-moe-command.sh"));

  const recommended = result.data.completion.plans[0];
  assert.equal(recommended.id, "preserve-parallel-expansion");
  assert.equal(recommended.proposed_config.parallel.ep, 8);
  assert.equal(recommended.proposed_config.parallel.dp, 8);
  assert.equal(recommended.proposed_config.cluster.total_ranks, 32);
  assert.equal(recommended.validation.status, "valid");
});

test("常规搜索无解时生成经过复验的兜底方案并逐项暴露冲突字段", () => {
  const result = parseTrainingConfig(input(`
parallel_config:
  data_parallel: 1
  model_parallel: 4
  pipeline_stage: 8
  expert_parallel: 4
model:
  model_config:
    model_type: hostile_moe
    num_hidden_layers: 3
    hidden_size: 64
    num_attention_heads: 7
    num_experts: 5
    num_experts_per_tok: 9
    seq_length: 10
    offset: [[9]]
    pp_interleave_num: 2
`, "yaml", "hostile.yaml"));

  const plan = result.data.completion.plans[0];
  assert.equal(result.data.completion.complete, true);
  assert.equal(plan.id, "static-safe-fallback");
  assert.equal(plan.validation.status, "valid");
  assert.ok(plan.values.some((item) => item.path === "model.top_k"));
  assert.ok(plan.values.some((item) => item.path === "parallel.pp"));
  assert.ok(plan.values.some((item) => item.path === "parallel.pipeline_layer_mode"));
  assert.ok(plan.values.some((item) => item.path === "cluster.total_ranks"));
  assert.ok(plan.values.every((item) => result.data.missing_required_fields.includes(item.path)
    || item.confidence === "requires-confirmation"));
});
