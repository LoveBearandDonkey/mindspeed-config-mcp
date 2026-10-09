import assert from "node:assert/strict";
import test from "node:test";

import { computeRankTopology } from "@mindspeed-config/config-core";

import { adaptRankTopology, topologyInputKey } from "../ui/src/mcp-topology-adapter.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

function pageTopology(input) {
  const stages = [
    { stage: 0, lo: 0, hi: 15, count: 16 },
    { stage: 1, lo: 16, hi: 31, count: 16 },
  ];
  return {
    valid: true,
    config: { node: 2 },
    preset: { id: "test-moe" },
    card: { label: "昇腾测试卡", hbmGB: 64 },
    errors: [],
    warnings: [],
    stages,
    layers: Array.from({ length: 32 }, (_, index) => ({
      index,
      stage: index < 16 ? 0 : 1,
      ffn: index < 16 ? "dense" : "moe",
      attention: "std",
    })),
    counts: {
      totalLayer: 32,
      routedExpert: input.model.routed_experts,
      topK: input.model.top_k,
      sharedExpert: input.model.shared_experts,
      ranksPerNode: input.cluster.ranks_per_node,
      dpReplica: input.parallel.dp,
    },
  };
}

test("MCP Rank 结果转换为原页面查询接口且坐标不在浏览器重算", () => {
  const input = createTrainingConfig();
  const result = computeRankTopology(input);
  const topology = adaptRankTopology(pageTopology(input), result);

  assert.ok(topology);
  assert.equal(topology.mcpResult, result);
  assert.equal(topology.counts.totalRank, 16);
  assert.deepEqual(topology.coordsOfRank(5), {
    rank: 5,
    stage: 0,
    dpIdx: 1,
    epIdx: 0,
    tpIdx: 1,
    cpIdx: 0,
    dpReal: 1,
    inner: 1,
    node: 0,
    groupIds: result.data.ranks[5].group_ids,
  });
  assert.deepEqual(topology.ranksOfStage(1), result.data.stages[1].ranks);
  assert.deepEqual(topology.expertsOfEpRank(1), [4, 5, 6, 7]);
  const tpGroup = topology.mcpGroups.tp.find((group) => group.ranks.includes(5));
  assert.deepEqual(tpGroup.ranks, [4, 5]);
});

test("拓扑请求键不受对象字段插入顺序影响", () => {
  assert.equal(
    topologyInputKey({ parallel: { tp: 2, pp: 4 }, model: { id: "x" } }),
    topologyInputKey({ model: { id: "x" }, parallel: { pp: 4, tp: 2 } }),
  );
});

test("非法 Tool 结果不会被适配成貌似可信的页面拓扑", () => {
  const input = createTrainingConfig({ cluster: { total_ranks: 32 } });
  assert.equal(adaptRankTopology(pageTopology(input), computeRankTopology(input)), null);
});
