import assert from "node:assert/strict";
import test from "node:test";

import {
  planTrainingConfigCompletion,
  suggestConfigFixes,
  validateParallelConfig,
} from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

test("合法配置不生成装饰性修改", () => {
  const result = suggestConfigFixes(createTrainingConfig());

  assert.equal(result.status, "valid");
  assert.equal(result.data.already_valid, true);
  assert.deepEqual(result.data.suggestions, []);
});

test("均匀 PP 无法整除总层数时提供切换到动态 PP 的候选", () => {
  const input = createTrainingConfig({ model: { total_layers: 31 } });
  const result = suggestConfigFixes(input);
  const dynamic = result.data.suggestions.find((suggestion) => suggestion.changes.some(
    (change) => change.path === "parallel.pipeline_layer_mode" && change.new_value === "dynamic",
  ));

  assert.ok(dynamic);
  assert.equal(dynamic.rank, 1);
  assert.deepEqual(dynamic.proposed_config.parallel.num_layer_list, [16, 15]);
  assert.equal(dynamic.proposed_config.rule_profile.framework, "mindspeed-llm-mcore");
  assert.equal(validateParallelConfig(dynamic.proposed_config).status, "valid");
});

test("锁定 PP 分层模式时不提供动态 PP 候选", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    model: { total_layers: 31 },
    policy: { locked_fields: ["parallel.pipeline_layer_mode"] },
  }));

  assert.equal(result.data.suggestions.some((suggestion) => suggestion.changes.some(
    (change) => change.path === "parallel.pipeline_layer_mode",
  )), false);
});

test("已选择动态 PP 但缺少 num_layer_list 时提供均衡 Stage 层数", () => {
  const input = createTrainingConfig({
    rule_profile: {
      framework: "mindspeed-llm-mcore",
      version: "master@7826e88",
      source_commit: "7826e883ab40f06dd54f0fa2ce6508d18036843c",
    },
    model: { total_layers: 46 },
    parallel: {
      pp: 4,
      dp: 2,
      pipeline_layer_mode: "dynamic",
    },
  });
  const result = suggestConfigFixes(input);
  const suggestion = result.data.suggestions[0];

  assert.equal(result.data.solved, true);
  assert.deepEqual(suggestion.changes.map(({ path, new_value }) => ({ path, new_value })), [{
    path: "parallel.num_layer_list",
    new_value: [12, 12, 11, 11],
  }]);
  assert.equal(validateParallelConfig(suggestion.proposed_config).status, "valid");
});

test("动态 PP 的 num_layer_list 长度或总和错误时重新生成完整列表", () => {
  for (const numLayerList of [[23, 23], [12, 12, 12, 12]]) {
    const input = createTrainingConfig({
      rule_profile: {
        framework: "mindspeed-llm-mcore",
        version: "master@7826e88",
        source_commit: "7826e883ab40f06dd54f0fa2ce6508d18036843c",
      },
      model: { total_layers: 46 },
      parallel: {
        pp: 4,
        dp: 2,
        pipeline_layer_mode: "dynamic",
        num_layer_list: numLayerList,
      },
    });
    const result = suggestConfigFixes(input);

    assert.deepEqual(
      result.data.suggestions[0].proposed_config.parallel.num_layer_list,
      [12, 12, 11, 11],
    );
    assert.equal(validateParallelConfig(result.data.suggestions[0].proposed_config).status, "valid");
  }
});

test("动态 PP 同时缺少 num_layer_list 和 MCore profile 时合并修复", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    model: { total_layers: 46 },
    parallel: {
      pp: 4,
      dp: 2,
      pipeline_layer_mode: "dynamic",
    },
  }));
  const suggestion = result.data.suggestions[0];

  assert.equal(suggestion.changes.length, 4);
  assert.deepEqual(suggestion.proposed_config.parallel.num_layer_list, [12, 12, 11, 11]);
  assert.equal(suggestion.proposed_config.rule_profile.framework, "mindspeed-llm-mcore");
  assert.equal(validateParallelConfig(suggestion.proposed_config).status, "valid");
});

test("锁定 num_layer_list 时不覆盖用户的动态 PP 分层", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    rule_profile: { framework: "mindspeed-llm-mcore" },
    parallel: { pipeline_layer_mode: "dynamic" },
    policy: { locked_fields: ["parallel.num_layer_list"] },
  }));

  assert.equal(result.data.solved, false);
  assert.deepEqual(result.data.suggestions, []);
});

