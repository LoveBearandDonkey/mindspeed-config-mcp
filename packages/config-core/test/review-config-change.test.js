import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseTrainingConfig, reviewConfigChange, suggestConfigFixes, validateParallelConfig } from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";
import { sha256Utf8 } from "../src/sha256.js";

test("源文本 SHA-256 在浏览器可用实现中与 Node 结果一致", () => {
  for (const value of ["", "abc", "昇腾 NPU 配置", "x".repeat(63), "y".repeat(64), "z".repeat(1000)]) {
    assert.equal(sha256Utf8(value), createHash("sha256").update(value, "utf8").digest("hex"));
  }
});

function rawConfig(tp = 3, ep = 2) {
  const { schema_version: ignoredSchema, rule_profile: ignoredProfile, policy: ignoredPolicy, ...config } = createTrainingConfig();
  delete config.model.id;
  config.parallel.tp = tp;
  config.parallel.ep = ep;
  return { ...config, model_name: "review-model", first_k_dense_layers: 0 };
}

function source(config) {
  return { format: "json", name: "train.json", content: JSON.stringify(config) };
}

function reviewInput(before = rawConfig(), after = rawConfig(2)) {
  return {
    schema_version: "1.0",
    rule_profile: createTrainingConfig().rule_profile,
    before: { source: source(before) },
    after: { source: source(after) },
    locked_fields: ["cluster.total_ranks", "parallel.ep"],
    expected_changes: [{ path: "parallel.tp", old_value: 3, new_value: 2 }],
  };
}

test("对话摘要优先给阻断结论、来源证据和下一步，同时保留结构化结果", () => {
  const invalid = validateParallelConfig(createTrainingConfig({ parallel: { tp: 3 } }));
  assert.equal(invalid.quick_assessment.state, "blocked");
  assert.equal(invalid.quick_assessment.evidence[0].code, invalid.errors[0].code);
  assert.ok(invalid.quick_assessment.evidence[0].source_ref);
  assert.match(invalid.quick_assessment.next_step, /重新校验/);

  const valid = validateParallelConfig(createTrainingConfig());
  assert.equal(valid.quick_assessment.state, "passed");
  assert.match(valid.quick_assessment.limitation, /实机/);
});

test("解析摘要固定源文本版本，候选沿用基线摘要但不把它冒充修改后的版本", () => {
  const input = reviewInput();
  const parsed = parseTrainingConfig({ schema_version: "1.0", rule_profile: input.rule_profile, ...input.before });
  assert.equal(parsed.data.complete, true);
  assert.match(parsed.data.source_snapshot.source.sha256, /^[a-f0-9]{64}$/);
  const fixInput = { ...parsed.data.normalized_config, source_snapshot: parsed.data.source_snapshot,
    policy: { locked_fields: input.locked_fields } };
  const fixes = suggestConfigFixes(fixInput);
  assert.deepEqual(fixes.data.source_snapshot, parsed.data.source_snapshot);
  assert.equal(fixes.data.solved, true);
  assert.ok(fixes.data.suggestions[0].changes.length);
  assert.equal(fixes.data.suggestions[0].proposed_config.source_snapshot, undefined);
});

test("修改后复查使用新源文本，检查锁定字段、候选差异和静态规则", () => {
  const input = reviewInput();
  const parsed = parseTrainingConfig({ schema_version: "1.0", rule_profile: input.rule_profile, ...input.before });
  input.expected_before_sha256 = parsed.data.source_snapshot.source.sha256;
  const result = reviewConfigChange(input);
  assert.equal(result.status, "valid");
  assert.equal(result.data.source_changed, true);
  assert.notEqual(result.data.source_snapshot.before.source.sha256, result.data.source_snapshot.after.source.sha256);
  assert.deepEqual(result.data.changes, [{ path: "parallel.tp", old_value: 3, new_value: 2 }]);
  assert.deepEqual(result.data.locked_field_changes, []);
  assert.equal(result.data.candidate_match, true);
  assert.equal(result.data.validation.status, "valid");
});

test("过期版本、锁定字段变化、候选不符和未写入源文件都会阻断复查", () => {
  const stale = reviewConfigChange({ ...reviewInput(), expected_before_sha256: "0".repeat(64) });
  assert.ok(stale.errors.some(({ code }) => code === "REVIEW_STALE_BASELINE"));

  const locked = reviewConfigChange(reviewInput(rawConfig(), rawConfig(2, 4)));
  assert.ok(locked.errors.some(({ code }) => code === "REVIEW_LOCKED_FIELD_CHANGED"));
  assert.equal(locked.status, "invalid");
  assert.equal(locked.data.validation.status, "valid");

  const mismatch = reviewConfigChange({ ...reviewInput(), expected_changes: [{ path: "parallel.cp", old_value: 1, new_value: 2 }] });
  assert.ok(mismatch.errors.some(({ code }) => code === "REVIEW_CANDIDATE_MISMATCH"));

  const same = rawConfig();
  const unchanged = reviewConfigChange(reviewInput(same, same));
  assert.ok(unchanged.errors.some(({ code }) => code === "REVIEW_SOURCE_UNCHANGED"));
});
