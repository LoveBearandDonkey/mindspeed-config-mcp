import {
  EP_MF,
  expertDataParallel,
  readParallelConfig,
  topologyScalars,
} from "./page-rules.js";
import { toolResult } from "./result.js";
import { validateParallelConfig } from "./validate-parallel-config.js";

function addToGroup(groups, type, id, rank) {
  const bucket = groups[type];
  if (!bucket.has(id)) bucket.set(id, []);
  bucket.get(id).push(rank);
}

function materializeGroups(groups) {
  return Object.fromEntries(Object.entries(groups).map(([type, values]) => [
    type,
    Array.from(values, ([id, ranks]) => ({ id, ranks })),
  ]));
}

function buildStages(totalLayers, pp) {
  const base = Math.floor(totalLayers / pp);
  const remainder = totalLayers % pp;
  const stages = [];
  let cursor = 0;
  for (let stage = 0; stage < pp; stage += 1) {
    const layerCount = base + (stage < remainder ? 1 : 0);
    stages.push({
      stage,
      layer_start: cursor,
      layer_end: cursor + layerCount - 1,
      layer_count: layerCount,
    });
    cursor += layerCount;
  }
  return stages;
}

export function computeRankTopology(input) {
  const validation = validateParallelConfig(input);
  if (validation.errors.length) {
    return toolResult({
      tool: "compute_rank_topology",
      input,
      status: "invalid",
      errors: validation.errors,
      warnings: validation.warnings,
      assumptions: validation.assumptions,
      data: { valid: false },
    });
  }

  const config = readParallelConfig(input);
  const scalars = topologyScalars(input);
  const mfDomain = config.mode === EP_MF;
  const edp = expertDataParallel(input);
  const ranksPerEp = mfDomain ? config.cp : config.tp * config.cp;
  const ranksPerDp = config.ep * ranksPerEp;
  const ranksPerStage = edp * ranksPerDp;
  const rankOf = (stage, dpIndex, epIndex, inner = 0) => (
    stage * ranksPerStage + dpIndex * ranksPerDp + epIndex * ranksPerEp + inner
  );

  const groupMaps = {
    tp: new Map(),
    pp: new Map(),
    dp: new Map(),
    cp: new Map(),
    ep: new Map(),
    edp: new Map(),
  };
  const ranks = [];

  for (let rank = 0; rank < input.cluster.total_ranks; rank += 1) {
    const stage = Math.floor(rank / ranksPerStage);
    const withinStage = rank - stage * ranksPerStage;
    const dpIndex = Math.floor(withinStage / ranksPerDp);
    const withinDp = withinStage - dpIndex * ranksPerDp;
    const epIndex = Math.floor(withinDp / ranksPerEp);
    const inner = withinDp - epIndex * ranksPerEp;
    const domainIndex = dpIndex * config.ep + epIndex;
    const tpIndex = mfDomain ? domainIndex % config.tp : inner % config.tp;
    const cpIndex = mfDomain ? inner : Math.floor(inner / config.tp);
    const dpIndexReal = mfDomain ? Math.floor(domainIndex / config.tp) : dpIndex;
    const node = Math.floor(rank / input.cluster.ranks_per_node);

    const ids = {
      pp: `pp:offset=${withinStage}`,
      tp: mfDomain
        ? `tp:stage=${stage},dp=${dpIndexReal},cp=${cpIndex}`
        : `tp:stage=${stage},edp=${dpIndex},ep=${epIndex},cp=${cpIndex}`,
      cp: mfDomain
        ? `cp:stage=${stage},domain=${domainIndex}`
        : `cp:stage=${stage},edp=${dpIndex},ep=${epIndex},tp=${tpIndex}`,
      ep: mfDomain
        ? `ep:stage=${stage},edp=${dpIndex},cp=${cpIndex}`
        : `ep:stage=${stage},edp=${dpIndex},tp=${tpIndex},cp=${cpIndex}`,
      dp: `dp:stage=${stage},tp=${tpIndex},cp=${cpIndex}`,
      edp: mfDomain
        ? `edp:stage=${stage},ep=${epIndex},cp=${cpIndex}`
        : `edp:stage=${stage},ep=${epIndex},tp=${tpIndex},cp=${cpIndex}`,
    };

    for (const [type, id] of Object.entries(ids)) addToGroup(groupMaps, type, id, rank);
    ranks.push({
      rank,
      node,
      stage,
      dp_index: dpIndexReal,
      edp_index: dpIndex,
      ep_index: epIndex,
      tp_index: tpIndex,
      cp_index: cpIndex,
      group_ids: ids,
    });
  }

  const stages = buildStages(input.model.total_layers, config.pp).map((stage) => ({
    ...stage,
    ranks: Array.from(
      { length: ranksPerStage },
      (_, offset) => rankOf(stage.stage, 0, 0, offset),
    ),
  }));

  return toolResult({
    tool: "compute_rank_topology",
    input,
    status: "valid",
    warnings: validation.warnings,
    assumptions: [
      "Rank 编址复现 config-relation-plane 页面口径。",
      "Megatron-Core core_v0.12.1 Commit 尚未锁定，因此通信组语义标记为 page-derived。",
    ],
    data: {
      valid: true,
      semantics: "page-derived",
      counts: {
        ...scalars,
        ranks_per_stage: ranksPerStage,
        ranks_per_edp_block: ranksPerDp,
        ranks_per_ep_slice: ranksPerEp,
        nodes: Math.ceil(input.cluster.total_ranks / input.cluster.ranks_per_node),
      },
      stages,
      ranks,
      groups: materializeGroups(groupMaps),
    },
  });
}

