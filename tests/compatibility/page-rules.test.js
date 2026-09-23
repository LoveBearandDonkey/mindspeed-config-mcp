import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  dpReplica,
  epDomain,
  epInWorld,
  expertDataParallel,
  parallelWorld,
  ranksPerStage,
} from "../../packages/config-core/src/index.js";
import { createTrainingConfig } from "../fixtures/training-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolMatrixRoot = process.env.TOOL_MATRIX_ROOT
  || path.resolve(here, "..", "..", "..", "compute-graph-viewer-wzh");
const upstreamPath = path.join(
  toolMatrixRoot,
  "Profiling_Insight_and_Tool",
  "shared",
  "plane-rules.js",
);

test("抽取后的 EP/world 标量与页面共享规则逐项一致", {
  skip: fs.existsSync(upstreamPath) ? false : `未找到只读上游：${upstreamPath}`,
}, () => {
  const require = createRequire(import.meta.url);
  delete require.cache[require.resolve(upstreamPath)];
  const upstream = require(upstreamPath);

  for (const epMode of ["split", "orthogonal", "mf"]) {
    for (const dp of [2, 4, 8]) {
      for (const tp of [1, 2, 4]) {
        for (const ep of [1, 2, 4]) {
          const input = createTrainingConfig({
            parallel: { dp, tp, ep, ep_mode: epMode },
          });
          const pageInput = {
            dp,
            pp: input.parallel.pp,
            tp,
            cp: input.parallel.cp,
            ep,
            epMode,
            totalLayer: input.model.total_layers,
            routedExpert: input.model.routed_experts,
            topK: input.model.top_k,
          };

          assert.equal(epDomain(input), upstream.epDomain(pageInput));
          assert.equal(epInWorld(input), upstream.epInWorld(pageInput));
          assert.equal(parallelWorld(input), upstream.parallelWorld(pageInput));
          assert.equal(dpReplica(input), upstream.dpReplica(pageInput));
          assert.equal(expertDataParallel(input), upstream.expertDataParallel(pageInput));
          assert.equal(ranksPerStage(input), upstream.ranksPerStage(pageInput));
        }
      }
    }
  }
});

