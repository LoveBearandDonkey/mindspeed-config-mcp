import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePerformanceEvidence,
  composeAnalysisReport,
  reviewConfigChange,
  validateParallelConfig,
} from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

const config = createTrainingConfig({ model: { first_k_dense_layers: 4 } });
const evidence = (bottleneck) => ({
  schema_version: "1.0",
  observed_config: config,
  evidence: { bottleneck, summary: "Profiler 显示该瓶颈", source: "profile.json", run_id: "run-42" },
});

test("性能证据关联静态检查，但不把瓶颈类别当作已验证归因", () => {
  const result = analyzePerformanceEvidence(evidence("communication"));
  assert.equal(result.data.attribution, "unverified");
  assert.equal(result.data.hypotheses[0].classification, "experiment-only");
  assert.equal(result.data.capacity.confidence, "theoretical");
  assert.match(result.data.hypotheses[0].verification_metric, /step time/);
  assert.equal(result.data.evidence.run_id, "run-42");
});

test("数据输入瓶颈保留非配置原因，不生成无依据的调参候选", () => {
  const result = analyzePerformanceEvidence(evidence("data-input"));
  assert.deepEqual(result.data.hypotheses, []);
  assert.ok(result.data.non_config_causes.some((item) => item.includes("数据读取")));
});

test("报告区分候选差异和已复查文件差异", () => {
  const analysis = validateParallelConfig(config);
  const input = {
    schema_version: "1.0", project: "demo", source: { name: "train.sh", version_kind: "disk" },
    analysis,
    candidate_changes: [{ path: "parallel.tp", old_value: 2, new_value: 4 }],
  };
  const result = composeAnalysisReport(input);
  assert.equal(result.data.report.review_status, "未复查源文件修改");
  assert.deepEqual(result.data.report.file_diff, []);
  assert.match(result.data.markdown, /候选建议 parallel.tp/);
  assert.match(result.data.markdown, /源文本 SHA-256：未提供/);
});

test("只有来源摘要匹配修改后复查文本时，报告才列出已复查差异", () => {
  const { schema_version: ignoredSchema, rule_profile: ignoredProfile, policy: ignoredPolicy,
    ...raw } = structuredClone(config);
  delete raw.model.id;
  raw.model_name = "report-model";
  raw.first_k_dense_layers = 4;
  const before = structuredClone(raw);
  before.parallel.tp = 3;
  const after = structuredClone(before);
  after.parallel.tp = 2;
  const review = reviewConfigChange({
    schema_version: "1.0", rule_profile: config.rule_profile,
    before: { source: { format: "json", content: JSON.stringify(before) } },
    after: { source: { format: "json", content: JSON.stringify(after) } },
  });
  assert.equal(review.status, "valid");
  const reportInput = {
    schema_version: "1.0", project: "demo", source: { name: "train.json", version_kind: "disk",
      sha256: review.data.source_snapshot.after.source.sha256 },
    analysis: validateParallelConfig(config), review,
  };
  const matched = composeAnalysisReport(reportInput).data.report;
  assert.match(matched.review_status, /已按提交的修改后文本复查/);
  assert.ok(matched.file_diff.some(({ path }) => path === "parallel.tp"));
  assert.match(matched.source_text_diff.text, /-.*"tp":3/);
  assert.match(matched.source_text_diff.text, /\+.*"tp":2/);
  const stale = composeAnalysisReport({ ...reportInput,
    source: { ...reportInput.source, sha256: "0".repeat(64) } }).data.report;
  assert.equal(stale.file_diff.length, 0);
  assert.ok(stale.unresolved.some((item) => item.includes("摘要不一致")));
});
