import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  computeRankTopology,
  estimateTrainingCapacity,
  suggestConfigFixes,
  validateParallelConfig,
} from "@mindspeed-config/config-core";
import {
  assertToolResult,
  assertTrainingConfig,
  toolResultSchema,
  trainingConfigSchema,
} from "@mindspeed-config/contracts";

const inputSchema = z.fromJSONSchema(trainingConfigSchema);
const outputSchema = z.fromJSONSchema(toolResultSchema);

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "validate_parallel_config",
    title: "校验 MindSpeed 并行配置",
    description: "校验层数、注意力头、TP/PP/CP/EP/VPP、专家切分和总 Rank 等静态约束。不启动训练。",
    run: validateParallelConfig,
  },
  {
    name: "compute_rank_topology",
    title: "计算 Rank 拓扑",
    description: "按页面口径计算每个 Rank 的节点、PP Stage、TP/DP/CP/EP 坐标和通信组。结果标记为 page-derived。",
    run: computeRankTopology,
  },
  {
    name: "suggest_config_fixes",
    title: "生成配置修复建议",
    description: "在不修改 locked_fields 的前提下搜索最小配置差异，返回经过全部静态规则复验的候选方案。",
    run: suggestConfigFixes,
  },
  {
    name: "estimate_training_capacity",
    title: "估算训练容量",
    description: "估算各 PP Stage 的权重、梯度、优化器、激活和运行时预留显存。结果为 theoretical，不是实测峰值。",
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
  return JSON.stringify(result);
}

function runTool(definition, args) {
  const input = assertTrainingConfig(args);
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
    server.registerTool(definition.name, {
      title: definition.title,
      description: definition.description,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async (args) => runTool(definition, args));
  }

  return server;
}

export { TOOL_DEFINITIONS };

