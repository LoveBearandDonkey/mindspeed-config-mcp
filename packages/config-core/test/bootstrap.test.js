import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG_CORE_STATUS } from "../src/index.js";

test("config-core starts without registering MCP tools", () => {
  assert.equal(CONFIG_CORE_STATUS.phase, "core-extraction");
  assert.deepEqual(CONFIG_CORE_STATUS.toolsImplemented, [
    "validate_parallel_config",
    "compute_rank_topology",
    "suggest_config_fixes",
    "estimate_training_capacity",
  ]);
});
