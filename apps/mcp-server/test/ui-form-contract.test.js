import assert from "node:assert/strict";
import test from "node:test";

import { trainingConfigSchema } from "@mindspeed-config/contracts";

import { PAGE_FIELDS } from "../ui/src/mcp-parse-adapter.js";

function leafPaths(schema, prefix = "") {
  const paths = [];
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (property.type === "object") paths.push(...leafPaths(property, path));
    else paths.push(path);
  }
  return paths;
}

test("当前 MCP 解析适配层登记的 31 个页面字段都有训练配置 Schema 去向", () => {
  const schemaFields = new Set(leafPaths(trainingConfigSchema));
  const contractPaths = Object.keys(PAGE_FIELDS);
  assert.equal(contractPaths.length, 31);
  assert.equal(new Set(Object.values(PAGE_FIELDS)).size, 31);
  for (const path of contractPaths) {
    assert.ok(schemaFields.has(path), `页面字段映射到了不存在的 Schema 路径：${path}`);
  }
});
