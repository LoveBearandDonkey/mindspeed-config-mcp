import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { projectAcceptanceScenarios } from "./acceptance-projection.js";

const goldenPath = fileURLToPath(new URL("./a01-a15.golden.json", import.meta.url));

test("A01～A15 的稳定摘要与 Golden 基线一致", () => {
  const expected = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  assert.deepEqual(projectAcceptanceScenarios(), expected);
});

