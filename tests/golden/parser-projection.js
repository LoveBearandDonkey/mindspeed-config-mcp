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

  const mixtral = parse(JSON.stringify({
    model_type: "mixtral",
    num_hidden_layers: 32,
    hidden_size: 4096,
    num_attention_heads: 32,
    intermediate_size: 14336,
    num_local_experts: 8,
    num_experts_per_tok: 2,
    vocab_size: 32000,
  }), "json", "hf_mixtral_config.json");

  const deepseek = parse(`
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
`, "yaml", "mf_pretrain_deepseek3_671b.yaml");

  const hostile = parse(`
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
`, "yaml", "hostile.yaml");

  const invalidYaml = parse("model:\n  hidden_size: [1, 2", "yaml", "broken.yaml");
  const pairedSources = parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "golden" },
    source: {
      format: "shell",
      name: "train.sh",
      content: "--num-layers 44 --hidden-size 4096 --num-attention-heads 64 --num-experts 8 --moe-router-topk 2",
    },
    model_source: {
      format: "json",
      name: "config.json",
      content: JSON.stringify({
        model_type: "deepseek_v4",
        num_hidden_layers: 43,
        hidden_size: 4096,
        num_attention_heads: 64,
        n_routed_experts: 8,
        n_shared_experts: 1,
        num_experts_per_tok: 2,
      }),
    },
  });

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
    mixtral_capacity_structure: {
      expert_ffn_hidden_size: mixtral.data.normalized_config.model.expert_ffn_hidden_size,
      first_k_dense_layers: mixtral.data.normalized_config.model.first_k_dense_layers,
      remaining_model_gaps: mixtral.data.missing_required_fields
        .filter((path) => path.startsWith("model.")),
    },
    model_structure_choice: {
      selected_plan: llamaFactory.data.completion.plans[0].id,
      recommended_plan: llamaFactory.data.completion.recommended_plan_id,
      requires_confirmation: llamaFactory.data.completion.plans[0].confidence,
      capacity_level: llamaFactory.data.completion.plans[0].capacity_assessment.level,
      capacity_ratio: llamaFactory.data.completion.plans[0].capacity_assessment.bottleneck_ratio,
      preset_model: llamaFactory.data.completion.plans[0].proposed_config.model.id,
      preset_layers: llamaFactory.data.completion.plans[0].proposed_config.model.total_layers,
      preset_hidden_size: llamaFactory.data.completion.plans[0].proposed_config.model.hidden_size,
      preset_dp: llamaFactory.data.completion.plans[0].proposed_config.parallel.dp,
      preset_total_ranks: llamaFactory.data.completion.plans[0].proposed_config.cluster.total_ranks,
      preset_card_model: llamaFactory.data.completion.plans[0].proposed_config.cluster.card_model,
      preset_card_memory_gib: llamaFactory.data.completion.plans[0].proposed_config.cluster.card_memory_gib,
      preset_source: llamaFactory.data.completion.plans[0].values[0].source_ref,
    },
    deepseek_completion: {
      computation: deepseek.data.completion.computation,
      strategy: deepseek.data.completion.strategy,
      recommended_plan: deepseek.data.completion.recommended_plan_id,
      mode: deepseek.data.normalized_config.parallel.pipeline_layer_mode,
      profile: deepseek.data.normalized_config.rule_profile.framework,
      plan_ids: deepseek.data.completion.plans.map((plan) => plan.id),
      plan_statuses: deepseek.data.completion.plans.map((plan) => plan.validation.status),
      capacity_levels: deepseek.data.completion.plans.map((plan) => plan.capacity_assessment.level),
      recommended_stage_layers: deepseek.data.completion.plans[0].validation.status === "valid"
        ? [8, 8, 8, 8, 8, 8, 8, 5]
        : [],
      completed_heads: deepseek.data.completion.plans[0].proposed_config.model.num_attention_heads,
      completed_experts: deepseek.data.completion.plans[0].proposed_config.model.routed_experts,
    },
    fallback_completion: {
      plan_id: hostile.data.completion.plans[0].id,
      status: hostile.data.completion.plans[0].validation.status,
      review_paths: hostile.data.completion.plans[0].values.map((item) => item.path),
      proposed_parallel: Object.fromEntries([
        "dp", "pp", "tp", "cp", "ep", "vpp", "pipeline_layer_mode",
      ].map((key) => [key, hostile.data.completion.plans[0].proposed_config.parallel[key]])),
      proposed_top_k: hostile.data.completion.plans[0].proposed_config.model.top_k,
      proposed_total_ranks: hostile.data.completion.plans[0].proposed_config.cluster.total_ranks,
    },
    invalid_yaml: {
      status: invalidYaml.status,
      code: invalidYaml.errors[0].code,
      message_prefix: invalidYaml.errors[0].message.split("：")[0],
      source_ref: invalidYaml.errors[0].source_ref,
    },
    tool_readiness: Object.fromEntries(Object.entries(mindformers.data.tool_readiness)
      .map(([tool, state]) => [tool, {
        ready: state.ready,
        missing_fields: state.missing_fields,
        source_ref: state.source_ref,
      }])),
    paired_sources: {
      model_source: pairedSources.data.model_source_name,
      layers: pairedSources.data.normalized_config.model.total_layers,
      shared_experts: pairedSources.data.normalized_config.model.shared_experts,
      conflicts: pairedSources.data.source_conflicts.map((item) => item.path),
      warning_codes: pairedSources.warnings.map((item) => item.code),
    },
  };
}

function getPath(target, path) {
  return path.split(".").reduce((value, part) => value?.[part], target);
}
