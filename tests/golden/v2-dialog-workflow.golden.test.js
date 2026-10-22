import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseTrainingConfig,
  reviewConfigChange,
  suggestConfigFixes,
  validateParallelConfig,
} from "../../packages/config-core/src/index.js";
import { createTrainingConfig } from "../fixtures/training-config.js";

const goldenPath = fileURLToPath(new URL("./v2-dialog-workflow.golden.json", import.meta.url));

export function projectV2DialogWorkflow() {
  const invalid = createTrainingConfig({ parallel: { tp: 3 }, policy: {
    locked_fields: ["cluster.total_ranks", "parallel.ep"],
  } });
  const validation = validateParallelConfig(invalid);
  const { schema_version: ignoredSchema, rule_profile: ignoredProfile, policy: ignoredPolicy, ...raw } = invalid;
  delete raw.model.id;
  raw.model_name = "golden-model";
  raw.first_k_dense_layers = 0;
  const source = (config) => ({ format: "json", name: "train.json", content: JSON.stringify(config) });
  const before = source(raw);
  const after = source({ ...raw, parallel: { ...raw.parallel, tp: 2 } });
  const parsed = parseTrainingConfig({ schema_version: "1.0", rule_profile: invalid.rule_profile, source: before });
  const fixes = suggestConfigFixes({ ...parsed.data.normalized_config,
    source_snapshot: parsed.data.source_snapshot, policy: invalid.policy });
  const review = reviewConfigChange({
    schema_version: "1.0",
    rule_profile: invalid.rule_profile,
    before: { source: before },
    after: { source: after },
    expected_before_sha256: parsed.data.source_snapshot.source.sha256,
    locked_fields: invalid.policy.locked_fields,
    expected_changes: [{ path: "parallel.tp", old_value: 3, new_value: 2 }],
  });
  return {
    validation: {
      state: validation.quick_assessment.state,
      first_code: validation.quick_assessment.evidence[0].code,
      source_ref: validation.quick_assessment.evidence[0].source_ref,
      next_step: validation.quick_assessment.next_step,
    },
    parse: {
      complete: parsed.data.complete,
      source_sha256: parsed.data.source_snapshot.source.sha256,
      state: parsed.quick_assessment.state,
      mcp_candidate_count: parsed.data.dialogue.solutions.length,
      dialogue_source_version: parsed.source_versions.config_core,
      solution_note: parsed.data.dialogue.solution_note,
      follow_up_prompt: parsed.data.dialogue.follow_up.prompt,
    },
    fix: {
      solved: fixes.data.solved,
      state: fixes.quick_assessment.state,
      locked_fields: fixes.data.locked_fields,
      first_changes: fixes.data.suggestions[0].changes.map(({ path, old_value, new_value }) => ({
        path, old_value, new_value,
      })),
    },
    review: {
      status: review.status,
      source_changed: review.data.source_changed,
      after_sha256: review.data.source_snapshot.after.source.sha256,
      locked_field_changes: review.data.locked_field_changes,
      changes: review.data.changes,
      text_diff_complete: review.data.source_text_diff.complete,
      text_diff_has_before: review.data.source_text_diff.text.includes('"tp":3'),
      text_diff_has_after: review.data.source_text_diff.text.includes('"tp":2'),
      validation_status: review.data.validation.status,
      state: review.quick_assessment.state,
    },
  };
}

test("V2 对话结论、源版本、候选差异和修改后复查保持 Golden 基线", () => {
  assert.deepEqual(projectV2DialogWorkflow(), JSON.parse(fs.readFileSync(goldenPath, "utf8")));
});
