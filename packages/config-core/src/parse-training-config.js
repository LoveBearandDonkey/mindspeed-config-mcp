import { parseDocument } from "yaml";

import { diagnostic, toolResult } from "./result.js";

const PARSER_SOURCE = "mindspeed-config-mcp:parse-training-config@0.1.0";

const REQUIRED_PATHS = Object.freeze([
  "model.id",
  "model.total_layers",
  "model.hidden_size",
  "model.num_attention_heads",
  "model.routed_experts",
  "model.top_k",
  "model.shared_experts",
  "parallel.dp",
  "parallel.pp",
  "parallel.tp",
  "parallel.cp",
  "parallel.ep",
  "parallel.vpp",
  "parallel.ep_mode",
  "parallel.cp_mode",
  "parallel.sequence_parallel",
  "parallel.vocab_embedding_data_parallel",
  "parallel.expert_tensor_parallel",
  "cluster.total_ranks",
  "cluster.ranks_per_node",
  "cluster.card_model",
  "cluster.card_memory_gib",
  "batch.micro_batch_size",
  "batch.sequence_length",
  "batch.micro_batch_count",
  "memory.compute_dtype",
  "memory.parameter_dtype",
  "memory.recompute_mode",
  "memory.shard_mode",
  "memory.lora_enabled"
]);

const integer = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new TypeError(`期望整数，实际为 ${JSON.stringify(value)}`);
  return parsed;
};

const number = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`期望数字，实际为 ${JSON.stringify(value)}`);
  return parsed;
};

const boolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "none", "null"].includes(normalized)) return false;
  throw new TypeError(`期望布尔值，实际为 ${JSON.stringify(value)}`);
};

const text = (value) => String(value);
const lower = (value) => String(value).trim().toLowerCase();
const enabledEnum = (enabled, disabled) => (value) => (boolean(value) ? enabled : disabled);
const dtypeFlag = (dtype) => (value) => (boolean(value) ? dtype : undefined);

const FIELD_MAPPINGS = new Map();

function define(aliases, target, convert = text) {
  for (const alias of aliases) FIELD_MAPPINGS.set(normalizeKey(alias), { target, convert });
}

define(["model", "model-name", "model-id"], "model.id");
define(["num-layers", "num-hidden-layers", "total-layer", "total-layers"], "model.total_layers", integer);
define(["hidden-size", "hidden-dim"], "model.hidden_size", integer);
define(["num-attention-heads", "attention-heads"], "model.num_attention_heads", integer);
define(["num-query-groups", "num-key-value-heads", "num-kv-heads"], "model.num_key_value_heads", integer);
define(["ffn-hidden-size", "intermediate-size"], "model.ffn_hidden_size", integer);
define(["moe-ffn-hidden-size", "expert-ffn-hidden-size", "moe-intermediate-size"], "model.expert_ffn_hidden_size", integer);
define(["padded-vocab-size", "vocab-size"], "model.vocab_size", integer);
define(["first-k-dense-replace", "first-k-dense-layers"], "model.first_k_dense_layers", integer);
define(["num-experts", "routed-experts", "num-routed-experts"], "model.routed_experts", integer);
define(["moe-router-topk", "moe-router-top-k", "num-experts-per-tok", "top-k"], "model.top_k", integer);
define(["num-shared-experts", "shared-experts"], "model.shared_experts", integer);

define(["data-parallel-size", "data-parallel", "dp"], "parallel.dp", integer);
define(["pipeline-model-parallel-size", "pipeline-parallel-size", "pp"], "parallel.pp", integer);
define(["tensor-model-parallel-size", "tensor-parallel-size", "tp"], "parallel.tp", integer);
define(["context-parallel-size", "cp"], "parallel.cp", integer);
define(["expert-model-parallel-size", "expert-parallel-size", "ep"], "parallel.ep", integer);
define(["virtual-pipeline-model-parallel-size", "virtual-pipeline-parallel-size", "vpp"], "parallel.vpp", integer);
define(["ep-mode", "expert-parallel-mode"], "parallel.ep_mode", lower);
define(["cp-mode", "context-parallel-mode"], "parallel.cp_mode", lower);
define(["context-parallel-algo"], "parallel.cp_mode", (value) => lower(value).includes("ulysses") ? "ulysses" : "ring");
define(["sequence-parallel"], "parallel.sequence_parallel", boolean);
define(["vocab-embedding-data-parallel", "vocab-emb-dp"], "parallel.vocab_embedding_data_parallel", boolean);
define(["expert-tensor-parallel", "expert-tensor-parallel-size"], "parallel.expert_tensor_parallel", (value) => typeof value === "number" ? value > 1 : boolean(value));

