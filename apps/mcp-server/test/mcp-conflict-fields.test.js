import assert from "node:assert/strict";
import test from "node:test";
import { validateParallelConfig } from "@mindspeed-config/config-core";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";
import { conflictFieldsFor, conflictInputValue, sourceParsedValue } from "../ui/src/mcp-conflict-fields.js";

test("源配置比较保留零值、真实缺口和被契约拒绝的原始值", () => {
  const result = { data: { normalized_config: { parallel: { dp: 64 }, model: { shared_experts: 0 } },
    unmapped_fields: [{ source_key: "first-k-dense-replace", value: "-1" }] },
    warnings: [{ fields: ["first-k-dense-replace", "model.first_k_dense_layers"] }] };
  assert.equal(sourceParsedValue(result, "parallel.dp"), 64);
  assert.equal(sourceParsedValue(result, "model.shared_experts"), 0);
  assert.equal(sourceParsedValue(result, "cluster.card_model"), undefined);
  assert.equal(sourceParsedValue(result, "model.first_k_dense_layers"), "-1");
});

test("校验错误的实际 fields 决定可编辑项，DP/EP 不从文案中猜测", () => {
  const config = createTrainingConfig({ parallel: { dp: 64, ep: 128 }, cluster: { total_ranks: 256 } });
  const result = validateParallelConfig(config);
  const fields = conflictFieldsFor(result, config);
  for (const path of ["parallel.dp", "parallel.ep"]) {
    const field = fields.find(item => item.path === path);
    assert.ok(field.issues.some(issue => issue.code === "PAGE_EP_DOMAIN_DIVISIBLE_BY_EP"));
    assert.equal(field.value, path.endsWith("dp") ? 64 : 128);
    assert.equal(field.schema.minimum, 1);
  }
  assert.equal(new Set(fields.map(item => item.path)).size, fields.length);
});

test("修改 DP 后的新总 Rank 冲突暴露真实关联字段；规则通过时不产生冲突项", () => {
  const config = createTrainingConfig({ parallel: { dp: 8 }, cluster: { total_ranks: 16 } });
  const fields = conflictFieldsFor(validateParallelConfig(config), config);
  assert.ok(fields.some(item => item.path === "cluster.total_ranks"));
  assert.deepEqual(conflictFieldsFor(validateParallelConfig(createTrainingConfig()), createTrainingConfig()), []);
});

test("只渲染契约字段，并按契约接受数字、枚举及数组的用户输入", () => {
  const config = createTrainingConfig();
  const fields = conflictFieldsFor({ errors: [{ code: "TEST", message: "review", fields: [
    "source.content", "__proto__.polluted", "model", "parallel.num_layer_list", "parallel.ep_mode", "parallel.dp",
  ] }] }, config);
  assert.deepEqual(fields.map(item => item.path), ["parallel.num_layer_list", "parallel.ep_mode", "parallel.dp"]);
  const [list, mode, dp] = fields;
  assert.deepEqual(conflictInputValue(list.schema, "[12,12,11,11]"), { valid: true, value: [12,12,11,11] });
  assert.equal(conflictInputValue(list.schema, "[12,-1]").valid, false);
  assert.equal(conflictInputValue(list.schema, "bad-json").valid, false);
  assert.equal(conflictInputValue(mode.schema, "split").valid, true);
  assert.equal(conflictInputValue(dp.schema, "0").valid, false);
  assert.equal(conflictInputValue(dp.schema, "1.5").valid, false);
  const feature = conflictFieldsFor({ errors: [{ fields: ["features.tp_2d"], message: "review" }] }, config)[0];
  assert.equal(conflictInputValue(feature.schema, "false").value, false);
});
