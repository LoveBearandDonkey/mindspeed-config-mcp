const CHECK_LABELS = Object.freeze({
  validate_parallel_config: "并行约束校验",
  compute_rank_topology: "Rank 拓扑",
  estimate_training_capacity: "理论容量估算",
});

const FIELD_GROUPS = Object.freeze({
  model: "模型结构",
  parallel: "并行策略",
  cluster: "设备与 Rank",
  batch: "批量",
  memory: "精度与显存策略",
});

function missingGroups(paths) {
  const groups = new Map();
  for (const path of paths) {
    const key = path.split(".")[0];
    const label = FIELD_GROUPS[key] ?? "其他";
    groups.set(label, [...(groups.get(label) ?? []), path]);
  }
  return [...groups].map(([label, fields]) => ({ label, count: fields.length, fields }));
}

function issueFromDiagnostic(item, severity) {
  return {
    severity,
    code: item.code,
    finding: item.message,
    locations: item.fields ?? [],
    constraint: item.formula ?? (severity === "blocked"
      ? "输入必须满足该项解析或静态约束。"
      : "尚未证实违反训练约束，需按实际框架语义核对。"),
    source_ref: item.source_ref ?? "",
  };
}

function crossSourceIssues(result) {
  const trainingName = result.data.source_name ?? result.data.source_snapshot?.source?.name ?? "训练配置";
  const modelName = result.data.model_source_name ?? result.data.source_snapshot?.model_source?.name ?? "模型结构";
  return (result.data.cross_source_observations ?? [])
    .filter((item) => item.relation === "different")
    .map((item) => ({
      severity: "review",
      code: "PARSE_CROSS_SOURCE_REVIEW",
      finding: `${item.label}：训练参数为 ${item.training.value}，模型结构为 ${item.model.value}。`,
      locations: [
        `${trainingName}:${item.training.source_key}`,
        `${modelName}:${item.model.source_key}`,
      ],
      constraint: "两份来源数值不同；实际运行语义未验证，不能据此判为训练阻断。",
      source_ref: item.source_ref,
    }));
}

function completionSolutions(result) {
  if (result.status === "error") return [];
  if (hasSourceDifference(result)) return [];
  const plans = result.data.completion?.plans ?? [];
  return [...plans]
    .filter((plan) => plan.validation?.status === "valid"
      && plan.capacity_assessment?.recommendation_eligible === true)
    .sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)))
    .slice(0, 3)
    .map((plan, index) => ({
      number: index + 1,
      id: plan.id,
      title: plan.label,
      reason: plan.summary,
      ranking_reason: index === 0
        ? "首选：已通过静态复验，且理论容量余量达到推荐门槛。"
        : "备选：同样达到静态规则与理论容量门槛，可按字段取舍比较。",
      confidence: plan.confidence,
      validation: "已通过已建模静态规则复验；尚未修改源文件",
      capacity_basis: plan.capacity_assessment?.confidence ?? "theoretical",
      capacity_estimate_gib: plan.capacity_assessment?.estimated_gib ?? null,
      card_capacity_gib: plan.capacity_assessment?.capacity_gib ?? null,
      requires_confirmation: plan.confidence === "requires-confirmation",
    }));
}

function hasSourceDifference(result) {
  return Boolean((result.data.source_conflicts ?? []).length)
    || (result.data.cross_source_observations ?? []).some((item) => item.relation === "different");
}

function solutionNote(result, solutions, missing, issues) {
  if (solutions.length) return "候选尚未写入源文件；容量依据为理论估算。";
  if (result.status === "error") return "解析错误未消除，暂无可验证的修改方案。";
  if (result.data.completion?.strategy === "requires-confirmed-framework-and-resources") {
    return "缺少已确认的框架和设备条件，尚未生成可复验的配置修改方案。";
  }
  if (hasSourceDifference(result)) return "两份来源仍有差异，先确认实际训练使用的值；暂不推荐修改源文件。";
  if (missing.length || issues.length) return "当前没有通过静态复验及理论容量门槛的可推荐改动；需先补齐证据或确认差异。";
  return "当前已覆盖字段未显示需修改的配置项。";
}

