import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  analyzePerformanceEvidence,
  composeAnalysisReport,
  computeRankTopology,
  estimateTrainingCapacity,
  planTrainingConfig,
  parseTrainingConfig,
  reviewConfigChange,
  suggestConfigFixes,
  validateParallelConfig,
} from "@mindspeed-config/config-core";
import {
  assertAnalyzePerformanceEvidence,
  assertComposeAnalysisReport,
  assertToolResult,
  assertParseTrainingConfig,
  assertPlanTrainingConfig,
  assertReviewConfigChange,
  assertTrainingConfig,
  parseTrainingConfigSchema,
  planTrainingConfigSchema,
  reviewConfigChangeSchema,
  toolResultSchema,
  trainingConfigSchema,
} from "@mindspeed-config/contracts";

import {
  APP_RESOURCE_META,
  APP_RESOURCE_URI,
  loadPackagedAppHtml,
} from "./app-resource.js";
import { createWorkbenchHandoff } from "./workbench-handoff.js";

const trainingInputSchema = z.fromJSONSchema(trainingConfigSchema);
const parseInputSchema = z.fromJSONSchema(parseTrainingConfigSchema);
const planInputSchema = z.object({
  schema_version: z.literal("1.0"),
  resources: z.object({
    total_ranks: z.number().int().min(1),
    card_memory_gib: z.number().positive(),
    ranks_per_node: z.number().int().min(1).optional(),
    card_model: z.string().min(1).optional(),
  }),
  goal: z.enum(planTrainingConfigSchema.properties.goal.enum),
  base_config: trainingInputSchema.optional(),
  locked_fields: z.array(z.string().min(1)).optional(),
});
const performanceInputSchema = z.object({
  schema_version: z.literal("1.0"),
  observed_config: trainingInputSchema,
  evidence: z.object({
    bottleneck: z.enum(["communication", "compute", "pipeline-bubble", "memory", "data-input", "unknown"]),
    summary: z.string().min(1).max(2000),
    source: z.string().min(1).max(260),
    run_id: z.string().min(1).max(260).optional(),
    non_config_causes: z.array(z.string().min(1).max(300)).max(20).optional(),
  }),
});
const reviewInputSchema = z.fromJSONSchema(reviewConfigChangeSchema);
const outputSchema = z.fromJSONSchema(toolResultSchema);
const reportInputSchema = z.object({
  schema_version: z.literal("1.0"),
  project: z.string().min(1).max(260),
  source: z.object({
    name: z.string().min(1).max(260),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    version_kind: z.enum(["disk", "unsaved", "preset", "unknown"]),
  }),
  analysis: outputSchema,
  performance: outputSchema.optional(),
  review: outputSchema.optional(),
  candidate_changes: z.array(z.object({
    path: z.string().min(1), old_value: z.unknown(), new_value: z.unknown(),
  })).max(100).optional(),
});
const workbenchOutputSchema = z.object({
  tool: z.literal("open_config_workbench"),
  status: z.literal("ready"),
  data: z.object({
    analysis_tools: z.array(z.string()),
    target_tool: z.string().nullable(),
    objective: z.string().nullable(),
    source: z.object({
      name: z.string(),
      content: z.string(),
      model_source: z.object({ name: z.string(), content: z.string() }).nullable(),
    }).nullable(),
    web_url: z.string().nullable(),
  }),
});
const workbenchInputSchema = z.object({
  objective: z.string().max(500).optional(),
  source: z.object({
    name: z.string().min(1).max(260),
    content: z.string().min(1).max(1_000_000),
    model_source: z.object({
      name: z.string().min(1).max(260),
      content: z.string().min(1).max(1_000_000),
    }).optional(),
  }).optional(),
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
    name: "plan_training_config",
    title: "规划训练配置候选",
    description: "按用户资源与显存/流水线/最小改动目标规划已复验的候选；缺少模型和批量条件时明确返回缺口。候选容量是 theoretical，不预测吞吐、不写源文件。",
    inputSchema: planInputSchema,
    assertInput: assertPlanTrainingConfig,
    run: planTrainingConfig,
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
  {
    name: "analyze_performance_evidence",
    title: "关联性能瓶颈与配置证据",
    description: "由 Agent 传入本次运行实际配置及 Profiling/日志瓶颈摘要，返回静态检查、理论容量和待实测假设，保留非配置原因。不推断已提速。",
    inputSchema: performanceInputSchema,
    assertInput: assertAnalyzePerformanceEvidence,
    run: analyzePerformanceEvidence,
    modelOnly: true,
  },
  {
    name: "compose_analysis_report",
    title: "生成可交接分析报告",
    description: "把已有结构化分析、可选性能证据与修改复查结果汇总为 Markdown 和机器可读报告，区分候选差异与已复查文件差异。",
    inputSchema: reportInputSchema,
    assertInput: assertComposeAnalysisReport,
    run: composeAnalysisReport,
    modelOnly: true,
  },
]);

const UI_TOOL_DEFINITIONS = TOOL_DEFINITIONS.filter(({ modelOnly }) => !modelOnly);

const LAUNCHER_DEFINITIONS = Object.freeze([
  {
    name: WORKBENCH_TOOL_NAME,
    title: "打开中文配置工作台",
    description: "打开统一中文工作台。可选传入 Agent 已读取的训练配置文本、模型结构文本和分析目标，界面直接接收同一份输入；没有文件时也可在界面导入。无需填写宿主生成的 JSON 表单。",
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
    content: [{ type: "text", text: definition.name === "compose_analysis_report"
      ? `${result.data.markdown}\n\n${summaryOf(result)}` : summaryOf(result) }],
    structuredContent: result,
  };
}

export function createMcpServer({ webWorkbenchUrl = null } = {}) {
  const server = new McpServer({ name: "mindspeed-config-mcp", version: "0.1.0" });

  for (const launcher of LAUNCHER_DEFINITIONS) {
    registerAppTool(server, launcher.name, {
      title: launcher.title,
      description: launcher.description,
      inputSchema: workbenchInputSchema,
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
    }, async (args = {}) => {
      const source = args.source ? {
        name: args.source.name,
        content: args.source.content,
        model_source: args.source.model_source ?? null,
      } : null;
      const objective = args.objective ?? null;
      const handoff = { source, objective, target_tool: launcher.targetTool };
      const webUrl = webWorkbenchUrl
        ? (source || objective
          ? `${webWorkbenchUrl}#handoff=${createWorkbenchHandoff(handoff)}`
          : webWorkbenchUrl)
        : null;
      return {
        content: [{ type: "text", text: (launcher.targetTool
          ? `已打开${launcher.title.replace(/^打开/, "")}自定义输入界面。`
          : "已打开 MindSpeed 中文配置工作台。请在界面中上传或填写训练配置。")
          + (webUrl ? ` 独立 Web 入口：${webUrl}` : "") }],
        structuredContent: {
          tool: WORKBENCH_TOOL_NAME,
          status: "ready",
          data: {
            analysis_tools: UI_TOOL_DEFINITIONS.map(({ name }) => name),
            target_tool: launcher.targetTool,
            objective,
            source,
            web_url: webUrl,
          },
        },
      };
    });
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
