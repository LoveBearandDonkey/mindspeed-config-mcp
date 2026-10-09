import { createPlaneModel, expertSliceFor, memoryForStage, memoryGradient, rankAt } from "./plane-model.js";

const CELL_WIDTH = 76;
const CELL_HEIGHT = 38;
const HEADER_HEIGHT = 42;
const GUTTER_WIDTH = 68;

export function createPlaneView({ host, onSelect }) {
  const viewport = host.querySelector("#planeViewport");
  const world = host.querySelector("#planeWorld");
  const empty = host.querySelector("#planeEmpty");
  const zoomLabel = host.querySelector("#planeZoomLabel");
  let topology;
  let capacity;
  let model;
  let zoom = 1;
  let mode = "topology";
  let layerDetail = true;
  let showExperts = true;
  let showTp = true;
  let selection = null;
  let frame;

  host.querySelector("#planeModeTopology").addEventListener("click", () => setMode("topology"));
  host.querySelector("#planeModeMemory").addEventListener("click", () => setMode("memory"));
  host.querySelector("#toggleLayers").addEventListener("change", (event) => { layerDetail = event.target.checked; rebuild(); });
  host.querySelector("#toggleExperts").addEventListener("change", (event) => { showExperts = event.target.checked; renderSoon(); });
  host.querySelector("#toggleTp").addEventListener("change", (event) => { showTp = event.target.checked; renderSoon(); });
  host.querySelector("#zoomIn").addEventListener("click", () => setZoom(zoom + .15));
  host.querySelector("#zoomOut").addEventListener("click", () => setZoom(zoom - .15));
  host.querySelector("#zoomReset").addEventListener("click", () => setZoom(1));
  viewport.addEventListener("scroll", renderSoon, { passive: true });
  new ResizeObserver(renderSoon).observe(viewport);

  function setMode(next) {
    mode = next;
    host.querySelector("#planeModeTopology").setAttribute("aria-selected", String(mode === "topology"));
    host.querySelector("#planeModeMemory").setAttribute("aria-selected", String(mode === "memory"));
    host.dataset.mode = mode;
    renderSoon();
  }

  function setZoom(next) {
    zoom = Math.min(2, Math.max(.55, next));
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    resizeWorld();
    renderSoon();
  }

  function rebuild() {
    model = createPlaneModel(topology, { layerDetail });
    resizeWorld();
    renderSoon();
  }

  function resizeWorld() {
    if (!model) return;
    world.style.width = `${GUTTER_WIDTH + model.columns.length * CELL_WIDTH * zoom}px`;
    world.style.height = `${HEADER_HEIGHT + model.rowCount * CELL_HEIGHT * zoom}px`;
  }

  function renderSoon() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderVisible);
  }

  function renderVisible() {
    world.replaceChildren();
    if (!model) {
      empty.hidden = false;
      viewport.hidden = true;
      return;
    }
    empty.hidden = true;
    viewport.hidden = false;
    const width = CELL_WIDTH * zoom;
    const height = CELL_HEIGHT * zoom;
    const left = Math.max(0, viewport.scrollLeft - GUTTER_WIDTH);
    const top = Math.max(0, viewport.scrollTop - HEADER_HEIGHT);
    const firstColumn = Math.max(0, Math.floor(left / width) - 1);
    const lastColumn = Math.min(model.columns.length - 1, Math.ceil((left + viewport.clientWidth) / width) + 1);
    const firstRow = Math.max(0, Math.floor(top / height) - 1);
    const lastRow = Math.min(model.rowCount - 1, Math.ceil((top + viewport.clientHeight) / height) + 1);

    const corner = node("div", "plane-corner", layerDetail ? "层 / Rank" : "Stage / Rank");
    corner.style.left = `${viewport.scrollLeft}px`;
    corner.style.top = `${viewport.scrollTop}px`;
    corner.style.width = `${GUTTER_WIDTH}px`;
    corner.style.height = `${HEADER_HEIGHT}px`;
    world.append(corner);

    for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex += 1) {
      const column = model.columns[columnIndex];
      const header = node("button", "plane-column", column.label);
      header.type = "button";
      header.style.top = `${viewport.scrollTop}px`;
      header.style.left = `${GUTTER_WIDTH + columnIndex * width}px`;
      header.style.width = `${width}px`;
      header.style.height = `${HEADER_HEIGHT}px`;
      header.dataset.ffn = column.ffn;
      header.title = layerDetail ? `Stage ${column.stage} · ${column.ffn === "moe" ? "MoE" : "Dense"}` : `Stage ${column.stage}`;
      world.append(header);
    }
    for (let row = firstRow; row <= lastRow; row += 1) {
      const gutter = node("div", "plane-row-label", `槽位 ${row}`);
      gutter.style.left = `${viewport.scrollLeft}px`;
      gutter.style.top = `${HEADER_HEIGHT + row * height}px`;
      gutter.style.width = `${GUTTER_WIDTH}px`;
      gutter.style.height = `${height}px`;
      world.append(gutter);
      for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex += 1) {
        const column = model.columns[columnIndex];
        const rank = rankAt(model, column, row);
        if (!rank) continue;
        const cell = node("button", "plane-cell");
        cell.type = "button";
        cell.style.left = `${GUTTER_WIDTH + columnIndex * width + 3}px`;
        cell.style.top = `${HEADER_HEIGHT + row * height + 3}px`;
        cell.style.width = `${Math.max(34, width - 6)}px`;
        cell.style.height = `${Math.max(24, height - 6)}px`;
        cell.dataset.stage = String(column.stage);
        cell.dataset.ffn = column.ffn;
        const slice = expertSliceFor(topology, rank.ep_index);
        if (showExperts && column.ffn === "moe") cell.style.setProperty("--expert-hue", String((rank.ep_index * 53) % 360));
        if (mode === "memory") {
          const stageMemory = memoryForStage(capacity, column.stage);
          if (stageMemory) {
            cell.style.backgroundImage = memoryGradient(stageMemory.values_gib);
            cell.dataset.level = stageMemory.level;
          }
        }
        if (selection?.rank === rank.rank && selection?.columnId === column.id) cell.dataset.selected = "true";
        cell.append(node("span", "plane-rank", `R${rank.rank}`));
        if (showTp) cell.append(node("small", "plane-coordinate", `TP${rank.tp_index} · EP${rank.ep_index}`));
        cell.title = showExperts && slice && column.ffn === "moe"
          ? `Rank ${rank.rank} · 专家 ${slice.expert_start}–${slice.expert_end}`
          : `Rank ${rank.rank} · Stage ${rank.stage}`;
        cell.addEventListener("click", () => {
          selection = { rank: rank.rank, columnId: column.id };
          onSelect?.({ rank, column, expertSlice: slice, memory: memoryForStage(capacity, column.stage) });
          renderSoon();
        });
        world.append(cell);
      }
    }
  }

  return {
    setTopology(data) { topology = data; rebuild(); },
    setCapacity(data) { capacity = data; if (data?.valid) setMode("memory"); },
    clear() { topology = undefined; capacity = undefined; model = undefined; renderSoon(); },
    showTopology() { setMode("topology"); },
  };
}

function node(tag, className, text) {
  const value = document.createElement(tag);
  value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}
