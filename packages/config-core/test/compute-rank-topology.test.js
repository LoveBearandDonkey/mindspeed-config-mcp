import assert from "node:assert/strict";
import test from "node:test";

import { computeRankTopology } from "../src/index.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

function groupContaining(groups, rank) {
  return groups.find((group) => group.ranks.includes(rank));
}

test("Rank 拓扑无重复、无遗漏地覆盖全部 Rank", () => {
  const result = computeRankTopology(createTrainingConfig());
  const ids = result.data.ranks.map((item) => item.rank);

  assert.equal(result.status, "valid");
  assert.equal(result.data.semantics, "page-derived");
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, 16);
  assert.deepEqual(ids, Array.from({ length: 16 }, (_, index) => index));
  assert.equal(result.data.stages.length, 2);
  assert.deepEqual(result.data.stages.map((stage) => stage.layer_count), [16, 16]);
  assert.equal(result.data.layers.length, 32);
  assert.deepEqual(result.data.layers[16], { layer: 16, stage: 1, stage_offset: 0, ffn: "moe" });
  assert.deepEqual(result.data.expert_slices.map(({ expert_start, expert_end }) => [expert_start, expert_end]), [[0, 3], [4, 7]]);
  assert.deepEqual(result.data.nodes.map(({ rank_start, rank_end }) => [rank_start, rank_end]), [[0, 7], [8, 15]]);
});

test("Rank 5 可反查节点、Stage 与五种并行组", () => {
  const result = computeRankTopology(createTrainingConfig());
  const rank = result.data.ranks[5];

  assert.deepEqual(
    {
      node: rank.node,
      stage: rank.stage,
      dp: rank.dp_index,
      ep: rank.ep_index,
      tp: rank.tp_index,
      cp: rank.cp_index,
    },
    { node: 0, stage: 0, dp: 1, ep: 0, tp: 1, cp: 0 },
  );
  assert.deepEqual(groupContaining(result.data.groups.tp, 5).ranks, [4, 5]);
  assert.deepEqual(groupContaining(result.data.groups.ep, 5).ranks, [5, 7]);
  assert.deepEqual(groupContaining(result.data.groups.pp, 5).ranks, [5, 13]);
  assert.deepEqual(groupContaining(result.data.groups.dp, 5).ranks, [1, 3, 5, 7]);
  assert.deepEqual(groupContaining(result.data.groups.cp, 5).ranks, [5]);
});

test("MindFormers EP 域不会把 TP 重复乘入 Rank 数", () => {
  const input = createTrainingConfig({
    rule_profile: { framework: "mindformers", version: "page-baseline" },
    parallel: { dp: 2, pp: 2, tp: 2, ep: 4, ep_mode: "mf" },
    cluster: { total_ranks: 8 },
  });
  const result = computeRankTopology(input);

  assert.equal(result.status, "valid");
  assert.equal(result.data.counts.world, 8);
  assert.equal(result.data.counts.ranks_per_stage, 4);
  assert.equal(result.data.ranks.length, 8);
  assert.equal(new Set(result.data.ranks.map((item) => item.rank)).size, 8);
});

test("动态 PP 使用已校验的 num_layer_list 生成 Stage 边界", () => {
  const result = computeRankTopology(createTrainingConfig({
    rule_profile: {
      framework: "mindspeed-llm-mcore",
      version: "master@7826e88",
      source_commit: "7826e883ab40f06dd54f0fa2ce6508d18036843c",
    },
    model: { total_layers: 32 },
    parallel: {
      pp: 2,
      pipeline_layer_mode: "dynamic",
      num_layer_list: [20, 12],
    },
  }));

  assert.equal(result.status, "valid");
  assert.deepEqual(
    result.data.stages.map(({ layer_start, layer_end, layer_count }) => ({
      layer_start,
      layer_end,
      layer_count,
    })),
    [
      { layer_start: 0, layer_end: 19, layer_count: 20 },
      { layer_start: 20, layer_end: 31, layer_count: 12 },
    ],
  );
  assert.equal(result.data.layers[20].stage, 1);
});

test("非法配置不生成貌似可信的 Rank 矩阵", () => {
  const result = computeRankTopology(createTrainingConfig({
    cluster: { total_ranks: 32 },
  }));

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.data, { valid: false });
  assert.ok(result.errors.some((item) => item.code === "PAGE_WORLD_SIZE_MATCHES_TOTAL_RANKS"));
});
