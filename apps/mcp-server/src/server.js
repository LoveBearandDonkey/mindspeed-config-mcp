import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { randomUUID } from "node:crypto";
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
const SERVER_INSTRUCTIONS = "快速检查训练脚本和模型配置时，Agent 先读取用户指定的文件内容，再调用当前 MCP 连接的 parse_training_config；检查返回的 data.mcp_invocation，不把本地计算或健康检查写成 V2 MCP 已调用。面向用户时须按 data.dialogue 的四章组织：读取总数、已映射数与分析缺口；问题及其约束判断表；0～3 个排序方案与推荐理由表；缺口及补齐后的检查范围。结尾依 follow_up 提问：0 个方案只索取缺失信息，1 个询问是否采用，多个请回复序号。依 tool_readiness 决定是否继续并行、Rank 与理论容量检查；未经授权不改源文件。";

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
    description: "用户要求快速检查已保存的训练脚本和模型配置时，先由 Agent 读取实际文件文本，再调用当前连接的本工具；不得把本地解析或健康检查冒充本次 V2 MCP 调用。用户答复须按 data.dialogue 的四章呈现：读取总数、已映射数与缺口；问题及约束判断表；0～3 个排序方案与推荐理由表；缺失配置与继续检查范围。结尾按 follow_up 提问，0 个方案不得要求选方案。先查看 tool_readiness，未就绪时不调用并行、Rank 或容量工具；仅要结论时无需打开页面。不读取服务器文件、不启动训练。",
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

function tableCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

function issueRuleCell(issue) {
  const source = issue.source_ref?.startsWith("https://")
    ? ` [依据](${issue.source_ref})`
    : "";
  return tableCell(`${issue.constraint}${source}`);
}

function parseDialogueText(result) {
  const dialogue = result.data.dialogue;
  const { overview, issues, solutions, solution_note: solutionNote, completion, follow_up: followUp } = dialogue;
  const parsed = overview.parse_status === "succeeded" ? "解析成功" : "解析失败";
  const lines = [
    "## 1. 文件与检查范围",
    `${parsed}：读取 ${overview.source_count} 份文件、共 ${overview.read_field_count} 项配置；${overview.mapped_field_count} 项纳入本次字段解析与对照，完整训练诊断还缺 ${overview.missing_required_count} 项必需配置。`,
    "本轮仅完成解析与来源对照；字段纳入分析不表示已通过并行、Rank 或容量校验。",
    "",
    "## 2. 发现的问题与差异",
  ];
  if (issues.length) {
    const blockedCount = issues.filter((issue) => issue.severity === "blocked").length;
    lines.push(blockedCount
      ? `已确认 ${blockedCount} 项解析或静态阻断；其余差异仍需核对。`
      : `已覆盖的字段中没有可确认的训练阻断项；有 ${issues.length} 项差异待核对。`);
    lines.push("| 结论 | 配置事实 | 规则或约束判断 |", "| --- | --- | --- |");
    for (const issue of issues) lines.push(
      `| ${issue.severity === "blocked" ? "阻断" : "待核对"} | ${tableCell(`${issue.locations.join("、")}：${issue.finding}`)} | ${issueRuleCell(issue)} |`
    );
  } else {
    lines.push("在已覆盖的字段中，暂未发现可确认的阻断项或跨来源差异。");
  }
  lines.push("", "## 3. 处理方案（按推荐顺序）");
  if (solutions.length) {
    lines.push("| 排序 | 解决方案 | 推荐理由与验证范围 |", "| --- | --- | --- |");
    for (const solution of solutions) {
      const capacity = solution.capacity_estimate_gib !== null && solution.card_capacity_gib !== null
        ? `；理论显存 ${solution.capacity_estimate_gib}/${solution.card_capacity_gib} GiB`
        : `；容量依据：${solution.capacity_basis}`;
      lines.push(`| ${solution.number} | ${tableCell(solution.title)} | ${tableCell(`${solution.reason} ${solution.ranking_reason} ${solution.validation}`)}${capacity}${solution.requires_confirmation ? "；占位值需确认" : ""} |`);
    }
  } else {
    lines.push("可推荐方案：0 个。", "| 排序 | 解决方案 | 推荐理由 |", "| --- | --- | --- |", `| — | 暂无可推荐改动 | ${tableCell(solutionNote)} |`);
  }
  lines.push("", "## 4. 补全后可继续检查");
  if (completion.missing_groups.length) {
    lines.push(`还缺 ${overview.missing_required_count} 项完整分析所需配置：`);
    for (const group of completion.missing_groups) lines.push(
      `- ${group.label} ${group.count} 项：${group.fields.slice(0, 4).join("、")}${group.count > 4 ? " 等" : ""}。`
    );
  } else {
    lines.push("完整分析所需字段已具备，可按实际问题继续调用就绪的校验工具。");
  }
  const unavailable = completion.tool_readiness.filter((item) => !item.ready).map((item) => item.label);
  if (unavailable.length) lines.push(`目前不能完成：${unavailable.join("、")}；补齐相关字段后才能继续。`);
  if (completion.shell_fragment) lines.push("当前 Shell 文件是参数片段；实际启动命令可能在外层脚本中。");
  if (completion.unmapped_count) lines.push(
    `另有 ${completion.unmapped_count} 项原始字段尚未纳入统一映射；这不等于这些字段有错。`
  );
  if (completion.unverified_architecture_fields.length) lines.push(
    `${completion.unmapped_count ? "其中" : "另有"} ${completion.unverified_architecture_fields.length} 项专用架构字段尚未进入统一静态规则，需结合实际框架版本核对。`
  );
  if (followUp.prompt) lines.push("", `下一步：${followUp.prompt}`);
  else lines.push("", "下一步：如需确认实际可运行性，请在目标环境复核。");
  return lines.join("\n");
}

function runTool(definition, args) {
  const input = definition.assertInput(args);
  const result = definition.run(input);
  assertToolResult(result);
  if (definition.name === "parse_training_config") {
    result.data.mcp_invocation = {
      server: "mindspeed-config-mcp",
      tool: definition.name,
      request_id: randomUUID(),
    };
  }
  return {
    content: [{ type: "text", text: definition.name === "compose_analysis_report"
      ? `${result.data.markdown}\n\n${summaryOf(result)}`
      : definition.name === "parse_training_config" ? parseDialogueText(result) : summaryOf(result) }],
    structuredContent: result,
  };
}

export function createMcpServer({ webWorkbenchUrl = null } = {}) {
  const server = new McpServer({ name: "mindspeed-config-mcp", version: "0.1.0" }, {
    instructions: SERVER_INSTRUCTIONS,
  });

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
