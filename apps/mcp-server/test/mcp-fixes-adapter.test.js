import assert from "node:assert/strict";
import test from "node:test";

import { suggestConfigFixes, validateParallelConfig } from "@mindspeed-config/config-core";

import {
  actionableLockFields,
  changesLockedBySuggestion,
  fixesResultAlreadyValid,
  hasSuggestionScore,
  suggestionPagePartial,
  suggestionPipelineSettings,
  withLockedFields,
} from "../ui/src/mcp-fixes-adapter.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

test("修复请求显式保留用户选择的 locked_fields", () => {
  const input = createTrainingConfig({ cluster: { total_ranks: 32 } });
  const request = withLockedFields(input, new Set(["cluster.total_ranks", "parallel.ep"]));
  assert.deepEqual(request.policy, {
    locked_fields: ["cluster.total_ranks", "parallel.ep"],
    objective: "mindspeed-compatible",
  });
  assert.deepEqual(input.policy.locked_fields, [], "不得原地修改调用方输入");
});

test("Tool 候选映射回原表单后仍是最小差异且不修改锁定字段", () => {
  const input = withLockedFields(
    createTrainingConfig({ cluster: { total_ranks: 32 } }),
    ["cluster.total_ranks", "parallel.ep"],
  );
  const result = suggestConfigFixes(input);
  const suggestion = result.data.suggestions[0];
  assert.ok(suggestion);
  assert.deepEqual(changesLockedBySuggestion(suggestion, input.policy.locked_fields), []);
  assert.deepEqual(
    Object.keys(suggestionPagePartial(suggestion)).sort(),
    suggestion.changes.map((change) => ({
      "cluster.total_ranks": "totalRank",
      "parallel.dp": "dp",
      "parallel.pp": "pp",
      "parallel.tp": "tp",
      "parallel.cp": "cp",
      "parallel.ep": "ep",
      "parallel.vpp": "vpp",
      "model.top_k": "topK",
    }[change.path])).sort(),
  );
  assert.equal(validateParallelConfig(suggestion.proposed_config).errors.length, 0);
});

test("适配层会拒绝任何意外触碰锁定字段的候选", () => {
  const suggestion = { changes: [{ path: "parallel.ep", old_value: 8, new_value: 4 }] };
  assert.deepEqual(changesLockedBySuggestion(suggestion, ["parallel.ep"]), suggestion.changes);
});

test("动态 PP 修复从普通表单回填中分离并保留完整分层设置", () => {
  const result = suggestConfigFixes(createTrainingConfig({ model: { total_layers: 31 } }));
  const suggestion = result.data.suggestions.find((item) => item.changes.some(
    (change) => change.path === "parallel.pipeline_layer_mode",
  ));

  assert.ok(suggestion);
  assert.deepEqual(suggestionPagePartial(suggestion), {});
  assert.deepEqual(suggestionPipelineSettings(suggestion), {
    mode: "dynamic",
    numLayerList: [16, 15],
    layerOffsets: undefined,
    framework: "mindspeed-llm-mcore",
  });
});

test("规则 profile 修复通过 PP 分层设置应用，而不是写入普通表单", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    model: { total_layers: 31 },
    parallel: {
      pipeline_layer_mode: "dynamic",
      num_layer_list: [16, 15],
    },
  }));
  const suggestion = result.data.suggestions[0];

  assert.deepEqual(suggestionPagePartial(suggestion), {});
  assert.deepEqual(suggestionPipelineSettings(suggestion), {
    mode: "dynamic",
    numLayerList: [16, 15],
    layerOffsets: undefined,
    framework: "mindspeed-llm-mcore",
  });
});

test("缺失 num_layer_list 的动态 PP 建议可通过 PP 分层设置回填", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    rule_profile: { framework: "mindspeed-llm-mcore" },
    model: { total_layers: 46 },
    parallel: {
      pp: 4,
      dp: 2,
      pipeline_layer_mode: "dynamic",
    },
  }));
  const suggestion = result.data.suggestions[0];

  assert.deepEqual(suggestionPagePartial(suggestion), {});
  assert.deepEqual(suggestionPipelineSettings(suggestion), {
    mode: "dynamic",
    numLayerList: [12, 12, 11, 11],
    layerOffsets: undefined,
    framework: "mindspeed-llm-mcore",
  });
});

test("缺失 MindFormers offset 矩阵的建议可通过 PP 分层设置回填", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    rule_profile: { framework: "mindformers" },
    model: { total_layers: 61 },
    parallel: {
      dp: 1,
      pp: 8,
      tp: 2,
      ep: 1,
      vpp: 2,
      pipeline_layer_mode: "mindformers-offset",
    },
  }));
  const suggestion = result.data.suggestions[0];

  assert.deepEqual(suggestionPagePartial(suggestion), {});
  assert.deepEqual(suggestionPipelineSettings(suggestion), {
    mode: "mindformers-offset",
    numLayerList: undefined,
    layerOffsets: [
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 0, 0, 0],
    ],
    framework: "mindformers",
  });
});

test("只有当前候选会修改的字段可新增锁定，已锁字段仍可取消", () => {
  const actionable = actionableLockFields([
    { changes: [{ path: "parallel.dp" }, { path: "parallel.pp" }] },
    { changes: [{ path: "parallel.dp" }, { path: "parallel.tp" }] },
  ]);
  assert.deepEqual([...actionable].sort(), ["parallel.dp", "parallel.pp", "parallel.tp"]);
  assert.equal(actionable.has("parallel.ep"), false);
});

test("有效零分保留显示，缺失或无效评分不显示", () => {
  assert.equal(hasSuggestionScore({ score: 0 }), true);
  assert.equal(hasSuggestionScore({ score: 1.25 }), true);
  assert.equal(hasSuggestionScore({}), false);
  assert.equal(hasSuggestionScore({ score: null }), false);
  assert.equal(hasSuggestionScore({ score: Number.NaN }), false);
  assert.equal(hasSuggestionScore({ score: Number.POSITIVE_INFINITY }), false);
});

test("合法配置不会留下空的 MCP 修复建议区", () => {
  assert.equal(fixesResultAlreadyValid({ status: "valid", data: { suggestions: [] } }), true);
  assert.equal(fixesResultAlreadyValid({ status: "invalid", data: { already_valid: true } }), true);
  assert.equal(fixesResultAlreadyValid({ status: "invalid", data: { suggestions: [] } }), false);
});
