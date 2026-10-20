import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { validateParallelConfig } from "@mindspeed-config/config-core";
import { validateTrainingConfig } from "@mindspeed-config/contracts";

import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";
import {
  APP_HTML_FILENAME_PATTERN,
  APP_RESOURCE_META,
  assertPackagedAppHtml,
  findPackagedAppHtmlUrl,
} from "../src/app-resource.js";
import { APP_RESOURCE_URI, createMcpServer } from "../src/server.js";
import {
  diffApplied,
  formatFillCoverageScore,
  missingFieldImpactRows,
  renderAppliedStatus,
  renderParseReport,
  toolReadinessForMissingFields,
  toPagePartial,
} from "../ui/src/mcp-parse-adapter.js";
import {
  capacityPressureFor,
  capacityModelEvidenceGaps,
  clearValidationMarks,
  clearValidationPresentation,
  createPagePresetContextTracker,
  isDismissibleValidationState,
  pageConfigToTrainingConfig,
  parseValidationSummary,
  pipelineSettingsForPreset,
  renderValidationConclusion,
  renderParseValidationDetails,
  validationMarks,
} from "../ui/src/mcp-validation-adapter.js";

const ANALYSIS_TOOLS = [
  "analyze_performance_evidence",
  "compose_analysis_report",
  "compute_rank_topology",
  "estimate_training_capacity",
  "parse_training_config",
  "plan_training_config",
  "review_config_change",
  "suggest_config_fixes",
  "validate_parallel_config",
];
const APP_LAUNCHERS = [
  "open_compute_rank_topology",
  "open_config_workbench",
  "open_estimate_training_capacity",
  "open_parse_training_config",
  "open_plan_training_config",
  "open_suggest_config_fixes",
  "open_validate_parallel_config",
];
const EXPECTED_TOOLS = [...ANALYSIS_TOOLS, ...APP_LAUNCHERS].sort();

const PARSE_INPUT = {
  schema_version: "1.0",
  rule_profile: { framework: "mindspeed-llm-mcore", version: "0.12.1" },
  source: {
    format: "shell",
    name: "train.sh",
    content: "python train.py --num-layers 32 --hidden-size 4096 --custom-flag 1",
  },
};

test("缺字段按 Tool 真实用途计算不可用范围", () => {
  const capacityOnly = toolReadinessForMissingFields(["model.vocab_size"]);
  assert.equal(capacityOnly.validate_parallel_config.ready, true);
  assert.equal(capacityOnly.compute_rank_topology.ready, true);
  assert.equal(capacityOnly.suggest_config_fixes.ready, true);
  assert.equal(capacityOnly.estimate_training_capacity.ready, false);

  const shared = toolReadinessForMissingFields(["parallel.tp", "model.vocab_size"]);
  assert.equal(shared.validate_parallel_config.ready, false);
  assert.deepEqual(shared.compute_rank_topology.missing_fields, ["parallel.tp"]);
  assert.deepEqual(shared.estimate_training_capacity.missing_fields, ["parallel.tp", "model.vocab_size"]);
  const rows = missingFieldImpactRows(["parallel.tp", "model.vocab_size"]);
  assert.deepEqual(rows[0].affected_tools.map(({ tool }) => tool), [
    "validate_parallel_config",
    "compute_rank_topology",
    "suggest_config_fixes",
    "estimate_training_capacity",
  ]);
  assert.deepEqual(rows[1].affected_tools.map(({ tool }) => tool), ["estimate_training_capacity"]);

  const layerTypeEvidence = toolReadinessForMissingFields(["model.first_k_dense_layers"]);
  assert.equal(layerTypeEvidence.validate_parallel_config.ready, true);
  assert.equal(layerTypeEvidence.compute_rank_topology.ready, false);
  assert.equal(layerTypeEvidence.estimate_training_capacity.ready, false);
});

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

test("MCP Server 注册九个计算 Tool 和七个可空输入的自定义界面入口", async () => {
  await withClient(async (client) => {
    const response = await client.listTools();
    const names = response.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, EXPECTED_TOOLS);
    assert.ok(response.tools.every((tool) => tool.inputSchema.type === "object"));
    assert.ok(response.tools.every((tool) => tool.outputSchema.type === "object"));
    for (const tool of response.tools) {
      if (APP_LAUNCHERS.includes(tool.name)) assert.equal(tool._meta?.ui?.resourceUri, APP_RESOURCE_URI);
      else {
        assert.equal(tool._meta?.ui?.resourceUri, undefined);
        assert.deepEqual(tool._meta?.ui?.visibility,
          ["review_config_change", "analyze_performance_evidence", "compose_analysis_report"].includes(tool.name)
            ? ["model"] : ["model", "app"]);
      }
    }
  });
});

