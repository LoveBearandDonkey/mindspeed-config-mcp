import { epInWorld, parallelWorld } from "./page-rules.js";
import { toolResult } from "./result.js";
import { estimateTrainingCapacity } from "./estimate-training-capacity.js";
import { validateParallelConfig } from "./validate-parallel-config.js";

const FIELD_LIMITS = Object.freeze({
  "parallel.dp": [1, 8192],
  "parallel.pp": [1, 128],
  "parallel.tp": [1, 64],
  "parallel.cp": [1, 64],
  "parallel.ep": [1, 1024],
  "parallel.vpp": [1, 128],
  "cluster.total_ranks": [1, 65536],
  "model.top_k": [0, 64],
});

const MAX_CHANGED_FIELDS = 4;
const MAX_RETURNED_SUGGESTIONS = 10;
const SCORE_FIELD_WEIGHT = 1000;
const SEARCH_BEAM_WIDTH = 256;

const OBJECTIVES = Object.freeze({
  "mindspeed-compatible": {
    label: "MindSpeed 合法优先",
    confidence: "deterministic",
    primary: "compatibility_warning_count",
  },
  "keep-current-resources": {
    label: "保持资源规模",
    confidence: "deterministic",
    primary: "total_rank_log2_distance",
  },
  "memory-safe": {
    label: "显存安全优先",
    confidence: "theoretical",
    primary: "bottleneck_memory_ratio",
  },
  "pipeline-balanced": {
    label: "流水线均衡优先",
    confidence: "theoretical",
    primary: "stage_memory_imbalance",
  },
});

const LEGACY_OBJECTIVES = Object.freeze({
  "minimal-change": "mindspeed-compatible",
  "fit-current-ranks": "keep-current-resources",
  "reduce-memory": "memory-safe",
  balanced: "pipeline-balanced",
});

function getAtPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function setAtPath(value, path, next) {
  const keys = path.split(".");
  let current = value;
  for (const key of keys.slice(0, -1)) current = current[key];
  current[keys.at(-1)] = next;
}

function isLocked(path, lockedFields) {
  const leaf = path.split(".").at(-1);
  return lockedFields.some((item) => item === path || item === leaf);
}

function powersOfTwo(min, max) {
  const values = [];
  for (let value = 1; value <= max; value *= 2) {
    if (value >= min) values.push(value);
  }
  return values;
}

function divisors(value, min, max) {
  const output = new Set();
  if (!Number.isInteger(value) || value <= 0) return output;
  for (let divisor = 1; divisor * divisor <= value; divisor += 1) {
    if (value % divisor !== 0) continue;
    if (divisor >= min && divisor <= max) output.add(divisor);
    const paired = value / divisor;
    if (paired >= min && paired <= max) output.add(paired);
  }
  return output;
}

function exactWorldCandidate(input, path) {
  const { parallel, cluster } = input;
  const includesEp = epInWorld(input) !== 1;
  const factors = {
    "parallel.dp": parallel.pp * parallel.tp * parallel.cp * (includesEp ? parallel.ep : 1),
    "parallel.pp": parallel.dp * parallel.tp * parallel.cp * (includesEp ? parallel.ep : 1),
    "parallel.tp": parallel.dp * parallel.pp * parallel.cp * (includesEp ? parallel.ep : 1),
    "parallel.cp": parallel.dp * parallel.pp * parallel.tp * (includesEp ? parallel.ep : 1),
    "parallel.ep": includesEp ? parallel.dp * parallel.pp * parallel.tp * parallel.cp : 0,
  };
  const factor = factors[path];
  if (!factor) return null;
  const value = cluster.total_ranks / factor;
  return Number.isInteger(value) ? value : null;
}

function valuesFor(input, path) {
  const [min, max] = FIELD_LIMITS[path];
  const current = getAtPath(input, path);
  const values = new Set(path === "model.top_k" ? [] : powersOfTwo(min, max));
  values.add(current);

  if (path === "parallel.pp" || path === "parallel.vpp") {
    for (const value of divisors(input.model.total_layers, min, max)) values.add(value);
  }
  if (path === "parallel.tp") {
    for (const value of divisors(input.model.num_attention_heads, min, max)) values.add(value);
    if (input.model.ffn_hidden_size) {
      for (const value of divisors(input.model.ffn_hidden_size, min, max)) values.add(value);
    }
  }
  if (path === "parallel.cp") {
    for (const value of divisors(input.batch.sequence_length, min, max)) values.add(value);
  }
  if (path === "parallel.ep") {
    for (const value of divisors(input.model.routed_experts, min, max)) values.add(value);
  }
  if (path === "cluster.total_ranks") values.add(parallelWorld(input));
  if (path === "model.top_k") {
    values.add(Math.min(input.model.top_k, input.model.routed_experts));
    values.add(input.model.routed_experts > 0 ? 1 : 0);
  }

  const exact = exactWorldCandidate(input, path);
  if (exact !== null) values.add(exact);
  return Array.from(values)
    .filter((value) => Number.isInteger(value) && value >= min && value <= max && value !== current)
    .sort((a, b) => a - b);
}

