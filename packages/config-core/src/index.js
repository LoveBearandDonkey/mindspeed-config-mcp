export { computeRankTopology } from "./compute-rank-topology.js";
export { estimateTrainingCapacity } from "./estimate-training-capacity.js";
export { parseTrainingConfig } from "./parse-training-config.js";
export {
  EP_MF,
  EP_ORTHOGONAL,
  EP_SPLIT,
  dpReplica,
  epDomain,
  epGroupRows,
  epInWorld,
  expertDataParallel,
  normalizeEpMode,
  parallelWorld,
  ranksPerStage,
  readParallelConfig,
  topologyScalars,
} from "./page-rules.js";
export { validateParallelConfig } from "./validate-parallel-config.js";
export { suggestConfigFixes } from "./suggest-config-fixes.js";

export const CONFIG_CORE_STATUS = Object.freeze({
  phase: "core-extraction",
  toolsImplemented: [
    "validate_parallel_config",
    "compute_rank_topology",
    "suggest_config_fixes",
    "parse_training_config",
    "estimate_training_capacity",
  ],
});