define(["world-size", "total-rank", "total-ranks"], "cluster.total_ranks", integer);
define(["nproc-per-node", "ranks-per-node", "device-num"], "cluster.ranks_per_node", integer);
define(["card-model", "device-model"], "cluster.card_model");
define(["card-memory-gib", "device-memory-gib"], "cluster.card_memory_gib", number);

define(["micro-batch-size", "micro-batch"], "batch.micro_batch_size", integer);
define(["seq-length", "sequence-length"], "batch.sequence_length", integer);
define(["num-microbatches", "micro-batch-count"], "batch.micro_batch_count", integer);
define(["global-batch-size"], "batch.global_batch_size", integer);

define(["compute-dtype"], "memory.compute_dtype", lower);
define(["params-dtype", "parameter-dtype"], "memory.parameter_dtype", lower);
define(["bf16"], "memory.compute_dtype", dtypeFlag("bf16"));
define(["fp16"], "memory.compute_dtype", dtypeFlag("fp16"));
define(["fp8", "fp8-format"], "memory.compute_dtype", () => "fp8");
define(["recompute-mode", "recompute-granularity"], "memory.recompute_mode", lower);
define(["recompute"], "memory.recompute_mode", enabledEnum("full", "none"));
define(["recompute-num-layers", "recompute-layers"], "memory.recompute_layers", integer);
define(["shard-mode"], "memory.shard_mode", lower);
define(["use-distributed-optimizer", "parallel-optimizer"], "memory.shard_mode", enabledEnum("zero1", "none"));
define(["use-fsdp2", "fsdp2"], "memory.shard_mode", enabledEnum("fsdp2", "none"));
define(["lora", "lora-enabled"], "memory.lora_enabled", boolean);
define(["lora-rank"], "memory.lora_rank", integer);

const IGNORED_KEYS = new Set([
  "data-path", "dataset", "tokenizer-model", "tokenizer-name-or-path", "tokenizer-type",
  "load", "save", "save-interval", "log-interval", "eval-interval", "eval-iters",
  "train-iters", "train-samples", "lr", "min-lr", "lr-decay-style", "weight-decay",
  "adam-beta1", "adam-beta2", "clip-grad", "master-addr", "master-port", "node-rank",
  "distributed-backend", "wandb-project", "tensorboard-dir", "seed"
]);

