export function createPlaneModel(topology, { layerDetail = true } = {}) {
  if (!topology?.valid) return null;
  const ranksById = new Map(topology.ranks.map((rank) => [rank.rank, rank]));
  const stagesById = new Map(topology.stages.map((stage) => [stage.stage, stage]));
  const columns = layerDetail
    ? topology.layers.map((layer) => ({ id: `layer-${layer.layer}`, label: `L${layer.layer}`, ...layer }))
    : topology.stages.map((stage) => ({ id: `stage-${stage.stage}`, label: `S${stage.stage}`, stage: stage.stage, ffn: "stage" }));
  const rowCount = Math.max(...topology.stages.map((stage) => stage.ranks.length), 0);
  return { topology, ranksById, stagesById, columns, rowCount };
}

export function rankAt(model, column, row) {
  const stage = model.stagesById.get(column.stage);
  const rankId = stage?.ranks[row];
  return rankId === undefined ? null : model.ranksById.get(rankId) ?? null;
}

export function expertSliceFor(topology, epIndex) {
  return topology.expert_slices?.find((slice) => slice.ep_index === epIndex) ?? null;
}

export function memoryForStage(capacity, stageId) {
  return capacity?.stages?.find((stage) => stage.stage === stageId) ?? null;
}

export function memoryGradient(values = {}) {
  const parts = ["weight", "gradient", "optimizer", "activation", "reserve"];
  const colors = ["#668cff", "#55c4e8", "#ad7cff", "#f0a553", "#596477"];
  const total = parts.reduce((sum, key) => sum + Math.max(0, values[key] ?? 0), 0) || 1;
  let cursor = 0;
  const stops = [];
  parts.forEach((key, index) => {
    const start = cursor / total * 100;
    cursor += Math.max(0, values[key] ?? 0);
    const end = cursor / total * 100;
    stops.push(`${colors[index]} ${start}%`, `${colors[index]} ${end}%`);
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
