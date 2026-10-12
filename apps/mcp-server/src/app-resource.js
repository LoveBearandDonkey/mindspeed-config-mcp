import fs from "node:fs/promises";

export const APP_RESOURCE_URI = "ui://mindspeed-config/result-view.html";
export const APP_HTML_DIRECTORY_URL = new URL(
  "../ui/dist/ui-shell-v1/training-run-twin-standalone/",
  import.meta.url,
);
export const APP_HTML_NAME_PREFIX = "config-relation-plane-mindspeed-config-mcp";
export const APP_HTML_FILENAME_PATTERN = new RegExp(
  `^${APP_HTML_NAME_PREFIX}-(\\d{8}-\\d{6})\\.html$`,
  "u",
);

export const APP_RESOURCE_META = Object.freeze({
  csp: Object.freeze({ connectDomains: Object.freeze([]), resourceDomains: Object.freeze([]) }),
  permissions: Object.freeze({}),
  prefersBorder: false,
});

const REQUIRED_MARKERS = Object.freeze([
  "MindSpeed Config Workbench",
  'id="croMindSpeedIntro"',
  'id="croImportConfig"',
  'id="croConfigPresetSelect"',
  "mcpWorkbench",
  "parse_training_config",
  "validate_parallel_config",
  "compute_rank_topology",
  "suggest_config_fixes",
  "estimate_training_capacity",
]);

const REMOVED_MODULE_MARKERS = Object.freeze([
  'id="navMonitoring"',
  'id="croEventRail"',
  'id="croIncidentView"',
  'id="croDocRegion"',
  'data-mode="heat"',
  'id="croNetRegion"',
  'id="croDeckHost"',
  "config-relation-doc.js",
  "model-architecture-3d-deck-pattern.js\"></script>",
]);

function assertNoExternalElementAssets(html) {
  const externalElement = /<(?:script|link|img|source|video|audio|iframe|object|embed)\b[^>]*(?:src|href|data)\s*=\s*["'][^"']+["'][^>]*>/giu;
  const matches = html.match(externalElement) ?? [];
  if (matches.length > 0) {
    throw new Error(`MCP App Resource 仍包含外部元素资源：${matches[0].slice(0, 160)}`);
  }
}

function assertNoExternalStyleAssets(html) {
  for (const [, style] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) {
    for (const match of style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
      const reference = match[1].trim();
      if (!reference.startsWith("data:") && !reference.startsWith("#")) {
        throw new Error(`MCP App Resource 的内联 CSS 仍引用外部资源：${reference}`);
      }
    }
    if (/@import\s/iu.test(style)) {
      throw new Error("MCP App Resource 的内联 CSS 仍包含 @import");
    }
  }
}

export function assertPackagedAppHtml(html) {
  if (typeof html !== "string" || !html.startsWith("<!DOCTYPE html>")) {
    throw new Error("MCP App Resource 必须是完整的单文件 HTML");
  }
  if (!/<script\b[^>]*type=["']module["']/iu.test(html)) {
    throw new Error("MCP App Resource 缺少内联 MCP 模块入口");
  }
  if (!/<style\b/iu.test(html)) {
    throw new Error("MCP App Resource 缺少内联样式");
  }

  assertNoExternalElementAssets(html);
  assertNoExternalStyleAssets(html);

  for (const marker of REQUIRED_MARKERS) {
    if (!html.includes(marker)) throw new Error(`MCP App Resource 缺少已验收能力：${marker}`);
  }
  for (const marker of REMOVED_MODULE_MARKERS) {
    if (html.includes(marker)) throw new Error(`MCP App Resource 重新打包了已清除模块：${marker}`);
  }
  return html;
}

export function packagedAppHtmlFilename(timestamp) {
  if (!/^\d{8}-\d{6}$/u.test(timestamp)) {
    throw new Error(`MCP App Resource 时间戳格式无效：${timestamp}`);
  }
  return `${APP_HTML_NAME_PREFIX}-${timestamp}.html`;
}

export function isPackagedAppHtmlFilename(filename) {
  return APP_HTML_FILENAME_PATTERN.test(filename);
}

export async function findPackagedAppHtmlUrl() {
  const entries = await fs.readdir(APP_HTML_DIRECTORY_URL, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && isPackagedAppHtmlFilename(entry.name))
    .map((entry) => entry.name);
  if (matches.length !== 1) {
    throw new Error(`MCP App Resource 目录必须包含唯一的时间戳 HTML，实际：${matches.join(", ") || "无"}`);
  }
  return new URL(matches[0], APP_HTML_DIRECTORY_URL);
}

export async function loadPackagedAppHtml() {
  const html = await fs.readFile(await findPackagedAppHtmlUrl(), "utf8");
  return assertPackagedAppHtml(html);
}