test("计算 Tool 都返回简短结论和结构化结果", async () => {
  await withClient(async (client) => {
    for (const name of ANALYSIS_TOOLS) {
      const response = await client.callTool({
        name,
        arguments: name === "parse_training_config" ? PARSE_INPUT
          : name === "plan_training_config" ? { schema_version: "1.0", resources: { total_ranks: 64, card_memory_gib: 64 }, goal: "memory-safe" }
          : name === "analyze_performance_evidence" ? { schema_version: "1.0",
            observed_config: createTrainingConfig({ model: { first_k_dense_layers: 4 } }),
            evidence: { bottleneck: "unknown", summary: "尚未定位", source: "profile.json" } }
          : name === "compose_analysis_report" ? { schema_version: "1.0", project: "demo",
            source: { name: "train.sh", version_kind: "unknown" },
            analysis: validateParallelConfig(createTrainingConfig()) }
          : name === "review_config_change" ? {
            schema_version: "1.0",
            rule_profile: createTrainingConfig().rule_profile,
            before: { source: { format: "json", content: "{\"model_name\":\"m\"}" } },
            after: { source: { format: "json", content: "{\"model_name\":\"m2\"}" } },
          } : createTrainingConfig(),
      });

      assert.notEqual(response.isError, true, name);
      assert.equal(response.structuredContent.tool, name);
      assert.equal(response.content[0].type, "text");
      assert.ok(response.content[0].text.length > 0);
      assert.match(response.content[0].text, /下一步：/);
      assert.ok(response.structuredContent.quick_assessment.conclusion);
      if (name === "parse_training_config") {
        const sections = response.content[0].text;
        assert.equal(response.structuredContent.data.mcp_invocation.tool, "parse_training_config");
        assert.match(response.structuredContent.data.mcp_invocation.request_id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.match(sections, /## 1\. 文件与检查范围/);
        assert.match(sections, /## 2\. 发现的问题与差异/);
        assert.match(sections, /## 3\. 处理方案/);
        assert.match(sections, /## 4\. 补全后可继续检查/);
        assert.ok(response.structuredContent.data.dialogue.solutions.length <= 3);
      }
    }
  });
});

test("GPT OSS 片段的 MCP 文本直接展示两项待核对差异和零个可推荐改动", async () => {
  await withClient(async (client) => {
    const response = await client.callTool({
      name: "parse_training_config",
      arguments: {
        schema_version: "1.0",
        rule_profile: { framework: "generic", version: "unknown" },
        source: {
          format: "shell", name: "model.sh",
          content: 'MODEL_ARGS=" --num-layers 24 --hidden-size 2880 --max-position-embeddings 40960 --moe-aux-loss-coeff 0.0 "',
        },
        model_source: {
          format: "json", name: "config.json",
          content: JSON.stringify({ model_type: "gpt_oss", num_hidden_layers: 24,
            hidden_size: 2880, max_position_embeddings: 131072, router_aux_loss_coef: 0.9 }),
        },
      },
    });
    const text = response.content[0].text;
    assert.equal(response.structuredContent.data.dialogue.issues.length, 2);
    assert.equal(response.structuredContent.data.dialogue.solutions.length, 0);
    assert.match(text, /model\.sh:max-position-embeddings/);
    assert.match(text, /config\.json:router_aux_loss_coef/);
    assert.match(text, /尚未证实|不能据此判为训练阻断/);
    assert.match(text, /已覆盖的字段中没有可确认的训练阻断项；有 2 项差异待核对/);
    assert.match(text, /可推荐方案：0 个。缺少已确认的框架和设备条件/);
    assert.match(text, /下一步：请提供实际启动脚本/);
  });
});

test("suggest_config_fixes 为缺少 num_layer_list 的动态 PP 返回可应用分层", async () => {
  await withClient(async (client) => {
    const input = createTrainingConfig({
      rule_profile: {
        framework: "mindspeed-llm-mcore",
        version: "master@7826e88",
        source_commit: "7826e883ab40f06dd54f0fa2ce6508d18036843c",
      },
      model: { total_layers: 46 },
      parallel: {
        pp: 4,
        dp: 2,
        pipeline_layer_mode: "dynamic",
      },
    });
    const response = await client.callTool({
      name: "suggest_config_fixes",
      arguments: input,
    });

    assert.notEqual(response.isError, true);
    assert.equal(response.structuredContent.data.solved, true);
    assert.deepEqual(
      response.structuredContent.data.suggestions[0].proposed_config.parallel.num_layer_list,
      [12, 12, 11, 11],
    );
  });
});

test("中文配置工作台无需输入 JSON 即可打开", async () => {
  await withClient(async (client) => {
    const response = await client.callTool({ name: "open_config_workbench", arguments: {} });
    assert.notEqual(response.isError, true);
    assert.equal(response.structuredContent.tool, "open_config_workbench");
    assert.equal(response.structuredContent.status, "ready");
    assert.equal(response.structuredContent.data.target_tool, null);
  });
});

test("Agent 已读取的配置和目标能原样交给同一个 MCP App 界面", async () => {
  await withClient(async (client) => {
    const source = {
      name: "train.sh",
      content: "python train.py --tensor-model-parallel-size 2",
      model_source: { name: "config.json", content: '{"hidden_size":4096}' },
    };
    const response = await client.callTool({
      name: "open_config_workbench",
      arguments: { objective: "检查并行配置", source },
    });
    assert.notEqual(response.isError, true);
    assert.equal(response.structuredContent.data.objective, "检查并行配置");
    assert.deepEqual(response.structuredContent.data.source, source);
    assert.equal(response.structuredContent.data.target_tool, null);
  });
});

test("六个分析页面入口无需宿主表单并指向对应 Schema Tool", async () => {
  await withClient(async (client) => {
    for (const analysisTool of ANALYSIS_TOOLS.filter((name) =>
      APP_LAUNCHERS.includes(`open_${name}`))) {
      const response = await client.callTool({ name: `open_${analysisTool}`, arguments: {} });
      assert.notEqual(response.isError, true, analysisTool);
      assert.equal(response.structuredContent.tool, "open_config_workbench");
      assert.equal(response.structuredContent.data.target_tool, analysisTool);
    }
  });
});

test("MCP App 资源可读取且为单文件 HTML", async () => {
  await withClient(async (client) => {
    const listed = await client.listResources();
    const listedApp = listed.resources.find((resource) => resource.uri === APP_RESOURCE_URI);
    assert.ok(listedApp);
    assert.deepEqual(listedApp._meta?.ui, APP_RESOURCE_META);

    const response = await client.readResource({ uri: APP_RESOURCE_URI });
    assert.equal(response.contents.length, 1);
    assert.equal(response.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(response.contents[0]._meta?.ui, APP_RESOURCE_META);
    const packagedUrl = await findPackagedAppHtmlUrl();
    assert.match(fileURLToPath(packagedUrl).split(/[\\/]/u).at(-1), APP_HTML_FILENAME_PATTERN);
    const packagedHtml = await fs.readFile(packagedUrl, "utf8");
    assert.equal(response.contents[0].text, packagedHtml);
    assert.equal(assertPackagedAppHtml(response.contents[0].text), packagedHtml);
    assert.match(response.contents[0].text, /MindSpeed Config MCP/);
    assert.match(response.contents[0].text, /Config &amp; Relation Observer/);
    assert.match(response.contents[0].text, /导入配置/);
    assert.match(response.contents[0].text, /配置寻优/);
    assert.match(response.contents[0].text, /hf_mixtral_config\.json/);
    assert.match(response.contents[0].text, /croObserver/);
    assert.match(response.contents[0].text, /mcpWorkbench/);
    assert.match(response.contents[0].text, /parse_training_config/);
    assert.match(response.contents[0].text, /data-mcp-parse-report/);
    assert.match(response.contents[0].text, /mixtral_8x7b\.sh/);
    assert.match(response.contents[0].text, /mcp-config-import-row/);
    assert.match(response.contents[0].text, /croImportClear/);
    assert.match(response.contents[0].text, /配置输入/);
    assert.doesNotMatch(response.contents[0].text, /mcpImportCodeTitle/);
    assert.match(response.contents[0].text, /校验结果/);
    assert.match(response.contents[0].text, /mcpPreview/);
    assert.match(response.contents[0].text, /local-core/);
    assert.match(response.contents[0].text, /关闭导入配置/);
    assert.match(response.contents[0].text, /mcpImportModelText/);
    assert.match(response.contents[0].text, /mcpImportScore/);
    assert.match(response.contents[0].text, /可回填/);
    assert.match(response.contents[0].text, /MCP 校验必填项/);
    assert.match(response.contents[0].text, /MCP缺口配置推荐补齐方案/);
    assert.match(response.contents[0].text, /MCP缺口（/);
    assert.match(response.contents[0].text, /mcp-completion-plan__cards/);
    assert.match(response.contents[0].text, /核对并应用/);
    assert.match(response.contents[0].text, /计算中… MCP 正在解析当前代码并求解完整候选/);
    assert.match(response.contents[0].text, /aria-busy/);
    assert.match(response.contents[0].text, /原配置与补填项合并后的完整配置/);
    assert.match(response.contents[0].text, /已通过 MCP 规则检查/);
    assert.match(response.contents[0].text, /理论显存预计超限/);
    assert.match(response.contents[0].text, /mcp-completion-capacity-status/);
    assert.match(response.contents[0].text, /mcp-completion-plan__capacity/);
    assert.match(response.contents[0].text, /静态安全兜底方案/);
    assert.match(response.contents[0].text, /MCP 已列出缺失项和冲突项/);
    assert.doesNotMatch(response.contents[0].text, /当前没有通过完整静态复验的候选，暂不可应用/);
    assert.match(response.contents[0].text, /mcp-missing-pane/);
    assert.match(response.contents[0].text, /MutationObserver/);
    assert.match(response.contents[0].text, /validate_parallel_config/);
    assert.match(response.contents[0].text, /配置合法，符合已建模的数学约束/);
    assert.match(response.contents[0].text, /mcpValidationConclusion/);
    assert.match(response.contents[0].text, /is-mcp-invalid/);
    assert.match(response.contents[0].text, /<script type="module"/);
    assert.doesNotMatch(response.contents[0].text, /<link rel="stylesheet" href=/);
    assert.doesNotMatch(response.contents[0].text, /<script src=/);
  });
});

test("4174 独立预览先构建并直接服务与 MCP Resource 相同的生产产物", async () => {
  const rootPackage = JSON.parse(await fs.readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  const previewScript = rootPackage.scripts["preview:adapted-ui"];
  assert.match(previewScript, /^npm run build:ui && vite preview /);
  assert.match(
    previewScript,
    /\/training-run-twin-standalone\/config-relation-plane-mindspeed-config-mcp\.html\?preview=1/,
  );
  assert.match(rootPackage.scripts["dev:adapted-ui"], /^vite --config /);
});

test("导入配置后重新应用页面预设会清理导入配置留下的 PP 上下文", () => {
  const applied = [];
  const tracker = createPagePresetContextTracker((presetId) => applied.push(presetId));

  tracker.prime({ configPreset: "cinnnnnndy" });
  assert.equal(tracker.observe({ configPreset: null }), false);
  assert.equal(tracker.observe({ configPreset: null }), false);
  assert.equal(tracker.observe({ configPreset: "cinnnnnndy" }), true);
  assert.deepEqual(applied, ["cinnnnnndy"]);
  assert.equal(tracker.observe({ configPreset: "cinnnnnndy" }), false);
});

test("内置页面预设显式携带 PP 分层输入，不在浏览器中临时推导", () => {
  assert.deepEqual(pipelineSettingsForPreset("cinnnnnndy"), {
    mode: "dynamic",
    numLayerList: [12, 12, 11, 11],
    framework: "mindspeed-llm-mcore",
  });
  assert.deepEqual(pipelineSettingsForPreset("openpangu-default"), {
    mode: "dynamic",
    numLayerList: [12, 12, 11, 11],
    framework: "mindspeed-llm-mcore",
  });
  assert.deepEqual(pipelineSettingsForPreset("qwen2-7b-default"), {
    mode: "uniform",
    numLayerList: null,
    framework: "mindspeed-core",
  });
  assert.equal(pipelineSettingsForPreset("unknown"), null);
});

test("原页面表单可转换为校验 Tool 输入，结论包含公式并定位原字段", () => {
  const pageConfig = {
    model: "qwen2-7b",
    totalLayer: 28,
    dp: 2,
    pp: 4,
    tp: 1,
    cp: 1,
    ep: 1,
    vpp: 1,
    epMode: "split",
    cpMode: "ulysses",
    seqParallel: false,
    vocabEmbDp: true,
    expertTp: false,
    totalRank: 8,
    node: 1,
    card: "910b-64",
    microBatch: 1,
    seqLen: 4096,
    microBatchNum: 16,
    dtype: "bf16",
    paramsDtype: "bf16",
    recomputeMode: "full",
    recomputeLayers: 4,
    shardMode: "zero1",
    lora: false,
    loraRank: 16,
  };
  const topologyApi = {
    MODEL_PRESETS: {
      "qwen2-7b": {
        id: "qwen2-7b",
        noMoe: true,
        hidden: 3584,
        vocab: 152064,
        heads: 28,
        kvHeads: 4,
        denseIntermediate: 18944,
      },
    },
    derive: () => ({
      card: { label: "昇腾 910B", hbmGB: 64, ranksPerNode: 8 },
    }),
  };
  const input = pageConfigToTrainingConfig(pageConfig, topologyApi);

  assert.deepEqual(validateTrainingConfig(input), { valid: true, errors: [] });
  assert.equal(input.model.routed_experts, 0);
  assert.equal(input.model.top_k, 0);
  assert.equal(input.parallel.tp, 1);
  assert.equal(input.cluster.ranks_per_node, 8);
  assert.equal(input.batch.global_batch_size, undefined,
    "页面不应在 MCP 输入中额外生成本地批量公式结果");

  const editedStructure = pageConfigToTrainingConfig({
    ...pageConfig,
    hidden: 4096,
    heads: 32,
    kvHeads: 8,
    denseIntermediate: 11008,
  }, topologyApi);
  assert.equal(editedStructure.model.hidden_size, 4096);
  assert.equal(editedStructure.model.num_attention_heads, 32);
  assert.equal(editedStructure.model.num_key_value_heads, 8);
  assert.equal(editedStructure.model.ffn_hidden_size, 11008);
  assert.deepEqual(validateTrainingConfig(editedStructure), { valid: true, errors: [] });

  const invalidHeadGroups = pageConfigToTrainingConfig({
    ...pageConfig,
    heads: 30,
    kvHeads: 8,
  }, topologyApi);
  assert.ok(validateParallelConfig(invalidHeadGroups).errors.some((item) => (
    item.code === "MODEL_ATTENTION_HEADS_DIVISIBLE_BY_KV_HEADS"
  )));

  const customMemory = pageConfigToTrainingConfig(
    { ...pageConfig, customCardMemoryGB: 56.5 },
    topologyApi,
  );
  assert.equal(customMemory.cluster.card_memory_gib, 56.5);

  const standardMemory = pageConfigToTrainingConfig(
    { ...pageConfig, customCardMemoryGB: null },
    topologyApi,
  );
  assert.equal(standardMemory.cluster.card_memory_gib, 64,
    "未填写自定义容量时应继续使用所选卡型的标准容量");

  const directUserValues = pageConfigToTrainingConfig(
    { ...pageConfig, seqLen: 1, totalRank: 3, customCardMemoryGB: -1 },
    topologyApi,
  );
  assert.equal(directUserValues.batch.sequence_length, 1,
    "页面不得把用户输入的 Seq Length 静默恢复为预设值");
  assert.equal(directUserValues.cluster.total_ranks, 3,
    "页面不得在 MCP 校验前自动配平 Total Rank");
  assert.equal(directUserValues.cluster.card_memory_gib, -1,
    "非法卡容量也必须原样交给 MCP Schema 判定");
  assert.equal(validateTrainingConfig(directUserValues).valid, false,
    "不符合契约的原始输入应由统一契约拒绝，而不是页面先行改写");

  const dynamic = pageConfigToTrainingConfig(
    { ...pageConfig, totalLayer: 46, pp: 4, dp: 2 },
    topologyApi,
    { mode: "dynamic", numLayerList: [12, 12, 11, 11] },
  );
  assert.equal(dynamic.rule_profile.framework, "mindspeed-llm-mcore");
  assert.deepEqual(dynamic.parallel.num_layer_list, [12, 12, 11, 11]);

  const advancedCp = pageConfigToTrainingConfig(
    { ...pageConfig, cpMode: "hybrid-adaptive" },
    topologyApi,
  );
  assert.equal(advancedCp.parallel.cp_mode, "hybrid-adaptive",
    "导入的高级 CP 模式不得在页面适配层静默折回 Ulysses");

  const unfilledDynamic = pageConfigToTrainingConfig(
    { ...pageConfig, totalLayer: 46, pp: 4, dp: 2 },
    topologyApi,
    { mode: "dynamic" },
  );
  assert.equal(unfilledDynamic.parallel.num_layer_list, undefined,
    "页面不得在 MCP 校验前自行生成动态 PP 分层");
  assert.equal(validateParallelConfig(unfilledDynamic).status, "invalid");

  const implicitPipelineMode = pageConfigToTrainingConfig(
    { ...pageConfig, totalLayer: 46, pp: 4, dp: 2 },
    topologyApi,
  );
  assert.equal(implicitPipelineMode.parallel.pipeline_layer_mode, "uniform",
    "没有来源或用户选择时不得按整除结果在页面自动切换动态 PP");
  assert.equal(implicitPipelineMode.parallel.num_layer_list, undefined);
  assert.equal(validateParallelConfig(implicitPipelineMode).status, "invalid");

  const unknownDenseModel = {
    ...input,
    model: { ...input.model, id: "imported-dense-model" },
  };
  assert.deepEqual(
    capacityModelEvidenceGaps(
      unknownDenseModel,
      new Set(["model.hidden_size"]),
      "qwen2-7b",
    ),
    ["model.vocab_size", "model.ffn_hidden_size"],
  );
  assert.deepEqual(capacityModelEvidenceGaps(input, new Set(), "qwen2-7b"), []);

  const result = {
    status: "invalid",
    errors: [{
      message: "注意力头 28 不能被 TP 8 整除。",
      fields: ["model.num_attention_heads", "parallel.tp"],
      formula: "num_attention_heads % tp === 0",
    }],
    warnings: [],
    assumptions: ["只校验已建模静态约束。"],
    data: { world_size: 64, ep_mode: "split" },
  };
  const html = renderValidationConclusion(result);
  assert.match(
    html,
    /cro-config-error__msg[\s\S]*?cro-config-error__title is-error">配置出错，图形未更新<\/b><\/p><section class="mcp-validation is-invalid"/,
  );
  assert.match(html, /注意力头 28 不能被 TP 8 整除。/);
  assert.doesNotMatch(html, /cro-config-error__frozen|图形已暂停更新|共发现/);
  assert.doesNotMatch(html, /静态校验未通过 · 1 个问题/);
  assert.doesNotMatch(html, /mcp-validation__eyebrow|MCP 静态校验/);
  assert.doesNotMatch(html, /mcp-validation__assumption/);
  assert.match(html, /num_attention_heads % tp === 0/);
  assert.deepEqual([...validationMarks(result)], [["heads", "invalid"], ["tp", "invalid"]]);

  const validHtml = renderValidationConclusion({
    status: "valid",
    errors: [],
    warnings: [],
    suggestions: [{
      code: "MINDSPEED_AUTO_SETTINGS_CP_SEARCH_SPACE",
      kind: "advisory",
      message: "按卡型裁剪 CP 候选。",
      applicable_hardware: ["昇腾 910B"],
      applicable_versions: ["MindSpeed 0.12.1"],
    }],
    assumptions: ["不代表实机运行通过。"],
    data: {
      world_size: 8,
      ep_mode: "split",
      pipeline_layer_mode: "dynamic",
      pipeline_stage_layers: [12, 12, 11, 11],
    },
  });
  assert.doesNotMatch(validHtml, /mcp-validation__eyebrow|mcp-validation__head/);
  assert.match(validHtml, /配置合法，符合已建模的数学约束/);
  assert.doesNotMatch(validHtml, /调优参考|建议处理/);
  assert.doesNotMatch(validHtml, /data-rule-code="MINDSPEED_AUTO_SETTINGS_CP_SEARCH_SPACE"/);
  assert.doesNotMatch(validHtml, /依据：|规则版本：|收益排序仍需 Profiling 或实测/);
  assert.doesNotMatch(validHtml, /mcp-validation__metrics|world size =|PP 分层 =|EP 口径 =/);
  assert.doesNotMatch(validHtml, /mcp-validation__offline/);
});

test("导入与预设横幅可展开同一份静态规则和策略建议", () => {
  const html = renderParseValidationDetails({
    errors: [{
      message: "MC2 与 CoC 不能同时启用。",
      formula: "!(use_ascend_mc2 && use_ascend_coc)",
    }],
    warnings: [{
      message: "当前页面口径与 MindSpeed 规则存在差异。",
      formula: "framework === mindspeed-llm-mcore",
    }],
    suggestions: [{
      code: "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE",
      kind: "advisory",
      confidence: "theoretical",
      message: "可评估 HCCL Buffer 自适应。",
      applicable_hardware: ["昇腾 NPU"],
      applicable_versions: ["MindSpeed 0.12.1"],
    }],
  });

  assert.doesNotMatch(html, /静态规则问题/);
  assert.match(html, /MC2 与 CoC/);
  assert.match(html, /mcp-validation__compatibility-section/);
  assert.match(html, /当前页面口径与 MindSpeed 规则存在差异/);
  assert.doesNotMatch(html, /<b>兼容性提醒<\/b>/);
  assert.doesNotMatch(html, /非阻塞策略建议/);
  assert.doesNotMatch(html, /data-rule-code="MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE"/);
  assert.doesNotMatch(html, /依据：|规则版本：/);

  assert.equal(
    parseValidationSummary({
      errors: [{}], warnings: [{}], suggestions: [{ kind: "suggestion" }, { kind: "advisory" }],
    }),
    "查看 1 条静态规则问题、1 条兼容性提醒与 1 条策略建议",
  );
  assert.equal(
    parseValidationSummary({ errors: [], warnings: [{}], suggestions: [] }),
    "查看 1 条兼容性提醒",
  );
  assert.equal(
    parseValidationSummary({ errors: [], warnings: [], suggestions: [{}, {}] }),
    "静态校验通过",
  );
});

test("容量偏满时才把未启用的 HCCL 自适应提升为建议处理", () => {
  const result = {
    status: "valid",
    errors: [],
    warnings: [],
    suggestions: [{
      code: "MINDSPEED_HCCL_GROUP_BUFFER_ADAPTIVE",
      kind: "advisory",
      message: "仅在显存偏满时评估。",
      data: {
        enabled: false,
        action: "试加 --hccl-group-buffer-adaptive。",
        impact_if_ignored: "配置仍然合法。",
        groups: { tp: 32, pp: 16 },
      },
    }],
  };
  const safe = renderValidationConclusion(result);
  assert.doesNotMatch(safe, /调优参考|HCCL|200 MiB/);
  assert.doesNotMatch(safe, /建议处理 · 1/);

  const tight = renderValidationConclusion(result, { capacityPressure: true });
  assert.match(tight, /建议处理 · 1/);
  assert.match(tight, /怎么做：/);
  assert.match(tight, /不处理：/);
  assert.match(tight, /tp 32 MiB · pp 16 MiB/);

  assert.equal(capacityPressureFor({
    THRESHOLD: { tight: 0.8 },
    measureShown: () => ({ ratio: 0.79 }),
    measureAll: () => [{ ratio: 0.95 }],
  }), false);
  assert.equal(capacityPressureFor({
    THRESHOLD: { tight: 0.8 },
    measureShown: () => ({ ratio: 0.81 }),
  }), true);
});

test("合法配置的兼容性提醒只渲染黄色分点而不重复标题", () => {
  const html = renderValidationConclusion({
    status: "valid",
    errors: [],
    warnings: [{ message: "页面规则与框架规则存在差异。" }],
    suggestions: [],
  });

  assert.match(html, /mcp-validation__warnings/);
  assert.match(html, /页面规则与框架规则存在差异/);
  assert.doesNotMatch(html, /<b>提醒<\/b>|<b>兼容性提醒<\/b>/);
});

test("重新校验时只清理 MCP 结论，不篡改页面自身的阻断和建议状态", () => {
  const classes = new Set([
    "cro-config-error",
    "is-blocking",
    "is-guidance",
    "is-warning",
    "is-mcp-invalid",
    "is-mcp-pending",
  ]);
  let conclusionRemoved = false;
  const container = {
    classList: {
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
    },
    querySelector(selector) {
      assert.equal(selector, "#mcpValidationConclusion");
      return { remove() { conclusionRemoved = true; } };
    },
  };

  clearValidationPresentation(container);

  assert.equal(conclusionRemoved, true);
  assert.deepEqual([...classes].sort(), [
    "cro-config-error",
    "is-blocking",
    "is-guidance",
    "is-warning",
  ]);
});

test("非阻塞校验提醒支持关闭并清除表单黄色标记", () => {
  assert.equal(isDismissibleValidationState("valid"), true);
  assert.equal(isDismissibleValidationState("warning"), true);
  assert.equal(isDismissibleValidationState("invalid"), false);

  const classes = new Set(["cro-stepper", "is-mcp-warning"]);
  const warningField = {
    classList: {
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
    },
    dataset: { mcpValidation: "MCP 静态校验提醒" },
  };
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, ".cro-stepper.is-mcp-invalid, .cro-stepper.is-mcp-warning");
      return [warningField];
    },
  };

  clearValidationMarks(root);

  assert.deepEqual([...classes], ["cro-stepper"]);
  assert.equal("mcpValidation" in warningField.dataset, false);
});

test("解析结果适配到原页面字段，并在原报告结构中区分映射来源", () => {
  const result = {
    tool: "parse_training_config",
    status: "valid",
    data: {
      detected_format: "yaml",
      explicit_mapped_count: 2,
      derived_count: 1,
      defaulted_count: 1,
      unmapped_count: 1,
      ignored_count: 0,
      normalized_config: {
        model: { total_layers: 32 },
        parallel: { tp: 4, sequence_parallel: true },
        cluster: { total_ranks: 16, ranks_per_node: 8 },
      },
      mapped_fields: [
        { source_key: "num_layers", target_path: "model.total_layers", value: 32, mapping_kind: "explicit" },
        { source_key: "hidden_size", target_path: "model.hidden_size", value: 4096, mapping_kind: "explicit" },
        { source_key: "tensor_model_parallel_size", target_path: "parallel.tp", value: 4, mapping_kind: "explicit" },
        { source_key: "world_size / parallel", target_path: "parallel.dp", value: 4, mapping_kind: "derived" },
        { source_key: "省略态", target_path: "parallel.vpp", value: 1, mapping_kind: "default" },
      ],
      unmapped_fields: [{ source_key: "custom_key", value: 1, reason: "没有已登记的字段映射" }],
      ignored_fields: [
        { source_key: "logging_steps", value: 10, reason: "不属于第一版统一训练配置契约" },
      ],
      missing_required_fields: ["batch.sequence_length"],
    },
  };

  assert.deepEqual(toPagePartial(result.data.normalized_config), {
    totalLayer: 32,
    tp: 4,
    seqParallel: true,
    totalRank: 16,
    node: 2,
  });
  assert.deepEqual(toPagePartial({
    model: {
      hidden_size: 4096,
      num_attention_heads: 32,
      num_key_value_heads: 8,
      ffn_hidden_size: 11008,
      expert_ffn_hidden_size: 2048,
    },
  }), {
    hidden: 4096,
    heads: 32,
    kvHeads: 8,
    denseIntermediate: 11008,
    moeIntermediate: 2048,
  });
  const html = renderParseReport(result);
  assert.match(html, /已映射 · 原文显式值/);
  assert.match(html, /推导 · 由同一文件计算/);
  assert.match(html, /默认 · 配置方言省略态/);
  assert.match(html, /未识别 · 没有静默丢弃/);
  assert.match(html, /仍缺输入/);
  assert.match(html, /不启动训练/);
  assert.match(html, /Hidden Size[\s\S]*← hidden_size/);
  assert.doesNotMatch(html, /已进入统一配置，但当前页面没有对应旋钮，不自动覆盖页面。/);
  assert.doesNotMatch(html, /没有已登记的字段映射/);
  assert.doesNotMatch(html, /不属于第一版统一训练配置契约/);
});

test("应用结果明确区分原值落地与页面自动配平", () => {
  const success = renderAppliedStatus([]);
  assert.match(success, /配置已成功应用到表单/);
  assert.match(success, /所有可回填项均已写入/);
  assert.doesNotMatch(success, /查看页面采用值/);

  const adjusted = renderAppliedStatus([
    { field: "dp", want: 3, got: 4 },
  ]);
  assert.match(adjusted, /配置已应用，页面自动调整了 1 项/);
  assert.match(adjusted, /DP/);
  assert.match(adjusted, /输入 3 → 页面采用 4/);
  assert.match(adjusted, /<div class="mcp-import-applied__details"><ul>/);
  assert.doesNotMatch(adjusted, /<details|查看页面采用值|请核对差异|无需再次应用/);
});

test("当前并行度下无效的控件归一化不显示为页面自动调整", () => {
  const inactive = diffApplied(
    { vocabEmbDp: false, shardMode: "none" },
    { tp: 1, dp: 1, vocabEmbDp: true, shardMode: "zero1" },
  );
  assert.deepEqual(inactive, []);
  assert.match(renderAppliedStatus(inactive), /配置已成功应用到表单/);
  assert.doesNotMatch(renderAppliedStatus(inactive), /is-adjusted|自动调整/);

  assert.deepEqual(
    diffApplied(
      { vocabEmbDp: false, shardMode: "none" },
      { tp: 2, dp: 2, vocabEmbDp: true, shardMode: "zero1" },
    ),
    [
      { field: "vocabEmbDp", want: false, got: true },
      { field: "shardMode", want: "none", got: "zero1" },
    ],
  );
});

test("配置预览和导入弹窗共用固定 MCP 必填口径", () => {
  const result = {
    status: "valid",
    data: {
      source_field_count: 100,
      required_field_count: 70,
      filled_required_field_count: 23,
      mapped_fields: [
        {
          source_key: "num-layer-list",
          target_path: "parallel.num_layer_list",
          value: [12, 12, 11, 11],
          mapping_kind: "explicit",
        },
        {
          source_key: "检测到 num_layer_list",
          target_path: "parallel.pipeline_layer_mode",
          value: "dynamic",
          mapping_kind: "derived",
        },
      ],
      unmapped_fields: [],
    },
  };

  assert.equal(
    formatFillCoverageScore(result),
    "本文件共 100 个配置，其中 23 项可回填 MCP，缺口 47 项。MCP 校验必填项 23/70（补齐缺口后才能校验）",
  );
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

test("真实 stdio 子进程可以完成握手并枚举全部 Tool", async () => {
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
