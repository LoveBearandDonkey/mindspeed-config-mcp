import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const importFile = path.join(
  repositoryRoot,
  "apps/web/config-relation-plane-baseline/training-run-twin-standalone/js/config-relation-import.js",
);
const shellFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-shell-entry.js");

test("应用样例后重开配置菜单仍从单文件内置内容解析", () => {
  const importSource = fs.readFileSync(importFile, "utf8");
  const shellSource = fs.readFileSync(shellFile, "utf8");

  assert.match(
    importSource,
    /new CustomEvent\("cro:sample-preview-requested",\s*\{[\s\S]*?cancelable:\s*true[\s\S]*?if \(!doc\.dispatchEvent\(previewRequest\)\) return;/,
    "基线选择器没有提供可取消的样例预览读取边界",
  );
  assert.match(
    shellSource,
    /cro:sample-preview-requested[\s\S]*?event\.preventDefault\(\)[\s\S]*?parseSample\(file, event\.detail\?\.card \?\? null\)/,
    "MCP 单文件适配层没有接管重开菜单后的样例解析",
  );
});
