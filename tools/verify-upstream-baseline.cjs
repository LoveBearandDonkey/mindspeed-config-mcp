"use strict";

/*
 * 只读验证页面上游的纯计算入口，不实现 MCP。
 *
 * 用法：
 *   node scripts/verify-upstream-baseline.js D:\Projects\compute-graph-viewer-wzh
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const workspace = process.argv[2]
  || process.env.TOOL_MATRIX_ROOT
  || path.resolve(__dirname, "..", "..", "compute-graph-viewer-wzh");

const profilingRoot = path.join(workspace, "Profiling_Insight_and_Tool");
const pageRoot = path.join(profilingRoot, "training-run-twin-standalone");
const sources = {
  rules: path.join(profilingRoot, "shared", "plane-rules.js"),
  observer: path.join(pageRoot, "js", "config-relation-observer.js"),
  capacity: path.join(pageRoot, "js", "config-relation-capacity.js"),
};

for (const [name, file] of Object.entries(sources)) {
  if (!fs.existsSync(file)) throw new Error(`缺少 ${name} 上游文件：${file}`);
}

const noop = () => {};
const stubElement = () => ({
  style: {},
  dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  append: noop,
  appendChild: noop,
  setAttribute: noop,
  addEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
});

const documentStub = {
  readyState: "loading",
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: noop,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: stubElement,
  createElementNS: stubElement,
  body: null,
  documentElement: null,
};

const windowStub = {
  document: documentStub,
  location: { search: "" },
  console,
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: noop,
  requestAnimationFrame: noop,
  setTimeout: noop,
  clearTimeout: noop,
  localStorage: { getItem: () => null, setItem: noop },
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  CustomEvent: function CustomEvent() {},
};
windowStub.window = windowStub;

const context = vm.createContext(windowStub);

function run(file, transform) {
  let source = fs.readFileSync(file, "utf8");
  if (transform) source = transform(source);
  vm.runInContext(source, context, { filename: file });
}

run(sources.rules);
run(sources.observer, (source) => {
  const marker = "global.CroTopology = {";
  if (!source.includes(marker)) throw new Error("CroTopology 导出点已变化，需要更新验证脚本");
  return source.replace(marker, "global.CroTopology = { proposeFix,");
});
run(sources.capacity);

const topologyApi = windowStub.CroTopology;
const capacityApi = windowStub.croCapacityModel;

if (!topologyApi || typeof topologyApi.validate !== "function"
    || typeof topologyApi.derive !== "function"
    || typeof topologyApi.proposeFix !== "function") {
  throw new Error("拓扑纯计算入口不完整");
}
if (!capacityApi || typeof capacityApi.measureAll !== "function") {
  throw new Error("容量纯计算入口不完整");
}

const preset = topologyApi.MODEL_PRESETS["qwen2-7b"];
const config = {
  ...preset.defaults,
  model: preset.id,
  epMode: "split",
  moeOrthogonal: false,
};
const errors = topologyApi.validate(config);
const topology = topologyApi.derive(config);
const stages = capacityApi.measureAll(topology);

if (errors.length) throw new Error(`Qwen2-7B 基线配置不再合法：${errors.join("；")}`);
if (!topology.valid) throw new Error("Qwen2-7B 基线没有产生有效拓扑");
if (stages.length !== config.pp) {
  throw new Error(`容量 Stage 数 ${stages.length} 与 PP ${config.pp} 不一致`);
}

const ranks = topology.stages.flatMap((stage) => topology.ranksOfStage(stage.stage));
const uniqueRanks = new Set(ranks);
if (ranks.length !== config.totalRank || uniqueRanks.size !== config.totalRank
    || Math.min(...ranks) !== 0 || Math.max(...ranks) !== config.totalRank - 1) {
  throw new Error("Rank 拓扑没有无重复、无遗漏地覆盖 [0, totalRank) 区间");
}

console.log(JSON.stringify({
  status: "ok",
  model: config.model,
  total_ranks: config.totalRank,
  rank_records: ranks.length,
  pp_stages: topology.stages.length,
  capacity_stages: stages.length,
  exported: {
    validate: true,
    derive: true,
    proposeFix: true,
    measureAll: true,
  },
}, null, 2));
