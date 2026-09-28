import fs from "node:fs/promises";

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  computeRankTopology,
  estimateTrainingCapacity,
  parseTrainingConfig,
  suggestConfigFixes,
  validateParallelConfig,
} from "@mindspeed-config/config-core";
import {
  assertToolResult,
  assertParseTrainingConfig,
  assertTrainingConfig,
  parseTrainingConfigSchema,
  toolResultSchema,
  trainingConfigSchema,
} from "@mindspeed-config/contracts";

const trainingInputSchema = z.fromJSONSchema(trainingConfigSchema);
const parseInputSchema = z.fromJSONSchema(parseTrainingConfigSchema);
const outputSchema = z.fromJSONSchema(toolResultSchema);
const APP_RESOURCE_URI = "ui://mindspeed-config/result-view.html";
const APP_HTML_URL = new URL("../dist/ui/mcp-app.html", import.meta.url);

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "validate_parallel_config",
    title: "校验 MindSpeed 并行配置",
    description: "校验层数、注意力头、TP/PP/CP/EP/VPP、专家切分和总 Rank 等静态约束。不启动训练。",
    inputSchema: trainingInputSchema,
    assertInput: assertTrainingConfig,
    run: validateParallelConfig,
  },
  {
    name: "compute_rank_topology",
    title: "计算 Rank 拓扑",
    description: "按页面口径计算每个 Rank 的节点、PP Stage、TP/DP/CP/EP 坐标和通信组。结果标记为 page-derived。",
    inputSchema: trainingInputSchema,
    assertInput: assertTrainingConfig,
    run: computeRankTopology,
  },
  {
    name: "suggest_config_fixes",
    title: "生成配置修复建议",
    description: "在不修改 locked_fields 的前提下搜索最小配置差异，返回经过全部静态规则复验的候选方案。",
    inputSchema: trainingInputSchema,
    assertInput: assertTrainingConfig,
    run: suggestConfigFixes,
  },
  {
    name: "parse_training_config",
    title: "解析训练配置",
    description: "解析 YAML、JSON 或 Shell 启动参数，映射为统一配置，并显式返回未识别、已忽略和仍缺少的字段。不启动训练。",
    inputSchema: parseInputSchema,
    assertInput: assertParseTrainingConfig,
    run: parseTrainingConfig,
  },
  {
    name: "estimate_training_capacity",
    title: "估算训练容量",
    description: "估算各 PP Stage 的权重、梯度、优化器、激活和运行时预留显存。结果为 theoretical，不是实测峰值。",
    inputSchema: trainingInputSchema,
    assertInput: assertTrainingConfig,
    run: estimateTrainingCapacity,
  },
]);

function summaryOf(result) {
  if (result.tool === "validate_parallel_config") {
    return result.data.valid
      ? `从已建模的数学约束看，这个配置合法；world size = ${result.data.world_size}。这不代表目标环境已经实机运行通过。`
      : `配置未通过静态校验，共发现 ${result.errors.length} 个问题：${result.errors.map((item) => item.code).join("、")}。`;
  }
  if (result.tool === "compute_rank_topology") {
    return result.data.valid
      ? `已按 page-derived 口径生成 ${result.data.ranks.length} 个 Rank 和 ${result.data.stages.length} 个 PP Stage。`
      : "配置未通过静态校验，因此没有生成貌似可信的 Rank 矩阵。";
  }
  if (result.tool === "suggest_config_fixes") {
    if (result.data.already_valid) return "当前配置已经合法，不需要修改。";
    return result.data.solved
      ? `找到 ${result.data.suggestions.length} 个经过复验的修复方案，未修改 locked_fields。`
      : "在最多修改两个未锁定字段的搜索范围内没有找到合法方案。";
  }
  if (result.tool === "estimate_training_capacity") {
    if (!result.data.valid) return "配置未通过静态校验，因此没有生成容量数字。";
    const stage = result.data.stages[result.data.bottleneck_stage];
    return `理论瓶颈位于 Stage ${stage.stage}，估算 ${stage.total_gib.toFixed(1)} GiB，等级为 ${stage.level}；这不是实测峰值。`;
  }
  if (result.tool === "parse_training_config") {
    if (result.status === "error") return result.errors[0]?.message ?? "配置内容解析失败。";
    return `已识别 ${result.data.mapped_count} 个字段，未识别 ${result.data.unmapped_count} 个，忽略 ${result.data.ignored_count} 个；未识别字段没有被静默丢弃。`;
  }
  return JSON.stringify(result);
}

function runTool(definition, args) {
  const input = definition.assertInput(args);
  const result = definition.run(input);
  assertToolResult(result);
  return {
    content: [{ type: "text", text: summaryOf(result) }],
    structuredContent: result,
  };
}

export function createMcpServer() {
  const server = new McpServer({ name: "mindspeed-config-mcp", version: "0.1.0" });

  for (const definition of TOOL_DEFINITIONS) {
    registerAppTool(server, definition.name, {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema,
      _meta: {
        ui: { resourceUri: APP_RESOURCE_URI },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async (args) => runTool(definition, args));
  }

  registerAppResource(server, "MindSpeed 配置分析结果界面", APP_RESOURCE_URI, {
    description: "以校验卡片、Rank 表格、修复差异、字段映射和容量条形图展示五个 Tool 的结果。",
  }, async () => ({
    contents: [{
      uri: APP_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await fs.readFile(APP_HTML_URL, "utf8"),
      _meta: {
        ui: {
          csp: { connectDomains: [], resourceDomains: [] },
        },
      },
    }],
  }));

  return server;
}

export { APP_RESOURCE_URI, TOOL_DEFINITIONS };
