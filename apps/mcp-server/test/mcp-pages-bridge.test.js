import assert from "node:assert/strict";
import test from "node:test";
import * as core from "@mindspeed-config/config-core";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";
import { checkPageFiles, installPagesBridge } from "../ui/src/mcp-pages-bridge.js";

function input(config = createTrainingConfig({ model: { first_k_dense_layers: 0 } })) {
  const { model, ...training } = config;
  return { active: "configs/model_config.json", files: [
    { path: "configs/training.json", content: JSON.stringify(training) },
    { path: "configs/model_config.json", content: JSON.stringify({ model }) },
  ] };
}

test("Pages fallback jointly checks send-time source values through config-core", () => {
  const good = checkPageFiles(input(), core);
  assert.equal(good.mode, "browser-local-config-core");
  assert.equal(good.parse.data.missing_required_fields.length, 0);
  assert.equal(good.validation.errors.length, 0);
  assert.deepEqual(good.calls, ["parse_training_config", "validate_parallel_config"]);
  const bad = checkPageFiles(input(createTrainingConfig({ model: { first_k_dense_layers: 0 }, parallel: { ep: 7 } })), core);
  assert.equal(bad.parse.data.normalized_config.parallel.ep, 7);
  assert.ok(bad.validation.errors.length > 0);
});

test("Pages fallback preserves missing input and never substitutes the page preset", () => {
  const result = checkPageFiles({ active: "configs/run.sh", files: [
    { path: "configs/run.sh", content: "torchrun --nproc_per_node 8 pretrain.py --tensor-model-parallel-size 2" },
  ] }, core);
  assert.ok(result.parse.data.missing_required_fields.length > 0);
  assert.equal(result.validation, null);
  assert.deepEqual(result.calls, ["parse_training_config"]);
});

test("Pages fallback rejects unrelated files and ambiguous sources", () => {
  const payload = input();
  payload.files[0].path = "other/training.json";
  assert.throws(() => checkPageFiles(payload, core), /同目录/);
  assert.throws(() => checkPageFiles({ active: "a.sh", files: [
    { path: "a.sh", content: "" }, { path: "b.sh", content: "" },
  ] }, core), /歧义/);
});

test("Embedded message endpoint rejects another window and untrusted origins", () => {
  const saved = Object.fromEntries(["window", "location", "document"].map(key => [key, globalThis[key]]));
  try {
    let listener, replies = 0;
    const parent = { postMessage() { replies++; } };
    globalThis.location = { search: "?embed=1", origin: "https://lovebearanddonkey.github.io" };
    globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({}) };
    globalThis.window = { parent, croObserver: { importConfig() {} }, addEventListener(name, handler) { listener = handler; } };
    installPagesBridge(core);
    const data = { channel: "mindspeed-config-demo/v1", requestId: "test", type: "hello" };
    listener({ source: parent, origin: "https://example.com", data });
    listener({ source: {}, origin: location.origin, data });
    assert.equal(replies, 0);
    listener({ source: parent, origin: location.origin, data });
    assert.equal(replies, 1);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
