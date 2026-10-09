import assert from "node:assert/strict";
import test from "node:test";

import { estimateTrainingCapacity } from "@mindspeed-config/config-core";

import {
  capacityMeasurements,
  capacityViewModel,
} from "../ui/src/mcp-capacity-adapter.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

test("容量适配层直接消费 Tool 的六段数据和瓶颈 Stage", () => {
  const result = estimateTrainingCapacity(createTrainingConfig());
  const model = capacityViewModel(result);

  assert.ok(model);
  assert.equal(model.confidence, "theoretical");
  assert.equal(model.shown.stage, result.data.bottleneck_stage);
  assert.deepEqual(
    model.stages.map(({ stage }) => stage),
    result.data.stages.map(({ stage }) => stage),
  );
  assert.equal(model.shown.values_gib.activation, result.data.stages[result.data.bottleneck_stage].values_gib.activation);
});

test("旧画布兼容视图只做字段与 GiB/byte 单位映射", () => {
  const result = estimateTrainingCapacity(createTrainingConfig());
  const measurements = capacityMeasurements(result);
  const first = measurements[0];
  const source = result.data.stages[0];

  assert.equal(first.ratio, source.ratio);
  assert.equal(first.total / (1024 ** 3), source.total_gib);
  assert.equal(first.values.weight / (1024 ** 3), source.values_gib.weight);
  assert.equal(first.reserveParts.workspace / (1024 ** 3), source.reserve_parts_gib.workspace);
  assert.equal(first.recomputed, source.recomputed_layers);
});

test("容量适配层拒绝非 theoretical 或缺失 Stage 的结果", () => {
  const result = estimateTrainingCapacity(createTrainingConfig());
  assert.equal(capacityViewModel({ ...result, confidence: "calibrated" }), null);
  assert.equal(capacityViewModel({ ...result, data: { ...result.data, stages: [] } }), null);
});
