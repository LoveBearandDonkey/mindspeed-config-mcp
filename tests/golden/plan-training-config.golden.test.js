import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { planTrainingConfig } from "../../packages/config-core/src/index.js";
import { createTrainingConfig } from "../fixtures/training-config.js";

const goldenPath = fileURLToPath(new URL("./plan-training-config.golden.json", import.meta.url));
const resources = { total_ranks: 64, card_memory_gib: 64 };

export function projectPlanTrainingConfig() {
  const missing = planTrainingConfig({ schema_version: "1.0", resources, goal: "memory-safe" });
  const planned = planTrainingConfig({
    schema_version: "1.0", resources, goal: "memory-safe",
    base_config: createTrainingConfig({ model: { first_k_dense_layers: 4 } }),
  });
  const blockedConfig = createTrainingConfig({ model: { first_k_dense_layers: 4 }, batch: { global_batch_size: 17 } });
  const blocked = planTrainingConfig({ schema_version: "1.0", resources: blockedConfig.cluster,
    goal: "minimal-change", base_config: blockedConfig,
    locked_fields: ["parallel.tp", "parallel.pp", "parallel.ep", "parallel.dp"] });
  return {
    missing: {
      status: missing.status,
      code: missing.warnings[0].code,
      source_ref: missing.warnings[0].source_ref,
      required_inputs: missing.data.required_inputs,
    },
    planned: {
      status: planned.status,
      confidence: planned.confidence,
      policy_source: planned.data.policy_source,
      considered: planned.data.considered,
      valid_candidate_count: planned.data.valid_candidate_count,
      candidates: planned.data.candidates.map((candidate) => ({
        id: candidate.id,
        level: candidate.capacity.level,
        bottleneck_gib: Number(candidate.capacity.bottleneck_gib.toFixed(2)),
        change_paths: candidate.changes.map(({ path }) => path),
        rank_count: candidate.topology.rank_count,
      })),
    },
    blocked: { status: blocked.status, diagnostics: blocked.data.diagnostics },
  };
}

test("资源规划缺口、候选排序和规则来源保持 Golden 基线", () => {
  assert.deepEqual(projectPlanTrainingConfig(), JSON.parse(fs.readFileSync(goldenPath, "utf8")));
});
