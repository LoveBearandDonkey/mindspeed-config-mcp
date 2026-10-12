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

import {
  APP_RESOURCE_META,
  APP_RESOURCE_URI,
  loadPackagedAppHtml,
} from "./app-resource.js";

const trainingInputSchema = z.fromJSONSchema(trainingConfigSchema);
const parseInputSchema = z.fromJSONSchema(parseTrainingConfigSchema);
const outputSchema = z.fromJSONSchema(toolResultSchema);
const workbenchOutputSchema = z.object({
  tool: z.literal("open_config_workbench"),
  status: z.literal("ready"),
  data: z.object({
    analysis_tools: z.array(z.string()),
    target_tool: z.string().nullable(),
  }),
});
const WORKBENCH_TOOL_NAME = "open_config_workbench";

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
    description: "解析 YAML、JSON 或 Shell 训练配置，并可联动解析独立模型结构文件；显式返回来源冲突、未识别和缺失字段，并为缺口生成经过完整静态复验的候选方案。不启动训练。",
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

const LAUNCHER_DEFINITIONS = Object.freeze([
  {
    name: WORKBENCH_TOOL_NAME,
    title: "打开中文配置工作台",
    description: "打开统一中文工作台，自主导入、填写和分析训练配置。无需填写宿主生成的 JSON 表单。",
    targetTool: null,
  },
  ...TOOL_DEFINITIONS.map((definition) => ({
    name: `open_${definition.name}`,
    title: `打开${definition.title}`,
    description: `打开自定义中文输入界面，再调用 ${definition.name}。无需填写宿主生成的 JSON 表单。`,
    targetTool: definition.name,
  })),
]);

function summaryOf(result) {
  if (result.tool === "validate_parallel_config") {
    return result.data.valid
      ? `配置合法，符合已建模的数学约束；world size = ${result.data.world_size}。这不代表目标环境已经实机运行通过。`
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
    const planCount = result.data.completion?.plans?.length ?? 0;
    return `原文映射 ${result.data.explicit_mapped_count} 个字段，同文件推导 ${result.data.derived_count} 个，省略态默认 ${result.data.defaulted_count} 个；未识别 ${result.data.unmapped_count} 个，未被静默丢弃；生成 ${planCount} 个经过完整静态复验的补齐方案。`;
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

  for (const launcher of LAUNCHER_DEFINITIONS) {
    registerAppTool(server, launcher.name, {
      title: launcher.title,
      description: launcher.description,
      outputSchema: workbenchOutputSchema,
      _meta: {
        ui: { resourceUri: APP_RESOURCE_URI, visibility: ["model"] },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async () => ({
      content: [{ type: "text", text: launcher.targetTool
        ? `已打开${launcher.title.replace(/^打开/, "")}自定义输入界面。`
        : "已打开 MindSpeed 中文配置工作台。请在界面中上传或填写训练配置。" }],
      structuredContent: {
        tool: WORKBENCH_TOOL_NAME,
        status: "ready",
        data: {
          analysis_tools: TOOL_DEFINITIONS.map(({ name }) => name),
          target_tool: launcher.targetTool,
        },
      },
    }));
  }

  for (const definition of TOOL_DEFINITIONS) {
    registerAppTool(server, definition.name, {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema,
      _meta: {
        ui: { visibility: ["model", "app"] },
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
    description: "以上游配置关系平面为界面基线，采集或解析训练配置，并用三栏画布展示校验、Rank 拓扑、修复差异、字段映射和理论容量。",
    _meta: { ui: APP_RESOURCE_META },
  }, async () => ({
    contents: [{
      uri: APP_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await loadPackagedAppHtml(),
      _meta: { ui: APP_RESOURCE_META },
    }],
  }));

  return server;
}

const REGISTERED_TOOL_COUNT = TOOL_DEFINITIONS.length + LAUNCHER_DEFINITIONS.length;

export { APP_RESOURCE_URI, LAUNCHER_DEFINITIONS, REGISTERED_TOOL_COUNT, TOOL_DEFINITIONS, WORKBENCH_TOOL_NAME };
