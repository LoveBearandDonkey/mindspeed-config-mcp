import assert from "node:assert/strict";
import test from "node:test";

import { computeRankTopology, parseTrainingConfig } from "@mindspeed-config/config-core";

import { BUILTIN_CONFIGS } from "../ui/src/builtin-configs.js";
import { createPlaneModel, expertSliceFor, rankAt } from "../ui/src/plane/plane-model.js";

test("三个开箱即用样例经 MCP 核心解析后均可直接生成拓扑", () => {
  const samples = BUILTIN_CONFIGS.filter(({ group }) => group === "开箱即用");
  assert.equal(samples.length, 3);

  for (const sample of samples) {
    const parsed = parseTrainingConfig({
      schema_version: "1.0",
      rule_profile: { framework: "generic", version: "v1-workbench" },
      source: { format: sample.format, name: sample.name, content: sample.content },
    });
    assert.equal(parsed.data.complete, true, `${sample.name} 应形成完整统一配置`);
    const topology = computeRankTopology({
      ...parsed.data.normalized_config,
      policy: { locked_fields: [], objective: "minimal-change" },
    });
    assert.equal(topology.status, "valid", `${sample.name} 应生成合法拓扑`);
  }
});

test("平面视图模型按 Stage 把层列映射到 Rank 槽位", () => {
  const sample = BUILTIN_CONFIGS.find(({ id }) => id === "quick-mixtral");
  const parsed = parseTrainingConfig({
    schema_version: "1.0",
    rule_profile: { framework: "generic", version: "v1-workbench" },
    source: { format: sample.format, name: sample.name, content: sample.content },
  });
  const topology = computeRankTopology({
    ...parsed.data.normalized_config,
    policy: { locked_fields: [], objective: "minimal-change" },
  }).data;
  const model = createPlaneModel(topology);

  assert.equal(model.columns.length, 32);
  assert.equal(rankAt(model, model.columns[0], 0).rank, 0);
  assert.equal(rankAt(model, model.columns[16], 0).rank, topology.stages[1].ranks[0]);
  assert.deepEqual(expertSliceFor(topology, 0).experts, [0, 1]);
});
