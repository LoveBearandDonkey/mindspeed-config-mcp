const CHANNEL = "mindspeed-config-demo/v1";

function trustedParent(origin, ownOrigin) {
  if (origin === ownOrigin && origin !== "null") return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" && url.hostname === "lovebearanddonkey.github.io")
      || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  } catch { return false; }
}

// Source selection is an input adapter. All parsing and rules stay in config-core.
export function checkPageFiles({ active, files }, { parseTrainingConfig, validateParallelConfig }) {
  if (typeof active !== "string" || !Array.isArray(files) || !files.length
    || files.length > 2 || !files.every(file => typeof file.path === "string"
      && typeof file.content === "string" && /\.(sh|ssh|json|ya?ml)$/i.test(file.path))
    || files.reduce((total, file) => total + file.content.length, 0) > 2000000) {
    throw new Error("请提供当前目录的一份训练配置及可选的一份 JSON 模型配置。");
  }
  const folder = active.slice(0, active.lastIndexOf("/") + 1);
  if (!files.some(file => file.path === active)
    || files.some(file => file.path.slice(0, file.path.lastIndexOf("/") + 1) !== folder)
    || new Set(files.map(file => file.path)).size !== files.length) {
    throw new Error("仅接受当前打开文件及同目录的配套配置。");
  }
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const training = ordered.find(file => /\.(sh|ssh|ya?ml)$/i.test(file.path))
    || ordered.find(file => !/model_config\.json$/i.test(file.path)) || ordered[0];
  const models = ordered.filter(file => file !== training && /\.json$/i.test(file.path));
  if (ordered.length !== 1 + models.length) throw new Error("配套模型配置须为 JSON，请先消除目录中的配置歧义。");
  const source = file => ({ name: file.path, content: file.content,
    format: /\.(sh|ssh)$/i.test(file.path) ? "shell" : /\.json$/i.test(file.path) ? "json" : "yaml" });
  const parse = parseTrainingConfig({ schema_version: "1.0",
    rule_profile: { framework: "mindspeed-llm-mcore", version: "0.12.1" },
    source: source(training), ...(models[0] ? { model_source: source(models[0]) } : {}) });
  const validation = parse.data?.tool_readiness?.validate_parallel_config?.ready === true
    ? validateParallelConfig(parse.data.normalized_config) : null;
  return { mode: "browser-local-config-core", active, files: ordered.map(file => file.path), parse, validation,
    calls: ["parse_training_config", ...(validation ? ["validate_parallel_config"] : [])],
    source: { name: training.path, content: training.content,
      model_source: models[0] ? { name: models[0].path, content: models[0].content } : null } };
}

export function installPagesBridge(core) {
  const query = new URLSearchParams(location.search);
  if (query.get("embed") !== "1" || window.parent === window) return;
  document.documentElement.dataset.mcpEmbed = "pages";
  window.addEventListener("message", event => {
    if (event.source !== window.parent || !trustedParent(event.origin, location.origin)
      || event.data?.channel !== CHANNEL || typeof event.data.requestId !== "string") return;
    const { type, requestId, payload } = event.data;
    const reply = (type, extra = {}) => event.source.postMessage({ channel: CHANNEL, type, requestId, ...extra }, event.origin);
    if (type === "hello") {
      if (window.croObserver?.importConfig && document.getElementById("mcpWorkbenchOverview")) reply("ready");
      return;
    }
    if (type !== "check") return;
    try {
      const result = checkPageFiles(payload ?? {}, core);
      document.getElementById("croImportConfig")?.click();
      document.dispatchEvent(new CustomEvent("mcp:workbench-handoff", { detail: {
        source: result.source, rule_profile: result.parse.data.normalized_config.rule_profile,
      } }));
      if (result.validation) {
        // The handoff first records the editable sources; restore the exact checked values next.
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent("mcp:restore-snapshot-request", { detail: { snapshot: {
            config: result.parse.data.normalized_config,
            source: { name: result.source.name, version_kind: "unsaved" },
          } } }));
          document.getElementById("croImportClose")?.click();
        }, 0);
      }
      reply("result", { result });
    } catch (error) { reply("error", { message: error instanceof Error ? error.message : String(error) }); }
  });
}
