import { parseDocument } from "yaml";

import { diagnostic, toolResult } from "./result.js";

const PARSER_SOURCE = "mindspeed-config-mcp:parse-training-config@0.2.0";
const PAGE_IMPORT_SOURCE = "compute-graph-viewer-wzh:config-relation-import.js:162-503@ef39d30";

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
const computeDtype = (value) => {
  const normalized = lower(value);
  if (["bf16", "bfloat16"].includes(normalized)) return "bf16";
  if (["fp16", "float16", "half"].includes(normalized)) return "fp16";
  if (normalized.includes("fp8") || normalized.includes("e4m3") || normalized.includes("e5m2")) return "fp8";
  throw new TypeError(`无法归一化计算精度 ${JSON.stringify(value)}`);
};
const parameterDtype = (value) => {
  const normalized = lower(value);
  if (["fp32", "float32"].includes(normalized)) return "fp32";
  if (["bf16", "bfloat16"].includes(normalized)) return "bf16";
  throw new TypeError(`无法归一化参数精度 ${JSON.stringify(value)}`);
};

const integerList = (value) => {
  const items = Array.isArray(value) ? value : String(value).split(",");
  const parsed = items.map((item) => integer(String(item).trim()));
  if (!parsed.length || parsed.some((item) => item < 1)) {
    throw new TypeError(`期望由正整数组成的列表，实际为 ${JSON.stringify(value)}`);
  }
  return parsed;
};

const FIELD_MAPPINGS = new Map();
const PATH_MAPPINGS = new Map();

function define(aliases, target, convert = text) {
  for (const alias of aliases) FIELD_MAPPINGS.set(normalizeKey(alias), { target, convert });
}

function definePath(aliases, target, convert = text) {
  for (const alias of aliases) PATH_MAPPINGS.set(normalizeSourcePath(alias), { target, convert });
}

define(["model", "model-name", "model-id", "model-name-or-path", "model-type"], "model.id");
define(["num-layers", "num-hidden-layers", "total-layer", "total-layers"], "model.total_layers", integer);
define(["hidden-size", "hidden-dim"], "model.hidden_size", integer);
define(["num-attention-heads", "attention-heads"], "model.num_attention_heads", integer);
define(["num-query-groups", "num-key-value-heads", "num-kv-heads"], "model.num_key_value_heads", integer);
define(["ffn-hidden-size", "intermediate-size"], "model.ffn_hidden_size", integer);
define(["moe-ffn-hidden-size", "expert-ffn-hidden-size", "moe-intermediate-size"], "model.expert_ffn_hidden_size", integer);
define(["padded-vocab-size", "vocab-size"], "model.vocab_size", integer);
define(["first-k-dense-replace", "first-k-dense-layers"], "model.first_k_dense_layers", integer);
define(["num-experts", "routed-experts", "num-routed-experts", "n-routed-experts", "num-local-experts", "expert-num"], "model.routed_experts", integer);
define(["moe-router-topk", "moe-router-top-k", "num-experts-per-tok", "num-experts-per-token", "num-experts-chosen", "top-k"], "model.top_k", integer);
define(["num-shared-experts", "n-shared-experts", "shared-experts", "shared-expert-num"], "model.shared_experts", integer);

define(["data-parallel-size", "data-parallel", "dp"], "parallel.dp", integer);
define(["pipeline-model-parallel-size", "pipeline-parallel-size", "pipeline-stage", "pp"], "parallel.pp", integer);
define(["tensor-model-parallel-size", "tensor-parallel-size", "model-parallel", "tp"], "parallel.tp", integer);
define(["context-parallel-size", "context-parallel", "cp"], "parallel.cp", integer);
define(["expert-model-parallel-size", "expert-parallel-size", "expert-parallel", "ep"], "parallel.ep", integer);
define(["virtual-pipeline-model-parallel-size", "virtual-pipeline-parallel-size", "pp-interleave-num", "vpp"], "parallel.vpp", integer);
define(["pipeline-layer-mode", "pp-layer-mode"], "parallel.pipeline_layer_mode", lower);
define(["num-layer-list", "pipeline-stage-layers"], "parallel.num_layer_list", integerList);
define(["ep-mode", "expert-parallel-mode"], "parallel.ep_mode", lower);
define(["cp-mode", "context-parallel-mode"], "parallel.cp_mode", lower);
define(["context-parallel-algo"], "parallel.cp_mode", (value) => lower(value).includes("ulysses") ? "ulysses" : "ring");
define(["sequence-parallel", "use-seq-parallel"], "parallel.sequence_parallel", boolean);
define(["vocab-embedding-data-parallel", "vocab-emb-dp"], "parallel.vocab_embedding_data_parallel", boolean);
define(["expert-tensor-parallel", "expert-tensor-parallel-size"], "parallel.expert_tensor_parallel", (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric > 1 : boolean(value);
});

