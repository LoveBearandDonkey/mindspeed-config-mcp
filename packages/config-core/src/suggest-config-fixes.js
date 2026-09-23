import { epInWorld, parallelWorld } from "./page-rules.js";
import { toolResult } from "./result.js";
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

export function suggestConfigFixes(input) {
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
  const atomicEdits = editablePaths.flatMap((path) => valuesFor(input, path).map((newValue) => ({
    path,
    old_value: getAtPath(input, path),
    new_value: newValue,
  })));
  const solutions = [];
  const seen = new Set();

  function consider(edits) {
    const key = candidateKey(edits);
    if (seen.has(key)) return;
    seen.add(key);
    const proposal = applyEdits(input, edits);
    const result = validateParallelConfig(proposal);
    if (result.errors.length) return;
    solutions.push({
      score: edits.length * 1000 + edits.reduce(
        (sum, edit) => sum + editCost(edit.old_value, edit.new_value),
        0,
      ),
      changes: edits.map((edit) => ({
        ...edit,
        reason: "使当前配置同时满足所有已建模约束。",
      })),
      proposed_config: proposal,
      warnings: result.warnings,
    });
  }

  for (const edit of atomicEdits) consider([edit]);
  if (!solutions.length) {
    for (let left = 0; left < atomicEdits.length; left += 1) {
      for (let right = left + 1; right < atomicEdits.length; right += 1) {
        if (atomicEdits[left].path === atomicEdits[right].path) continue;
        consider([atomicEdits[left], atomicEdits[right]]);
      }
    }
  }

  solutions.sort((left, right) => left.score - right.score
    || candidateKey(left.changes).localeCompare(candidateKey(right.changes)));
  const suggestions = solutions.slice(0, 3).map(({ score, ...solution }, index) => ({
    rank: index + 1,
    ...solution,
  }));

  return toolResult({
    tool: "suggest_config_fixes",
    input,
    status: "invalid",
    errors: validation.errors,
    warnings: validation.warnings,
    assumptions: [
      "只搜索最多修改两个可编辑字段的确定性方案。",
      "未修改模型结构字段；如果无解，可能需要用户放宽 locked_fields 或调整模型结构。",
    ],
    data: {
      already_valid: false,
      solved: suggestions.length > 0,
      locked_fields: lockedFields,
      suggestions,
    },
  });
}

