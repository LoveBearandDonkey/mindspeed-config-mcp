import { topologyInputKey } from "./mcp-topology-adapter.js";

const LEVEL_LABELS = Object.freeze({ safe: "安全", tight: "偏满", alert: "预警", over: "越界" });
const SEGMENTS = Object.freeze([
  ["base", "运行时底座", "base"],
  ["weight", "权重分片", "weight"],
  ["gradient", "梯度", "grad"],
  ["optimizer", "优化器状态", "optim"],
  ["activation", "激活分片", "act"],
  ["reserve", "预留 buffer/碎片", "reserve"],
]);

function finite(value) {
  return Number.isFinite(Number(value));
}

function validStage(stage) {
  return Number.isInteger(stage?.stage)
    && finite(stage.capacity_gib)
    && finite(stage.total_gib)
    && finite(stage.ratio)
    && Object.hasOwn(LEVEL_LABELS, stage.level)
    && SEGMENTS.every(([key]) => finite(stage.values_gib?.[key]));
}

export function capacityViewModel(result, selectedStage = null) {
  if (result?.tool !== "estimate_training_capacity"
    || result.status !== "estimated"
    || result.confidence !== "theoretical"
    || result.data?.valid !== true) return null;
  const stages = [...(result.data.stages ?? [])].filter(validStage)
    .sort((left, right) => left.stage - right.stage);
  if (!stages.length || stages.length !== result.data.stages.length) return null;
  const bottleneck = stages.find(({ stage }) => stage === result.data.bottleneck_stage)
    ?? stages.reduce((largest, current) => current.ratio > largest.ratio ? current : largest);
  const shown = stages.find(({ stage }) => stage === selectedStage) ?? bottleneck;
  return {
    confidence: result.confidence,
    assumptions: [...(result.assumptions ?? [])],
    warnings: [...(result.warnings ?? [])],
    thresholds: { ...result.data.thresholds },
    runtimeCoefficients: { ...result.data.runtime_coefficients },
    bottleneckStage: bottleneck.stage,
    bottleneckLevel: bottleneck.level,
    shown,
    stages,
  };
}

export function capacityMeasurements(result) {
  const model = capacityViewModel(result);
  if (!model) return [];
  const gib = 1024 * 1024 * 1024;
  return model.stages.map((stage) => ({
    stage: stage.stage,
    cap: stage.capacity_gib * gib,
    total: stage.total_gib * gib,
    ratio: stage.ratio,
    layers: stage.layers,
    inflight: stage.inflight_micro_batches,
    inflightFull: stage.full_pipeline_inflight,
    microBatchNum: stage.micro_batch_count,
    chunks: stage.vpp_chunks,
    recomputed: stage.recomputed_layers,
    values: {
      base: stage.values_gib.base * gib,
      weight: stage.values_gib.weight * gib,
      grad: stage.values_gib.gradient * gib,
      optim: stage.values_gib.optimizer * gib,
      act: stage.values_gib.activation * gib,
      reserve: stage.values_gib.reserve * gib,
    },
    reserveParts: {
      comm: (stage.reserve_parts_gib?.communication ?? 0) * gib,
      workspace: (stage.reserve_parts_gib?.workspace ?? 0) * gib,
      frag: (stage.reserve_parts_gib?.fragmentation ?? 0) * gib,
      unshard: (stage.reserve_parts_gib?.fsdp_unshard ?? 0) * gib,
    },
  }));
}

