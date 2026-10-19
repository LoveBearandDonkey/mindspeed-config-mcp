import { diagnostic, toolResult } from "./result.js";

const POLICY_SOURCE = "mindspeed-config-mcp:packages/config-core/src/compose-analysis-report.js@0.1.0";

function evidenceRows(result) {
  return [...result.errors, ...result.warnings].map((item) => ({
    code: item.code,
    message: item.message,
    fields: item.fields,
    source_ref: item.source_ref || "未提供规则来源",
  }));
}

function markdown(report) {
  const lines = [
    `# ${report.project} · 配置分析报告`,
    "",
    `来源：${report.source.name}（${report.source.version_kind}）`,
    `源文本 SHA-256：${report.source.sha256 ?? "未提供；无法证明与磁盘文件一致"}`,
    `结论：${report.conclusion}`,
    `复查状态：${report.review_status}`,
    "",
    "## 规则依据",
    ...((report.rule_evidence.length ? report.rule_evidence.map((item) =>
      `- ${item.code}：${item.message}；来源 ${item.source_ref}`) : ["- 没有阻断或提醒；仅表示已建模静态规则通过。"])),
    "",
    "## 假设与未解决项",
    ...report.assumptions.map((item) => `- 假设：${item}`),
    ...report.unresolved.map((item) => `- 未解决：${item}`),
    "",
    "## 字段差异",
    ...((report.file_diff.length ? report.file_diff.map((item) =>
      `- 已复查文件 ${item.path}：${JSON.stringify(item.old_value)} → ${JSON.stringify(item.new_value)}`)
      : ["- 尚无已复查的源文件差异。"])),
    ...report.candidate_changes.map((item) =>
      `- 候选建议 ${item.path}：${JSON.stringify(item.old_value)} → ${JSON.stringify(item.new_value)}（未写入源文件）`),
    "",
    "## 源文本差异",
    ...(report.source_text_diff?.text ? ["```diff", report.source_text_diff.text, "```",
      ...(report.source_text_diff.complete ? [] : ["差异已截断；请在工程中查看完整 git diff。"])]
      : ["尚无与报告来源版本匹配的修改后源文本差异。"]),
    "",
    `机器可读结果：${report.analysis_tool} / ${report.analysis_status}；规则版本 ${report.rule_profile.framework}@${report.rule_profile.version}`,
  ];
  return lines.join("\n");
}

export function composeAnalysisReport(input) {
  const analysis = input.analysis;
  const review = input.review;
  const performance = input.performance;
  const actualChanges = review?.data?.changes ?? [];
  const reviewed = review?.status === "valid" && review?.data?.source_changed === true
    && Boolean(input.source.sha256)
    && input.source.sha256 === review.data.source_snapshot?.after?.source?.sha256;
  const ruleEvidence = [...evidenceRows(analysis), ...(performance ? evidenceRows(performance) : [])];
  const unresolved = [
    ...(!input.source.sha256 ? ["缺少源文本摘要，无法确认报告对应的文件版本。"] : []),
    ...(!reviewed ? ["源文件修改尚未通过 review_config_change 复查。"] : []),
    ...(review && !reviewed ? ["复查结果与报告来源摘要不一致，不能确认同一文件版本。"] : []),
    ...(performance ? ["性能归因与提速收益需在目标 NPU 上实测。"] : []),
    ...(analysis.status === "invalid" ? ["静态校验仍有阻断问题。"] : []),
  ];
  const report = {
    schema_version: "1.0",
    project: input.project,
    source: input.source,
    conclusion: analysis.quick_assessment.conclusion,
    analysis_tool: analysis.tool,
    analysis_status: analysis.status,
    rule_profile: analysis.rule_profile,
    source_versions: analysis.source_versions,
    rule_evidence: ruleEvidence,
    assumptions: [...new Set([...analysis.assumptions, ...(performance?.assumptions ?? [])])],
    unresolved,
    review_status: reviewed ? "已按提交的修改后文本复查；磁盘写回由 Agent 确认" : "未复查源文件修改",
    file_diff: reviewed ? actualChanges : [],
    source_text_diff: reviewed ? review.data.source_text_diff ?? null : null,
    candidate_changes: input.candidate_changes ?? [],
    performance: performance ? {
      evidence: performance.data.evidence,
      attribution: performance.data.attribution,
      hypotheses: performance.data.hypotheses,
      non_config_causes: performance.data.non_config_causes,
    } : null,
  };
  return toolResult({
    tool: "compose_analysis_report",
    input: { rule_profile: analysis.rule_profile },
    status: "valid",
    warnings: unresolved.map((message, index) => diagnostic(`REPORT_UNRESOLVED_${index + 1}`,
      message, [], "compatibility-gap", POLICY_SOURCE)),
    assumptions: report.assumptions,
    confidence: analysis.confidence,
    data: { report, markdown: markdown(report), policy_source: POLICY_SOURCE },
  });
}
