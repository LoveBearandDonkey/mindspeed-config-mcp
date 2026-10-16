import { diagnostic, sourceSnapshotFor, toolResult } from "./result.js";
import { parseTrainingConfig } from "./parse-training-config.js";
import { validateParallelConfig } from "./validate-parallel-config.js";

const REVIEW_SOURCE = "docs/V2版-用户使用流程.md#现行版本保留与新方案试验";

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function flatten(value, prefix = "", output = new Map()) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, path, output);
    else output.set(path, child);
  }
  return output;
}

function changesBetween(before, after) {
  const oldFields = flatten(before);
  const newFields = flatten(after);
  const paths = new Set([...oldFields.keys(), ...newFields.keys()]);
  return [...paths].sort().filter((path) => !valuesEqual(oldFields.get(path), newFields.get(path)))
    .map((path) => ({ path, old_value: oldFields.get(path) ?? null, new_value: newFields.get(path) ?? null }));
}

function matchesLock(path, locked) {
  return locked === path || (!locked.includes(".") && path.split(".").at(-1) === locked);
}

export function reviewConfigChange(input) {
  const beforeInput = { schema_version: "1.0", rule_profile: input.rule_profile, ...input.before };
  const afterInput = { schema_version: "1.0", rule_profile: input.rule_profile, ...input.after };
  const before = parseTrainingConfig(beforeInput);
  const after = parseTrainingConfig(afterInput);
  const beforeSnapshot = sourceSnapshotFor(beforeInput);
  const afterSnapshot = sourceSnapshotFor(afterInput);
  const errors = [];
  const warnings = [];
  const sourceChanged = beforeSnapshot.source.sha256 !== afterSnapshot.source.sha256
    || beforeSnapshot.model_source?.sha256 !== afterSnapshot.model_source?.sha256;
  const lockedFields = input.locked_fields ?? [];

  if (input.expected_before_sha256 && input.expected_before_sha256 !== beforeSnapshot.source.sha256) {
    errors.push(diagnostic("REVIEW_STALE_BASELINE", "分析时的源文件摘要与本次复查提供的修改前内容不一致。",
      ["before.source.content"], "parser-rule", REVIEW_SOURCE));
  }
  if (input.expected_before_model_sha256
    && input.expected_before_model_sha256 !== beforeSnapshot.model_source?.sha256) {
    errors.push(diagnostic("REVIEW_STALE_MODEL_BASELINE", "分析时的模型结构摘要与本次复查提供的修改前内容不一致。",
      ["before.model_source.content"], "parser-rule", REVIEW_SOURCE));
  }
  if (!sourceChanged) errors.push(diagnostic("REVIEW_SOURCE_UNCHANGED", "修改前后源文件内容相同；尚不能确认源文件已修改。",
    ["before.source.content", "after.source.content"], "parser-rule", REVIEW_SOURCE));
  if (before.status === "error" || after.status === "error") {
    errors.push(...before.errors.map((item) => ({ ...item, fields: item.fields.map((field) => `before.${field}`) })));
    errors.push(...after.errors.map((item) => ({ ...item, fields: item.fields.map((field) => `after.${field}`) })));
    return toolResult({ tool: "review_config_change", input, status: "error", errors,
      data: { source_changed: sourceChanged, source_snapshot: { before: beforeSnapshot, after: afterSnapshot },
        locked_fields: lockedFields, changes: [], after_complete: false, validation: null } });
  }

  const changes = changesBetween(before.data.normalized_config, after.data.normalized_config);
  const lockedChanges = changes.filter(({ path }) => lockedFields.some((locked) => matchesLock(path, locked)));
  for (const change of lockedChanges) errors.push(diagnostic("REVIEW_LOCKED_FIELD_CHANGED",
    `锁定字段 ${change.path} 在源文件修改后发生变化。`, [change.path], "parser-rule", REVIEW_SOURCE));
  const availablePaths = new Set([
    ...flatten(before.data.normalized_config).keys(),
    ...flatten(after.data.normalized_config).keys(),
  ]);
  for (const locked of lockedFields) {
    if (![...availablePaths].some((path) => matchesLock(path, locked))) {
      errors.push(diagnostic("REVIEW_LOCKED_FIELD_UNVERIFIED", `锁定字段 ${locked} 未被解析映射，无法确认它保持不变。`,
        [locked], "parser-rule", REVIEW_SOURCE));
    }
  }
  if (!after.data.complete) errors.push(diagnostic("REVIEW_AFTER_INCOMPLETE", "修改后的源文件仍缺少静态校验必填字段。",
    after.data.missing_required_fields, "parser-rule", REVIEW_SOURCE));

  const expected = input.expected_changes ?? [];
  const candidateMismatches = expected.filter((change) => {
    const actual = changes.find(({ path }) => path === change.path);
    return !actual
      || (Object.hasOwn(change, "old_value") && !valuesEqual(actual.old_value, change.old_value))
      || (Object.hasOwn(change, "new_value") && !valuesEqual(actual.new_value, change.new_value));
  });
  for (const change of candidateMismatches) errors.push(diagnostic("REVIEW_CANDIDATE_MISMATCH",
    `源文件复查结果与候选中 ${change.path} 的预期差异不一致。`, [change.path], "parser-rule", REVIEW_SOURCE));
  const expectedPaths = new Set(expected.map(({ path }) => path));
  const additionalChanges = expected.length ? changes.filter(({ path }) => !expectedPaths.has(path)) : [];
  if (additionalChanges.length) warnings.push(diagnostic("REVIEW_ADDITIONAL_CHANGES",
    `修改后的源文件还改变了 ${additionalChanges.length} 个候选之外的已映射字段，请审阅差异。`,
    additionalChanges.map(({ path }) => path), "parser-rule", REVIEW_SOURCE));

  let validation = null;
  if (after.data.complete) {
    try {
      validation = validateParallelConfig(after.data.normalized_config);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
    } catch {
      errors.push(diagnostic("REVIEW_AFTER_INVALID_INPUT", "修改后的映射值无法进入静态校验，请核对字段类型。",
        ["after.source.content"], "parser-rule", REVIEW_SOURCE));
    }
  }
  if (sourceChanged && !changes.length) warnings.push(diagnostic("REVIEW_NO_MODELED_CHANGE",
    "源文件内容已变化，但已建模的配置字段没有变化。", ["after.source.content"], "parser-rule", REVIEW_SOURCE));

  return toolResult({
    tool: "review_config_change",
    input,
    status: errors.length ? "invalid" : "valid",
    errors,
    warnings: [...after.warnings, ...warnings],
    assumptions: ["复查只比较传入的修改前后文件文本；Agent 须从磁盘重新读取修改后的源文件，工具本身不写文件。"],
    data: {
      source_changed: sourceChanged,
      source_snapshot: { before: beforeSnapshot, after: afterSnapshot },
      locked_fields: lockedFields,
      locked_field_changes: lockedChanges,
      changes,
      candidate_match: expected.length ? candidateMismatches.length === 0 : null,
      additional_changes: additionalChanges,
      after_complete: after.data.complete,
      after_unmapped_fields: after.data.unmapped_fields,
      after_source_conflicts: after.data.source_conflicts ?? [],
      validation,
    },
  });
}