function editCost(oldValue, newValue) {
  if (oldValue > 0 && newValue > 0) return Math.abs(Math.log2(newValue / oldValue));
  return Math.abs(newValue - oldValue);
}

function applyEdits(input, edits) {
  const proposal = structuredClone(input);
  for (const edit of edits) setAtPath(proposal, edit.path, edit.new_value);
  return proposal;
}

function candidateKey(edits) {
  return edits.map((edit) => `${edit.path}=${edit.new_value}`).sort().join("|");
}

function candidateScore(edits) {
  return edits.length * SCORE_FIELD_WEIGHT + edits.reduce(
    (sum, edit) => sum + editCost(edit.old_value, edit.new_value),
    0,
  );
}

function normalizedObjective(input) {
  const requested = input.policy?.objective ?? "mindspeed-compatible";
  return OBJECTIVES[requested] ? requested : (LEGACY_OBJECTIVES[requested] ?? "mindspeed-compatible");
}

function capacityMetrics(proposal) {
  const capacity = estimateTrainingCapacity(proposal);
  const stages = capacity.data?.stages ?? [];
  if (!stages.length) return { bottleneckRatio: Infinity, imbalance: Infinity };
  const ratios = stages.map((stage) => Number(stage.ratio));
  const totals = stages.map((stage) => Number(stage.total_gib));
  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  return {
    bottleneckRatio: Math.max(...ratios),
    imbalance: mean > 0 ? (Math.max(...totals) - Math.min(...totals)) / mean : 0,
  };
}

function scoreSolution(input, solution, objective) {
  const editDistance = solution.changes.reduce(
    (sum, edit) => sum + editCost(edit.old_value, edit.new_value),
    0,
  );
  const minimalChange = solution.changes.length * SCORE_FIELD_WEIGHT + editDistance;
  const warningCount = solution.warnings.length;
  const rankDistance = editCost(input.cluster.total_ranks, solution.proposed_config.cluster.total_ranks);
  const needsCapacity = objective === "memory-safe" || objective === "pipeline-balanced";
  const capacity = needsCapacity ? capacityMetrics(solution.proposed_config) : null;
  let primaryValue = warningCount;
  let secondaryMetric = "minimal_change_tie_breaker";
  let secondaryValue = minimalChange;

  if (objective === "keep-current-resources") {
    primaryValue = rankDistance;
    secondaryMetric = "compatibility_warning_count";
    secondaryValue = warningCount;
  } else if (objective === "memory-safe") {
    primaryValue = capacity.bottleneckRatio;
    secondaryMetric = "compatibility_warning_count";
    secondaryValue = warningCount;
  } else if (objective === "pipeline-balanced") {
    primaryValue = capacity.imbalance;
    secondaryMetric = "bottleneck_memory_ratio";
    secondaryValue = capacity.bottleneckRatio;
  }

  const definition = OBJECTIVES[objective];
  return {
    ...solution,
    score: Number(primaryValue.toFixed(6)),
    score_details: {
      objective,
      objective_label: definition.label,
      lower_is_better: true,
      primary_metric: definition.primary,
      primary_value: Number(primaryValue.toFixed(6)),
      secondary_metric: secondaryMetric,
      secondary_value: Number(secondaryValue.toFixed(6)),
      compatibility_warning_count: warningCount,
      changed_field_count: solution.changes.length,
      numeric_log2_distance: Number(editDistance.toFixed(6)),
      minimal_change_tie_breaker: Number(minimalChange.toFixed(6)),
      confidence: definition.confidence,
      ...(capacity ? {
        bottleneck_memory_ratio: Number(capacity.bottleneckRatio.toFixed(6)),
        stage_memory_imbalance: Number(capacity.imbalance.toFixed(6)),
      } : {}),
    },
  };
}

function stateOrder(left, right) {
  return left.validation.errors.length - right.validation.errors.length
    || left.score - right.score
    || left.key.localeCompare(right.key);
}

