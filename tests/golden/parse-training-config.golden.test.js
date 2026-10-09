import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { projectParserDialects } from "./parser-projection.js";

const goldenPath = fileURLToPath(new URL("./parser-dialects.golden.json", import.meta.url));

test("配置方言映射与推导摘要保持稳定", () => {
  const expected = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  assert.deepEqual(projectParserDialects(), expected);
});
