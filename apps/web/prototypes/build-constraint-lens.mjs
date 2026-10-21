import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createTrainingConfig } from "../../../tests/fixtures/training-config.js";

const htmlPath = fileURLToPath(new URL("./constraint-lens.html", import.meta.url));
const entry = fileURLToPath(new URL("./constraint-lens-entry.js", import.meta.url));
const result = await build({
  configFile: false,
  logLevel: "error",
  build: {
    write: false,
    minify: true,
    lib: { entry, name: "ConstraintLensCore", formats: ["iife"] },
  },
});
const bundle = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk")?.code;
assert.ok(bundle, "config-core browser bundle missing");

const original = fs.readFileSync(htmlPath, "utf8");
const bundleMarker = /(\/\* CONFIG_CORE_BUNDLE_START \*\/)[\s\S]*?(\/\* CONFIG_CORE_BUNDLE_END \*\/)/;
const baseMarker = /(\/\* FACTOR_BASE_START \*\/)[\s\S]*?(\/\* FACTOR_BASE_END \*\/)/;
assert.match(original, bundleMarker);
assert.match(original, baseMarker);
const updated = original
  .replace(bundleMarker, (_, start, end) => `${start}\n${bundle}\n${end}`)
  .replace(baseMarker, (_, start, end) => `${start}${JSON.stringify(createTrainingConfig())}${end}`);
fs.writeFileSync(htmlPath, updated);
console.log(`Embedded prototype dependencies in ${htmlPath} (${bundle.length} bytes)`);
