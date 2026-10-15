import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateParallelConfig } from "../../packages/config-core/src/index.js";
import { createTrainingConfig } from "../fixtures/training-config.js";

const goldenPath = fileURLToPath(new URL("./static-capabilities.golden.json", import.meta.url));
const codes = (result) => result.errors.map(({ code }) => code).sort();

function projection() {
  const hybrid = validateParallelConfig(createTrainingConfig({
    parallel: { cp: 8, cp_mode: "hybrid", ulysses_degree_in_cp: 2, cp_window_size: 2 },
    cluster: { total_ranks: 128, card_model: "昇腾 910B" },
    batch: { sequence_length: 32768 },
  }));
  const compatibility = validateParallelConfig(createTrainingConfig({
    features: {
      use_ascend_mc2: true,
      use_ascend_coc: true,
      tp_2d: true,
      tp_x: 2,
      tp_y: 2,
      use_nd_matmul: true,
      normalization: "layernorm",
      loading_checkpoint: true,
    },
  }));
  const strategy = validateParallelConfig(createTrainingConfig({
    parallel: { cp: 8 },
    cluster: { total_ranks: 128, card_model: "昇腾 910B" },
    batch: { sequence_length: 32768 },
  }));
  const cpSuggestion = strategy.suggestions.find(({ code }) => (
    code === "MINDSPEED_CP_SLICE_BELOW_DEVICE_HEURISTIC"
  ));
  const hcclSuggestion = strategy.suggestions.find(({ code }) => (
    code === "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE"
  ));

  return {
    hybrid: {
      status: hybrid.status,
      error_codes: codes(hybrid),
      suggestion_codes: hybrid.suggestions.map(({ code }) => code),
    },
    compatibility: {
      status: compatibility.status,
      error_codes: codes(compatibility),
      suggestion_codes: compatibility.suggestions.map(({ code }) => code),
    },
    strategy: {
      status: strategy.status,
      warning_codes: strategy.warnings.map(({ code }) => code),
      suggestion_codes: strategy.suggestions.map(({ code }) => code),
      cp_search_space: cpSuggestion.data,
      hccl_buffer: hcclSuggestion.data,
    },
  };
}

test("高级静态约束与策略建议和 Golden 基线一致", () => {
  const expected = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  assert.deepEqual(projection(), expected);
});