function make(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

function formatGiB(value) {
  return `${Number(value).toFixed(1)} GiB`;
}

function segmentColor(key) {
  return ({
    base: "var(--cro-cap-base)",
    weight: "var(--cro-cap-weight)",
    gradient: "var(--cro-cap-grad)",
    optimizer: "var(--cro-cap-optim)",
    activation: "var(--cro-cap-act)",
    reserve: "var(--cro-cap-reserve)",
  })[key];
}

function appendSvgTitle(node, text) {
  const title = svgNode("title");
  title.textContent = text;
  node.append(title);
}

function renderCapacityScene(host, stage, thresholds) {
  host.replaceChildren();
  const isoC = Math.cos(Math.PI / 6);
  const isoS = Math.sin(Math.PI / 6);
  const box = { width: 5.2, depth: 4, height: 9.6, inset: 0.26 };
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let overhangX0 = Infinity;
  const project = (x, y, z) => {
    const px = (x - z) * isoC;
    const py = (x + z) * isoS - y;
    bounds.x0 = Math.min(bounds.x0, px);
    bounds.x1 = Math.max(bounds.x1, px);
    bounds.y0 = Math.min(bounds.y0, py);
    bounds.y1 = Math.max(bounds.y1, py);
    return [px, py];
  };
  const points = (values) => values.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(" ");
  const svg = svgNode("svg", { role: "img", "aria-label": `Stage${stage.stage} 理论显存等距示意` });
  const group = svgNode("g");
  svg.append(group);

  const solid = (y, height, color, { title, dashed = false, opacity = null } = {}) => {
    const x = box.inset;
    const z = box.inset;
    const width = box.width - box.inset * 2;
    const depth = box.depth - box.inset * 2;
    const p = (dx, dy, dz) => project(x + dx, y + dy, z + dz);
    const faces = [
      [points([p(0, height, 0), p(width, height, 0), p(width, height, depth), p(0, height, depth)]),
        `color-mix(in srgb, ${color} 70%, white 30%)`],
      [points([p(0, 0, depth), p(0, height, depth), p(width, height, depth), p(width, 0, depth)]), color],
      [points([p(width, 0, 0), p(width, height, 0), p(width, height, depth), p(width, 0, depth)]),
        `color-mix(in srgb, ${color} 70%, black 30%)`],
    ];
    const solidGroup = svgNode("g", { class: "cro-capacity__solid", opacity });
    for (const [facePoints, fill] of faces) {
      solidGroup.append(svgNode("polygon", {
        points: facePoints,
        fill,
        stroke: `color-mix(in srgb, ${color} 54%, black 46%)`,
        "stroke-width": 0.062,
        "stroke-linejoin": "round",
        "stroke-dasharray": dashed ? "0.18 0.14" : null,
      }));
    }
    appendSvgTitle(solidGroup, title);
    return solidGroup;
  };

  const capacity = Math.max(1, Number(stage.capacity_gib));
  let cursor = 0;
  let overflow = 0;
  let loaded = 0;
  for (const [key, label] of SEGMENTS) {
    const value = Number(stage.values_gib[key]);
    if (!(value > 0)) continue;
    loaded += value;
    const fullHeight = value / capacity * box.height;
    const visibleHeight = Math.min(fullHeight, Math.max(0, box.height - cursor));
    overflow += fullHeight - visibleHeight;
    if (visibleHeight > 0.012) {
      group.append(solid(cursor, visibleHeight, segmentColor(key), {
        title: `${label} ${formatGiB(value)}`,
        dashed: key === "reserve",
        opacity: key === "reserve" ? 0.62 : (key === "base" ? 0.72 : null),
      }));
    }
    cursor += visibleHeight;
  }

  if (overflow > 0.012) {
    group.append(solid(box.height + 0.3, Math.max(0.5, overflow), "var(--danger)", {
      title: `溢出 ${formatGiB(loaded - capacity)} → OOM`,
    }));
  }

  const wireEdges = [
    [[0, 0, 0], [box.width, 0, 0]], [[0, 0, 0], [0, 0, box.depth]],
    [[box.width, 0, 0], [box.width, 0, box.depth]], [[0, 0, box.depth], [box.width, 0, box.depth]],
    [[0, 0, 0], [0, box.height, 0]], [[box.width, 0, 0], [box.width, box.height, 0]],
    [[0, 0, box.depth], [0, box.height, box.depth]], [[box.width, 0, box.depth], [box.width, box.height, box.depth]],
    [[0, box.height, 0], [box.width, box.height, 0]], [[0, box.height, 0], [0, box.height, box.depth]],
    [[box.width, box.height, 0], [box.width, box.height, box.depth]],
    [[0, box.height, box.depth], [box.width, box.height, box.depth]],
  ];
  for (const [from, to] of wireEdges) {
    const [x1, y1] = project(...from);
    const [x2, y2] = project(...to);
    group.append(svgNode("line", {
      x1, y1, x2, y2,
      stroke: "var(--border-strong)", "stroke-width": 0.075, "stroke-dasharray": "0.26 0.2",
    }));
  }

  for (const [ratio, color] of [[thresholds?.tight, "var(--warning)"], [thresholds?.alert, "var(--danger)"]]) {
    if (!finite(ratio)) continue;
    const y = Number(ratio) * box.height;
    const ring = [
      [[0, y, 0], [box.width, y, 0]], [[0, y, 0], [0, y, box.depth]],
      [[box.width, y, 0], [box.width, y, box.depth]], [[0, y, box.depth], [box.width, y, box.depth]],
    ];
    for (const [from, to] of ring) {
      const [x1, y1] = project(...from);
      const [x2, y2] = project(...to);
      group.append(svgNode("line", {
        x1, y1, x2, y2, stroke: color, "stroke-width": 0.062,
        "stroke-dasharray": "0.2 0.18", opacity: 0.8,
      }));
    }
    const [labelX, labelY] = project(0, y, box.depth);
    const label = svgNode("text", {
      x: labelX - 0.26, y: labelY + 0.24, "text-anchor": "end", "font-size": 0.78,
      "font-family": "ui-monospace, Menlo, Consolas, monospace", "font-weight": 600,
      fill: color, opacity: 0.9,
    });
    label.textContent = `${Math.round(Number(ratio) * 100)}%`;
    group.append(label);
    overhangX0 = Math.min(overhangX0, labelX - 2);
  }

  const padding = 0.35;
  const centerX = (bounds.x0 + bounds.x1) / 2;
  const visualLeft = Number.isFinite(overhangX0) ? Math.min(bounds.x0, overhangX0) : bounds.x0;
  const halfWidth = Math.max(
    centerX - visualLeft,
    bounds.x1 - centerX,
  ) + padding;
  svg.setAttribute("viewBox", [
    (centerX - halfWidth).toFixed(2),
    (bounds.y0 - padding).toFixed(2),
    (halfWidth * 2).toFixed(2),
    (bounds.y1 - bounds.y0 + padding * 2).toFixed(2),
  ].join(" "));
  host.append(svg);
}

function diagnosticText(result) {
  const errors = result?.errors ?? [];
  return errors.length
    ? errors.slice(0, 2).map((item) => item.message ?? String(item)).join("；")
    : "当前配置没有可展示的理论容量结果。";
}

function stageRank(stage) {
  const topology = window.croObserver?.topology;
  const ranks = topology?.ranksOfStage?.(stage) ?? [];
  return ranks[0] ?? topology?.rankOf?.(stage, 0, 0, 0) ?? null;
}

export function capacitySelection(primary, topology) {
  if (!primary) return null;
  if (primary.kind === "rank" && Number.isInteger(primary.stage)) {
    return { stage: primary.stage, rank: Number.isInteger(primary.rank) ? primary.rank : null };
  }
  if (primary.kind === "layer" && Number.isInteger(primary.layer)) {
    const stage = topology?.stageOfLayer?.(primary.layer);
    return Number.isInteger(stage) ? { stage, rank: null } : null;
  }
  return Number.isInteger(primary.stage) ? { stage: primary.stage, rank: null } : null;
}

export function rankShownForStage(rank, stage, topology) {
  if (!Number.isInteger(rank)) return null;
  const coords = topology?.coordsOfRank?.(rank);
  return coords?.stage === stage ? rank : null;
}

function selectStage(stage) {
  const rank = stageRank(stage);
  const topology = window.croObserver?.topology;
  const coords = Number.isInteger(rank) ? topology?.coordsOfRank?.(rank) : null;
  if (!coords || typeof window.croSelect !== "function") return;
  window.croSelect({
    kind: "rank",
    rank,
    stage,
    dpIdx: coords.dpIdx,
    epRank: coords.epIdx,
    tpIdx: coords.tpIdx,
    cpIdx: coords.cpIdx,
    node: coords.node,
  });
}

function cacheElements() {
  const root = document.getElementById("croCapacity");
  if (!root) return null;
  return {
    root,
    title: root.querySelector(".cro-capacity__title"),
    body: document.getElementById("croCapacityBody"),
    empty: document.getElementById("croCapacityEmpty"),
    scope: document.getElementById("croCapacityScope"),
    help: document.getElementById("croCapacityHelp"),
    basis: document.getElementById("croCapacityBasis"),
    scene: document.getElementById("croCapacityScene"),
    ratio: document.getElementById("croCapacityRatio"),
    pct: document.getElementById("croCapacityPct"),
    abs: document.getElementById("croCapacityAbs"),
    legend: document.getElementById("croCapacityLegend"),
    verdict: document.getElementById("croCapacityVerdict"),
    verdictBadge: document.getElementById("croCapacityBadge"),
    verdictText: document.getElementById("croCapacityVerdictText"),
    spread: document.getElementById("croCapacitySpread"),
    spreadNote: document.getElementById("croCapacitySpreadNote"),
    stages: document.getElementById("croCapacityStages"),
  };
}

function installHelp(ui) {
  if (!ui.help || !ui.basis || ui.help.dataset.mcpCapacityHelp === "ready") return;
  ui.help.dataset.mcpCapacityHelp = "ready";
  if (ui.basis.parentNode !== document.body) document.body.append(ui.basis);
  let timer = 0;
  const place = () => {
    if (ui.basis.hidden) return;
    const anchor = ui.help.getBoundingClientRect();
    const box = ui.basis.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
    const below = anchor.bottom + 6;
    const top = below + box.height <= window.innerHeight - 8
      ? below : Math.max(8, anchor.top - box.height - 6);
    ui.basis.style.left = `${Math.round(left)}px`;
    ui.basis.style.top = `${Math.round(top)}px`;
  };
  const show = (open) => {
    window.clearTimeout(timer);
    if (open) {
      ui.basis.hidden = false;
      ui.help.setAttribute("aria-expanded", "true");
      place();
    } else {
      timer = window.setTimeout(() => {
        ui.basis.hidden = true;
        ui.help.setAttribute("aria-expanded", "false");
      }, 140);
    }
  };
  ui.help.addEventListener("pointerenter", () => show(true));
  ui.help.addEventListener("pointerleave", () => show(false));
  ui.help.addEventListener("focus", () => show(true));
  ui.help.addEventListener("blur", () => show(false));
  ui.help.addEventListener("click", (event) => {
    event.stopPropagation();
    show(ui.basis.hidden);
  });
  ui.basis.addEventListener("pointerenter", () => show(true));
  ui.basis.addEventListener("pointerleave", () => show(false));
  window.addEventListener("resize", place);
  document.addEventListener("scroll", place, { capture: true, passive: true });
}

function renderBasis(ui, model) {
  if (!ui.basis) return;
  ui.basis.replaceChildren();
  ui.basis.append(
    make("p", "cro-capacity__basis-sub", "估算边界"),
    make("p", "cro-capacity__basis-note", "theoretical · 静态理论容量，不是设备实测峰值，也不连接远端集群。"),
  );
  const assumptions = make("ul", "mcp-capacity__assumptions");
  for (const item of model.assumptions) assumptions.append(make("li", "", item));
  ui.basis.append(assumptions);
  const coefficients = Object.entries(model.runtimeCoefficients);
  if (coefficients.length) {
    ui.basis.append(make("p", "cro-capacity__basis-sub", "Tool 返回的运行时经验系数"));
    const list = make("dl");
    for (const [name, value] of coefficients) {
      list.append(make("dt", "", name), make("dd", "", String(value)));
    }
    ui.basis.append(list);
  }
}

function renderModel(ui, model, selectedRank, onStageChange) {
  const stage = model.shown;
  ui.root.dataset.mcpCapacityState = "valid";
  ui.root.setAttribute("aria-busy", "false");
  ui.empty.hidden = true;
  ui.body.hidden = false;
  ui.title.textContent = "单卡容量";
  const rank = rankShownForStage(selectedRank, stage.stage, window.croObserver?.topology);
  ui.scope.textContent = `theoretical · 非实测峰值 · ${Number.isInteger(rank) ? `rank ${rank} · ` : ""}Stage${stage.stage}`
    + (stage.stage === model.bottleneckStage ? " · 理论瓶颈" : "");
  ui.scope.title = "数据来自 estimate_training_capacity；同一 Stage 的并行副本按当前理论口径等值。";
  renderCapacityScene(ui.scene, stage, model.thresholds);

  ui.legend.replaceChildren();
  for (const [key, label, dataKey] of [...SEGMENTS].reverse()) {
    const row = make("li", "cro-capacity__row");
    row.dataset.seg = dataKey;
    row.append(make("i"), make("span", "", label), make("b", "", formatGiB(stage.values_gib[key])));
    if (key === "reserve") {
      const parts = stage.reserve_parts_gib ?? {};
      row.title = `通信 ${formatGiB(parts.communication ?? 0)} · workspace ${formatGiB(parts.workspace ?? 0)}`
        + ` · 碎片 ${formatGiB(parts.fragmentation ?? 0)} · FSDP2 暂存 ${formatGiB(parts.fsdp_unshard ?? 0)}`;
    }
    ui.legend.append(row);
  }

  ui.ratio.dataset.level = stage.level;
  ui.pct.textContent = `${Math.round(stage.ratio * 100)}%`;
  ui.abs.textContent = `${formatGiB(stage.total_gib)} / ${formatGiB(stage.capacity_gib)}`;
  ui.verdict.hidden = stage.level === "safe";
  if (!ui.verdict.hidden) {
    ui.verdict.dataset.level = stage.level;
    ui.verdictBadge.textContent = LEVEL_LABELS[stage.level];
    ui.verdictText.textContent = `理论估算占用 ${Math.round(stage.ratio * 100)}%，`
      + `${formatGiB(stage.total_gib)} / ${formatGiB(stage.capacity_gib)}；不是设备实测峰值。`;
  }

  const hideSpread = stage.level !== "safe";
  ui.spread.hidden = hideSpread;
  ui.stages.replaceChildren();
  if (!hideSpread) {
    const peak = Math.max(1, ...model.stages.map((entry) => entry.ratio));
    for (const entry of model.stages) {
      const bar = make("button", "cro-capacity__stage");
      bar.type = "button";
      bar.dataset.stage = String(entry.stage);
      bar.dataset.level = entry.level;
      bar.classList.toggle("is-selected", entry.stage === stage.stage);
      bar.style.height = `${Math.max(6, entry.ratio / peak * 100).toFixed(1)}%`;
      bar.title = `Stage${entry.stage} · ${formatGiB(entry.total_gib)} / ${formatGiB(entry.capacity_gib)}`
        + ` · ${entry.layers} 层 · 在飞 ${entry.inflight_micro_batches} 个 micro-batch`;
      bar.setAttribute("aria-label", bar.title);
      bar.addEventListener("click", () => {
        onStageChange(entry.stage);
        selectStage(entry.stage);
      });
      ui.stages.append(bar);
    }
    ui.spreadNote.textContent = `理论瓶颈 Stage${model.bottleneckStage} · ${Math.round(model.stages.find(({ stage: id }) => id === model.bottleneckStage).ratio * 100)}%`;
  }
  renderBasis(ui, model);
}

function renderEmpty(ui, state, message, retry) {
  ui.root.dataset.mcpCapacityState = state;
  ui.root.setAttribute("aria-busy", String(state === "pending"));
  ui.body.hidden = true;
  ui.empty.hidden = false;
  ui.scope.textContent = state === "pending" ? "theoretical · 更新中" : "theoretical";
  ui.empty.replaceChildren(document.createTextNode(message));
  if (state === "error") {
    const button = make("button", "btn btn-sm mcp-capacity__retry", "重试");
    button.type = "button";
    button.addEventListener("click", retry);
    ui.empty.append(button);
  }
}

function relevantControl(event) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest("#croCapacity, #croImportPanel")) return false;
  return Boolean(target.closest(
    ".cro-stepper, #croModelSelect, #croCardSelect, #croConfigPresetSelect, #croConfigPresetMenu",
  ));
}

