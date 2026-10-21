import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parallelWorld } from "../../../packages/config-core/src/page-rules.js";
import { validateParallelConfig } from "../../../packages/config-core/src/validate-parallel-config.js";
import { rebalanceParallelConfig } from "./constraint-lens-balance.js";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

const goldenPath = fileURLToPath(new URL("./constraint-lens-balance.golden.json", import.meta.url));

function setup(mode) {
  const input = createTrainingConfig({
    parallel: {
      dp: mode === "split" ? 4 : 2,
      pp: 2,
      tp: 2,
      cp: 2,
      ep: 2,
      ep_mode: mode,
    },
  });
  input.cluster.total_ranks = parallelWorld(input);
  return input;
}

function project(input, request) {
  const result = rebalanceParallelConfig(input, {
    editableFields: ["dp", "pp", "tp", "cp", "ep", "ranks"],
    ...request,
  });
  if (result.status === "balanced") {
    const proposal = structuredClone(input);
    for (const [field, value] of Object.entries(result.selection)) {
      if (field === "ranks") proposal.cluster.total_ranks = value;
      else proposal.parallel[field] = value;
    }
    assert.equal(validateParallelConfig(proposal).status, "valid");
    assert.equal(parallelWorld(proposal), proposal.cluster.total_ranks);
  }
  return {
    status: result.status,
    selection: result.selection,
    changes: result.changes,
    search_exhausted: result.search_exhausted,
  };
}

test("并行交互的最少被动改动、锁定和无解回退符合 Golden", () => {
  const orthogonal = setup("orthogonal");
  const split = setup("split");
  const threeFactorConflict = structuredClone(orthogonal);
  Object.assign(threeFactorConflict.parallel, { dp: 6, pp: 7, tp: 3, cp: 1, ep: 2 });
  threeFactorConflict.cluster.total_ranks = 32;
  const boundedFields = { dp: 16, pp: 16, tp: 16, cp: 16, ep: 16, ranks: 256 };
  const primeRankConflict = structuredClone(threeFactorConflict);
  primeRankConflict.cluster.total_ranks = 58;
  const projection = {
    factor_moves_rank: project(orthogonal, { field: "dp", value: 3 }),
    locked_active_still_moves_rank: project(orthogonal, {
      field: "dp", value: 3, lockedFields: ["dp"],
    }),
    rank_moves_factor: project(orthogonal, { field: "ranks", value: 48 }),
    locked_factor_is_skipped: project(orthogonal, {
      field: "ranks", value: 64, lockedFields: ["dp"],
    }),
    impossible_tp_keeps_previous: project(orthogonal, { field: "tp", value: 3 }),
    locked_rank_blocks_factor: project(orthogonal, {
      field: "dp", value: 3, lockedFields: ["ranks"],
    }),
    split_dp_changes_ep_and_rank: project(split, { field: "dp", value: 3 }),
    three_factor_rank_repair: project(threeFactorConflict, {
      field: "ranks", value: 32, lockedFields: ["ranks"], fieldLimits: boundedFields,
    }),
    bounded_prime_rank_fallback: project(primeRankConflict, {
      field: "dp", value: 6, fieldLimits: boundedFields,
    }),
  };
  assert.deepEqual(projection, JSON.parse(fs.readFileSync(goldenPath, "utf8")));
});
