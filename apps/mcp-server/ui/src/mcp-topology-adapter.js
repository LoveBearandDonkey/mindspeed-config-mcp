function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function topologyInputKey(input) {
  return JSON.stringify(stableValue(input));
}

function groupMap(groups = {}) {
  return Object.fromEntries(Object.entries(groups).map(([type, values]) => [
    type,
    new Map((values ?? []).map((group) => [group.id, group])),
  ]));
}

export function adaptRankTopology(pageTopology, result) {
  if (!pageTopology || result?.status !== "valid" || !result.data?.valid) return null;
  const data = result.data;
  const rankRecords = data.ranks ?? [];
  const stages = (data.stages ?? []).map((stage) => ({
    stage: stage.stage,
    lo: stage.layer_start,
    hi: stage.layer_end,
    count: stage.layer_count,
    ranks: [...(stage.ranks ?? [])],
  }));
  const stageById = new Map(stages.map((stage) => [stage.stage, stage]));
  const pageLayers = new Map((pageTopology.layers ?? []).map((layer) => [layer.index, layer]));
  const layers = (data.layers ?? []).map((layer) => ({
    index: layer.layer,
    stage: layer.stage,
    ffn: layer.ffn,
    attention: pageLayers.get(layer.layer)?.attention ?? "std",
  }));
  const layerById = new Map(layers.map((layer) => [layer.index, layer]));
  const expertSlices = data.expert_slices ?? [];
  const epRanks = expertSlices.map((slice) => ({
    epRank: slice.ep_index,
    experts: [...(slice.experts ?? [])],
    lo: slice.expert_start,
    hi: slice.expert_end,
  }));
  const rankById = new Map(rankRecords.map((rank) => [rank.rank, rank]));
  const groupsById = groupMap(data.groups);
  const ranksPerNode = positiveInteger(pageTopology.config?.node
    ? Math.ceil(rankRecords.length / pageTopology.config.node)
    : pageTopology.counts?.ranksPerNode);

  const recordsMatching = (predicate) => rankRecords.filter(predicate).map(({ rank }) => rank);
  const ranksOfStage = (stage) => [...(stageById.get(stage)?.ranks ?? [])];
  const stageOfLayer = (layer) => layerById.get(layer)?.stage;
  const epRankOfExpert = (expert) => expertSlices.find((slice) => (
    expert >= slice.expert_start && expert <= slice.expert_end
  ))?.ep_index ?? 0;
  const expertsOfEpRank = (epRank) => [...(epRanks[epRank]?.experts ?? [])];
  const nodeOfRank = (rank) => rankById.get(rank)?.node ?? Math.floor(rank / ranksPerNode);
  const coordsOfRank = (rank) => {
    const record = rankById.get(rank);
    if (!record) return null;
    const sameSlice = rankRecords.filter((item) => (
      item.stage === record.stage
      && item.edp_index === record.edp_index
      && item.ep_index === record.ep_index
    ));
    return {
      rank: record.rank,
      stage: record.stage,
      dpIdx: record.edp_index,
      epIdx: record.ep_index,
      tpIdx: record.tp_index,
      cpIdx: record.cp_index,
      dpReal: record.dp_index,
      inner: Math.max(0, sameSlice.findIndex((item) => item.rank === rank)),
      node: record.node,
      groupIds: { ...record.group_ids },
    };
  };
  const rankOf = (stage, dpIdx, epIdx, inner = 0) => recordsMatching((record) => (
    record.stage === stage && record.edp_index === dpIdx && record.ep_index === epIdx
  ))[inner];
  const rankOfCoords = (stage, dpIdx, epIdx, tpIdx = 0, cpIdx = 0) => rankRecords.find((record) => (
    record.stage === stage
    && record.edp_index === dpIdx
    && record.ep_index === epIdx
    && record.tp_index === tpIdx
    && record.cp_index === cpIdx
  ))?.rank;
  const shardOf = (dpIdx, epIdx, inner = 0) => {
    const coords = coordsOfRank(rankOf(0, dpIdx, epIdx, inner));
    return {
      tpIdx: coords?.tpIdx ?? 0,
      cpIdx: coords?.cpIdx ?? 0,
      dpReal: coords?.dpReal ?? dpIdx,
    };
  };
  const ranksOfStageInDp = (stage, dpIdx = 0) => recordsMatching((record) => (
    record.stage === stage && record.edp_index === dpIdx
  ));
  const ranksOfLayer = (layer) => ranksOfStage(stageOfLayer(layer));
  const ranksOfLayerInDp = (layer, dpIdx = 0) => ranksOfStageInDp(stageOfLayer(layer), dpIdx);
  const ranksOfExpertInLayer = (layer, expert) => {
    const stage = stageOfLayer(layer);
    const epIndex = epRankOfExpert(expert);
    return recordsMatching((record) => record.stage === stage && record.ep_index === epIndex);
  };
  const ranksOfEpRankInStage = (stage, epIndex) => recordsMatching((record) => (
    record.stage === stage && record.ep_index === epIndex
  ));
  const nodesOfRanks = (ranks) => Array.from(new Set(ranks.map(nodeOfRank))).sort((a, b) => a - b);

  const counts = {
    ...pageTopology.counts,
    totalLayer: data.counts?.total_layers ?? layers.length,
    denseLayers: data.counts?.dense_layers ?? layers.filter(({ ffn }) => ffn === "dense").length,
    moeLayers: data.counts?.moe_layers ?? layers.filter(({ ffn }) => ffn === "moe").length,
    routedExpert: data.counts?.routed_experts ?? pageTopology.counts?.routedExpert ?? 0,
    expertsPerEpRank: data.counts?.experts_per_ep_slice ?? epRanks[0]?.experts.length ?? 0,
    dp: data.counts?.dp ?? pageTopology.counts?.dp,
    edp: data.counts?.edp ?? pageTopology.counts?.edp,
    ep: data.counts?.ep ?? pageTopology.counts?.ep,
    pp: data.counts?.pp ?? stages.length,
    tp: data.counts?.tp ?? pageTopology.counts?.tp,
    cp: data.counts?.cp ?? pageTopology.counts?.cp,
    totalRank: rankRecords.length,
    node: data.counts?.nodes ?? data.nodes?.length ?? pageTopology.counts?.node,
    ranksPerNode,
    tailRanks: data.nodes?.at(-1)?.ranks?.length ?? pageTopology.counts?.tailRanks,
    ranksPerStage: data.counts?.ranks_per_stage ?? stages[0]?.ranks.length ?? 0,
    ranksPerDp: data.counts?.ranks_per_edp_block ?? pageTopology.counts?.ranksPerDp,
    ranksPerEp: data.counts?.ranks_per_ep_slice ?? pageTopology.counts?.ranksPerEp,
    epMode: data.counts?.mode ?? pageTopology.counts?.epMode,
    moeOrthogonal: (data.counts?.mode ?? pageTopology.counts?.epMode) === "orthogonal",
  };

  return {
    ...pageTopology,
    valid: true,
    stages,
    layers,
    epRanks,
    counts,
    hasMoe: counts.moeLayers > 0,
    mcpResult: result,
    mcpGroups: data.groups ?? {},
    mcpGroupsById: groupsById,
    stageOfLayer,
    epRankOfExpert,
    expertsOfEpRank,
    rankOf,
    rankOfCoords,
    nodeOfRank,
    coordsOfRank,
    shardOf,
    ranksOfStage,
    ranksOfLayer,
    ranksOfStageInDp,
    ranksOfLayerInDp,
    ranksOfExpertInLayer,
    ranksOfEpRankInStage,
    nodesOfRanks,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticSummary(result) {
  const errors = result?.errors ?? [];
  if (!errors.length) return "当前配置未生成可用的 Rank 拓扑。";
  return errors.slice(0, 2).map((item) => item.message ?? String(item)).join("；");
}

export function installTopologyAdapter(callTopologyTool, trainingConfigFor) {
  let token = 0;
  let cached = null;
  let pendingKey = null;
  let lastPageTopology = null;

  function setStatus(state, text, detail = "") {
    const heat = document.getElementById("croHeat");
    heat?.classList.toggle("is-mcp-topology-stale", state !== "valid");
    heat?.setAttribute("aria-busy", String(state === "pending"));
    if (!heat) return;
    heat.dataset.mcpTopologyState = state;
    heat.dataset.mcpTopologyMessage = text;
    if (detail) heat.dataset.mcpTopologyDetail = detail;
    else delete heat.dataset.mcpTopologyDetail;
  }

  async function request(pageTopology, input, key) {
    const currentToken = ++token;
    pendingKey = key;
    setStatus("pending", "正在更新 Rank 拓扑…", "调用 compute_rank_topology；不启动训练，不连接远端集群。");
    try {
      const result = await callTopologyTool(input);
      if (currentToken !== token) return;
      pendingKey = null;
      if (result.status !== "valid" || !result.data?.valid) {
        cached = null;
        setStatus("invalid", "Rank 拓扑不可用", diagnosticSummary(result));
        return;
      }
      const topology = adaptRankTopology(pageTopology, result);
      if (!topology) throw new Error("compute_rank_topology 返回了无法渲染的结果。");
      cached = { key, topology };
      setStatus(
        "valid",
        `MCP Rank 拓扑 · ${result.data.semantics ?? "page-derived"}`,
        "静态计算，不是训练实测；不采集实时指标，不连接远端集群。",
      );
      window.croObserver?.refresh();
    } catch (error) {
      if (currentToken !== token) return;
      pendingKey = null;
      cached = null;
      setStatus("error", "Rank 拓扑调用失败", errorMessage(error));
    }
  }

  function resolve(pageTopology) {
    lastPageTopology = pageTopology;
    if (!pageTopology?.valid) return null;
    let input;
    try {
      input = trainingConfigFor(pageTopology.config);
    } catch (error) {
      setStatus("error", "Rank 拓扑输入不可用", errorMessage(error));
      return null;
    }
    const key = topologyInputKey(input);
    if (cached?.key === key) return cached.topology;
    if (pendingKey !== key) request(pageTopology, input, key);
    return null;
  }

  function peek(pageTopology) {
    if (!pageTopology?.valid || !cached) return null;
    try {
      return cached.key === topologyInputKey(trainingConfigFor(pageTopology.config))
        ? cached.topology : null;
    } catch {
      return null;
    }
  }

  function refresh() {
    token += 1;
    pendingKey = null;
    cached = null;
    const topology = window.croObserver?.topology ?? lastPageTopology;
    if (topology) resolve(topology.mcpResult ? lastPageTopology : topology);
  }

  function invalidate(pageTopology) {
    token += 1;
    pendingKey = null;
    cached = null;
    lastPageTopology = pageTopology;
    setStatus(
      "invalid",
      "Rank 拓扑等待合法配置",
      "当前表单未通过页面基础约束；旧矩阵已标记为失效，不会作为当前配置结果。",
    );
  }

  window.__mcpTopologyAdapter = { resolve, peek, invalidate };
  document.addEventListener("mcp:pipeline-settings-change", () => refresh());
  document.addEventListener("mcp:parsed-config-applied", () => window.setTimeout(refresh, 0));
  document.addEventListener("mcp:retry-requested", (event) => {
    if (event.detail?.tool === "compute_rank_topology") refresh();
  });
  const mount = () => {
    if (window.croObserver) window.croObserver.refresh();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();

  return {
    refresh,
    invalidate,
    reveal: () => document.getElementById("croHeat")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    }),
  };
}
