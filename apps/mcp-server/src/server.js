import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  computeRankTopology,
  estimateTrainingCapacity,
  parseTrainingConfig,
  reviewConfigChange,
  suggestConfigFixes,
  validateParallelConfig,
} from "@mindspeed-config/config-core";
import {
  assertToolResult,
  assertParseTrainingConfig,
  assertReviewConfigChange,
  assertTrainingConfig,
  parseTrainingConfigSchema,
  reviewConfigChangeSchema,
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
const reviewInputSchema = z.fromJSONSchema(reviewConfigChangeSchema);
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
    description: "校验并行度、Hybrid/Adaptive CP、MC2/CoC、AMPipe、2D TP、ND MatMul、MoE overlap 等静态约束，并返回硬件适用的非阻塞策略建议。不启动训练。",
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
    description: "解析 YAML、JSON 或 Shell 训练配置，并可联动解析独立模型结构文件；显式返回来源冲突、未识别和缺失字段，并为缺口生成经过完整静态复验与理论容量门禁的候选方案。不启动训练。",
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
  {
    name: "review_config_change",
    title: "复查源配置修改",
    description: "比较修改前后实际读取的训练配置文本摘要和已映射字段，检查 locked_fields 与预期候选差异，并按修改后内容重新静态校验。不读取服务器文件、不写文件、不启动训练。",
    inputSchema: reviewInputSchema,
    assertInput: assertReviewConfigChange,
    run: reviewConfigChange,
    modelOnly: true,
  },
]);

const UI_TOOL_DEFINITIONS = TOOL_DEFINITIONS.filter(({ modelOnly }) => !modelOnly);

const LAUNCHER_DEFINITIONS = Object.freeze([
  {
    name: WORKBENCH_TOOL_NAME,
    title: "打开中文配置工作台",
    description: "打开统一中文工作台，自主导入、填写和分析训练配置。无需填写宿主生成的 JSON 表单。",
    targetTool: null,
  },
  ...UI_TOOL_DEFINITIONS.map((definition) => ({
    name: `open_${definition.name}`,
    title: `打开${definition.title}`,
    description: `打开自定义中文输入界面，再调用 ${definition.name}。无需填写宿主生成的 JSON 表单。`,
    targetTool: definition.name,
  })),
]);

function summaryOf(result) {
  const brief = result.quick_assessment;
  const priority = brief.evidence[0];
  return [brief.conclusion,
    priority ? `首要依据：${priority.message}（${priority.code}；${priority.source_ref}）。` : "",
    `下一步：${brief.next_step}`,
    brief.limitation,
  ].filter(Boolean).join(" ");
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
          analysis_tools: UI_TOOL_DEFINITIONS.map(({ name }) => name),
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
        ui: { visibility: definition.modelOnly ? ["model"] : ["model", "app"] },
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
