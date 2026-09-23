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
  for (const suggestion of result.data.suggestions) {
    assert.equal(suggestion.proposed_config.cluster.total_ranks, 32);
    assert.equal(suggestion.proposed_config.parallel.ep, 2);
    assert.equal(validateParallelConfig(suggestion.proposed_config).status, "valid");
    assert.ok(suggestion.changes.every((change) => !result.data.locked_fields.includes(change.path)));
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