define(["world-size", "total-rank", "total-ranks"], "cluster.total_ranks", integer);
define(["nproc-per-node", "ranks-per-node", "device-num"], "cluster.ranks_per_node", integer);
define(["card-model", "device-model"], "cluster.card_model");
define(["card-memory-gib", "device-memory-gib"], "cluster.card_memory_gib", number);

define(["micro-batch-size", "micro-batch", "per-device-train-batch-size", "train-micro-batch-size-per-gpu"], "batch.micro_batch_size", integer);
define(["seq-length", "sequence-length", "cutoff-len"], "batch.sequence_length", integer);
define(["num-microbatches", "micro-batch-count", "micro-batch-num", "gradient-accumulation-steps"], "batch.micro_batch_count", integer);
define(["global-batch-size", "train-batch-size"], "batch.global_batch_size", integer);

define(["compute-dtype", "torch-dtype"], "memory.compute_dtype", computeDtype);
define(["params-dtype", "parameter-dtype"], "memory.parameter_dtype", parameterDtype);
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

definePath(["zero-optimization.stage"], "memory.shard_mode", (value) => {
  const stage = integer(value);
  if (stage >= 3) return "fsdp2";
  if (stage >= 1) return "zero1";
  return "none";
});
definePath(["parallel.enable-parallel-optimizer"], "memory.shard_mode", enabledEnum("zero1", "none"));
definePath(["bf16.enabled"], "memory.compute_dtype", dtypeFlag("bf16"));
definePath(["fp16.enabled"], "memory.compute_dtype", dtypeFlag("fp16"));
define(["finetuning-type"], "memory.lora_enabled", (value) => lower(value) === "lora");

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
    const sourcePath = normalizeSourcePath(entry.key);
    if (["nnodes", "num-nodes", "node-count"].includes(key)) {
      try {
        nodeCount = integer(entry.value);
        ignoredFields.push({ source_key: entry.key, value: entry.value, reason: "用于派生 total_ranks，不直接进入 V1 字段" });
      } catch (error) {
        unmappedFields.push({ source_key: entry.key, value: entry.value, reason: error.message });
      }
      continue;
    }

    const mapping = PATH_MAPPINGS.get(sourcePath) ?? FIELD_MAPPINGS.get(key);
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
      const previous = assigned.get(mapping.target);
      if (previous && previous.value !== value) {
        warnings.push(diagnostic(
          "PARSE_TARGET_OVERWRITTEN",
          `${entry.key} 覆盖了先前映射到 ${mapping.target} 的 ${previous.sourceKey}。`,
          [entry.key, mapping.target],
          "parser-rule",
          PARSER_SOURCE
        ));
      }
      setPath(normalized, mapping.target, value);
      assigned.set(mapping.target, { sourceKey: entry.key, value });
      mappedFields.push({ source_key: entry.key, target_path: mapping.target, value, mapping_kind: "explicit" });
    } catch (error) {
      unmappedFields.push({ source_key: entry.key, value: entry.value, reason: error.message });
    }
  }

  const ranksPerNode = getPath(normalized, "cluster.ranks_per_node");
  if (nodeCount && ranksPerNode && !getPath(normalized, "cluster.total_ranks")) {
    const value = nodeCount * ranksPerNode;
    assignGenerated(normalized, mappedFields, "cluster.total_ranks", value, "nnodes × nproc_per_node", "derived");
  }

  applySourceDerivations({
    detectedFormat,
    entries,
    sourceName: input.source.name,
    normalized,
    mappedFields,
    warnings,
  });

  if (getPath(normalized, "parallel.num_layer_list") !== undefined
    && getPath(normalized, "parallel.pipeline_layer_mode") === undefined) {
    assignGenerated(
      normalized,
      mappedFields,
      "parallel.pipeline_layer_mode",
      "dynamic",
      "检测到 num_layer_list",
      "derived",
    );
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
    assumptions: [
      "解析器只映射已登记字段；未识别字段会显式返回，不会静默丢弃。",
      "mapping_kind=default 的字段采用对应配置方言的省略态；mapping_kind=derived 的字段由同一文件中的显式值推导。",
    ],
    data: {
      detected_format: detectedFormat,
      source_name: input.source.name ?? null,
      complete: missingRequiredFields.length === 0,
      source_field_count: entries.length,
      required_field_count: REQUIRED_PATHS.length,
      filled_required_field_count: REQUIRED_PATHS.length - missingRequiredFields.length,
      mapped_count: mappedFields.length,
      explicit_mapped_count: mappedFields.filter((field) => field.mapping_kind === "explicit").length,
      derived_count: mappedFields.filter((field) => field.mapping_kind === "derived").length,
      defaulted_count: mappedFields.filter((field) => field.mapping_kind === "default").length,
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
    source_field_count: 0,
    required_field_count: REQUIRED_PATHS.length,
    filled_required_field_count: 0,
    mapped_count: 0,
    explicit_mapped_count: 0,
    derived_count: 0,
    defaulted_count: 0,
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

function applySourceDerivations({ detectedFormat, entries, sourceName, normalized, mappedFields, warnings }) {
  const sourcePaths = new Set(entries.map((entry) => normalizeSourcePath(entry.key)));
  const hasPath = (path) => sourcePaths.has(normalizeSourcePath(path));
  const isShell = detectedFormat === "shell";
  const isMindFormers = hasPath("parallel_config.model_parallel")
    || hasPath("parallel_config.pipeline_stage")
    || hasPath("parallel_config.expert_parallel");
  const isHuggingFaceModel = hasPath("model_type") || hasPath("architectures");
  const supportsOmittedDefaults = isShell || isMindFormers;

  const add = (path, value, sourceKey, kind = "derived") => (
    assignGenerated(normalized, mappedFields, path, value, sourceKey, kind)
  );

  if (isShell && sourceName && getPath(normalized, "model.id") === undefined) {
    add("model.id", String(sourceName).replace(/\.[^.]+$/, ""), "Shell 文件名", "derived");
  }

  if (supportsOmittedDefaults) {
    for (const [path, value] of [
      ["parallel.tp", 1],
      ["parallel.pp", 1],
      ["parallel.cp", 1],
      ["parallel.ep", 1],
      ["parallel.vpp", 1],
      ["parallel.ep_mode", isMindFormers ? "mf" : "split"],
      ["parallel.cp_mode", "ring"],
      ["parallel.sequence_parallel", false],
      ["parallel.vocab_embedding_data_parallel", false],
      ["parallel.expert_tensor_parallel", false],
      ["memory.recompute_mode", "none"],
      ["memory.shard_mode", "none"],
      ["memory.lora_enabled", false],
    ]) add(path, value, `${isMindFormers ? "MindFormers" : "Megatron"} 省略态`, "default");
  }

  const routedExperts = getPath(normalized, "model.routed_experts");
  if (routedExperts !== undefined && getPath(normalized, "model.shared_experts") === undefined) {
    add("model.shared_experts", 0, "未声明共享专家", "default");
  }
  if (routedExperts === undefined && (isShell || isHuggingFaceModel)
    && !hasAnyLeaf(sourcePaths, ["num-experts", "n-routed-experts", "num-local-experts", "expert-num"])) {
    add("model.routed_experts", 0, "未声明 MoE 专家字段", "default");
    add("model.top_k", 0, "Dense 模型省略态", "default");
    add("model.shared_experts", 0, "Dense 模型省略态", "default");
  }

  const dp = getPath(normalized, "parallel.dp");
  const pp = getPath(normalized, "parallel.pp");
  const tp = getPath(normalized, "parallel.tp");
  const cp = getPath(normalized, "parallel.cp");
  let totalRanks = getPath(normalized, "cluster.total_ranks");

  if (isMindFormers && totalRanks === undefined && [dp, pp, tp, cp].every(Number.isInteger)) {
    totalRanks = dp * pp * tp * cp;
    add("cluster.total_ranks", totalRanks, "MindFormers DP × PP × TP × CP", "derived");
  }

  if (isShell && dp === undefined && [totalRanks, pp, tp, cp].every(Number.isInteger)) {
    const inferredDp = totalRanks / (pp * tp * cp);
    if (Number.isInteger(inferredDp) && inferredDp >= 1) {
      add("parallel.dp", inferredDp, "world_size ÷ (PP × TP × CP)", "derived");
    } else {
      warnings.push(diagnostic(
        "PARSE_WORLD_SIZE_INCONSISTENT",
        `脚本中的 world size ${totalRanks} 不能形成整数 DP：${totalRanks} ÷ (${pp} × ${tp} × ${cp}) = ${inferredDp}。`,
        ["cluster.total_ranks", "parallel.dp", "parallel.pp", "parallel.tp", "parallel.cp"],
        "parser-rule",
        PAGE_IMPORT_SOURCE,
        "dp = total_ranks / (pp * tp * cp)",
      ));
    }
  }

  const effectiveDp = getPath(normalized, "parallel.dp");
  const globalBatch = getPath(normalized, "batch.global_batch_size");
  const microBatch = getPath(normalized, "batch.micro_batch_size");
  if (getPath(normalized, "batch.micro_batch_count") === undefined
    && [globalBatch, microBatch, effectiveDp].every(Number.isInteger)) {
    const count = globalBatch / (microBatch * effectiveDp);
    if (Number.isInteger(count) && count >= 1) {
      add("batch.micro_batch_count", count, "global_batch_size ÷ (micro_batch_size × DP)", "derived");
    }
  }

  const zeroStage = entries.find((entry) => normalizeSourcePath(entry.key) === "zero-optimization.stage");
  if (zeroStage && Number(zeroStage.value) >= 3) {
    warnings.push(diagnostic(
      "PARSE_ZERO3_APPROXIMATED_AS_FSDP2",
      "统一契约没有 ZeRO-3 档；当前按页面三档口径映射为 fsdp2，仅表示完整参数/梯度/优化器分片，不表示两者运行时实现相同。",
      [zeroStage.key, "memory.shard_mode"],
      "compatibility-gap",
      PAGE_IMPORT_SOURCE,
    ));
  }
}

function assignGenerated(target, mappedFields, path, value, sourceKey, mappingKind) {
  if (getPath(target, path) !== undefined) return false;
  setPath(target, path, value);
  mappedFields.push({
    source_key: sourceKey,
    target_path: path,
    value,
    mapping_kind: mappingKind,
  });
  return true;
}

function hasAnyLeaf(sourcePaths, leaves) {
  const normalizedLeaves = new Set(leaves.map(normalizeKey));
  return [...sourcePaths].some((path) => normalizedLeaves.has(path.split(".").at(-1)));
}

function parseShell(content) {
  const withoutComments = content
    .split(/\r?\n/)
    .map(stripShellComment)
    .join("\n");
  const variables = readShellVariables(withoutComments);
  const joined = withoutComments.replace(/\\\r?\n/g, " ");
  const rawTokens = joined.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g) ?? [];
  const tokens = rawTokens.flatMap((token) => {
    const value = unquote(token);
    if (/^--[^\s]+\s+/.test(value)) {
      const splitAt = value.search(/\s/);
      return [value.slice(0, splitAt), value.slice(splitAt + 1)];
    }
    return [value];
  });
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const equal = token.indexOf("=");
    let key = token.slice(2, equal === -1 ? undefined : equal);
    let value;
    if (equal !== -1) {
      value = token.slice(equal + 1);
    } else if (tokens[index + 1] && !tokens[index + 1].startsWith("--")
      && !isShellDelimiter(tokens[index + 1])) {
      value = tokens[index + 1];
      index += 1;
    } else {
      value = true;
    }
    if (key.startsWith("no-")) {
      key = key.slice(3);
      value = false;
    }
    entries.push({ key, value: resolveShellValue(value, variables) });
  }

  appendShellVariable(entries, variables, "GPUS_PER_NODE", "nproc-per-node");
  appendShellVariable(entries, variables, variables.NNODES === undefined ? "NUM_NODES" : "NNODES", "node-count");
  appendShellVariable(entries, variables, "WORLD_SIZE", "world-size");
  appendShellVariable(entries, variables, "DTYPE", "compute-dtype");
  if (!entries.length) throw new TypeError("没有找到形如 --name value 的启动参数");
  return entries;
}

