/**
 * 从 config-relation-plane 的共享规则层抽取出的无界面计算。
 *
 * 来源：compute-graph-viewer-wzh/Profiling_Insight_and_Tool/shared/plane-rules.js
 * 基线 Commit：1e6bb6eabe60f75b2486188b3b08b59f65d33621
 */

export const EP_SPLIT = "split";
export const EP_ORTHOGONAL = "orthogonal";
export const EP_MF = "mf";

export function normalizeEpMode(mode) {
  if (mode === EP_ORTHOGONAL || mode === "ortho") return EP_ORTHOGONAL;
  if (mode === EP_MF) return EP_MF;
  return EP_SPLIT;
}

export function readParallelConfig(input) {
  const parallel = input?.parallel ?? {};
  const model = input?.model ?? {};
  return {
    mode: normalizeEpMode(parallel.ep_mode),
    layers: Number(model.total_layers),
    dp: Number(parallel.dp),
    pp: Number(parallel.pp),
    tp: Number(parallel.tp),
    cp: Number(parallel.cp),
    ep: Number(parallel.ep),
    vpp: Number(parallel.vpp),
    routed: Number(model.routed_experts),
    topk: Number(model.top_k),
  };
}

export function epDomain(input) {
  const config = readParallelConfig(input);
  return config.mode === EP_MF ? config.dp * config.tp : config.dp;
}

export function epInWorld(input) {
  const config = readParallelConfig(input);
  return config.mode === EP_ORTHOGONAL ? config.ep : 1;
}

export function parallelWorld(input) {
  const config = readParallelConfig(input);
  return config.dp * config.pp * config.tp * config.cp * epInWorld(input);
}

export function dpReplica(input) {
  const config = readParallelConfig(input);
  return config.mode === EP_ORTHOGONAL ? config.dp * config.ep : config.dp;
}

export function expertDataParallel(input) {
  const config = readParallelConfig(input);
  if (config.mode === EP_ORTHOGONAL) return config.dp;
  return Math.max(1, Math.floor(epDomain(input) / config.ep));
}

export function epGroupRows(input) {
  const config = readParallelConfig(input);
  return config.mode === EP_MF ? config.ep : config.ep * config.tp;
}

export function ranksPerStage(input) {
  const config = readParallelConfig(input);
  return dpReplica(input) * config.tp;
}

export function topologyScalars(input) {
  const config = readParallelConfig(input);
  return {
    mode: config.mode,
    dp: dpReplica(input),
    pp: config.pp,
    tp: config.tp,
    cp: config.cp,
    ep: config.ep,
    rows: ranksPerStage(input),
    rank_count_per_stage: ranksPerStage(input) * config.cp,
    group_rows: epGroupRows(input),
    edp: expertDataParallel(input),
    world: parallelWorld(input),
    d_axis: config.mode !== EP_ORTHOGONAL && config.ep > 1 ? "EDP" : "DP",
  };
}
