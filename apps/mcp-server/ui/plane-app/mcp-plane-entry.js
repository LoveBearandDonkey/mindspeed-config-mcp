import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

import "./mcp-plane.css";
import "./js/config-relation-doc.js";
import { PREVIEW_RESULTS } from "../src/preview-results.js";
import { createMcpPlaneView } from "./mcp-plane-view.js";

const DEFAULT_CONFIG = {
  schema_version: "1.0",
  rule_profile: { framework: "generic", version: "v1-workbench" },
  model: {
    id: "Mixtral-8x7B",
    total_layers: 32,
    hidden_size: 4096,
    num_attention_heads: 32,
    num_key_value_heads: 8,
    ffn_hidden_size: 14336,
    vocab_size: 32000,
    routed_experts: 8,
    top_k: 2,
    shared_experts: 0,
  },
  parallel: {
    dp: 8, pp: 2, tp: 2, cp: 1, ep: 4, vpp: 1,
    ep_mode: "split", cp_mode: "ring",
    sequence_parallel: true,
    vocab_embedding_data_parallel: false,
    expert_tensor_parallel: false,
  },
  cluster: { total_ranks: 32, ranks_per_node: 8, card_model: "昇腾 910B", card_memory_gib: 64 },
  batch: { micro_batch_size: 1, sequence_length: 4096, micro_batch_count: 4 },
  memory: {
    compute_dtype: "bf16", parameter_dtype: "fp32", recompute_mode: "selective",
    shard_mode: "zero1", lora_enabled: false,
  },
};

const previewMode = new URLSearchParams(window.location.search).has("preview");
let app = null;
let initialized = false;
let refreshVersion = 0;

const view = createMcpPlaneView({
  onConfigChange: refreshVisualization,
  onRunTool: runSelectedTool,
  onParseSource: parseSource,
});

if (previewMode) {
  app = createPreviewApp();
  initializeWorkbench();
} else {
  app = new App({ name: "MindSpeed Config Plane", version: "0.1.0" });
  app.ontoolresult = (response) => {
    const result = response.structuredContent;
    if (!result) return;
    if (result.tool === "open_config_workbench") {
      initializeWorkbench(result.data?.target_tool);
      return;
    }
    view.showResult(result);
  };
  app.onhostcontextchanged = applyHostContext;
  app.onerror = (error) => view.showError(error instanceof Error ? error.message : String(error));
  app.connect()
    .then(() => {
      applyHostContext(app.getHostContext());
      window.setTimeout(() => { if (!initialized) initializeWorkbench(); }, 150);
    })
    .catch(app.onerror);
}

async function initializeWorkbench(targetTool = null) {
  if (initialized) {
    if (targetTool) document.querySelector(".crop-tool-select").value = targetTool;
    return;
  }
  initialized = true;
  if (targetTool && targetTool !== "parse_training_config") document.querySelector(".crop-tool-select").value = targetTool;
  try {
    await view.loadSample();
  } catch {
    view.setConfig(DEFAULT_CONFIG, { name: "quickstart_mixtral_8x7b.yaml", format: "yaml" });
    await refreshVisualization(DEFAULT_CONFIG);
  }
  if (targetTool === "parse_training_config") document.getElementById("croImportConfig").click();
}

async function callTool(name, args) {
  if (!app) throw new Error("MCP App 尚未连接。请稍后重试。");
  const response = await app.callServerTool({ name, arguments: args });
  if (response.isError || !response.structuredContent) {
    const message = response.content?.find((item) => item.type === "text")?.text;
    throw new Error(message || `${name} 调用失败。`);
  }
  return response.structuredContent;
}

async function parseSource(source) {
  view.setBusy(true, `正在解析 ${source.name}…`);
  try {
    return await callTool("parse_training_config", {
      schema_version: "1.0",
      rule_profile: { framework: "generic", version: "v1-workbench" },
      source: { format: source.format, name: source.name, content: source.content },
    });
  } finally {
    view.setBusy(false);
  }
}

async function refreshVisualization(config) {
  const version = ++refreshVersion;
  view.setBusy(true, "正在更新拓扑与理论容量…");
  try {
    const [topology, capacity] = await Promise.all([
      callTool("compute_rank_topology", config),
      callTool("estimate_training_capacity", config),
    ]);
    if (version !== refreshVersion) return;
    view.showResult(topology);
    view.showResult(capacity);
  } catch (error) {
    if (version === refreshVersion) view.showError(error instanceof Error ? error.message : String(error));
  } finally {
    if (version === refreshVersion) view.setBusy(false);
  }
}

async function runSelectedTool(name) {
  const config = view.getConfig();
  if (!config) return view.showError("请先选择内置配置，或导入一份配置。");
  view.setBusy(true, `正在运行 ${name}…`);
  try {
    const result = await callTool(name, config);
    view.showResult(result);
    if (name === "estimate_training_capacity" && !previewMode) {
      const topology = await callTool("compute_rank_topology", config);
      view.showResult(topology);
      view.showResult(result);
    }
  } catch (error) {
    view.showError(error instanceof Error ? error.message : String(error));
  } finally {
    view.setBusy(false);
  }
}

function applyHostContext(context) {
  if (context?.theme) {
    applyDocumentTheme(context.theme);
    document.body.dataset.theme = context.theme;
  }
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

function createPreviewApp() {
  return {
    async callServerTool(request) {
      if (request.name === "parse_training_config") {
        return {
          isError: false,
          structuredContent: {
            ...PREVIEW_RESULTS.parse_training_config,
            data: {
              ...PREVIEW_RESULTS.parse_training_config.data,
              detected_format: request.arguments.source.format === "auto" ? "yaml" : request.arguments.source.format,
              source_name: request.arguments.source.name,
              complete: true,
              missing_required_fields: [],
              normalized_config: structuredClone(DEFAULT_CONFIG),
            },
          },
        };
      }
      const result = PREVIEW_RESULTS[request.name];
      if (!result) throw new Error("独立预览只提供静态演示结果；请在 MCP Inspector 中验证真实调用。");
      return { isError: false, structuredContent: structuredClone(result) };
    },
  };
}