function stripShellComment(line) {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote && line[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["\"", "'"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function isShellDelimiter(token) {
  return [")", "(", "];", "]"].includes(token) || /^[A-Za-z_][A-Za-z0-9_]*\+?=\($/.test(token);
}

function readShellVariables(content) {
  const variables = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || match[2].trim() === "(") continue;
    variables[match[1]] = unquote(match[2].trim());
  }
  return variables;
}

function resolveShellValue(value, variables, depth = 0) {
  if (typeof value !== "string" || depth > 8) return value;
  let resolved = unquote(value.trim());
  const defaultValue = resolved.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*):-([\s\S]*)\}$/);
  if (defaultValue) {
    const candidate = variables[defaultValue[1]] ?? unquote(defaultValue[2]);
    return resolveShellValue(candidate, variables, depth + 1);
  }
  const reference = resolved.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
  if (reference && variables[reference[1]] !== undefined) {
    return resolveShellValue(variables[reference[1]], variables, depth + 1);
  }
  const arithmetic = resolved.match(/^\$\(\((.*)\)\)$/);
  if (arithmetic) {
    const factors = arithmetic[1].split("*").map((factor) => resolveShellValue(factor.trim(), variables, depth + 1));
    if (factors.length > 1 && factors.every((factor) => Number.isFinite(Number(factor)))) {
      return factors.reduce((product, factor) => product * Number(factor), 1);
    }
  }
  return resolved;
}

function appendShellVariable(entries, variables, variable, key) {
  if (!variable || variables[variable] === undefined) return;
  const value = resolveShellValue(variables[variable], variables);
  if (typeof value === "string" && value.startsWith("$")) return;
  entries.push({ key, value });
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

function normalizeSourcePath(path) {
  return String(path).split(".").map(normalizeKey).join(".");
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
