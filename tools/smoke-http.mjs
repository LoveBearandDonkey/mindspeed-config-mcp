import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createHttpApp } from "../apps/mcp-server/src/http.js";
import { APP_RESOURCE_URI } from "../apps/mcp-server/src/server.js";
import { createTrainingConfig } from "../tests/fixtures/training-config.js";

const EXPECTED_TOOLS = [
  "validate_parallel_config",
  "compute_rank_topology",
  "suggest_config_fixes",
  "parse_training_config",
  "estimate_training_capacity",
];
const REGISTERED_TOOLS = [...EXPECTED_TOOLS, "open_config_workbench"];
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
  checks.push({ check: "MCP 握手与枚举", result: "通过", detail: "五个分析 Tool 和中文工作台已注册" });

  const workbench = await client.callTool({ name: "open_config_workbench", arguments: {} });
  assert.equal(workbench.structuredContent?.status, "ready");
  checks.push({ check: "中文工作台零输入入口", result: "通过", detail: "无需填写 JSON" });

  for (const name of EXPECTED_TOOLS) {
    const response = await client.callTool({
      name,
      arguments: name === "parse_training_config" ? PARSE_INPUT : createTrainingConfig(),
    });
    assert.notEqual(response.isError, true, `${name} 返回了错误结果`);
    assert.equal(response.structuredContent?.tool, name);
    assert.equal(response.content?.[0]?.type, "text");
    checks.push({ check: name, result: "通过", detail: response.content[0].text });
  }

  const resource = await client.readResource({ uri: APP_RESOURCE_URI });
  const app = resource.contents[0];
  assert.equal(app.mimeType, "text/html;profile=mcp-app");
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
