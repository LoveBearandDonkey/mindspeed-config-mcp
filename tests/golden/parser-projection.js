import { parseTrainingConfig } from "../../packages/config-core/src/index.js";

function parse(content, format, name) {
  return parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "golden" },
    source: { content, format, name },
  });
}

function summary(result, paths) {
  return {
    values: Object.fromEntries(paths.map((path) => [path, getPath(result.data.normalized_config, path)])),
    coverage: {
      source_fields: result.data.source_field_count,
      filled_required: result.data.filled_required_field_count,
      required_fields: result.data.required_field_count,
    },
    missing: result.data.missing_required_fields,
    warnings: result.warnings.map((warning) => warning.code),
  };
}

export function projectParserDialects() {
  const mindformers = parse(`
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
`, "yaml", "mindformers.yaml");

  const shell = parse(`
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
`, "shell", "variable-model.sh");

  const llamaFactory = parse(`
model_name_or_path: Qwen/Qwen3-4B
finetuning_type: lora
lora_rank: 8
cutoff_len: 2048
per_device_train_batch_size: 1
gradient_accumulation_steps: 8
bf16: true
`, "yaml", "lora.yaml");

  const zero3 = parse('{"zero_optimization":{"stage":3}}', "json", "ds_z3.json");

  return {
    mindformers: summary(mindformers, [
      "parallel.tp", "parallel.pp", "parallel.ep", "parallel.ep_mode",
      "parallel.sequence_parallel", "cluster.total_ranks", "batch.micro_batch_count",
      "memory.compute_dtype", "memory.parameter_dtype", "memory.shard_mode",
    ]),
    shell: summary(shell, [
      "model.id", "model.total_layers", "parallel.dp", "parallel.tp", "parallel.pp",
      "parallel.cp", "parallel.sequence_parallel", "cluster.total_ranks",
      "cluster.ranks_per_node", "batch.micro_batch_count", "memory.compute_dtype",
    ]),
    llama_factory: summary(llamaFactory, [
      "model.id", "batch.micro_batch_size", "batch.sequence_length",
      "batch.micro_batch_count", "memory.compute_dtype", "memory.lora_enabled", "memory.lora_rank",
    ]),
    deepspeed_zero3: summary(zero3, ["memory.shard_mode"]),
  };
}

function getPath(target, path) {
  return path.split(".").reduce((value, part) => value?.[part], target);
}
