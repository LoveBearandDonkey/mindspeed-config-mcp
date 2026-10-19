import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzePerformanceEvidence,
  composeAnalysisReport,
  validateParallelConfig,
} from "../../packages/config-core/src/index.js";
import { createTrainingConfig } from "../fixtures/training-config.js";

const goldenPath = fileURLToPath(new URL("./performance-report.golden.json", import.meta.url));

export function projectPerformanceReport() {
  const config = createTrainingConfig({ model: { first_k_dense_layers: 4 } });
  const performance = analyzePerformanceEvidence({
    schema_version: "1.0", observed_config: config,
    evidence: { bottleneck: "pipeline-bubble", summary: "Profiler 显示 PP Stage 空泡偏高",
      source: "profile.json", run_id: "run-42", non_config_causes: ["数据加载抖动"] },
  });
  const report = composeAnalysisReport({
    schema_version: "1.0", project: "demo", source: { name: "train.sh", version_kind: "disk",
      sha256: "a".repeat(64) },
    analysis: validateParallelConfig(config), performance,
    candidate_changes: [{ path: "parallel.pp", old_value: 4, new_value: 8 }],
  });
  return {
    performance: {
      state: performance.quick_assessment.state,
      attribution: performance.data.attribution,
      policy_source: performance.data.policy_source,
      hypothesis_code: performance.data.hypotheses[0].code,
      fields: performance.data.hypotheses[0].fields,
      non_config_causes: performance.data.non_config_causes,
      capacity_confidence: performance.data.capacity.confidence,
    },
    report: {
      policy_source: report.data.policy_source,
      review_status: report.data.report.review_status,
      source: report.data.report.source,
      candidate_changes: report.data.report.candidate_changes,
      file_diff: report.data.report.file_diff,
      unresolved: report.data.report.unresolved,
      markdown_has_source: report.data.markdown.includes("源文本 SHA-256"),
    },
  };
}

test("性能证据假设、来源及报告复查状态保持 Golden 基线", () => {
  assert.deepEqual(projectPerformanceReport(), JSON.parse(fs.readFileSync(goldenPath, "utf8")));
});
