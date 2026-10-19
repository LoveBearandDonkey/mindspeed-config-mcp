import fs from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

const trainingConfigSchema = JSON.parse(fs.readFileSync(
  new URL("../training-config-v1.schema.json", import.meta.url),
  "utf8",
));
const parseTrainingConfigSchema = JSON.parse(fs.readFileSync(
  new URL("../parse-training-config-v1.schema.json", import.meta.url),
  "utf8",
));
const toolResultSchema = JSON.parse(fs.readFileSync(
  new URL("../tool-result-v1.schema.json", import.meta.url),
  "utf8",
));
const reviewConfigChangeSchema = JSON.parse(fs.readFileSync(
  new URL("../review-config-change-v1.schema.json", import.meta.url),
  "utf8",
));
const planTrainingConfigSchema = JSON.parse(fs.readFileSync(
  new URL("../plan-training-config-v1.schema.json", import.meta.url),
  "utf8",
));
const analyzePerformanceEvidenceSchema = JSON.parse(fs.readFileSync(
  new URL("../analyze-performance-evidence-v1.schema.json", import.meta.url),
  "utf8",
));
const composeAnalysisReportSchema = JSON.parse(fs.readFileSync(
  new URL("../compose-analysis-report-v1.schema.json", import.meta.url),
  "utf8",
));

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkTrainingConfig = ajv.compile(trainingConfigSchema);
const checkParseTrainingConfig = ajv.compile(parseTrainingConfigSchema);
const checkToolResult = ajv.compile(toolResultSchema);
const checkReviewConfigChange = ajv.compile(reviewConfigChangeSchema);
const checkPlanTrainingConfig = ajv.compile(planTrainingConfigSchema);
const checkAnalyzePerformanceEvidence = ajv.compile(analyzePerformanceEvidenceSchema);
const checkComposeAnalysisReport = ajv.compile(composeAnalysisReportSchema);

function outcome(valid, errors) {
  return {
    valid,
    errors: valid ? [] : (errors ?? []).map((error) => ({
      instance_path: error.instancePath,
      schema_path: error.schemaPath,
      keyword: error.keyword,
      message: error.message ?? "JSON Schema 校验失败",
      params: error.params,
    })),
  };
}

export function validateTrainingConfig(value) {
  return outcome(checkTrainingConfig(value), checkTrainingConfig.errors);
}

export function validateParseTrainingConfig(value) {
  return outcome(checkParseTrainingConfig(value), checkParseTrainingConfig.errors);
}

export function validateToolResult(value) {
  return outcome(checkToolResult(value), checkToolResult.errors);
}

export function validateReviewConfigChange(value) {
  return outcome(checkReviewConfigChange(value), checkReviewConfigChange.errors);
}

export function validatePlanTrainingConfig(value) {
  const result = outcome(checkPlanTrainingConfig(value), checkPlanTrainingConfig.errors);
  if (!result.valid || !value?.base_config) return result;
  const nested = validateTrainingConfig(value.base_config);
  return nested.valid ? result : outcome(false, nested.errors.map((error) => ({
    ...error,
    instance_path: `/base_config${error.instance_path}`,
  })));
}

export function validateAnalyzePerformanceEvidence(value) {
  const result = outcome(checkAnalyzePerformanceEvidence(value), checkAnalyzePerformanceEvidence.errors);
  if (!result.valid || !value?.observed_config) return result;
  const nested = validateTrainingConfig(value.observed_config);
  return nested.valid ? result : outcome(false, nested.errors.map((error) => ({
    ...error,
    instance_path: `/observed_config${error.instance_path}`,
  })));
}

export function validateComposeAnalysisReport(value) {
  const result = outcome(checkComposeAnalysisReport(value), checkComposeAnalysisReport.errors);
  if (!result.valid) return result;
  for (const key of ["analysis", "performance", "review"]) {
    if (!value[key]) continue;
    const nested = validateToolResult(value[key]);
    if (!nested.valid) return outcome(false, nested.errors.map((error) => ({
      ...error,
      instance_path: `/${key}${error.instance_path}`,
    })));
  }
  if (value.performance && value.performance.tool !== "analyze_performance_evidence") {
    return outcome(false, [{ instance_path: "/performance/tool", message: "必须是 analyze_performance_evidence 结果" }]);
  }
  if (value.review && value.review.tool !== "review_config_change") {
    return outcome(false, [{ instance_path: "/review/tool", message: "必须是 review_config_change 结果" }]);
  }
  if (value.analysis.tool === "compose_analysis_report") {
    return outcome(false, [{ instance_path: "/analysis/tool", message: "不能把报告当作分析证据" }]);
  }
  return result;
}

export function assertTrainingConfig(value) {
  const result = validateTrainingConfig(value);
  if (result.valid) return value;
  throw new TypeError(`训练配置不符合 Schema：${JSON.stringify(result.errors)}`);
}

export function assertParseTrainingConfig(value) {
  const result = validateParseTrainingConfig(value);
  if (result.valid) return value;
  throw new TypeError(`待解析训练配置不符合 Schema：${JSON.stringify(result.errors)}`);
}

export function assertToolResult(value) {
  const result = validateToolResult(value);
  if (result.valid) return value;
  throw new TypeError(`工具返回值不符合 Schema：${JSON.stringify(result.errors)}`);
}

export function assertReviewConfigChange(value) {
  const result = validateReviewConfigChange(value);
  if (result.valid) return value;
  throw new TypeError(`修改复查输入不符合 Schema：${JSON.stringify(result.errors)}`);
}

export function assertPlanTrainingConfig(value) {
  const result = validatePlanTrainingConfig(value);
  if (result.valid) return value;
  throw new TypeError(`训练规划输入不符合 Schema：${JSON.stringify(result.errors)}`);
}

export function assertAnalyzePerformanceEvidence(value) {
  const result = validateAnalyzePerformanceEvidence(value);
  if (result.valid) return value;
  throw new TypeError(`性能证据输入不符合 Schema：${JSON.stringify(result.errors)}`);
}

export function assertComposeAnalysisReport(value) {
  const result = validateComposeAnalysisReport(value);
  if (result.valid) return value;
  throw new TypeError(`分析报告输入不符合 Schema：${JSON.stringify(result.errors)}`);
}

export {
  parseTrainingConfigSchema,
  analyzePerformanceEvidenceSchema,
  composeAnalysisReportSchema,
  planTrainingConfigSchema,
  reviewConfigChangeSchema,
  toolResultSchema,
  trainingConfigSchema,
};