test("手动选择 MindFormers offset 但缺少矩阵时生成可回填的均衡矩阵", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    rule_profile: {
      framework: "mindformers",
      version: "page-baseline",
      source_commit: "page-form",
    },
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

  assert.equal(result.data.solved, true);
  assert.deepEqual(suggestion.changes.map(({ path, new_value }) => ({ path, new_value })), [{
    path: "parallel.pipeline_layer_offsets",
    new_value: [
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 0, 0, 0],
    ],
  }]);
  assert.deepEqual(suggestion.proposed_config.parallel.pipeline_layer_offsets, [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 0, 0, 0],
  ]);
  assert.equal(validateParallelConfig(suggestion.proposed_config).status, "valid");
});

test("锁定 pipeline_layer_offsets 时不覆盖 MindFormers offset 矩阵", () => {
  const result = suggestConfigFixes(createTrainingConfig({
    rule_profile: { framework: "mindformers" },
    parallel: { pipeline_layer_mode: "mindformers-offset" },
    policy: { locked_fields: ["parallel.pipeline_layer_offsets"] },
  }));

  assert.equal(result.data.solved, false);
  assert.deepEqual(result.data.suggestions, []);
});

test("导入补齐方案把动态 PP 作为明确命名且默认推荐的第一项", () => {
  const completion = planTrainingConfigCompletion(
    createTrainingConfig({
      model: { total_layers: 31 },
      parallel: { dp: 4, tp: 8 },
      cluster: { total_ranks: 64, card_memory_gib: 128 },
      memory: { shard_mode: "fsdp2", recompute_mode: "full", parameter_dtype: "bf16" },
    }),
  );
  const recommended = completion.plans[0];

  assert.equal(recommended.id, "validated-fix-1");
  assert.equal(recommended.label, "切换到动态 PP");
  assert.equal(recommended.recommended, true);
  assert.equal(recommended.capacity_assessment.recommendation_eligible, true);
  assert.match(recommended.summary, /16 \/ 15/);
  assert.equal(recommended.proposed_config.parallel.pipeline_layer_mode, "dynamic");
  assert.deepEqual(recommended.proposed_config.parallel.num_layer_list, [16, 15]);
  assert.ok(recommended.values.some((item) => (
    item.path === "parallel.pipeline_layer_mode" && item.value === "dynamic"
  )));
});

test("缺少模型结构时提供不绑定具体模型名称的可确认预置结构", () => {
  const input = createTrainingConfig({
    parallel: { dp: 8, tp: 8 },
    cluster: { total_ranks: 128, card_memory_gib: 128 },
    memory: { shard_mode: "fsdp2", recompute_mode: "full", parameter_dtype: "bf16" },
  });
  delete input.model.total_layers;
  delete input.model.hidden_size;
  delete input.model.num_attention_heads;
  const completion = planTrainingConfigCompletion(input, [
    "model.total_layers",
    "model.hidden_size",
    "model.num_attention_heads",
  ]);
  const preset = completion.plans[0];

  assert.equal(preset.id, "editable-model-structure-preset");
  assert.equal(preset.recommended, true);
  assert.equal(preset.capacity_assessment.level, "safe");
  assert.equal(preset.confidence, "requires-confirmation");
  assert.equal(preset.proposed_config.model.id, "editable-moe-structure-preset");
  assert.equal(preset.proposed_config.model.total_layers, 46);
  assert.equal(preset.proposed_config.model.hidden_size, 2560);
  assert.equal(preset.proposed_config.model.num_attention_heads, 48);
  assert.equal(preset.proposed_config.model.routed_experts, 256);
  assert.equal(preset.validation.status, "valid");
  assert.ok(preset.values.every((item) => (
    item.source_ref === "mindspeed-config-mcp:editable-model-structure-preset@0.3.1"
  )));
  assert.doesNotMatch(JSON.stringify(preset), /openpangu/i);
});

