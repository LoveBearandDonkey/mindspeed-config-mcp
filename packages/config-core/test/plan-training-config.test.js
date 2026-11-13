import assert from "node:assert/strict";
import test from "node:test";

import { planTrainingConfig, preparePlanningBaseConfig } from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

const resources = { total_ranks: 64, card_memory_gib: 64 };
const base = createTrainingConfig({ model: { first_k_dense_layers: 4 } });

test("仅给 NPU 数量和显存时返回模型与批量缺口", () => {
  const result = planTrainingConfig({ schema_version: "1.0", resources, goal: "memory-safe" });
  assert.equal(result.data.ready, false);
  assert.ok(result.data.required_inputs.includes("model.hidden_size"));
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.warnings[0].source_ref,
    "mindspeed-config-mcp:packages/config-core/src/plan-training-config.js@0.2.0");
});

test("页面未显式保存 Global Batch 时按原基线推导，不随目标卡数改变", () => {
  const config = createTrainingConfig({ model: { first_k_dense_layers: 4 } });
  delete config.batch.global_batch_size;
  assert.equal(preparePlanningBaseConfig(config).batch.global_batch_size, 16);
  assert.equal(config.batch.global_batch_size, undefined);
  const result = planTrainingConfig({ schema_version: "1.0", resources, goal: "memory-safe", base_config: config });
  assert.ok(result.data.candidates.length);
  assert.ok(result.data.candidates.every(({ proposed_config }) => proposed_config.batch.global_batch_size === 16));
  delete config.batch.micro_batch_count;
  assert.equal(preparePlanningBaseConfig(config).batch.global_batch_size, undefined);
});

test("锁定切分导致批量不可整除时返回字段、示例与调整方向", () => {
  const config = createTrainingConfig({ model: { first_k_dense_layers: 4 }, batch: { global_batch_size: 17 } });
  const result = planTrainingConfig({ schema_version: "1.0", resources: config.cluster, goal: "minimal-change",
    base_config: config, locked_fields: ["parallel.tp", "parallel.pp", "parallel.ep", "parallel.dp"] });
  assert.equal(result.status, "invalid");
  const issue = result.data.diagnostics[0];
  assert.equal(issue.code, "PLAN_BATCH_NOT_DIVISIBLE");
  assert.ok(issue.message.includes("17") && issue.message.includes("DP=4"));
  assert.ok(issue.fields.includes("batch.global_batch_size"));
  assert.ok(issue.suggestion.includes("锁定"));
  assert.equal(issue.rejected_count, 1);
  assert.ok(result.quick_assessment.conclusion.includes(issue.message));
});

test("保留真实静态规则诊断，不把模型错误统称为资源不足", () => {
  const config = createTrainingConfig({ model: { first_k_dense_layers: 4 }, parallel: {
    pipeline_layer_mode: "dynamic", num_layer_list: [16, 15],
  }, rule_profile: { framework: "mindspeed-llm-mcore" } });
  const result = planTrainingConfig({ schema_version: "1.0", resources: config.cluster,
    goal: "minimal-change", base_config: config });
  assert.equal(result.data.candidates.length, 0);
  const issue = result.data.diagnostics.find(({ code }) => code === "MINDSPEED_DYNAMIC_PP_LIST_SUM_MATCHES_LAYERS");
  assert.ok(issue && issue.message.includes("31"));
  assert.ok(issue.fields.includes("parallel.num_layer_list"));
  assert.ok(issue.source_ref.startsWith("MindSpeed-LLM:"));
});

test("候选明确返回理论余量、风险线和排序依据，over 不伪装为无静态解", () => {
  const result = planTrainingConfig({ schema_version: "1.0", resources: { ...resources, card_memory_gib: 1 },
    goal: "memory-safe", base_config: base });
  assert.ok(result.data.candidates.length);
  assert.equal(result.data.viable, false);
  for (const candidate of result.data.candidates) {
    assert.equal(candidate.capacity.level, "over");
    assert.ok(candidate.capacity.headroom_gib < 0);
    assert.equal(candidate.capacity.available_gib, 1);
    assert.equal(candidate.capacity.thresholds.tight, 0.8);
    assert.equal(candidate.validation.status, "valid");
  }
  assert.ok(result.data.ranking_basis.some((value) => value.includes("吞吐")));
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
