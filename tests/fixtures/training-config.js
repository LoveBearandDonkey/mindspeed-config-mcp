export function createTrainingConfig(overrides = {}) {
  const base = {
    schema_version: "1.0",
    rule_profile: {
      framework: "mindspeed-core",
      version: "0.12.1",
      source_commit: "65634689bed75ee9b6df666d526f7f16051a3db5",
    },
    model: {
      id: "test-moe",
      total_layers: 32,
      hidden_size: 4096,
      num_attention_heads: 32,
      num_key_value_heads: 8,
      ffn_hidden_size: 11008,
      expert_ffn_hidden_size: 14336,
      vocab_size: 32000,
      routed_experts: 8,
      top_k: 2,
      shared_experts: 1,
    },
    parallel: {
      dp: 4,
      pp: 2,
      tp: 2,
      cp: 1,
      ep: 2,
      vpp: 1,
      ep_mode: "split",
      cp_mode: "ulysses",
      sequence_parallel: true,
      vocab_embedding_data_parallel: true,
      expert_tensor_parallel: false,
    },
    cluster: {
      total_ranks: 16,
      ranks_per_node: 8,
      card_model: "Ascend test card",
      card_memory_gib: 64,
    },
    batch: {
      micro_batch_size: 1,
      sequence_length: 4096,
      micro_batch_count: 4,
      global_batch_size: 16,
    },
    memory: {
      compute_dtype: "bf16",
      parameter_dtype: "fp32",
      recompute_mode: "selective",
      shard_mode: "zero1",
      lora_enabled: false,
    },
    policy: {
      locked_fields: [],
      objective: "minimal-change",
    },
  };

  return merge(base, overrides);
}

function merge(base, overrides) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value)
      && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      output[key] = merge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