export function installCapacityAdapter(callCapacityTool, trainingConfigFor) {
  let ui = null;
  let token = 0;
  let timer = 0;
  let lastKey = null;
  let lastResult = null;
  let selectedStage = null;
  let selectedRank = null;
  let ready = false;
  // 首次 Tool 结果到达前不声明页面兜底阈值；画布与容量卡只接受 structuredContent。
  const thresholds = { tight: Number.NaN, alert: Number.NaN };

  const notifyCapacityConsumers = (state, reason = "") => {
    document.dispatchEvent(new CustomEvent("mcp:capacity-result", {
      detail: {
        state,
        available: state === "ready",
        reason,
      },
    }));
  };

  window.croCapacityModel = {
    THRESHOLD: thresholds,
    LEVEL_LABEL: LEVEL_LABELS,
    levelOf(ratio) {
      if (ratio > 1) return "over";
      if (ratio > thresholds.alert) return "alert";
      if (ratio > thresholds.tight) return "tight";
      return "safe";
    },
    measureAll() {
      return ready ? capacityMeasurements(lastResult) : [];
    },
  };

  const ensureUi = () => {
    ui ??= cacheElements();
    if (ui) installHelp(ui);
    return ui;
  };

  const paintResult = () => {
    const elements = ensureUi();
    if (!elements || !lastResult) return;
    const model = capacityViewModel(lastResult, selectedStage);
    if (!model) {
      renderEmpty(elements, "error", "容量结果缺少可渲染的 Stage 或六段数据。", refresh);
      return;
    }
    selectedStage = model.shown.stage;
    selectedRank = rankShownForStage(selectedRank, selectedStage, window.croObserver?.topology);
    renderModel(elements, model, selectedRank, (stage) => {
      selectedStage = stage;
      selectedRank = null;
      paintResult();
    });
  };

  async function requestCurrent(force = false) {
    const elements = ensureUi();
    const config = window.croObserver?.config;
    if (!elements || !config) return;
    let input;
    try {
      input = trainingConfigFor(config);
    } catch (error) {
      // 输入证据不足时必须同时失效上一份成功结果；否则随后点击 Rank/Stage 会由
      // cro:select 再次 paintResult()，把旧模型的容量数字覆盖到当前错误状态上。
      token += 1;
      lastKey = null;
      lastResult = null;
      ready = false;
      const reason = error instanceof Error ? error.message : String(error);
      renderEmpty(elements, "error", reason, refresh);
      notifyCapacityConsumers("unavailable", reason);
      return;
    }
    const key = topologyInputKey(input);
    if (!force && key === lastKey && lastResult) {
      ready = true;
      notifyCapacityConsumers("ready");
      return;
    }
    const currentToken = ++token;
    ready = false;
    notifyCapacityConsumers("pending");
    renderEmpty(elements, "pending", "正在调用 estimate_training_capacity 计算理论容量…", refresh);
    try {
      const result = await callCapacityTool(input);
      if (currentToken !== token) return;
      lastKey = key;
      if (result.status !== "estimated" || !result.data?.valid) {
        lastResult = null;
        ready = false;
        const reason = diagnosticText(result);
        renderEmpty(elements, "invalid", reason, refresh);
        notifyCapacityConsumers("invalid", reason);
        return;
      }
      lastResult = result;
      ready = true;
      if (finite(result.data.thresholds?.tight)) thresholds.tight = Number(result.data.thresholds.tight);
      if (finite(result.data.thresholds?.alert)) thresholds.alert = Number(result.data.thresholds.alert);
      const stageIds = new Set(result.data.stages.map(({ stage }) => stage));
      if (!stageIds.has(selectedStage)) {
        selectedStage = result.data.bottleneck_stage;
        selectedRank = null;
      }
      paintResult();
      notifyCapacityConsumers("ready");
    } catch (error) {
      if (currentToken !== token) return;
      lastResult = null;
      ready = false;
      const reason = `理论容量调用失败：${error instanceof Error ? error.message : String(error)}`;
      renderEmpty(elements, "error", reason, refresh);
      notifyCapacityConsumers("error", reason);
    }
  }

  function schedule(delay = 80) {
    token += 1;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => requestCurrent(), delay);
  }

  function refresh() {
    lastKey = null;
    requestCurrent(true);
  }

  document.addEventListener("cro:change", () => schedule(0));
  document.addEventListener("mcp:pipeline-settings-change", () => schedule(0));
  document.addEventListener("mcp:parsed-config-applied", () => schedule(0));
  document.addEventListener("mcp:retry-requested", (event) => {
    if (event.detail?.tool === "estimate_training_capacity") refresh();
  });
  document.addEventListener("cro:select", (event) => {
    const primary = event.detail?.primary;
    const selection = capacitySelection(primary, window.croObserver?.topology);
    if (!selection) return;
    selectedStage = selection.stage;
    selectedRank = selection.rank;
    paintResult();
  });
  for (const eventName of ["input", "change"]) {
    document.addEventListener(eventName, (event) => {
      if (relevantControl(event)) schedule();
    });
  }

  const start = () => schedule(0);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  return {
    refresh,
    reveal: () => {
      refresh();
      ensureUi()?.root.scrollIntoView({ behavior: "smooth", block: "center" });
    },
  };
}
