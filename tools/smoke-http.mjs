import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createHttpApp } from "../apps/mcp-server/src/http.js";
import { APP_RESOURCE_META, APP_RESOURCE_URI, assertPackagedAppHtml } from "../apps/mcp-server/src/app-resource.js";
import { createTrainingConfig } from "../tests/fixtures/training-config.js";

const EXPECTED_TOOLS = [
  "validate_parallel_config",
  "compute_rank_topology",
  "suggest_config_fixes",
  "parse_training_config",
  "plan_training_config",
  "estimate_training_capacity",
];
const APP_LAUNCHERS = [
  "open_config_workbench",
  ...EXPECTED_TOOLS.map((name) => `open_${name}`),
];
const REGISTERED_TOOLS = [...EXPECTED_TOOLS, "review_config_change",
  "analyze_performance_evidence", "compose_analysis_report", ...APP_LAUNCHERS];
const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

const PARSE_INPUT = {
  schema_version: "1.0",
  rule_profile: { framework: "mindspeed-llm-mcore", version: "0.12.1" },
  source: {
    format: "shell",
    name: "train.sh",
    content: "python train.py --num-layers 32 --hidden-size 4096 --custom-flag 1",
  },
};

const token = randomBytes(32).toString("hex");
const httpServer = await listen(createHttpApp({ token }));
const address = httpServer.address();
assert(address && typeof address === "object");

const baseUrl = `http://127.0.0.1:${address.port}`;
const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "mindspeed-config-local-smoke", version: "0.1.0" });
const checks = [];

try {
  const health = await fetch(`${baseUrl}/health`);
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assert.equal(healthBody.status, "ok");
  checks.push({ check: "健康检查", result: "通过", detail: `${healthBody.tools} 个 Tool` });

  const unauthorized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(unauthorized.status, 401);
  checks.push({ check: "Token 鉴权", result: "通过", detail: "无 Token 返回 401" });

  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(({ name }) => name).sort(), [...REGISTERED_TOOLS].sort());
  checks.push({ check: "MCP 握手与枚举", result: "通过", detail: "九个计算 Tool 和七个自定义界面入口已注册" });

  const workbench = await client.callTool({ name: "open_config_workbench", arguments: {} });
  assert.equal(workbench.structuredContent?.status, "ready");
  checks.push({ check: "中文工作台零输入入口", result: "通过", detail: "无需填写 JSON" });

  for (const name of EXPECTED_TOOLS) {
    const launcher = await client.callTool({ name: `open_${name}`, arguments: {} });
    assert.equal(launcher.structuredContent?.data?.target_tool, name);
  }

  const { schema_version: ignoredSchema, rule_profile: ignoredProfile, policy: ignoredPolicy, ...raw } = createTrainingConfig();
  delete raw.model.id;
  raw.model_name = "smoke-model";
  raw.first_k_dense_layers = 0;
  raw.parallel.tp = 3;
  const beforeContent = JSON.stringify(raw);
  const afterContent = JSON.stringify({ ...raw, parallel: { ...raw.parallel, tp: 2 } });
  const review = await client.callTool({
    name: "review_config_change",
    arguments: {
      schema_version: "1.0",
      rule_profile: createTrainingConfig().rule_profile,
      before: { source: { format: "json", name: "train.json", content: beforeContent } },
      after: { source: { format: "json", name: "train.json", content: afterContent } },
      expected_before_sha256: createHash("sha256").update(beforeContent).digest("hex"),
      locked_fields: ["cluster.total_ranks", "parallel.ep"],
      expected_changes: [{ path: "parallel.tp", old_value: 3, new_value: 2 }],
    },
  });
  assert.notEqual(review.isError, true);
  assert.equal(review.structuredContent?.status, "valid");
  assert.equal(review.structuredContent?.data?.candidate_match, true);
  checks.push({ check: "review_config_change", result: "通过", detail: review.content[0].text });
  const performance = await client.callTool({ name: "analyze_performance_evidence", arguments: {
    schema_version: "1.0", observed_config: createTrainingConfig({ model: { first_k_dense_layers: 4 } }),
    evidence: { bottleneck: "data-input", summary: "数据等待较长", source: "profile.json" },
  } });
  assert.equal(performance.structuredContent?.data?.attribution, "unverified");
  const report = await client.callTool({ name: "compose_analysis_report", arguments: {
    schema_version: "1.0", project: "smoke", source: { name: "train.sh", version_kind: "unknown" },
    analysis: performance.structuredContent,
  } });
  assert.match(report.structuredContent?.data?.markdown, /配置分析报告/);
  checks.push({ check: "性能证据与报告", result: "通过", detail: "非配置原因保留，Markdown 和结构化报告可读取" });
  checks.push({ check: "六个分析页面入口", result: "通过", detail: "全部为零输入自定义界面" });

  for (const name of EXPECTED_TOOLS) {
    const response = await client.callTool({
      name,
      arguments: name === "parse_training_config" ? PARSE_INPUT
        : name === "plan_training_config" ? { schema_version: "1.0", resources: { total_ranks: 64, card_memory_gib: 64 }, goal: "memory-safe" }
          : createTrainingConfig(),
    });
    assert.notEqual(response.isError, true, `${name} 返回了错误结果`);
    assert.equal(response.structuredContent?.tool, name);
    assert.equal(response.content?.[0]?.type, "text");
    if (name === "parse_training_config") {
      const dialogue = response.structuredContent.data.dialogue;
      assert.equal(response.structuredContent.data.mcp_invocation.tool, name);
      assert.match(response.structuredContent.data.mcp_invocation.request_id, /^[0-9a-f-]{36}$/);
      assert.equal(dialogue.overview.source_count, 1);
      assert.ok(dialogue.solutions.length <= 3);
      assert.match(response.content[0].text, /## ① 读取与解析[\s\S]*## ④ 还缺什么[\s\S]*## 下一步帮助/);
      checks.push({ check: name, result: "通过", detail: "实际 MCP 调用含追踪信息、4+1 结论与最多三个候选" });
    } else {
      checks.push({ check: name, result: "通过", detail: response.content[0].text });
    }
  }

  const resource = await client.readResource({ uri: APP_RESOURCE_URI });
  const app = resource.contents[0];
  assert.equal(app.mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(app._meta?.ui, APP_RESOURCE_META);
  assertPackagedAppHtml(app.text);
  assert.match(app.text, /MindSpeed Config MCP/);
  checks.push({ check: "MCP App 界面资源", result: "通过", detail: APP_RESOURCE_URI });

  console.log("\n本地 Streamable HTTP 模拟验收通过（未部署、未启动训练）。\n");
  console.table(checks);
} finally {
  await Promise.allSettled([client.close(), close(httpServer)]);
}

function listen(app) {
  return tryListen(app);
}

async function tryListen(app) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = await new Promise((resolve, reject) => {
      const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
      candidate.on("error", reject);
    });
    if (!FETCH_FORBIDDEN_PORTS.has(server.address().port)) return server;
    await close(server);
  }
  throw new Error("连续十次获得 Fetch 禁止端口，无法启动本地模拟服务");
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
