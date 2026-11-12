import schema from "../../../../packages/contracts/training-config-v1.schema.json" with { type: "json" };

function fieldSchema(path) {
  if (!/^(model|parallel|cluster|batch|memory|features|rule_profile)\.[a-z_][a-z_0-9]*$/.test(path)) return null;
  return path.split(".").reduce((current, key) => current?.properties && Object.hasOwn(current.properties, key)
    ? current.properties[key] : undefined, schema) ?? null;
}

export function conflictFieldsFor(result, config) {
  const fields = new Map();
  for (const issue of result?.errors ?? []) {
    for (const path of issue.fields ?? []) {
      const definition = fieldSchema(path);
      if (!definition || (!definition.type && !definition.enum)) continue;
      const entry = fields.get(path) ?? { path, schema: definition,
        value: path.split(".").reduce((current, key) => current?.[key], config), issues: [] };
      if (!entry.issues.some(item => item.code === issue.code && item.message === issue.message)) entry.issues.push(issue);
      fields.set(path, entry);
    }
  }
  return [...fields.values()];
}

// Input shape checks only. Business constraints always come from the tool result.
export function conflictInputValue(definition, raw) {
  let value;
  try {
    if (raw === "") return { valid: false };
    value = definition.type === "array" ? JSON.parse(raw)
      : ["number", "integer"].includes(definition.type) ? Number(raw)
        : definition.type === "boolean" ? raw === "true" : raw;
  } catch { return { valid: false }; }
  function valid(item, rule) {
    if (rule.enum) return rule.enum.includes(item);
    if (rule.type === "array") return Array.isArray(item)
      && item.length >= (rule.minItems ?? 0) && item.every(child => valid(child, rule.items));
    if (["number", "integer"].includes(rule.type)) return Number.isFinite(item)
      && (rule.type !== "integer" || Number.isInteger(item))
      && (rule.minimum === undefined || item >= rule.minimum)
      && (rule.exclusiveMinimum === undefined || item > rule.exclusiveMinimum);
    if (rule.type === "boolean") return typeof item === "boolean";
    return typeof item === "string" && item.length >= (rule.minLength ?? 0);
  }
  return { value, valid: valid(value, definition) };
}
