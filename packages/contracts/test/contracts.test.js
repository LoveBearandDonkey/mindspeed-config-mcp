import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRankTopology,
  estimateTrainingCapacity,
  parseTrainingConfig,
  suggestConfigFixes,
  validateParallelConfig,
} from "../../config-core/src/index.js";
import {
  assertToolResult,
  validateParseTrainingConfig,
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
  ];

  for (const result of results) {
    assert.deepEqual(validateToolResult(result), { valid: true, errors: [] }, result.tool);
    assert.equal(assertToolResult(result), result);
  }
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
  assert.equal(validateParseTrainingConfig(invalid).valid, false);
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
