import {
  computeRankTopology,
  estimateTrainingCapacity,
  suggestConfigFixes,
  validateParallelConfig,
} from "../../packages/config-core/src/index.js";
import { ACCEPTANCE_SCENARIOS, createDenseTrainingConfig } from "../fixtures/acceptance-scenarios.js";

const round = (value) => Number(value.toFixed(6));
const errorCodes = (result) => result.errors.map((item) => item.code).sort();
const capacitySummary = (result) => result.data.stages.map((stage) => ({
  stage: stage.stage,
  level: stage.level,
  total_gib: round(stage.total_gib),
  weight_gib: round(stage.values_gib.weight),
  gradient_gib: round(stage.values_gib.gradient),
  optimizer_gib: round(stage.values_gib.optimizer),
  activation_gib: round(stage.values_gib.activation),
}));

export function projectAcceptanceScenarios() {
  const a01Validation = validateParallelConfig(ACCEPTANCE_SCENARIOS.A01);
  const a01Topology = computeRankTopology(ACCEPTANCE_SCENARIOS.A01);
  const a02 = validateParallelConfig(ACCEPTANCE_SCENARIOS.A02);
  const a03 = validateParallelConfig(ACCEPTANCE_SCENARIOS.A03);
  const a04 = validateParallelConfig(ACCEPTANCE_SCENARIOS.A04);
  const a05Validation = validateParallelConfig(ACCEPTANCE_SCENARIOS.A05);
  const a05Topology = computeRankTopology(ACCEPTANCE_SCENARIOS.A05);
  const a06 = validateParallelConfig(ACCEPTANCE_SCENARIOS.A06);
  const a07Validation = validateParallelConfig(ACCEPTANCE_SCENARIOS.A07);
  const a07Topology = computeRankTopology(ACCEPTANCE_SCENARIOS.A07);
  const a08 = validateParallelConfig(ACCEPTANCE_SCENARIOS.A08);
  const a09 = validateParallelConfig(ACCEPTANCE_SCENARIOS.A09);
  const a10 = suggestConfigFixes(ACCEPTANCE_SCENARIOS.A10);
  const a11 = suggestConfigFixes(ACCEPTANCE_SCENARIOS.A11);
  const a12 = estimateTrainingCapacity(ACCEPTANCE_SCENARIOS.A12);
  const a13 = estimateTrainingCapacity(ACCEPTANCE_SCENARIOS.A13);
  const a14None = estimateTrainingCapacity(ACCEPTANCE_SCENARIOS.A14);
  const a14Zero1 = estimateTrainingCapacity(createDenseTrainingConfig({
    memory: { shard_mode: "zero1" },
  }));
  const a14Fsdp2 = estimateTrainingCapacity(createDenseTrainingConfig({
    memory: { shard_mode: "fsdp2" },
  }));
  const a15 = estimateTrainingCapacity(ACCEPTANCE_SCENARIOS.A15);

  return {
    A01: {
      status: a01Validation.status,
      world_size: a01Validation.data.world_size,
      error_codes: errorCodes(a01Validation),
      rank_count: a01Topology.data.ranks.length,
      unique_rank_count: new Set(a01Topology.data.ranks.map((item) => item.rank)).size,
    },
    A02: { status: a02.status, error_codes: errorCodes(a02) },
    A03: { status: a03.status, error_codes: errorCodes(a03) },
    A04: { status: a04.status, error_codes: errorCodes(a04) },
    A05: {
      status: a05Validation.status,
      edp: a05Validation.data.expert_data_parallel,
      ep_group_sizes: a05Topology.data.groups.ep.map((group) => group.ranks.length),
    },
    A06: { status: a06.status, error_codes: errorCodes(a06) },
    A07: {
      status: a07Validation.status,
      ep_domain: a07Validation.data.ep_domain,
      edp: a07Validation.data.expert_data_parallel,
      rank_count: a07Topology.data.ranks.length,
      unique_rank_count: new Set(a07Topology.data.ranks.map((item) => item.rank)).size,
    },
    A08: { status: a08.status, error_codes: errorCodes(a08) },
    A09: { status: a09.status, error_codes: errorCodes(a09) },
    A10: {
      solved: a10.data.solved,
      locked_fields: a10.data.locked_fields,
      first_changes: a10.data.suggestions[0]?.changes.map(({ path, old_value, new_value }) => ({
        path, old_value, new_value,
      })) ?? [],
    },
    A11: { solved: a11.data.solved, suggestion_count: a11.data.suggestions.length },
    A12: {
      confidence: a12.confidence,
      bottleneck_level: a12.data.bottleneck_level,
      stages: capacitySummary(a12),
    },
    A13: {
      confidence: a13.confidence,
      bottleneck_level: a13.data.bottleneck_level,
      bottleneck_stage: a13.data.bottleneck_stage,
      total_gib: round(a13.data.stages[a13.data.bottleneck_stage].total_gib),
    },
    A14: {
      none: capacitySummary(a14None)[0],
      zero1: capacitySummary(a14Zero1)[0],
      fsdp2: capacitySummary(a14Fsdp2)[0],
    },
    A15: {
      bottleneck_stage: a15.data.bottleneck_stage,
      stage_weights_gib: a15.data.stages.map((stage) => round(stage.values_gib.weight)),
    },
  };
}

