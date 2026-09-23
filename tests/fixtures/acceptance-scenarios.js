import { createTrainingConfig } from "./training-config.js";

export function createDenseTrainingConfig(overrides = {}) {
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

export const ACCEPTANCE_SCENARIOS = Object.freeze({
  A01: createTrainingConfig(),
  A02: createTrainingConfig({ cluster: { total_ranks: 32 } }),
  A03: createTrainingConfig({ model: { total_layers: 31 } }),
  A04: createTrainingConfig({
    model: { num_attention_heads: 30, ffn_hidden_size: 2048 },
    parallel: { tp: 4 },
    cluster: { total_ranks: 32 },
  }),
  A05: createTrainingConfig(),
  A06: createTrainingConfig({
    parallel: { dp: 3 },
    cluster: { total_ranks: 12, ranks_per_node: 4 },
  }),
  A07: createTrainingConfig({
    rule_profile: { framework: "mindformers", version: "page-baseline" },
    parallel: { dp: 2, tp: 2, ep: 4, ep_mode: "mf" },
    cluster: { total_ranks: 8 },
  }),
  A08: createTrainingConfig({
    model: { num_attention_heads: 30, ffn_hidden_size: 2048 },
    parallel: { tp: 2, cp: 4, cp_mode: "ulysses" },
    cluster: { total_ranks: 64 },
  }),
  A09: createTrainingConfig({
    parallel: { cp: 4, cp_mode: "ring" },
    cluster: { total_ranks: 64 },
    batch: { sequence_length: 4098 },
  }),
  A10: createTrainingConfig({
    cluster: { total_ranks: 32 },
    policy: { locked_fields: ["cluster.total_ranks", "parallel.ep"] },
  }),
  A11: createTrainingConfig({
    cluster: { total_ranks: 32 },
    policy: {
      locked_fields: [
        "cluster.total_ranks",
        "parallel.dp",
        "parallel.pp",
        "parallel.tp",
        "parallel.cp",
        "parallel.ep",
        "parallel.vpp",
        "model.top_k",
      ],
    },
  }),
  A12: createDenseTrainingConfig(),
  A13: createTrainingConfig(),
  A14: createDenseTrainingConfig({ memory: { shard_mode: "none" } }),
  A15: createDenseTrainingConfig({
    parallel: { pp: 4 },
    cluster: { total_ranks: 32 },
  }),
});

