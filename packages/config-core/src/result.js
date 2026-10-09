export const SOURCE_VERSIONS = Object.freeze({
  tool_matrix_ui: "1e6bb6eabe60f75b2486188b3b08b59f65d33621",
  plane_ui_reference: "485d5206ce4c0cd4719f5d28dd5cbbeb04680be1",
  mindspeed_core: "0.12.1@65634689bed75ee9b6df666d526f7f16051a3db5",
  config_core: "0.1.0",
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

export function toolResult({
  tool,
  input,
  status,
  errors = [],
  warnings = [],
  assumptions = [],
  confidence = "deterministic",
  data = {},
}) {
  return {
    schema_version: "1.0",
    tool,
    status,
    rule_profile: { ...input.rule_profile },
    source_versions: { ...SOURCE_VERSIONS },
    errors,
    warnings,
    assumptions,
    confidence,
    data,
  };
}

