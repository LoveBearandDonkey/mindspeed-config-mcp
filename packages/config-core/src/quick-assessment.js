function diagnosticEvidence(item) {
  return {
    code: item.code,
    message: item.message,
    fields: item.fields ?? [],
    source: item.source,
    source_ref: item.source_ref ?? "",
    ...(item.formula ? { formula: item.formula } : {}),
  };
}

function assessment(state, conclusion, evidence, nextStep, limitation) {
  return {
    state,
    conclusion,
    evidence,
    next_step: nextStep,
    limitation,
  };
}

export function quickAssessment({ tool, status, errors, warnings, suggestions, data }) {
  if (tool === "suggest_config_fixes") {
    if (data.already_valid) return assessment("passed", "当前配置通过已建模静态校验，无需修复。", [],
      "如需确认可运行性，在目标环境继续验证。", "静态通过不代表实机训练通过。");
    if (data.solved) {
      const first = data.suggestions[0];
      return assessment("review", `找到 ${data.suggestions.length} 个已复验的修复候选。`,
        [{ code: "FIX_CANDIDATE", message: `首选候选修改 ${first.changes.length} 个字段`, fields: first.changes.map(({ path }) => path), source: "mindspeed-rule", source_ref: "packages/config-core/src/suggest-config-fixes.js" }],
        "核对首选候选的 changes；由 Agent 修改源文件，再调用 review_config_change 复查。",
        "候选只改结构化配置，尚未写入源文件。");
    }
    return assessment("blocked", "当前搜索范围内没有找到合法修复候选。", errors[0] ? [diagnosticEvidence(errors[0])] : [],
      "检查锁定字段、缺失条件和原始配置，再决定修复方向。",
      "搜索受字段范围与束宽限制，不代表不存在其他方案。");
  }
  const firstError = errors[0];
  if (firstError) {
    const nextStep = tool === "review_config_change"
      ? "核对修改后的源文件、锁定字段和候选差异，再按新文件内容复查。"
      : tool === "parse_training_config"
        ? "修正原始配置的解析错误，再重新提交文件内容。"
        : tool === "suggest_config_fixes"
          ? "核对首个候选的字段差异；由 Agent 修改源文件后重新解析并复查。"
          : "先处理所列静态问题，再用修改后的配置重新校验。";
    return assessment(
      "blocked",
      tool === "review_config_change" ? "修改后复查未通过。" : "当前配置存在阻断问题。",
      [diagnosticEvidence(firstError)],
      nextStep,
      "静态结论不等于目标环境的训练运行结果。",
    );
  }

  if (tool === "parse_training_config") {
    const incomplete = warnings.find(({ code }) => code === "PARSE_INCOMPLETE");
    const conflict = warnings.find(({ code }) => code === "PARSE_SOURCE_CONFLICT");
    if (incomplete) return assessment(
      "needs_input", "原始配置已解析，但缺少调用完整分析所需的字段。",
      [diagnosticEvidence(incomplete)], "补齐缺失字段并核对来源，再运行静态校验。",
      "省略态默认值与推导值应由用户核对。",
    );
    if (conflict) return assessment(
      "review", "原始配置已解析，但来源文件有冲突。",
      [diagnosticEvidence(conflict)], "确认冲突字段应采用哪个文件，再运行静态校验。",
      "解析成功不等于配置通过静态校验。",
    );
    if (data.unmapped_count > 0) return assessment(
      "review", "原始配置已解析，但仍有未识别字段。",
      [{ code: "PARSE_UNMAPPED_FIELDS", message: `${data.unmapped_count} 个字段未映射`, fields: (data.unmapped_fields ?? []).slice(0, 3).map(({ source_key }) => source_key), source: "parser-rule", source_ref: "packages/config-core/src/parse-training-config.js" }],
      "核对未识别字段与映射结果，再运行静态校验。",
      "解析成功不等于配置通过静态校验。",
    );
    return assessment("ready", "原始配置已完成解析，可继续静态校验。", [],
      "运行 validate_parallel_config；需要时再查看 Rank 与理论容量。",
      "解析成功不等于配置通过静态校验。");
  }

  if (tool === "review_config_change") {
    const firstWarning = warnings[0];
    if (firstWarning || data.after_unmapped_fields?.length || data.after_source_conflicts?.length) return assessment(
      "review", "修改后静态复查通过，但仍有来源或差异需要核对。",
      firstWarning ? [diagnosticEvidence(firstWarning)] : [],
      "审阅源文件差异、未识别字段和来源冲突，再决定是否采用。",
      "静态通过不代表实机训练通过。",
    );
    return assessment("passed", "源文件已变化，锁定字段保持不变，修改后静态复查通过。", [],
      "展示源文件差异，并在目标环境验证训练行为。", "静态通过不代表实机训练通过。");
  }

  if (tool === "estimate_training_capacity" && status === "estimated") {
    const stage = data.stages[data.bottleneck_stage];
    const risky = data.bottleneck_level === "over" || data.bottleneck_level === "tight";
    return assessment(risky ? "review" : "estimated",
      `理论瓶颈位于 Stage ${stage.stage}，估算 ${stage.total_gib.toFixed(1)} GiB，等级为 ${stage.level}。`,
      [{ code: "CAPACITY_BOTTLENECK", message: `Stage ${stage.stage}: ${stage.total_gib.toFixed(1)} GiB`, fields: ["cluster.card_memory_gib"], source: "page-rule", source_ref: "packages/config-core/src/estimate-training-capacity.js" }],
      risky ? "先检查瓶颈 Stage 的理论容量余量，再在目标 NPU 上实测。" : "在目标 NPU 上实测峰值，校准估算。",
      "容量为 theoretical，不是实测峰值。");
  }

  const firstWarning = warnings[0];
  const firstSuggestion = suggestions.find(({ kind }) => kind === "suggestion");
  const evidence = firstWarning ? [diagnosticEvidence(firstWarning)] : firstSuggestion
    ? [{ code: firstSuggestion.code, message: firstSuggestion.message, fields: firstSuggestion.fields, source: firstSuggestion.source, source_ref: firstSuggestion.source_ref }]
    : [];
  if (firstWarning || firstSuggestion) return assessment("review", "配置通过已建模静态校验，但有需要核对的提醒。",
    evidence, "核对提醒的依据与适用条件，再决定是否调整配置。",
    "静态通过不代表实机训练通过。");
  return assessment("passed", tool === "compute_rank_topology"
    ? `已生成 ${data.ranks.length} 个 Rank、${data.stages.length} 个 PP Stage 的拓扑。`
    : "配置通过已建模静态校验。", [],
  "如需确认可运行性，在目标环境继续验证。", "静态通过不代表实机训练通过。");
}
