import { parseTrainingConfig } from "../../packages/config-core/src/index.js";
import { createTrainingConfig } from "../fixtures/training-config.js";

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
  const canonicalConfig = createTrainingConfig({
    rule_profile: { framework: "mindformers", version: "unknown" },
    model: {
      total_layers: 34, first_k_dense_layers: 0, hidden_size: 256,
      num_attention_heads: 8, ffn_hidden_size: 512, expert_ffn_hidden_size: 256,
    },
    parallel: {
      dp: 2, pp: 4, tp: 2, ep: 2, ep_mode: "mf",
      pipeline_layer_mode: "mindformers-offset",
      pipeline_layer_offsets: [[1, 1, 0, 0]],
    },
    cluster: { total_ranks: 16 },
  });
  const canonicalMindFormers = parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: canonicalConfig.rule_profile,
    source: { format: "json", name: "mindformers.json", content: JSON.stringify(canonicalConfig) },
  });
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
  const gptOssFragment = parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "unknown" },
    source: {
      format: "shell",
      name: "D:\\fixtures\\nvidia_megatron_gpt_oss_20b_model_config.sh",
      content: `MODEL_ARGS=" \\
--num-layers 24 --hidden-size 2880 --num-attention-heads 64 \\
--num-query-groups 8 --num-experts 32 --moe-router-topk 4 \\
--micro-batch-size 1 --seq-length 4096 --bf16 --sequence-parallel \\
--max-position-embeddings 40960 --moe-aux-loss-coeff 0.0 \\
--window-size 127,0 --window-attn-skip-freq 2 --enable-gpt-oss \\
"`,
    },
    model_source: {
      format: "json",
      name: "gpt_oss_20b_model_config.json",
      content: JSON.stringify({
        model_type: "gpt_oss", num_hidden_layers: 24, hidden_size: 2880,
        num_attention_heads: 64, num_key_value_heads: 8, num_local_experts: 32,
        num_experts_per_tok: 4, vocab_size: 201088,
        max_position_embeddings: 131072, router_aux_loss_coef: 0.9,
        sliding_window: 128, layer_types: ["sliding_attention", "full_attention"],
        rope_scaling: { rope_type: "yarn", factor: 32 },
        quantization_config: { quant_method: "mxfp4" },
      }),
    },
  });

  return {
    canonical_mindformers: {
      model_id: canonicalMindFormers.data.normalized_config.model.id,
      pipeline_layer_mode: canonicalMindFormers.data.normalized_config.parallel.pipeline_layer_mode,
      pipeline_layer_offsets: canonicalMindFormers.data.normalized_config.parallel.pipeline_layer_offsets,
      missing_fields: canonicalMindFormers.data.missing_required_fields,
      completion_plan_count: canonicalMindFormers.data.completion.plans.length,
      dialogue_solution_count: canonicalMindFormers.data.dialogue.solutions.length,
      follow_up_mode: canonicalMindFormers.data.dialogue.follow_up.mode,
    },
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
    generic_model_structure: {
      strategy: llamaFactory.data.completion.strategy,
      complete: llamaFactory.data.completion.complete,
      recommended_plan: llamaFactory.data.completion.recommended_plan_id,
      launch_feasible: llamaFactory.data.completion.launch_feasible,
      plan_count: llamaFactory.data.completion.plans.length,
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
    gpt_oss_fragment: {
      model_id: gptOssFragment.data.normalized_config.model.id,
      parallel_tp: gptOssFragment.data.normalized_config.parallel?.tp ?? null,
      parse_complete: gptOssFragment.data.complete,
      completion: {
        strategy: gptOssFragment.data.completion.strategy,
        complete: gptOssFragment.data.completion.complete,
        launch_feasible: gptOssFragment.data.completion.launch_feasible,
        plan_count: gptOssFragment.data.completion.plans.length,
      },
      conflicts: gptOssFragment.data.source_conflicts.map((item) => item.path),
      observations: gptOssFragment.data.cross_source_observations.map((item) => ({
        label: item.label, relation: item.relation, assessment: item.assessment,
      })),
      unverified_fields: gptOssFragment.data.unverified_architecture_fields.map(
        (item) => item.source_key,
      ),
      warning_codes: gptOssFragment.warnings.map((item) => item.code),
      quick_state: gptOssFragment.quick_assessment.state,
      quick_evidence_codes: gptOssFragment.quick_assessment.evidence.map((item) => item.code),
      dialogue: {
        overview: gptOssFragment.data.dialogue.overview,
        issues: gptOssFragment.data.dialogue.issues.map((item) => ({
          severity: item.severity, code: item.code, locations: item.locations,
        })),
        solution_count: gptOssFragment.data.dialogue.solutions.length,
        unmapped_count: gptOssFragment.data.dialogue.completion.unmapped_count,
        missing_groups: gptOssFragment.data.dialogue.completion.missing_groups.map(
          (item) => ({ label: item.label, count: item.count })
        ),
        follow_up_mode: gptOssFragment.data.dialogue.follow_up.mode,
      },
      snapshot_hash_basis: gptOssFragment.data.source_snapshot.source.hash_basis,
    },
  };
}

function getPath(target, path) {
  return path.split(".").reduce((value, part) => value?.[part], target);
}
