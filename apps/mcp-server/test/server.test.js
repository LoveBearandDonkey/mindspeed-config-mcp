import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";
import { createMcpServer } from "../src/server.js";

const EXPECTED_TOOLS = [
  "compute_rank_topology",
  "estimate_training_capacity",
  "suggest_config_fixes",
  "validate_parallel_config",
];

async function withClient(run) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "mindspeed-config-mcp-test", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("MCP Server 只注册第一版四个 Tool", async () => {
  await withClient(async (client) => {
    const response = await client.listTools();
    const names = response.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, EXPECTED_TOOLS);
    assert.ok(response.tools.every((tool) => tool.inputSchema.type === "object"));
    assert.ok(response.tools.every((tool) => tool.outputSchema.type === "object"));
  });
});

test("四个 MCP Tool 都返回文本解释和结构化结果", async () => {
  await withClient(async (client) => {
    for (const name of EXPECTED_TOOLS) {
      const response = await client.callTool({
        name,
        arguments: createTrainingConfig(),
      });

      assert.notEqual(response.isError, true, name);
      assert.equal(response.structuredContent.tool, name);
      assert.equal(response.content[0].type, "text");
      assert.ok(response.content[0].text.length > 0);
    }
  });
});

test("MCP 层在输入缺字段时返回协议错误而不是进入核心计算", async () => {
  await withClient(async (client) => {
    const input = createTrainingConfig();
    delete input.parallel.tp;
    const response = await client.callTool({
      name: "validate_parallel_config",
      arguments: input,
    });

    assert.equal(response.isError, true);
  });
});

test("真实 stdio 子进程可以完成握手并枚举四个 Tool", async () => {
  const entry = fileURLToPath(new URL("../src/index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    stderr: "pipe",
  });
  const client = new Client({ name: "mindspeed-config-mcp-stdio-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    const response = await client.listTools();
    assert.deepEqual(response.tools.map((tool) => tool.name).sort(), EXPECTED_TOOLS);
  } finally {
    await client.close();
  }
});