export function suggestConfigFixes(input) {
  const objective = normalizedObjective(input);
  const validation = validateParallelConfig(input);
  if (!validation.errors.length) {
    return toolResult({
      tool: "suggest_config_fixes",
      input,
      status: "valid",
      warnings: validation.warnings,
      assumptions: ["当前配置已通过已建模规则，因此没有生成无意义的改动。"],
      data: { already_valid: true, solved: true, suggestions: [] },
    });
  }

  const lockedFields = input.policy?.locked_fields ?? [];
  const editablePaths = Object.keys(FIELD_LIMITS)
    .filter((path) => !isLocked(path, lockedFields));
  const editsByPath = new Map(editablePaths.map((path) => [
    path,
    valuesFor(input, path).map((newValue) => ({
      path,
      old_value: getAtPath(input, path),
      new_value: newValue,
    })).sort((left, right) => editCost(left.old_value, left.new_value)
      - editCost(right.old_value, right.new_value) || left.new_value - right.new_value),
  ]));
  let frontier = [{ edits: [], key: "", score: 0, proposal: input, validation }];
  let solutions = [];
  let searchPruned = false;

  for (let depth = 1; depth <= MAX_CHANGED_FIELDS && frontier.length; depth += 1) {
    const next = new Map();
    const generatedKeys = new Set();
    for (const state of frontier) {
      const selectedPaths = new Set(state.edits.map((edit) => edit.path));
      const relevantPaths = new Set(state.validation.errors.flatMap((error) => error.fields ?? []));
      for (const path of editablePaths) {
        if (selectedPaths.has(path) || !relevantPaths.has(path)) continue;
        for (const edit of editsByPath.get(path) ?? []) {
          const edits = [...state.edits, edit];
          const key = candidateKey(edits);
          if (generatedKeys.has(key)) continue;
          generatedKeys.add(key);
          const proposal = applyEdits(input, edits);
          const nextValidation = validateParallelConfig(proposal);
          const candidate = {
            edits,
            key,
            score: candidateScore(edits),
            proposal,
            validation: nextValidation,
          };
          if (!nextValidation.errors.length) {
            solutions.push({
              changes: edits.map((item) => ({
                ...item,
                reason: "使当前配置同时满足所有已建模约束。",
              })),
              proposed_config: proposal,
              warnings: nextValidation.warnings,
            });
          } else {
            next.set(key, candidate);
          }
        }
      }
    }
    if (solutions.length) break;
    const ordered = [...next.values()].sort(stateOrder);
    if (ordered.length > SEARCH_BEAM_WIDTH) searchPruned = true;
    frontier = ordered.slice(0, SEARCH_BEAM_WIDTH);
  }

  solutions = solutions.map((solution) => scoreSolution(input, solution, objective));
  solutions.sort((left, right) => left.score - right.score
    || left.score_details.secondary_value - right.score_details.secondary_value
    || left.score_details.compatibility_warning_count - right.score_details.compatibility_warning_count
    || left.score_details.minimal_change_tie_breaker - right.score_details.minimal_change_tie_breaker
    || candidateKey(left.changes).localeCompare(candidateKey(right.changes)));
  const solutionCount = solutions.length;
  solutions = solutions.slice(0, MAX_RETURNED_SUGGESTIONS);
  const suggestions = solutions.map((solution, index) => ({
    rank: index + 1,
    ...solution,
  }));

  return toolResult({
    tool: "suggest_config_fixes",
    input,
    status: "invalid",
    errors: validation.errors,
    warnings: validation.warnings,
    confidence: OBJECTIVES[objective].confidence,
    assumptions: [
      "当前工具搜索最多修改四个可编辑字段的合法方案；四项上限用于控制确定性搜索成本，不是 MindSpeed 的硬性要求。",
      "束搜索先按剩余违规数和修改距离保留候选，再用所选策略排序已发现的合法方案；search_pruned=true 时不代表穷举全局最优。",
      `${OBJECTIVES[objective].label}属于 MindSpeed 规则派生的静态排序；不启动训练、不采集 Profiling。`,
      "未修改模型结构字段；如果无解，可能需要用户放宽 locked_fields 或调整模型结构。",
    ],
    data: {
      already_valid: false,
      solved: suggestions.length > 0,
      locked_fields: lockedFields,
      suggestions,
      suggestion_limit: MAX_RETURNED_SUGGESTIONS,
      discovered_solution_count: solutionCount,
      suggestions_truncated: solutionCount > MAX_RETURNED_SUGGESTIONS,
      search_pruned: searchPruned,
      search_strategy: "deterministic-beam",
      search_beam_width: SEARCH_BEAM_WIDTH,
      score: {
        objective,
        objective_label: OBJECTIVES[objective].label,
        lower_is_better: true,
        primary_metric: OBJECTIVES[objective].primary,
        tie_breaker: "changed_field_count * 1000 + sum(abs(log2(new_value / old_value)))",
        confidence: OBJECTIVES[objective].confidence,
        source: "mindspeed-config-mcp MindSpeed-rule-derived policy",
      },
      max_changed_fields: MAX_CHANGED_FIELDS,
    },
  });
}
