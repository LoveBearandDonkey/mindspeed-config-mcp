import assert from "node:assert/strict";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createHttpApp, loadHttpConfig } from "../src/http.js";

const TOKEN = "test-token-with-at-least-thirty-two-characters";

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("HTTP 配置缺少 Token 或公网 Host 白名单时拒绝启动", () => {
  assert.throws(() => loadHttpConfig({}), /MCP_BEARER_TOKEN/);
  assert.throws(() => loadHttpConfig({ MCP_BEARER_TOKEN: "short" }), /至少需要 32/);
  assert.throws(() => loadHttpConfig({
    MCP_BEARER_TOKEN: TOKEN,
    MCP_HTTP_HOST: "0.0.0.0",
  }), /MCP_ALLOWED_HOSTS/);

  assert.deepEqual(loadHttpConfig({
    MCP_BEARER_TOKEN: TOKEN,
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_HTTP_PORT: "4100",
    MCP_ALLOWED_HOSTS: "mcp.example.com,127.0.0.1",
  }), {
    host: "0.0.0.0",
    port: 4100,
    token: TOKEN,
    allowedHosts: ["mcp.example.com", "127.0.0.1"],
    allowedOrigins: undefined,
  });
});

test("健康检查无需 Token，但 MCP 端点拒绝无 Token 请求", async () => {
  const server = await listen(createHttpApp({ token: TOKEN }));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.service, "mindspeed-config-mcp");
    assert.equal(healthBody.version, "0.1.0");
    assert.equal(healthBody.transport, "streamable-http");
    assert.equal(healthBody.tools, 5);
    assert.ok(Number.isInteger(healthBody.uptime_seconds));

    const unauthorized = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate"), /^Bearer/);
  } finally {
    await close(server);
  }
});

test("携带 Bearer Token 的 Streamable HTTP 客户端可调用五个 Tool 并读取界面", async () => {
  const server = await listen(createHttpApp({ token: TOKEN }));
  const { port } = server.address();
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "mindspeed-config-http-test", version: "0.1.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "compute_rank_topology",
      "estimate_training_capacity",
      "parse_training_config",
      "suggest_config_fixes",
      "validate_parallel_config",
    ]);

    const parsed = await client.callTool({
      name: "parse_training_config",
      arguments: {
        schema_version: "1.0",
        rule_profile: { framework: "mindspeed-llm-mcore", version: "0.12.1" },
        source: { format: "shell", content: "python train.py --num-layers 32 --unknown-flag 1" },
      },
    });
    assert.equal(parsed.structuredContent.tool, "parse_training_config");
    assert.equal(parsed.structuredContent.data.unmapped_count, 1);

    const resource = await client.readResource({ uri: "ui://mindspeed-config/result-view.html" });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  } finally {
    await client.close();
    await close(server);
  }
});
