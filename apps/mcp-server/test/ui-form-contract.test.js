import assert from "node:assert/strict";
import test from "node:test";

import { trainingConfigSchema } from "@mindspeed-config/contracts";

import { WORKBENCH_FIELD_PATHS, WORKBENCH_REQUIRED_PATHS } from "../ui/src/workbench.js";

function leafPaths(schema, prefix = "") {
  const paths = [];
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (property.type === "object") paths.push(...leafPaths(property, path));
    else paths.push(path);
  }
  return paths;
}

function requiredLeafPaths(schema, prefix = "") {
  const paths = [];
  const required = new Set(schema.required ?? []);
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (property.type === "object") paths.push(...requiredLeafPaths(property, path));
    else if (required.has(key)) paths.push(path);
  }
  return paths;
}

test("自定义输入区覆盖 Inspector 使用的训练配置 Schema 字段", () => {
  const schemaFields = leafPaths(trainingConfigSchema).filter((path) => path !== "schema_version").sort();
  assert.deepEqual(WORKBENCH_FIELD_PATHS, schemaFields);
});

test("自定义输入区必填标记与训练配置 Schema 一致", () => {
  const schemaRequired = requiredLeafPaths(trainingConfigSchema).filter((path) => path !== "schema_version").sort();
  assert.deepEqual(WORKBENCH_REQUIRED_PATHS, schemaRequired);
});