function followUp(result, solutions, missing) {
  if (result.status === "error") return {
    mode: "provide_input",
    prompt: "请提供可解析的原始配置内容；修正后可重新检查。",
  };
  if (solutions.length > 1) return {
    mode: "choose_solution",
    prompt: `你倾向哪个方案？请回复方案序号（1～${solutions.length}）${solutions.some((item) => item.requires_confirmation) ? "，并确认方案中的占位值" : ""}；我会先列出拟改动，再修改源文件并复查。`,
  };
  if (solutions.length === 1) return {
    mode: "confirm_solution",
    prompt: `是否采用方案 1？${solutions[0].requires_confirmation ? "请先确认方案中的占位值，再" : "请"}回复“采用方案 1”；我会先列出拟改动，再修改源文件并复查。`,
  };
  if (missing.length) return {
    mode: "provide_input",
    prompt: `当前没有可供选择的修改方案。请提供实际启动脚本、并行度和设备信息${hasSourceDifference(result) ? "，并确认两份来源实际使用的值" : ""}；补齐后我可以继续校验。`,
  };
  if (hasSourceDifference(result)) return {
    mode: "provide_input",
    prompt: "请确认冲突字段应以哪份配置为准，之后可继续校验。",
  };
  return { mode: "none", prompt: "" };
}

/** 只整理已有解析和规则证据；不推断未执行的校验，也不生成新修复公式。 */
export function parseDialogue(result) {
  const data = result.data;
  const missing = data.missing_required_fields ?? [];
  const snapshot = data.source_snapshot ?? {};
  const sourceCount = Number(Boolean(snapshot.source)) + Number(Boolean(snapshot.model_source));
  const issues = [
    ...result.errors.map((item) => issueFromDiagnostic(item, "blocked")),
    ...(data.source_conflicts ?? []).map((item) => ({
      severity: "review",
      code: "PARSE_SOURCE_CONFLICT",
      finding: `${item.path}：训练配置为 ${JSON.stringify(item.training.value)}，模型结构为 ${JSON.stringify(item.model.value)}。`,
      locations: [
        `${data.source_name ?? "训练配置"}:${item.training.source_key}`,
        `${data.model_source_name ?? "模型结构"}:${item.model.source_key}`,
      ],
      constraint: "同一模型字段跨来源值不同；需确认实际使用的值。",
      source_ref: result.warnings.find((warning) => warning.code === "PARSE_SOURCE_CONFLICT")?.source_ref ?? "",
    })),
    ...crossSourceIssues(result),
    ...result.warnings.filter((item) => item.code === "PARSE_TARGET_OVERWRITTEN")
      .map((item) => issueFromDiagnostic(item, "review")),
  ];
  const solutions = completionSolutions(result);
  const readiness = Object.entries(data.tool_readiness ?? {})
    .filter(([name]) => CHECK_LABELS[name])
    .map(([name, value]) => ({
      tool: name,
      label: CHECK_LABELS[name],
      ready: value.ready,
      missing_count: value.missing_fields?.length ?? 0,
    }));
  return {
    overview: {
      parse_status: result.status === "error" ? "failed" : "succeeded",
      source_count: sourceCount,
      source_names: [snapshot.source?.name, snapshot.model_source?.name].filter(Boolean),
      read_field_count: data.source_field_count ?? 0,
      mapped_field_count: data.mapped_count ?? 0,
      required_field_count: data.required_field_count ?? 0,
      available_required_count: data.filled_required_field_count ?? 0,
      missing_required_count: missing.length,
      full_static_validation_performed: false,
    },
    issues,
    solutions,
    solution_note: solutionNote(result, solutions, missing, issues),
    completion: {
      missing_groups: missingGroups(missing),
      tool_readiness: readiness,
      unmapped_count: data.unmapped_count ?? 0,
      unverified_architecture_fields: (data.unverified_architecture_fields ?? []).map((item) => item.source_key),
      shell_fragment: result.warnings.some((item) => item.code === "PARSE_SHELL_FRAGMENT"),
    },
    follow_up: followUp(result, solutions, missing),
  };
}
