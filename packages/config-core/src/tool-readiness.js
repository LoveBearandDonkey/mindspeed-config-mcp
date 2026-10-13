const CAPACITY_ONLY_REQUIRED_PATHS = new Set([
  "model.vocab_size",
  "model.ffn_hidden_size",
  "model.expert_ffn_hidden_size",
  "model.first_k_dense_layers",
]);

export const TOOL_READINESS_SOURCE =
  "mindspeed-config-mcp:training-config-v1.schema.json+topology+capacity@0.1.0";

export function toolReadinessForMissingFields(missingFields = []) {
  const missing = [...new Set(missingFields)];
  const sharedMissing = missing.filter((path) => !CAPACITY_ONLY_REQUIRED_PATHS.has(path));
  const topologyMissing = missing.filter((path) => (
    !CAPACITY_ONLY_REQUIRED_PATHS.has(path) || path === "model.first_k_dense_layers"
  ));
  const entry = (fields) => ({
    ready: fields.length === 0,
    missing_fields: [...fields],
    source_ref: TOOL_READINESS_SOURCE,
  });
  return {
    validate_parallel_config: entry(sharedMissing),
    compute_rank_topology: entry(topologyMissing),
    suggest_config_fixes: entry(sharedMissing),
    estimate_training_capacity: entry(missing),
  };
}