export function parseTrainingConfig(input) {
  const detectedFormat = detectFormat(input.source.content, input.source.format, input.source.name);
  let entries;
  try {
    entries = detectedFormat === "shell"
      ? parseShell(input.source.content)
      : parseStructured(input.source.content, detectedFormat);
  } catch (error) {
    return toolResult({
      tool: "parse_training_config",
      input,
      status: "error",
      errors: [diagnostic(
        "PARSE_SYNTAX_ERROR",
        `无法按 ${detectedFormat} 解析输入：${error.message}`,
        ["source.content"],
        "parser-rule",
        PARSER_SOURCE
      )],
      data: emptyData(input, detectedFormat)
    });
  }

  const normalized = {
    schema_version: "1.0",
    rule_profile: { ...input.rule_profile }
  };
  const mappedFields = [];
  const unmappedFields = [];
  const ignoredFields = [];
  const warnings = [];
  const assigned = new Map();
  let nodeCount;

  for (const entry of entries) {
    const key = normalizeKey(entry.key.split(".").at(-1));
    if (["nnodes", "num-nodes", "node-count"].includes(key)) {
      try {
        nodeCount = integer(entry.value);
        ignoredFields.push({ source_key: entry.key, value: entry.value, reason: "用于派生 total_ranks，不直接进入 V1 字段" });
      } catch (error) {
        unmappedFields.push({ source_key: entry.key, value: entry.value, reason: error.message });
      }
      continue;
    }

    const mapping = FIELD_MAPPINGS.get(key);
    if (!mapping) {
      if (IGNORED_KEYS.has(key)) {
        ignoredFields.push({ source_key: entry.key, value: entry.value, reason: "不属于第一版统一训练配置契约" });
      } else {
        unmappedFields.push({ source_key: entry.key, value: entry.value, reason: "没有已登记的字段映射" });
      }
      continue;
    }

    try {
      const value = mapping.convert(entry.value);
      if (value === undefined) {
        ignoredFields.push({ source_key: entry.key, value: entry.value, reason: "关闭态不覆盖已有目标字段" });
        continue;
      }
      if (assigned.has(mapping.target)) {
        warnings.push(diagnostic(
          "PARSE_TARGET_OVERWRITTEN",
          `${entry.key} 覆盖了先前映射到 ${mapping.target} 的 ${assigned.get(mapping.target)}。`,
          [entry.key, mapping.target],
          "parser-rule",
          PARSER_SOURCE
        ));
      }
      setPath(normalized, mapping.target, value);
      assigned.set(mapping.target, entry.key);
      mappedFields.push({ source_key: entry.key, target_path: mapping.target, value });
    } catch (error) {
      unmappedFields.push({ source_key: entry.key, value: entry.value, reason: error.message });
    }
  }

  const ranksPerNode = getPath(normalized, "cluster.ranks_per_node");
  if (nodeCount && ranksPerNode && !getPath(normalized, "cluster.total_ranks")) {
    const value = nodeCount * ranksPerNode;
    setPath(normalized, "cluster.total_ranks", value);
    mappedFields.push({ source_key: "nnodes × nproc_per_node", target_path: "cluster.total_ranks", value });
  }

  const missingRequiredFields = REQUIRED_PATHS.filter((path) => getPath(normalized, path) === undefined);
  if (missingRequiredFields.length) {
    warnings.push(diagnostic(
      "PARSE_INCOMPLETE",
      `已完成字段映射，但距离可直接调用其余工具还缺少 ${missingRequiredFields.length} 个必填字段。`,
      missingRequiredFields,
      "parser-rule",
      PARSER_SOURCE
    ));
  }

  return toolResult({
    tool: "parse_training_config",
    input,
    status: "valid",
    warnings,
    assumptions: ["解析器只映射已登记字段；未识别字段会显式返回，不会静默丢弃。"],
    data: {
      detected_format: detectedFormat,
      source_name: input.source.name ?? null,
      complete: missingRequiredFields.length === 0,
      mapped_count: mappedFields.length,
      unmapped_count: unmappedFields.length,
      ignored_count: ignoredFields.length,
      normalized_config: normalized,
      mapped_fields: mappedFields,
      unmapped_fields: unmappedFields,
      ignored_fields: ignoredFields,
      missing_required_fields: missingRequiredFields
    }
  });
}

function emptyData(input, format) {
  return {
    detected_format: format,
    source_name: input.source.name ?? null,
    complete: false,
    mapped_count: 0,
    unmapped_count: 0,
    ignored_count: 0,
    normalized_config: { schema_version: "1.0", rule_profile: { ...input.rule_profile } },
    mapped_fields: [],
    unmapped_fields: [],
    ignored_fields: [],
    missing_required_fields: [...REQUIRED_PATHS]
  };
}

function detectFormat(content, requested, name = "") {
  if (requested !== "auto") return requested;
  const extension = name.toLowerCase().split(".").at(-1);
  if (extension === "json") return "json";
  if (["sh", "bash"].includes(extension)) return "shell";
  if (["yaml", "yml"].includes(extension)) return "yaml";
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^#!.*\b(?:ba)?sh\b/m.test(trimmed) || /(?:^|\s)--[a-zA-Z0-9][\w-]*/.test(trimmed)) return "shell";
  return "yaml";
}

function parseStructured(content, format) {
  let value;
  if (format === "json") {
    value = JSON.parse(content);
  } else {
    const document = parseDocument(content, { prettyErrors: true, uniqueKeys: false });
    if (document.errors.length) throw document.errors[0];
    value = document.toJS();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("配置根节点必须是对象");
  }
  return flatten(value);
}

function parseShell(content) {
  const joined = content.replace(/\\\r?\n/g, " ");
  const tokens = joined.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g) ?? [];
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const equal = token.indexOf("=");
    let key = token.slice(2, equal === -1 ? undefined : equal);
    let value;
    if (equal !== -1) {
      value = unquote(token.slice(equal + 1));
    } else if (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      value = unquote(tokens[index + 1]);
      index += 1;
    } else {
      value = true;
    }
    if (key.startsWith("no-")) {
      key = key.slice(3);
      value = false;
    }
    entries.push({ key, value });
  }
  if (!entries.length) throw new TypeError("没有找到形如 --name value 的启动参数");
  return entries;
}

function flatten(value, prefix = "", output = []) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, path, output);
    else output.push({ key: path, value: child });
  }
  return output;
}

function normalizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/^--?/, "")
    .replace(/[_.\s]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((cursor, part) => cursor?.[part], target);
}
