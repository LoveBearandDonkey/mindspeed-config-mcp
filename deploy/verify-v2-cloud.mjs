import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const token = process.env.MCP_BEARER_TOKEN;
assert.ok(token?.length >= 32, "V2 Bearer Token is missing");

const client = new Client({ name: "mindspeed-v2-cloud-verify", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(
  new URL("http://127.0.0.1:3000/mindspeed-config-v2/mcp"),
  { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
);

const ruleProfile = {
  framework: "mindspeed-core",
  version: "0.12.1",
  source_commit: "65634689bed75ee9b6df666d526f7f16051a3db5",
};
const config = {
  model: {
    total_layers: 32, hidden_size: 4096, num_attention_heads: 32,
    num_key_value_heads: 8, ffn_hidden_size: 11008, expert_ffn_hidden_size: 14336,
    vocab_size: 32000, routed_experts: 8, top_k: 2, shared_experts: 1,
  },
  model_name: "v2-cloud-verification",
  first_k_dense_layers: 0,
  parallel: {
    dp: 4, pp: 2, tp: 3, cp: 1, ep: 2, vpp: 1,
    pipeline_layer_mode: "uniform", ep_mode: "split", cp_mode: "ulysses",
    sequence_parallel: true, vocab_embedding_data_parallel: true,
    expert_tensor_parallel: false,
  },
  cluster: {
    total_ranks: 16, ranks_per_node: 8,
    card_model: "Ascend test card", card_memory_gib: 64,
  },
  batch: {
    micro_batch_size: 1, sequence_length: 4096,
    micro_batch_count: 4, global_batch_size: 16,
  },
  memory: {
    compute_dtype: "bf16", parameter_dtype: "fp32",
    recompute_mode: "selective", shard_mode: "zero1", lora_enabled: false,
  },
};
const beforeText = JSON.stringify(config);
const afterText = JSON.stringify({ ...config, parallel: { ...config.parallel, tp: 2 } });
const source = (content) => ({ format: "json", name: "train.json", content });

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(({ name }) => name);
  assert.equal(tools.length, 12);
  assert.ok(tools.includes("review_config_change"));

  const parsed = await client.callTool({ name: "parse_training_config", arguments: {
    schema_version: "1.0", rule_profile: ruleProfile, source: source(beforeText),
  } });
  assert.notEqual(parsed.isError, true);
  assert.ok(parsed.content?.[0]?.text);
  assert.ok(parsed.structuredContent?.quick_assessment?.conclusion);
  assert.equal(parsed.structuredContent?.data?.complete, true);
  const snapshot = parsed.structuredContent.data.source_snapshot;
  assert.equal(snapshot.source.sha256, createHash("sha256").update(beforeText).digest("hex"));

  const fixes = await client.callTool({ name: "suggest_config_fixes", arguments: {
    ...parsed.structuredContent.data.normalized_config,
    source_snapshot: snapshot,
    policy: { locked_fields: ["cluster.total_ranks", "parallel.ep"], objective: "minimal-change" },
  } });
  assert.notEqual(fixes.isError, true);
  assert.equal(fixes.structuredContent?.data?.solved, true);
  assert.deepEqual(fixes.structuredContent?.data?.suggestions?.[0]?.changes?.map(({ path }) => path), ["parallel.tp"]);

  const review = await client.callTool({ name: "review_config_change", arguments: {
    schema_version: "1.0", rule_profile: ruleProfile,
    before: { source: source(beforeText) }, after: { source: source(afterText) },
    expected_before_sha256: snapshot.source.sha256,
    locked_fields: ["cluster.total_ranks", "parallel.ep"],
    expected_changes: [{ path: "parallel.tp", old_value: 3, new_value: 2 }],
  } });
  assert.notEqual(review.isError, true);
  assert.equal(review.structuredContent?.status, "valid");
  assert.equal(review.structuredContent?.data?.candidate_match, true);
  assert.equal(review.structuredContent?.data?.locked_field_changes?.length, 0);
  assert.equal(review.structuredContent?.data?.validation?.status, "valid");

  console.log(JSON.stringify({ tools: tools.length, short_answer: true,
    source_snapshot: true, fix_candidate: true, review: "valid", locked_fields_preserved: true }));
} finally {
  await client.close();
}
