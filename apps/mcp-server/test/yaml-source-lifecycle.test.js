import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const baselineDirectory = path.join(
  repositoryRoot,
  "apps/web/config-relation-plane-baseline/training-run-twin-standalone",
);
const planeHtmlFile = path.join(baselineDirectory, "config-relation-plane-mindspeed-config-mcp.html");
const observerHtmlFile = path.join(baselineDirectory, "config-relation-observer.html");
const yamlFile = path.join(baselineDirectory, "js/config-relation-yaml.js");
const importFile = path.join(baselineDirectory, "js/config-relation-import.js");
const shellFile = path.join(repositoryRoot, "apps/mcp-server/ui/src/mcp-shell-entry.js");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function sourceLifecycle() {
  const marker = "\n  const highlightJson = (text) => {";
  const original = read(yamlFile);
  assert.ok(original.includes(marker), "YAML 原文生命周期测试的注入点不存在");
  const instrumented = original.replace(
    marker,
    `
  global.__yamlSourceLifecycle = {
    useSource,
    discardSourceIfConfigChanged,
    get source() { return source; },
  };
  return;${marker}`,
  );
  const window = {
    document: {},
    croObserver: { config: { model: "openpangu-flash", dp: 16, pp: 4 } },
  };
  vm.runInNewContext(instrumented, { window }, { filename: yamlFile });
  return { window, lifecycle: window.__yamlSourceLifecycle };
}

test("真实配置原文不会被同配置的异步拓扑刷新替换成 openPangu 生成模板", () => {
  const { window, lifecycle } = sourceLifecycle();
  const source = { name: "config-test/mixtral_8x7b.sh", text: "REAL_MIXTRAL_SOURCE" };

  lifecycle.useSource(source);
  assert.equal(lifecycle.discardSourceIfConfigChanged(), false);
  assert.equal(lifecycle.source, source, "同配置 refresh 后必须继续显示逐字原文");

  window.croObserver.config.dp = 32;
  assert.equal(lifecycle.discardSourceIfConfigChanged(), true);
  assert.equal(lifecycle.source, null, "用户实际改配置后才应退回生成视图");
});

test("独立页与 MCP 页都把 config-test 的真实文本交给代码框", () => {
  const importSource = read(importFile);
  const shellSource = read(shellFile);

  assert.match(importSource, /fetch\(`\.\/config-test\/\$\{file\}`\)/);
  assert.match(importSource, /const detail = pending\.text \? \{[\s\S]*?text: pending\.text/);
  assert.match(shellSource, /const content = BUILTIN_SOURCES\[file\]/);
  assert.match(shellSource, /text: current\.source\?\.content \?\? current\.content/);
});

test("配置选择器将字段覆盖口径明确标为 MCP 适配度", () => {
  for (const file of [planeHtmlFile, observerHtmlFile]) {
    const source = read(file);
    assert.match(source, /id="croPreviewTitle">MCP 适配度<\/h2>/);
    assert.doesNotMatch(source, /id="croPreviewTitle">兼容度<\/h2>/);
  }
});
