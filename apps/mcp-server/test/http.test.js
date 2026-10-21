import assert from "node:assert/strict";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { APP_RESOURCE_META } from "../src/app-resource.js";
import { createHttpApp, loadHttpConfig } from "../src/http.js";

const TOKEN = "test-token-with-at-least-thirty-two-characters";
const BROWSER_TOKEN = "browser-access-code-with-at-least-thirty-two-characters";
const PUBLIC_ORIGIN = "https://mcp.example.com";
const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

async function listen(app) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = await new Promise((resolve, reject) => {
      const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
      candidate.on("error", reject);
    });
    if (!FETCH_FORBIDDEN_PORTS.has(server.address().port)) return server;
    await close(server);
  }
  throw new Error("连续十次获得 Fetch 禁止端口，无法启动本地测试服务");
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
    MCP_BROWSER_PUBLIC_ORIGIN: "https://mcp.example.com",
  }), {
    host: "0.0.0.0",
    port: 4100,
    token: TOKEN,
    allowedHosts: ["mcp.example.com", "127.0.0.1"],
    allowedOrigins: undefined,
    browserAccessToken: TOKEN,
    browserBasePath: "/mindspeed-config",
    browserPublicOrigin: "https://mcp.example.com",
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
    assert.equal(healthBody.tools, 16);
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

test("浏览器入口使用访问码换取 HttpOnly 会话，并由腾讯云 HTTP 服务执行计算", async () => {
  const server = await listen(createHttpApp({
    token: TOKEN,
    browserAccessToken: BROWSER_TOKEN,
    browserPublicOrigin: PUBLIC_ORIGIN,
  }));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const browserBase = `${base}/mindspeed-config`;
  try {
    const page = await fetch(`${browserBase}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
    const html = await page.text();
    assert.match(html, /__MINDSPEED_WEB_SERVICE__/);
    assert.match(html, /mindspeed-config\/api/);
    assert.doesNotMatch(html, new RegExp(TOKEN));
    assert.doesNotMatch(html, new RegExp(BROWSER_TOKEN));

    const unauthenticated = await fetch(`${browserBase}/api/tools/parse_training_config`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
      body: "{}",
    });
    assert.equal(unauthenticated.status, 401);

    const crossOrigin = await fetch(`${browserBase}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ access_token: TOKEN }),
    });
    assert.equal(crossOrigin.status, 403);

    const rejected = await fetch(`${browserBase}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
      body: JSON.stringify({ access_token: TOKEN }),
    });
    assert.equal(rejected.status, 401);

    const login = await fetch(`${browserBase}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
      body: JSON.stringify({ access_token: BROWSER_TOKEN }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /^mindspeed_config_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Path=\/mindspeed-config\//);

    const parsed = await fetch(`${browserBase}/api/tools/parse_training_config`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        schema_version: "1.0",
        rule_profile: { framework: "mindspeed-llm-mcore", version: "0.12.1" },
        source: { format: "shell", content: "python train.py --num-layers 32 --unknown-flag 1" },
      }),
    });
    assert.equal(parsed.status, 200);
    const body = await parsed.json();
    assert.equal(body.structuredContent.tool, "parse_training_config");
    assert.equal(body.structuredContent.data.unmapped_count, 1);
  } finally {
    await close(server);
  }
});

test("独立 Web 用登录后一次性交接接收 Agent 已读取的配置", async () => {
  const server = await listen(createHttpApp({
    token: TOKEN,
    browserAccessToken: BROWSER_TOKEN,
    browserPublicOrigin: PUBLIC_ORIGIN,
  }));
  const { port } = server.address();
  const browserBase = `http://127.0.0.1:${port}/mindspeed-config`;
  const transport = new StreamableHTTPClientTransport(new URL(`${browserBase}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "handoff-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const source = { name: "train.sh", content: "python train.py --num-layers 32" };
    const opened = await client.callTool({
      name: "open_config_workbench",
      arguments: { objective: "检查训练配置", source },
    });
    const webUrl = opened.structuredContent.data.web_url;
    assert.match(webUrl, /^https:\/\/mcp\.example\.com\/mindspeed-config\/#handoff=/);
    assert.doesNotMatch(webUrl, /num-layers/);
    const token = new URL(webUrl).hash.slice("#handoff=".length);

    const unauthorized = await fetch(`${browserBase}/api/handoff`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
      body: JSON.stringify({ token }),
    });
    assert.equal(unauthorized.status, 401);
    const login = await fetch(`${browserBase}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
      body: JSON.stringify({ access_token: BROWSER_TOKEN }),
    });
    assert.equal(login.status, 200);
    const headers = {
      "content-type": "application/json",
      origin: PUBLIC_ORIGIN,
      cookie: login.headers.get("set-cookie"),
    };
    const redeemed = await fetch(`${browserBase}/api/handoff`, {
      method: "POST", headers, body: JSON.stringify({ token }),
    });
    assert.equal(redeemed.status, 200);
    assert.deepEqual((await redeemed.json()).handoff, {
      source: { ...source, model_source: null }, objective: "检查训练配置", target_tool: null,
    });
    const replay = await fetch(`${browserBase}/api/handoff`, {
      method: "POST", headers, body: JSON.stringify({ token }),
    });
    assert.equal(replay.status, 404);
  } finally {
    await client.close();
    await close(server);
  }
});

test("携带 Bearer Token 的 Streamable HTTP 客户端可调用 Tool 并读取中文工作台界面", async () => {
  const server = await listen(createHttpApp({ token: TOKEN }));
  const { port } = server.address();
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mindspeed-config/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "mindspeed-config-http-test", version: "0.1.0" });

  try {
    const initialized = await fetch(`http://127.0.0.1:${port}/mindspeed-config/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json, text/event-stream",
        "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "instructions-check", version: "0.1" },
      } }),
    });
    assert.equal(initialized.status, 200);
    assert.match(await initialized.text(), /当前 MCP 连接的 parse_training_config/);
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "analyze_performance_evidence",
      "compose_analysis_report",
      "compute_rank_topology",
      "estimate_training_capacity",
      "open_compute_rank_topology",
      "open_config_workbench",
      "open_estimate_training_capacity",
      "open_parse_training_config",
      "open_plan_training_config",
      "open_suggest_config_fixes",
      "open_validate_parallel_config",
      "parse_training_config",
      "plan_training_config",
      "review_config_change",
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
    assert.equal(parsed.structuredContent.data.mcp_invocation.tool, "parse_training_config");
    assert.equal(parsed.structuredContent.data.dialogue.overview.source_count, 1);
    assert.match(parsed.content[0].text, /## ① 读取与解析[\s\S]*## ④ 还缺什么[\s\S]*## 下一步帮助/);

    const workbench = await client.callTool({ name: "open_config_workbench", arguments: {} });
    assert.equal(workbench.structuredContent.status, "ready");

    const capacityApp = await client.callTool({ name: "open_estimate_training_capacity", arguments: {} });
    assert.equal(capacityApp.structuredContent.data.target_tool, "estimate_training_capacity");

    const resource = await client.readResource({ uri: "ui://mindspeed-config/result-view.html" });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(resource.contents[0]._meta?.ui, APP_RESOURCE_META);
  } finally {
    await client.close();
    await close(server);
  }
});
