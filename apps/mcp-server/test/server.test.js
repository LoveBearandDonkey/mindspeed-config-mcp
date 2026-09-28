import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";
import { APP_RESOURCE_URI, createMcpServer } from "../src/server.js";

const EXPECTED_TOOLS = [
  "compute_rank_topology",
  "estimate_training_capacity",
  "parse_training_config",
  "suggest_config_fixes",
  "validate_parallel_config",
];

const PARSE_INPUT = {
  schema_version: "1.0",
  rule_profile: { framework: "mindspeed-llm-mcore", version: "0.12.1" },
  source: {
    format: "shell",
    name: "train.sh",
    content: "python train.py --num-layers 32 --hidden-size 4096 --custom-flag 1",
  },
};

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

test("MCP Server 只注册第一版五个 Tool，并为每个 Tool 关联结果界面", async () => {
  await withClient(async (client) => {
    const response = await client.listTools();
    const names = response.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, EXPECTED_TOOLS);
    assert.ok(response.tools.every((tool) => tool.inputSchema.type === "object"));
    assert.ok(response.tools.every((tool) => tool.outputSchema.type === "object"));
    assert.ok(response.tools.every((tool) => tool._meta?.ui?.resourceUri === APP_RESOURCE_URI));
  });
});

test("五个 MCP Tool 都返回文本解释和结构化结果", async () => {
  await withClient(async (client) => {
    for (const name of EXPECTED_TOOLS) {
      const response = await client.callTool({
        name,
        arguments: name === "parse_training_config" ? PARSE_INPUT : createTrainingConfig(),
      });

      assert.notEqual(response.isError, true, name);
      assert.equal(response.structuredContent.tool, name);
      assert.equal(response.content[0].type, "text");
      assert.ok(response.content[0].text.length > 0);
    }
  });
});

test("MCP App 资源可读取且为单文件 HTML", async () => {
  await withClient(async (client) => {
    const listed = await client.listResources();
    assert.ok(listed.resources.some((resource) => resource.uri === APP_RESOURCE_URI));

    const response = await client.readResource({ uri: APP_RESOURCE_URI });
    assert.equal(response.contents.length, 1);
    assert.equal(response.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(response.contents[0].text, /MindSpeed Config MCP/);
    assert.match(response.contents[0].text, /<script type="module"/);
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

test("真实 stdio 子进程可以完成握手并枚举五个 Tool", async () => {
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
