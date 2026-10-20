import assert from "node:assert/strict";
import test from "node:test";

import { parseDialogue } from "../src/parse-dialogue.js";

function resultWithPlans(plans) {
  return {
    status: "valid",
    errors: [],
    warnings: [],
    data: {
      source_name: "train.yaml",
      source_field_count: 4,
      required_field_count: 6,
      filled_required_field_count: 4,
      missing_required_fields: ["parallel.tp", "cluster.total_ranks"],
      source_snapshot: { source: { name: "train.yaml" } },
      tool_readiness: { validate_parallel_config: {
        ready: false, missing_fields: ["parallel.tp", "cluster.total_ranks"],
      } },
      completion: { plans },
    },
  };
}

function plan(id, { recommended = false, eligible = true, confidence = "deterministic" } = {}) {
  return {
    id,
    label: id,
    summary: `采用 ${id} 的已复验配置`,
    recommended,
    confidence,
    validation: { status: "valid" },
    capacity_assessment: { recommendation_eligible: eligible, confidence: "theoretical" },
  };
}

test("场景 1 方案数量决定后续提问，容量不合格候选不作为推荐方案", () => {
  const none = parseDialogue(resultWithPlans([plan("over-capacity", { eligible: false })]));
  assert.deepEqual(none.solutions, []);
  assert.equal(none.follow_up.mode, "provide_input");

  const one = parseDialogue(resultWithPlans([plan("confirmed", {
    recommended: true, confidence: "requires-confirmation",
  })]));
  assert.deepEqual(one.solutions.map((item) => item.number), [1]);
  assert.equal(one.follow_up.mode, "confirm_solution");
  assert.match(one.follow_up.prompt, /先确认方案中的占位值/);

  const multiple = parseDialogue(resultWithPlans([
    plan("alternative"), plan("preferred", { recommended: true }),
    plan("third"), plan("fourth"),
  ]));
  assert.deepEqual(multiple.solutions.map((item) => item.id), ["preferred", "alternative", "third"]);
  assert.match(multiple.solutions[0].ranking_reason, /^首选：/);
  assert.match(multiple.solutions[1].ranking_reason, /^备选：/);
  assert.equal(multiple.follow_up.mode, "choose_solution");
  assert.match(multiple.follow_up.prompt, /方案序号（1～3）/);

  const conflicting = resultWithPlans([plan("otherwise-eligible", { recommended: true })]);
  conflicting.data.cross_source_observations = [{ relation: "different", label: "最大位置长度",
    training: { source_key: "max-position-embeddings", value: 40960 },
    model: { source_key: "max_position_embeddings", value: 131072 }, source_ref: "upstream" }];
  const unresolved = parseDialogue(conflicting);
  assert.deepEqual(unresolved.solutions, []);
  assert.match(unresolved.follow_up.prompt, /确认两份来源的差异值/);
});
