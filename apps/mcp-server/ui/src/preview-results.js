// 仅用于独立页面的视觉验收，不参与 MCP Tool 计算或正式结果生成。
const base = {
  schema_version: "1.0",
  confidence: "deterministic",
  errors: [],
  warnings: [],
  assumptions: ["这是独立预览演示数据；正式结果以 MCP Tool 返回的 structuredContent 为准。"],
};

export const PREVIEW_VIEWS = [
  ["open_config_workbench", "中文配置工作台"],
  ["validate_parallel_config", "并行配置校验"],
  ["compute_rank_topology", "Rank 拓扑矩阵"],
  ["suggest_config_fixes", "配置修复建议"],
  ["parse_training_config", "训练配置解析"],
  ["estimate_training_capacity", "理论容量估算"],
];

export const PREVIEW_RESULTS = {
  validate_parallel_config: {
    ...base,
    tool: "validate_parallel_config",
    status: "valid",
    data: { valid: true, world_size: 16, ep_mode: "split", ep_domain: 4, expert_data_parallel: 2 },
  },
  compute_rank_topology: {
    ...base,
    tool: "compute_rank_topology",
    status: "valid",
    data: {
      valid: true,
      semantics: "page-derived",
      counts: { nodes: 2, total_layers: 8, dense_layers: 2, moe_layers: 6, routed_experts: 8, experts_per_ep_slice: 4 },
      stages: [
        { stage: 0, layer_start: 0, layer_end: 3, layer_count: 4, ranks: [0, 1, 2, 3] },
        { stage: 1, layer_start: 4, layer_end: 7, layer_count: 4, ranks: [4, 5, 6, 7] },
      ],
      layers: Array.from({ length: 8 }, (_, layer) => ({ layer, stage: layer < 4 ? 0 : 1, stage_offset: layer % 4, ffn: layer < 2 ? "dense" : "moe" })),
      expert_slices: [
        { ep_index: 0, expert_start: 0, expert_end: 3, experts: [0, 1, 2, 3] },
        { ep_index: 1, expert_start: 4, expert_end: 7, experts: [4, 5, 6, 7] },
      ],
      ranks: [
        { rank: 0, node: 0, stage: 0, dp_index: 0, edp_index: 0, tp_index: 0, cp_index: 0, ep_index: 0 },
        { rank: 1, node: 0, stage: 0, dp_index: 0, edp_index: 0, tp_index: 1, cp_index: 0, ep_index: 0 },
        { rank: 2, node: 0, stage: 0, dp_index: 1, edp_index: 1, tp_index: 0, cp_index: 0, ep_index: 1 },
        { rank: 3, node: 0, stage: 0, dp_index: 1, edp_index: 1, tp_index: 1, cp_index: 0, ep_index: 1 },
        { rank: 4, node: 1, stage: 1, dp_index: 0, edp_index: 0, tp_index: 0, cp_index: 0, ep_index: 0 },
        { rank: 5, node: 1, stage: 1, dp_index: 0, edp_index: 0, tp_index: 1, cp_index: 0, ep_index: 0 },
        { rank: 6, node: 1, stage: 1, dp_index: 1, edp_index: 1, tp_index: 0, cp_index: 0, ep_index: 1 },
        { rank: 7, node: 1, stage: 1, dp_index: 1, edp_index: 1, tp_index: 1, cp_index: 0, ep_index: 1 },
      ],
    },
  },
  suggest_config_fixes: {
    ...base,
    tool: "suggest_config_fixes",
    status: "invalid",
    errors: [{ code: "MINDSPEED_LAYERS_DIVISIBLE_BY_PP", message: "总层数 31 不能被 PP 2 整除。", formula: "total_layers % pp === 0" }],
    data: {
      already_valid: false,
      solved: true,
      locked_fields: [],
      suggestions: [
        { rank: 1, changes: [{ path: "parallel.pp", old_value: 2, new_value: 1 }, { path: "cluster.total_ranks", old_value: 16, new_value: 8 }] },
        { rank: 2, changes: [{ path: "parallel.cp", old_value: 1, new_value: 2 }] },
      ],
    },
  },
  parse_training_config: {
    ...base,
    tool: "parse_training_config",
    status: "valid",
    data: {
      detected_format: "yaml",
      source_name: "train.yaml",
      complete: false,
      mapped_count: 4,
      explicit_mapped_count: 3,
      derived_count: 1,
      defaulted_count: 0,
      unmapped_count: 1,
      ignored_count: 1,
      mapped_fields: [
        { source_key: "num_layers", target_path: "model.total_layers", value: 32 },
        { source_key: "tensor_model_parallel_size", target_path: "parallel.tp", value: 2 },
        { source_key: "pipeline_model_parallel_size", target_path: "parallel.pp", value: 2 },
        { source_key: "world_size", target_path: "cluster.total_ranks", value: 16 },
      ],
      unmapped_fields: [{ source_key: "custom_flag", value: "kept", reason: "没有已登记的字段映射" }],
      ignored_fields: [{ source_key: "log_interval", value: 10, reason: "训练日志参数不属于统一配置" }],
      missing_required_fields: ["model.hidden_size", "cluster.card_memory_gib"],
    },
  },
  estimate_training_capacity: {
    ...base,
    tool: "estimate_training_capacity",
    status: "estimated",
    confidence: "theoretical",
    data: {
      valid: true,
      bottleneck_stage: 0,
      bottleneck_level: "alert",
      stages: [
        { stage: 0, capacity_gib: 64, total_gib: 57.8, level: "alert", values_gib: { weight: 14, gradient: 7, optimizer: 21, activation: 11.8, reserve: 4 } },
        { stage: 1, capacity_gib: 64, total_gib: 49.2, level: "tight", values_gib: { weight: 12, gradient: 6, optimizer: 18, activation: 9.2, reserve: 4 } },
        { stage: 2, capacity_gib: 64, total_gib: 44.6, level: "safe", values_gib: { weight: 11, gradient: 5.5, optimizer: 16, activation: 8.1, reserve: 4 } },
        { stage: 3, capacity_gib: 64, total_gib: 52.4, level: "tight", values_gib: { weight: 13, gradient: 6.5, optimizer: 19, activation: 9.9, reserve: 4 } },
      ],
    },
  },
};
