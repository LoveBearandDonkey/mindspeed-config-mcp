import fs from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

const trainingConfigSchema = JSON.parse(fs.readFileSync(
  new URL("../training-config-v1.schema.json", import.meta.url),
  "utf8",
));
const toolResultSchema = JSON.parse(fs.readFileSync(
  new URL("../tool-result-v1.schema.json", import.meta.url),
  "utf8",
));

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkTrainingConfig = ajv.compile(trainingConfigSchema);
const checkToolResult = ajv.compile(toolResultSchema);

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

export function validateToolResult(value) {
  return outcome(checkToolResult(value), checkToolResult.errors);
}

export function assertTrainingConfig(value) {
  const result = validateTrainingConfig(value);
  if (result.valid) return value;
  throw new TypeError(`训练配置不符合 Schema：${JSON.stringify(result.errors)}`);
}

export function assertToolResult(value) {
  const result = validateToolResult(value);
  if (result.valid) return value;
  throw new TypeError(`工具返回值不符合 Schema：${JSON.stringify(result.errors)}`);
}

export { toolResultSchema, trainingConfigSchema };

