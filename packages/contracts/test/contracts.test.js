import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePerformanceEvidence,
  composeAnalysisReport,
  computeRankTopology,
  estimateTrainingCapacity,
  parseTrainingConfig,
  planTrainingConfig,
  reviewConfigChange,
  suggestConfigFixes,
  validateParallelConfig,
} from "../../config-core/src/index.js";
import {
  validateAnalyzePerformanceEvidence,
  validateComposeAnalysisReport,
  assertToolResult,
  validateParseTrainingConfig,
  validatePlanTrainingConfig,
  validateReviewConfigChange,
  validateToolResult,
  validateTrainingConfig,
} from "../src/index.js";
import { ACCEPTANCE_SCENARIOS } from "../../../tests/fixtures/acceptance-scenarios.js";

test("A01～A15 的所有训练配置都符合输入 Schema", () => {
  for (const [id, input] of Object.entries(ACCEPTANCE_SCENARIOS)) {
    assert.deepEqual(validateTrainingConfig(input), { valid: true, errors: [] }, id);
  }
});

test("五个纯计算接口的成功与失败结果都符合统一返回 Schema", () => {
  const valid = ACCEPTANCE_SCENARIOS.A01;
  const invalid = ACCEPTANCE_SCENARIOS.A02;
  const results = [
    validateParallelConfig(valid),
    validateParallelConfig(invalid),
    computeRankTopology(valid),
    computeRankTopology(invalid),
    suggestConfigFixes(valid),
    suggestConfigFixes(ACCEPTANCE_SCENARIOS.A10),
    parseTrainingConfig({
      schema_version: "1.0",
      rule_profile: { framework: "mindspeed-llm-mcore", version: "0.12.1" },
      source: { format: "shell", content: "python train.py --num-layers 32 --custom-flag 1" },
    }),
    estimateTrainingCapacity(ACCEPTANCE_SCENARIOS.A12),
    estimateTrainingCapacity(invalid),
    planTrainingConfig({ schema_version: "1.0", resources: { total_ranks: 64, card_memory_gib: 64 }, goal: "memory-safe" }),
    analyzePerformanceEvidence({ schema_version: "1.0", observed_config: valid,
      evidence: { bottleneck: "unknown", summary: "Profiling 尚未分类", source: "profile.json" } }),
    composeAnalysisReport({ schema_version: "1.0", project: "demo",
      source: { name: "train.sh", version_kind: "unknown" }, analysis: validateParallelConfig(valid) }),
    reviewConfigChange({
      schema_version: "1.0",
      rule_profile: valid.rule_profile,
      before: { source: { format: "json", content: "{\"model_name\":\"before\"}" } },
      after: { source: { format: "json", content: "{\"model_name\":\"after\"}" } },
    }),
  ];

  for (const result of results) {
    assert.deepEqual(validateToolResult(result), { valid: true, errors: [] }, result.tool);
    assert.equal(assertToolResult(result), result);
  }
});

test("性能证据和报告输入使用独立契约并复验嵌套配置与结果", () => {
  const observed_config = ACCEPTANCE_SCENARIOS.A01;
  const perf = { schema_version: "1.0", observed_config,
    evidence: { bottleneck: "memory", summary: "峰值接近容量", source: "profile.json" } };
  assert.equal(validateAnalyzePerformanceEvidence(perf).valid, true);
  assert.equal(validateAnalyzePerformanceEvidence({ ...perf, observed_config: {} }).valid, false);
  const report = { schema_version: "1.0", project: "demo",
    source: { name: "train.sh", version_kind: "disk" }, analysis: validateParallelConfig(observed_config) };
  assert.equal(validateComposeAnalysisReport(report).valid, true);
  assert.equal(validateComposeAnalysisReport({ ...report, analysis: {} }).valid, false);
});

test("资源规划输入校验资源、目标和已有配置", () => {
  const input = { schema_version: "1.0", resources: { total_ranks: 64, card_memory_gib: 64 }, goal: "memory-safe" };
  assert.deepEqual(validatePlanTrainingConfig(input), { valid: true, errors: [] });
  assert.equal(validatePlanTrainingConfig({ ...input, goal: "unknown" }).valid, false);
  assert.equal(validatePlanTrainingConfig({ ...input, base_config: { model: {} } }).valid, false);
});

test("待解析文件使用独立输入 Schema", () => {
  const valid = {
    schema_version: "1.0",
    rule_profile: { framework: "mindspeed-bridge", version: "main" },
    source: { format: "yaml", content: "num_layers: 32", name: "config.yaml" },
  };
  const invalid = structuredClone(valid);
  delete invalid.source.content;

  assert.deepEqual(validateParseTrainingConfig(valid), { valid: true, errors: [] });
  assert.deepEqual(validateParseTrainingConfig({
    ...valid,
    model_source: { format: "json", content: "{\"num_hidden_layers\":32}", name: "config.json" },
  }), { valid: true, errors: [] });
  assert.equal(validateParseTrainingConfig(invalid).valid, false);
  assert.equal(validateParseTrainingConfig({ ...valid, model_source: { format: "json" } }).valid, false);
});

test("解析来源摘要可原样传给后续计算工具", () => {
  const config = structuredClone(ACCEPTANCE_SCENARIOS.A01);
  const parsed = parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: config.rule_profile,
    source: { format: "json", name: "train.json", content: JSON.stringify(config) },
  });
  assert.equal(parsed.data.source_snapshot.source.hash_basis, "submitted_utf8_text");
  config.source_snapshot = parsed.data.source_snapshot;
  assert.deepEqual(validateTrainingConfig(config), { valid: true, errors: [] });
  assert.equal(suggestConfigFixes(config).status, "valid");
});

test("修改复查输入要求两份文本并校验源摘要格式", () => {
  const input = {
    schema_version: "1.0",
    rule_profile: ACCEPTANCE_SCENARIOS.A01.rule_profile,
    before: { source: { format: "shell", name: "train.sh", content: "python train.py --num-layers 32" } },
    after: { source: { format: "shell", name: "train.sh", content: "python train.py --num-layers 48" } },
    expected_before_sha256: "a".repeat(64),
    locked_fields: ["parallel.ep"],
  };
  assert.equal(validateReviewConfigChange(input).valid, true);
  assert.equal(validateReviewConfigChange({ ...input, after: undefined }).valid, false);
  assert.equal(validateReviewConfigChange({ ...input, expected_before_sha256: "stale" }).valid, false);
});

test("缺字段和未知字段会被输入 Schema 拒绝", () => {
  const missing = structuredClone(ACCEPTANCE_SCENARIOS.A01);
  delete missing.parallel.tp;
  const extra = structuredClone(ACCEPTANCE_SCENARIOS.A01);
  extra.parallel.unknown_axis = 2;

  assert.equal(validateTrainingConfig(missing).valid, false);
  assert.equal(validateTrainingConfig(extra).valid, false);
});

test("返回值中的未知顶层字段会被结果 Schema 拒绝", () => {
  const result = validateParallelConfig(ACCEPTANCE_SCENARIOS.A01);
  result.unexpected = true;

  assert.equal(validateToolResult(result).valid, false);
});
