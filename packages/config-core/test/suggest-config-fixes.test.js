import assert from "node:assert/strict";
import test from "node:test";

import { suggestConfigFixes, validateParallelConfig } from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

test("合法配置不生成装饰性修改", () => {
  const result = suggestConfigFixes(createTrainingConfig());

  assert.equal(result.status, "valid");
  assert.equal(result.data.already_valid, true);
  assert.deepEqual(result.data.suggestions, []);
});

test("锁定总 Rank 和 EP 时通过调整未锁定字段修复 world", () => {
  const input = createTrainingConfig({
    cluster: { total_ranks: 32 },
    policy: { locked_fields: ["cluster.total_ranks", "parallel.ep"] },
  });
  const result = suggestConfigFixes(input);

  assert.equal(result.data.solved, true);
  assert.ok(result.data.suggestions.length > 0);
  assert.ok(result.data.suggestions.length <= 10);
  assert.equal(result.data.suggestion_limit, 10);
  assert.equal(result.data.score.objective, "mindspeed-compatible");
  assert.equal(result.data.max_changed_fields, 4);
  assert.deepEqual(
    result.data.suggestions.map((suggestion) => suggestion.score),
    result.data.suggestions.map((suggestion) => suggestion.score).toSorted((left, right) => left - right),
  );
  for (const suggestion of result.data.suggestions) {
    assert.equal(suggestion.proposed_config.cluster.total_ranks, 32);
    assert.equal(suggestion.proposed_config.parallel.ep, 2);
    assert.equal(validateParallelConfig(suggestion.proposed_config).status, "valid");
    assert.ok(suggestion.changes.every((change) => !result.data.locked_fields.includes(change.path)));
  }
});

test("最多四字段搜索能修复四组相互独立的静态约束", () => {
  const input = createTrainingConfig({
    model: { num_attention_heads: 30, routed_experts: 10, top_k: 12 },
    parallel: { tp: 4, cp: 4, ep: 4 },
    cluster: { total_ranks: 48 },
    batch: { sequence_length: 4098 },
  });
  const result = suggestConfigFixes(input);

  assert.equal(result.data.solved, true);
  assert.equal(result.data.suggestions[0].changes.length, 4);
  assert.equal(validateParallelConfig(result.data.suggestions[0].proposed_config).status, "valid");
  assert.match(result.data.score.tie_breaker, /changed_field_count \* 1000/);
});

test("四种 MindSpeed 规则派生策略返回对应的评分口径", () => {
  const objectives = {
    "mindspeed-compatible": ["compatibility_warning_count", "deterministic"],
    "keep-current-resources": ["total_rank_log2_distance", "deterministic"],
    "memory-safe": ["bottleneck_memory_ratio", "theoretical"],
    "pipeline-balanced": ["stage_memory_imbalance", "theoretical"],
  };
  for (const [objective, [metric, confidence]] of Object.entries(objectives)) {
    const result = suggestConfigFixes(createTrainingConfig({
      cluster: { total_ranks: 32 },
      policy: { locked_fields: [], objective },
    }));
    assert.equal(result.data.score.objective, objective);
    assert.equal(result.data.score.primary_metric, metric);
    assert.equal(result.confidence, confidence);
    assert.equal(result.data.suggestions[0].score_details.confidence, confidence);
    assert.deepEqual(
      result.data.suggestions.map((suggestion) => suggestion.score),
      result.data.suggestions.map((suggestion) => suggestion.score).toSorted((left, right) => left - right),
    );
  }
});

test("锁定全部冲突字段时结构化返回无解", () => {
  const input = createTrainingConfig({
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
  });
  const result = suggestConfigFixes(input);

  assert.equal(result.status, "invalid");
  assert.equal(result.data.solved, false);
  assert.deepEqual(result.data.suggestions, []);
});

test("修复建议不原地修改调用方配置", () => {
  const input = createTrainingConfig({ cluster: { total_ranks: 32 } });
  const before = structuredClone(input);

  suggestConfigFixes(input);

  assert.deepEqual(input, before);
});
