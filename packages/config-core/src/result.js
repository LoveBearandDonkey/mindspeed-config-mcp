import { quickAssessment } from "./quick-assessment.js";
import { parseDialogue } from "./parse-dialogue.js";
import { sha256Utf8 } from "./sha256.js";

export const SOURCE_VERSIONS = Object.freeze({
  tool_matrix_ui: "1e6bb6eabe60f75b2486188b3b08b59f65d33621",
  plane_ui_reference: "485d5206ce4c0cd4719f5d28dd5cbbeb04680be1",
  mindspeed_core: "0.12.1@65634689bed75ee9b6df666d526f7f16051a3db5",
  config_core: "0.1.1",
});

export function diagnostic(code, message, fields, source, sourceRef, formula) {
  const value = {
    code,
    message,
    fields,
    source,
    source_ref: sourceRef,
  };
  if (formula) value.formula = formula;
  return value;
}

export function suggestion({
  code,
  kind = "suggestion",
  confidence = "theoretical",
  message,
  fields = [],
  applicableHardware = [],
  applicableVersions = [],
  assumptions = [],
  source = "mindspeed-rule",
  sourceRef,
  formula,
  data,
}) {
  const value = {
    code,
    kind,
    confidence,
    message,
    fields,
    applicable_hardware: applicableHardware,
    applicable_versions: applicableVersions,
    assumptions,
    source,
    source_ref: sourceRef,
  };
  if (formula) value.formula = formula;
  if (data) value.data = data;
  return value;
}

export function toolResult({
  tool,
  input,
  status,
  errors = [],
  warnings = [],
  suggestions = [],
  assumptions = [],
  confidence = "deterministic",
  data = {},
}) {
  const sourceSnapshot = tool === "parse_training_config" ? sourceSnapshotFor(input) : input.source_snapshot;
  const completeData = sourceSnapshot ? { ...data, source_snapshot: sourceSnapshot } : data;
  const result = {
    schema_version: "1.0",
    tool,
    status,
    rule_profile: { ...input.rule_profile },
    source_versions: { ...SOURCE_VERSIONS },
    errors,
    warnings,
    suggestions,
    assumptions,
    confidence,
    data: completeData,
  };
  result.quick_assessment = quickAssessment(result);
  if (tool === "parse_training_config") result.data.dialogue = parseDialogue(result);
  return result;
}

export function sourceSnapshotFor(input) {
  if (!input.source?.content) return null;
  const entry = (source) => ({
    name: source.name ?? null,
    sha256: sha256Utf8(source.content),
    hash_basis: "submitted_utf8_text",
  });
  return {
    source: entry(input.source),
    ...(input.model_source ? { model_source: entry(input.model_source) } : {}),
  };
}

