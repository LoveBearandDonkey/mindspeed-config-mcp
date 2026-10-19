import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createMcpServer } from "../../apps/mcp-server/src/server.js";

const fixture = new URL("../fixtures/v2-scenario-1/", import.meta.url);
const rule_profile = { framework: "mindspeed-llm-mcore", version: "0.12.1" };

async function withClient(run) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "v2-scenario-1-acceptance", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function call(client, name, input) {
  const response = await client.callTool({ name, arguments: input });
  assert.notEqual(response.isError, true, name);
  assert.equal(response.structuredContent.tool, name);
  assert.equal(response.content[0].type, "text");
  assert.ok(response.structuredContent.quick_assessment);
  return response;
}

test("V2 场景 1：对话先给阻断结论，来源问题可追溯，修正后仍区分理论容量", async () => {
  const script = await readFile(new URL("pretrain.sh", fixture), "utf8");
  const model = await readFile(new URL("config.json", fixture), "utf8");

  await withClient(async (client) => {
    const parseInput = (content) => ({
      schema_version: "1.0",
      rule_profile,
      source: { format: "shell", name: "pretrain.sh", content },
      model_source: { format: "json", name: "config.json", content: model },
    });
    const parsed = await call(client, "parse_training_config", parseInput(script));
    const parseResult = parsed.structuredContent;
    assert.equal(parseResult.data.complete, true);
    assert.ok(parseResult.data.source_snapshot.source.sha256);
    assert.ok(parseResult.data.source_snapshot.model_source.sha256);
    assert.ok(parseResult.data.source_conflicts.some(({ path, training, model }) =>
      path === "model.total_layers" && training.value === 31 && model.value === 32));
    assert.ok(parseResult.data.unmapped_fields.some(({ source_key }) => source_key === "custom-optimizer-flag"));

    const config = parseResult.data.normalized_config;
    const validation = await call(client, "validate_parallel_config", config);
    assert.equal(validation.structuredContent.quick_assessment.state, "blocked");
    assert.match(validation.content[0].text, /当前配置存在阻断问题。.*首要依据：.*下一步：/);
    assert.ok(validation.structuredContent.errors.some(({ code }) => code === "PAGE_HEADS_DIVISIBLE_BY_TP"));
    assert.ok(validation.structuredContent.errors.some(({ code }) => code === "PAGE_WORLD_SIZE_MATCHES_TOTAL_RANKS"));
    assert.equal((await call(client, "compute_rank_topology", config)).structuredContent.status, "invalid");
    assert.equal((await call(client, "estimate_training_capacity", config)).structuredContent.status, "invalid");

    const correctedScript = script
      .replace("--num-layers 31", "--num-layers 32")
      .replace("--tensor-model-parallel-size 3", "--tensor-model-parallel-size 2")
      .replace("  --custom-optimizer-flag on\n", "");
    const corrected = (await call(client, "parse_training_config", parseInput(correctedScript))).structuredContent;
    assert.equal(corrected.data.complete, true);
    assert.notEqual(corrected.data.source_snapshot.source.sha256, parseResult.data.source_snapshot.source.sha256);
    assert.equal(corrected.data.unmapped_count, 0);
    assert.ok(!corrected.data.source_conflicts.some(({ path }) => path === "model.total_layers"));

    const correctedConfig = corrected.data.normalized_config;
    const checked = (await call(client, "validate_parallel_config", correctedConfig)).structuredContent;
    assert.equal(checked.status, "valid");
    assert.equal(checked.errors.length, 0);
    const topology = (await call(client, "compute_rank_topology", correctedConfig)).structuredContent;
    assert.equal(topology.status, "valid");
    assert.equal(topology.data.ranks.length, 16);
    assert.equal(topology.data.stages.length, 2);
    const capacityResponse = await call(client, "estimate_training_capacity", correctedConfig);
    const capacity = capacityResponse.structuredContent;
    assert.equal(capacity.status, "estimated");
    assert.equal(capacity.confidence, "theoretical");
    assert.equal(capacity.data.bottleneck_level, "over");
    assert.match(capacityResponse.content[0].text, /theoretical/);
    assert.equal(await readFile(new URL("pretrain.sh", fixture), "utf8"), script);
  });
});
