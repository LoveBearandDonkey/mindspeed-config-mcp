import { estimateTrainingCapacity } from "./estimate-training-capacity.js";
import { diagnostic, toolResult } from "./result.js";
import { validateParallelConfig } from "./validate-parallel-config.js";

const POLICY_SOURCE = "mindspeed-config-mcp:packages/config-core/src/analyze-performance-evidence.js@0.1.0";

const HYPOTHESES = Object.freeze({
  communication: {
    code: "PERF_COMMUNICATION_CONFIG_HYPOTHESIS",
    fields: ["parallel.tp", "parallel.cp", "parallel.ep", "parallel.dp"],
    hypothesis: "并行通信组与瓶颈有关，值得比较切分策略。",
    experiment: "保持模型、Global Batch 和 NPU 总数不变，每次只比较一种通过静态校验的并行切分；记录通信占比和 step time。",
    verification_metric: "目标 NPU 上的通信占比与 step time",
  },
  "pipeline-bubble": {
    code: "PERF_PIPELINE_CONFIG_HYPOTHESIS",
    fields: ["parallel.pp", "parallel.num_layer_list", "batch.micro_batch_count"],
    hypothesis: "PP 分层或 micro batch count 可能影响流水线空泡。",
    experiment: "核对各 Stage 的实际耗时与空泡比例，再比较经过静态校验的 PP 分层或 micro batch count。",
    verification_metric: "各 Stage 耗时、空泡比例与 step time",
  },
  memory: {
    code: "PERF_MEMORY_CONFIG_HYPOTHESIS",
    fields: ["cluster.card_memory_gib", "memory.shard_mode", "memory.recompute_mode"],
    hypothesis: "显存压力可能限制可用的批量或重计算策略。",
    experiment: "对照实测峰值与理论容量，再比较经过静态校验的分片或重计算方案。",
    verification_metric: "实测峰值显存、OOM 记录与 step time",
  },
});

export function analyzePerformanceEvidence(input) {
  const config = input.observed_config;
  const validation = validateParallelConfig(config);
  const capacity = validation.status === "valid" ? estimateTrainingCapacity(config) : null;
  const bottleneck = input.evidence.bottleneck;
  const template = HYPOTHESES[bottleneck];
  const hypothesis = template ? {
    ...template,
    classification: "experiment-only",
    supporting_evidence: input.evidence.summary,
    source_ref: POLICY_SOURCE,
    caveat: "瓶颈类别由调用方提供；静态检查不能证明性能归因或提速。",
  } : null;
  const nonConfigCauses = [...new Set([
    ...(input.evidence.non_config_causes ?? []),
    ...(bottleneck === "data-input" ? ["数据读取、预处理或输入流水线"] : []),
    ...(bottleneck === "compute" ? ["算子实现、编译、数据类型或硬件利用率"] : []),
    ...(bottleneck === "unknown" ? ["计算、通信、数据输入和环境均需 Profiling 区分"] : []),
  ])];
  const validationCodes = validation.errors.map(({ code }) => code);
  const capacitySummary = capacity?.status === "estimated" ? {
    confidence: "theoretical",
    bottleneck_stage: capacity.data.bottleneck_stage,
    bottleneck_level: capacity.data.bottleneck_level,
    bottleneck_gib: capacity.data.stages[capacity.data.bottleneck_stage]?.total_gib ?? null,
    source_ref: "packages/config-core/src/estimate-training-capacity.js",
  } : null;
  return toolResult({
    tool: "analyze_performance_evidence",
    input: config,
    status: validationCodes.length ? "invalid" : "estimated",
    errors: validationCodes.length ? [diagnostic("PERF_CONFIG_STATIC_INVALID",
      "本次运行配置未通过已建模静态规则，先核对实际运行配置是否一致。",
      validation.errors.flatMap(({ fields }) => fields).slice(0, 10), "compatibility-gap", POLICY_SOURCE)] : [],
    warnings: [diagnostic("PERF_CAUSALITY_UNVERIFIED",
      "性能瓶颈类别是外部证据摘要；此工具只关联配置检查，调参收益仍需实测。",
      [], "compatibility-gap", POLICY_SOURCE)],
    assumptions: ["observed_config 是本次运行实际使用的配置。", "瓶颈类别由调用方依据 Profiling 或日志确定。"],
    confidence: "model-informed",
    data: {
      evidence: input.evidence,
      config_check: {
        status: validation.status,
        error_codes: validationCodes,
        warning_codes: validation.warnings.map(({ code }) => code),
        source_refs: validation.errors.map(({ source_ref }) => source_ref).filter(Boolean),
      },
      capacity: capacitySummary,
      hypotheses: hypothesis ? [hypothesis] : [],
      non_config_causes: nonConfigCauses,
      attribution: "unverified",
      policy_source: POLICY_SOURCE,
    },
  });
}
