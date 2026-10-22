import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createMcpServer } from "../../apps/mcp-server/src/server.js";

const fixture = new URL("../fixtures/v2-scenario-3/", import.meta.url);
const rule_profile = { framework: "mindspeed-llm-mcore", version: "0.12.1" };
const resources = { total_ranks: 64, card_memory_gib: 64 };
const digest = (content) => createHash("sha256").update(content, "utf8").digest("hex");

async function withClient(run) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "v2-scenario-3-acceptance", version: "0.1.0" });
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
  if (name === "parse_training_config") assert.ok(response.structuredContent.data.mcp_invocation?.request_id);
  return response.structuredContent;
}

function applyChanges(source, changes) {
  const edited = structuredClone(source);
  for (const { path, old_value, new_value } of changes) {
    const parts = path.split(".");
    const key = parts.pop();
    const section = parts.reduce((value, part) => value[part], edited);
    assert.deepEqual(section[key], old_value, `候选的旧值应对应磁盘基线：${path}`);
    section[key] = new_value;
  }
  return edited;
}

test("V2 场景 3：仅资源先返回缺口，有基线后规划并写入可复查的配置", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "mindspeed-v2-scenario-3-"));
  const sourcePath = join(temporaryDirectory, "training.json");
  try {
    await writeFile(sourcePath, await readFile(new URL("baseline.json", fixture)));
    await withClient(async (client) => {
      const missing = await call(client, "plan_training_config", {
        schema_version: "1.0", resources, goal: "minimal-change",
      });
      assert.equal(missing.data.ready, false);
      assert.deepEqual(missing.data.candidates, []);
      assert.ok(missing.data.required_inputs.includes("rule_profile.framework"));
      assert.ok(missing.data.required_inputs.includes("model.hidden_size"));
      assert.ok(missing.data.required_inputs.includes("batch.global_batch_size"));
      assert.ok(missing.warnings.some(({ code }) => code === "PLAN_NEEDS_CONTEXT"));

      const beforeText = await readFile(sourcePath, "utf8");
      const source = (content) => ({ format: "json", name: "training.json", content });
      const parseInput = (content) => ({ schema_version: "1.0", rule_profile, source: source(content) });
      const parsedBefore = await call(client, "parse_training_config", parseInput(beforeText));
      assert.equal(parsedBefore.data.complete, true);
      assert.equal(parsedBefore.data.source_snapshot.source.sha256, digest(beforeText));
      assert.equal((await call(client, "validate_parallel_config", parsedBefore.data.normalized_config)).status, "valid");

      const plan = await call(client, "plan_training_config", {
        schema_version: "1.0", resources, goal: "minimal-change",
        base_config: parsedBefore.data.normalized_config,
        locked_fields: ["batch.global_batch_size"],
      });
      assert.equal(plan.status, "estimated");
      assert.equal(plan.data.ready, true);
      assert.equal(plan.data.viable, true);
      assert.ok(plan.data.candidates.length > 0 && plan.data.candidates.length <= 3);
      assert.ok(plan.data.locked_fields.includes("batch.global_batch_size"));
      assert.ok(plan.assumptions.some((item) => item.includes("卡型名称沿用基线")));
      const candidate = plan.data.candidates[0];
      assert.equal(candidate.id, "tp2-pp4-ep2-dp4");
      assert.deepEqual(candidate.changes, [
        { path: "cluster.total_ranks", old_value: 32, new_value: 64 },
        { path: "parallel.pp", old_value: 2, new_value: 4 },
      ]);
      assert.equal(candidate.validation.status, "valid");
      assert.equal(candidate.topology.rank_count, 64);
      assert.equal(candidate.capacity.confidence, "theoretical");
      assert.equal(candidate.capacity.level, "safe");
      assert.ok(candidate.tradeoffs.some((item) => item.includes("流水线空泡")));

      const edited = applyChanges(JSON.parse(beforeText), candidate.changes);
      await writeFile(sourcePath, `${JSON.stringify(edited, null, 2)}\n`, "utf8");
      const afterText = await readFile(sourcePath, "utf8");
      assert.equal(afterText, await readFile(new URL("planned.json", fixture), "utf8"));

      const review = await call(client, "review_config_change", {
        schema_version: "1.0", rule_profile,
        before: { source: source(beforeText) },
        after: { source: source(afterText) },
        expected_before_sha256: parsedBefore.data.source_snapshot.source.sha256,
        locked_fields: ["batch.global_batch_size"],
        expected_changes: candidate.changes,
      });
      assert.equal(review.status, "valid");
      assert.equal(review.data.source_snapshot.after.source.sha256, digest(afterText));
      assert.equal(review.data.candidate_match, true);
      assert.deepEqual(review.data.changes, candidate.changes);
      assert.deepEqual(review.data.locked_field_changes, []);
      assert.deepEqual(review.data.additional_changes, []);
      assert.equal(review.data.validation.status, "valid");

      const parsedAfter = await call(client, "parse_training_config", parseInput(afterText));
      assert.equal(parsedAfter.data.complete, true);
      assert.deepEqual(parsedAfter.data.normalized_config, candidate.proposed_config);
      assert.equal((await call(client, "validate_parallel_config", parsedAfter.data.normalized_config)).status, "valid");
      const topology = await call(client, "compute_rank_topology", parsedAfter.data.normalized_config);
      assert.equal(topology.status, "valid");
      assert.equal(topology.data.ranks.length, 64);
      const capacity = await call(client, "estimate_training_capacity", parsedAfter.data.normalized_config);
      assert.equal(capacity.status, "estimated");
      assert.equal(capacity.confidence, "theoretical");
      assert.equal(capacity.data.bottleneck_level, "safe");
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