test("源配置完全没有并行拓扑时采用可编辑的单机 8 Rank 起点", () => {
  const input = createTrainingConfig();
  input.parallel = {};
  input.batch.micro_batch_count = 2;
  delete input.cluster.total_ranks;
  const completion = planTrainingConfigCompletion(input, [
    "parallel.dp",
    "parallel.pp",
    "parallel.tp",
    "parallel.cp",
    "parallel.ep",
    "parallel.vpp",
    "parallel.ep_mode",
    "parallel.cp_mode",
    "parallel.sequence_parallel",
    "parallel.vocab_embedding_data_parallel",
    "parallel.expert_tensor_parallel",
    "cluster.total_ranks",
  ]);
  const proposed = completion.plans[0].proposed_config;

  assert.equal(proposed.parallel.dp, 8);
  assert.equal(proposed.parallel.pp, 1);
  assert.equal(proposed.parallel.tp, 1);
  assert.equal(proposed.cluster.total_ranks, 8);
  assert.ok(completion.plans[0].values.some((item) => (
    item.path === "parallel.dp" && item.reason.includes("单机 8 Rank")
  )));
});

test("源配置缺少机器规格时采用 950PR 128G 容量优先假设", () => {
  const input = createTrainingConfig();
  delete input.cluster.card_model;
  delete input.cluster.card_memory_gib;
  const completion = planTrainingConfigCompletion(input, [
    "cluster.card_model",
    "cluster.card_memory_gib",
  ]);
  const proposed = completion.plans[0].proposed_config;

  assert.equal(proposed.cluster.card_model, "昇腾 950PR");
  assert.equal(proposed.cluster.card_memory_gib, 128);
  assert.ok(completion.plans[0].values.every((item) => (
    item.reason.includes("950PR 128G") && item.source_ref.endsWith("@0.3.1")
  )));
});

test("源配置已声明卡型时补齐匹配显存而不静默升级硬件", () => {
  const input = createTrainingConfig({ cluster: { card_model: "昇腾 910B" } });
  delete input.cluster.card_memory_gib;
  const completion = planTrainingConfigCompletion(input, ["cluster.card_memory_gib"]);

  assert.equal(completion.plans[0].proposed_config.cluster.card_model, "昇腾 910B");
  assert.equal(completion.plans[0].proposed_config.cluster.card_memory_gib, 64);
});

test("动态 PP 使用错误 framework 时提供切换 MCore 规则口径的候选", () => {
  const input = createTrainingConfig({
    model: { total_layers: 31 },
    parallel: {
      dp: 4,
      tp: 8,
      pipeline_layer_mode: "dynamic",
      num_layer_list: [16, 15],
    },
    cluster: { total_ranks: 64, card_memory_gib: 128 },
    memory: { shard_mode: "fsdp2", recompute_mode: "full", parameter_dtype: "bf16" },
  });
  const result = suggestConfigFixes(input);
  const suggestion = result.data.suggestions[0];

  assert.equal(result.data.solved, true);
  assert.equal(suggestion.changes[0].path, "rule_profile.framework");
  assert.equal(suggestion.proposed_config.rule_profile.framework, "mindspeed-llm-mcore");
  assert.equal(suggestion.proposed_config.rule_profile.version, "master@7826e88");
  assert.equal(
    suggestion.proposed_config.rule_profile.source_commit,
    "7826e883ab40f06dd54f0fa2ce6508d18036843c",
  );
  assert.equal(validateParallelConfig(suggestion.proposed_config).status, "valid");

  const completion = planTrainingConfigCompletion(input);
  assert.equal(completion.plans[0].label, "切换到 MindSpeed-LLM MCore 规则口径");
  assert.equal(completion.plans[0].recommended, true);
  assert.ok(completion.plans[0].values.some((item) => (
    item.path === "rule_profile.framework" && item.value === "mindspeed-llm-mcore"
  )));
});

test("理论容量超过单卡上限的静态合法补齐方案不再标记为推荐", () => {
  const input = createTrainingConfig();
  delete input.model.total_layers;
  delete input.model.hidden_size;
  delete input.model.num_attention_heads;
  const completion = planTrainingConfigCompletion(input, [
    "model.total_layers",
    "model.hidden_size",
    "model.num_attention_heads",
  ]);
  const plan = completion.plans[0];

  assert.equal(plan.validation.status, "valid");
  assert.equal(plan.capacity_assessment.level, "over");
  assert.equal(plan.capacity_assessment.launch_feasible, false);
  assert.equal(plan.capacity_assessment.recommendation_eligible, false);
  assert.equal(plan.recommended, false);
  assert.equal(completion.launch_feasible, false);
  assert.equal(completion.recommended_plan_id, null);
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
