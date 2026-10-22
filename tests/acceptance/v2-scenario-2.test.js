import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createMcpServer } from "../../apps/mcp-server/src/server.js";

const fixture = new URL("../fixtures/v2-scenario-2/training.json", import.meta.url);
const rule_profile = { framework: "mindspeed-llm-mcore", version: "0.12.1" };
const locked_fields = ["cluster.total_ranks", "parallel.ep"];
const digest = (content) => createHash("sha256").update(content, "utf8").digest("hex");

async function withClient(run) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "v2-scenario-2-acceptance", version: "0.1.0" });
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

test("V2 场景 2：锁定总 Rank 与 EP，修改源文件，再按新文本复查", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "mindspeed-v2-scenario-2-"));
  const sourcePath = join(temporaryDirectory, "training.json");
  try {
    await writeFile(sourcePath, await readFile(fixture));
    const beforeText = await readFile(sourcePath, "utf8");
    const source = (content) => ({ format: "json", name: "training.json", content });
    const parseInput = (content) => ({ schema_version: "1.0", rule_profile, source: source(content) });

    await withClient(async (client) => {
      const parsedBefore = await call(client, "parse_training_config", parseInput(beforeText));
      assert.equal(parsedBefore.data.complete, true);
      assert.equal(parsedBefore.data.source_snapshot.source.sha256, digest(beforeText));
      assert.equal(parsedBefore.data.normalized_config.cluster.total_ranks, 32);
      assert.equal(parsedBefore.data.normalized_config.parallel.ep, 2);

      const initialValidation = await call(client, "validate_parallel_config", parsedBefore.data.normalized_config);
      assert.equal(initialValidation.status, "invalid");
      assert.ok(initialValidation.errors.some(({ code }) => code === "PAGE_WORLD_SIZE_MATCHES_TOTAL_RANKS"));

      const fixes = await call(client, "suggest_config_fixes", {
        ...parsedBefore.data.normalized_config,
        source_snapshot: parsedBefore.data.source_snapshot,
        policy: { locked_fields },
      });
      assert.equal(fixes.data.source_snapshot.source.sha256, digest(beforeText));
      assert.equal(fixes.data.solved, true);
      const candidate = fixes.data.suggestions[0];
      assert.deepEqual(candidate.changes.map(({ path, old_value, new_value }) => ({ path, old_value, new_value })), [
        { path: "parallel.cp", old_value: 1, new_value: 2 },
      ]);
      assert.ok(candidate.changes.every(({ path }) => !locked_fields.includes(path)));

      const edited = JSON.parse(beforeText);
      edited.parallel.cp = candidate.changes[0].new_value;
      await writeFile(sourcePath, `${JSON.stringify(edited, null, 2)}\n`, "utf8");
      const afterText = await readFile(sourcePath, "utf8");
      assert.notEqual(afterText, beforeText);
      assert.equal(edited.cluster.total_ranks, 32);
      assert.equal(edited.parallel.ep, 2);

      const review = await call(client, "review_config_change", {
        schema_version: "1.0",
        rule_profile,
        before: { source: source(beforeText) },
        after: { source: source(afterText) },
        expected_before_sha256: parsedBefore.data.source_snapshot.source.sha256,
        locked_fields,
        expected_changes: candidate.changes.map(({ path, old_value, new_value }) => ({ path, old_value, new_value })),
      });
      assert.equal(review.status, "valid");
      assert.equal(review.data.source_changed, true);
      assert.equal(review.data.source_snapshot.before.source.sha256, digest(beforeText));
      assert.equal(review.data.source_snapshot.after.source.sha256, digest(afterText));
      assert.deepEqual(review.data.locked_field_changes, []);
      assert.deepEqual(review.data.additional_changes, []);
      assert.equal(review.data.candidate_match, true);
      assert.deepEqual(review.data.changes, [{ path: "parallel.cp", old_value: 1, new_value: 2 }]);
      assert.equal(review.data.validation.status, "valid");
      assert.ok(review.data.source_text_diff);

      const parsedAfter = await call(client, "parse_training_config", parseInput(afterText));
      assert.equal(parsedAfter.data.complete, true);
      assert.equal(parsedAfter.data.source_snapshot.source.sha256, digest(afterText));
      assert.notEqual(parsedAfter.data.source_snapshot.source.sha256, parsedBefore.data.source_snapshot.source.sha256);
      assert.equal((await call(client, "validate_parallel_config", parsedAfter.data.normalized_config)).status, "valid");
      assert.equal((await call(client, "compute_rank_topology", parsedAfter.data.normalized_config)).data.ranks.length, 32);
      const capacity = await call(client, "estimate_training_capacity", parsedAfter.data.normalized_config);
      assert.equal(capacity.status, "estimated");
      assert.equal(capacity.confidence, "theoretical");
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
