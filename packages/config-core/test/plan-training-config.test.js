import assert from "node:assert/strict";
import test from "node:test";

import { planTrainingConfig } from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

const resources = { total_ranks: 64, card_memory_gib: 64 };
const base = createTrainingConfig({ model: { first_k_dense_layers: 4 } });

test("仅给 NPU 数量和显存时返回模型与批量缺口", () => {
  const result = planTrainingConfig({ schema_version: "1.0", resources, goal: "memory-safe" });
  assert.equal(result.data.ready, false);
  assert.ok(result.data.required_inputs.includes("model.hidden_size"));
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.warnings[0].source_ref,
    "mindspeed-config-mcp:packages/config-core/src/plan-training-config.js@0.1.0");
});

test("规划候选经过静态校验、Rank 和理论容量计算，且不改写基线", () => {
  const snapshot = structuredClone(base);
  const result = planTrainingConfig({ schema_version: "1.0", resources, goal: "memory-safe", base_config: base });
  assert.equal(result.status, "estimated");
  assert.equal(result.data.ready, true);
  assert.ok(result.data.candidates.length > 0 && result.data.candidates.length <= 3);
  assert.ok(result.data.candidates[0].capacity.bottleneck_ratio
    <= result.data.candidates[1].capacity.bottleneck_ratio);
  for (const candidate of result.data.candidates) {
    assert.equal(candidate.validation.status, "valid");
    assert.equal(candidate.topology.rank_count, resources.total_ranks);
    assert.equal(candidate.capacity.confidence, "theoretical");
    assert.equal(candidate.proposed_config.cluster.total_ranks, resources.total_ranks);
    assert.equal(candidate.proposed_config.parallel.tp * candidate.proposed_config.parallel.pp
      * candidate.proposed_config.parallel.dp, resources.total_ranks);
  }
  assert.deepEqual(base, snapshot);
});

test("锁定项保持原值，冲突的资源显式拒绝", () => {
  const plan = { schema_version: "1.0", resources, goal: "minimal-change", base_config: base };
  const locked = planTrainingConfig({ ...plan, locked_fields: ["parallel.tp", "parallel.ep"] });
  assert.ok(locked.data.candidates.length > 0);
  assert.ok(locked.data.candidates.every(({ proposed_config }) =>
    proposed_config.parallel.tp === base.parallel.tp && proposed_config.parallel.ep === base.parallel.ep));
  const conflict = planTrainingConfig({ ...plan, locked_fields: ["cluster.total_ranks"] });
  assert.equal(conflict.status, "invalid");
  assert.equal(conflict.errors[0].code, "PLAN_LOCKED_RESOURCE_CONFLICT");
});
