const STORE_KEY = "mindspeed-config-analysis-snapshots-v1";
const MAX_PER_PROJECT = 20;
const memoryStore = new Map();
const fallbackStorage = {
  getItem: (key) => memoryStore.get(key) ?? null,
  setItem: (key, value) => memoryStore.set(key, value),
};

function storage() {
  try { return window.localStorage; } catch { return fallbackStorage; }
}
const COMPARE_PATHS = [
  "cluster.total_ranks", "cluster.card_model", "cluster.card_memory_gib",
  "parallel.tp", "parallel.pp", "parallel.cp", "parallel.ep", "parallel.dp",
  "parallel.pipeline_layer_mode", "parallel.num_layer_list",
  "batch.global_batch_size", "batch.micro_batch_size", "batch.micro_batch_count",
  "memory.recompute_mode", "memory.shard_mode",
];

function element(tag, className = "", content = "") {
  const value = document.createElement(tag);
  value.className = className;
  value.textContent = content;
  return value;
}

function getPath(value, path) {
  return path.split(".").reduce((current, part) => current?.[part], value);
}

export function compareSnapshotFields(before, after) {
  return COMPARE_PATHS.flatMap((path) => {
    const oldValue = getPath(before?.config, path);
    const newValue = getPath(after?.config, path);
    return JSON.stringify(oldValue) === JSON.stringify(newValue) ? []
      : [{ path, old_value: oldValue ?? null, new_value: newValue ?? null }];
  });
}

function readStore(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function snapshotsForProject(storage, project) {
  const rows = readStore(storage)[project];
  return Array.isArray(rows) ? rows : [];
}

export function saveProjectSnapshot(storage, project, snapshot) {
  const saved = readStore(storage);
  saved[project] = [snapshot, ...snapshotsForProject(storage, project)].slice(0, MAX_PER_PROJECT);
  storage.setItem(STORE_KEY, JSON.stringify(saved));
  return saved[project];
}

async function fingerprint(config) {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function installAnalysisNotebook(callReportTool, getCurrentConfig) {
  let dialog;
  let projectInput;
  let feedback;
  let reportBox;
  let snapshotList;
  let beforeSelect;
  let afterSelect;
  let comparison;
  let currentValidation = null;
  let currentReport = null;
  let candidateChanges = [];
  let source = { name: "当前工作台预设", version_kind: "preset" };
  let pending = true;
  let lastProject = "";

  function projectName() { return projectInput.value.trim(); }

  function renderComparison() {
    comparison.replaceChildren();
    const rows = snapshotsForProject(storage(), projectName());
    const before = rows.find(({ id }) => id === beforeSelect.value);
    const after = rows.find(({ id }) => id === afterSelect.value);
    if (!before || !after || before.id === after.id) {
      comparison.append(element("p", "mcp-notebook__hint", "选择两份不同的快照比较页面试验值。"));
      return;
    }
    const diffs = compareSnapshotFields(before, after);
    comparison.append(element("p", "mcp-notebook__hint",
      `对照 ${before.captured_at} → ${after.captured_at}；${diffs.length} 个已映射字段不同。以下是页面方案比较，不代表源文件差异。`));
    if (!diffs.length) return;
    const list = element("ul", "mcp-notebook__diffs");
    diffs.forEach(({ path, old_value, new_value }) => list.append(element("li", "",
      `${path}: ${JSON.stringify(old_value)} → ${JSON.stringify(new_value)}`)));
    comparison.append(list);
  }

  function renderSnapshots() {
    const project = projectName();
    const rows = snapshotsForProject(storage(), project);
    snapshotList.replaceChildren();
    beforeSelect.replaceChildren();
    afterSelect.replaceChildren();
    for (const [index, snapshot] of rows.entries()) {
      const optionBefore = element("option", "", `${snapshot.captured_at} · ${snapshot.source.name}`);
      optionBefore.value = snapshot.id;
      const optionAfter = optionBefore.cloneNode(true);
      beforeSelect.append(optionBefore);
      afterSelect.append(optionAfter);
      const card = element("article", "mcp-notebook__snapshot");
      card.append(element("strong", "", snapshot.report.conclusion));
      card.append(element("p", "", `${snapshot.captured_at} · ${snapshot.source.name} · 来源 ${snapshot.source.sha256?.slice(0, 12) ?? "无摘要"}`));
      card.append(element("p", "", `页面版本 ${snapshot.config_fingerprint.slice(0, 12)} · ${snapshot.file_write_status}`));
      const restore = element("button", "btn btn-sm", "恢复页面方案");
      restore.type = "button";
      restore.addEventListener("click", () => document.dispatchEvent(new CustomEvent(
        "mcp:restore-snapshot-request", { detail: { snapshot } })));
      card.append(restore);
      snapshotList.append(card);
      if (index === 0) afterSelect.value = snapshot.id;
      if (index === 1) beforeSelect.value = snapshot.id;
    }
    if (!rows.length) snapshotList.append(element("p", "mcp-notebook__hint", "这个工程还没有保存分析快照。"));
    if (rows.length === 1) beforeSelect.value = rows[0].id;
    renderComparison();
  }

  function mount() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "mcp-notebook";
    dialog.setAttribute("aria-labelledby", "mcpNotebookTitle");
    const header = element("header", "mcp-notebook__header");
    const title = element("h2", "", "报告与工程快照");
    title.id = "mcpNotebookTitle";
    const close = element("button", "btn btn-sm", "关闭");
    close.type = "button";
    close.addEventListener("click", () => dialog.close());
    header.append(title, close);
    const intro = element("p", "mcp-notebook__hint",
      "报告只汇总已有 MCP 证据。快照按工程名称保存在此浏览器；恢复只改变工作台页面方案，不写入源文件。");
    const projectField = element("label", "mcp-notebook__project", "工程名称");
    projectInput = document.createElement("input");
    projectInput.type = "text";
    projectInput.maxLength = 260;
    projectInput.value = "当前工作台预设";
    projectField.append(projectInput);
    projectInput.addEventListener("change", renderSnapshots);
    const actions = element("div", "mcp-notebook__actions");
    const generate = element("button", "btn btn-sm mcp-notebook__primary", "生成当前报告");
    const copy = element("button", "btn btn-sm", "复制 Markdown");
    const saveMd = element("button", "btn btn-sm", "保存 Markdown");
    const saveJson = element("button", "btn btn-sm", "保存 JSON");
    const saveSnapshot = element("button", "btn btn-sm", "保存快照");
    for (const button of [generate, copy, saveMd, saveJson, saveSnapshot]) button.type = "button";
    actions.append(generate, copy, saveMd, saveJson, saveSnapshot);
    feedback = element("p", "mcp-notebook__feedback", "等待当前配置的静态校验结果。 ");
    feedback.setAttribute("role", "status");
    reportBox = document.createElement("textarea");
    reportBox.readOnly = true;
    reportBox.setAttribute("aria-label", "分析报告 Markdown");
    reportBox.className = "mcp-notebook__report";
    const section = element("section", "mcp-notebook__history");
    section.append(element("h3", "", "当前工程快照"));
    snapshotList = element("div", "mcp-notebook__snapshots");
    const compareRow = element("div", "mcp-notebook__compare-row");
    beforeSelect = document.createElement("select");
    afterSelect = document.createElement("select");
    beforeSelect.setAttribute("aria-label", "对照快照");
    afterSelect.setAttribute("aria-label", "目标快照");
    beforeSelect.addEventListener("change", renderComparison);
    afterSelect.addEventListener("change", renderComparison);
    compareRow.append(element("span", "", "对照"), beforeSelect, element("span", "", "→"), afterSelect);
    comparison = element("div", "mcp-notebook__comparison");
    section.append(snapshotList, compareRow, comparison);
    dialog.append(header, intro, projectField, actions, feedback, reportBox, section);
    document.body.append(dialog);

    generate.addEventListener("click", async () => {
      if (pending || !currentValidation) {
        feedback.textContent = "当前配置尚无可用静态结果；请等待校验完成。";
        return;
      }
      const project = projectName();
      if (!project) { feedback.textContent = "先填写工程名称。"; return; }
      generate.disabled = true;
      feedback.textContent = "正在汇总 MCP 结构化证据…";
      try {
        const result = await callReportTool({ schema_version: "1.0", project, source,
          analysis: currentValidation, candidate_changes: candidateChanges });
        currentReport = result;
        reportBox.value = result.data.markdown;
        feedback.textContent = "报告已生成。源文件差异和写回状态以修改后复查结果为准。";
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : String(error);
      } finally { generate.disabled = false; }
    });
    copy.addEventListener("click", async () => {
      if (!currentReport) { feedback.textContent = "先生成报告。"; return; }
      try { await navigator.clipboard.writeText(currentReport.data.markdown); feedback.textContent = "已复制 Markdown。"; }
      catch { reportBox.select(); feedback.textContent = "剪贴板不可用；已选中报告，可手动复制。"; }
    });
    saveMd.addEventListener("click", () => {
      if (!currentReport) { feedback.textContent = "先生成报告。"; return; }
      download("mindspeed-config-report.md", currentReport.data.markdown, "text/markdown;charset=utf-8");
    });
    saveJson.addEventListener("click", () => {
      if (!currentReport) { feedback.textContent = "先生成报告。"; return; }
      download("mindspeed-config-report.json", JSON.stringify(currentReport.data.report, null, 2), "application/json");
    });
    saveSnapshot.addEventListener("click", async () => {
      if (!currentReport || pending) { feedback.textContent = "先按当前配置生成报告。"; return; }
      const project = projectName();
      if (project !== currentReport.data.report.project) {
        feedback.textContent = "工程名称已变化；请重新生成当前工程的报告。";
        return;
      }
      try {
        const config = getCurrentConfig();
        const snapshot = {
          id: crypto.randomUUID(), captured_at: new Date().toISOString(), source: structuredClone(source),
          config_fingerprint: await fingerprint(config), config: structuredClone(config),
          file_write_status: "未写回源文件", report: structuredClone(currentReport.data.report),
          markdown: currentReport.data.markdown,
        };
        saveProjectSnapshot(storage(), project, snapshot);
        feedback.textContent = storage() === fallbackStorage
          ? "浏览器存储不可用；快照仅保留在本次页面会话中，且未写回源文件。"
          : "快照已保存在当前浏览器，并明确标记为未写回源文件。";
        renderSnapshots();
      } catch (error) { feedback.textContent = `快照保存失败：${error instanceof Error ? error.message : String(error)}`; }
    });
    renderSnapshots();
  }

  function reveal() {
    mount();
    if (projectInput.value === "当前工作台预设" && source.name !== "当前工作台预设") {
      projectInput.value = source.name;
      lastProject = source.name;
      renderSnapshots();
    }
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("mcp:report-open", reveal);
  document.addEventListener("mcp:validation-pending", () => { pending = true; currentReport = null; candidateChanges = []; });
  document.addEventListener("mcp:validation-result", (event) => {
    currentValidation = event.detail?.result ?? null;
    pending = !currentValidation;
    if (feedback && currentValidation) feedback.textContent = "当前静态结果已就绪，可生成报告。";
  });
  document.addEventListener("mcp:plan-result", (event) => {
    candidateChanges = event.detail?.result?.data?.candidates?.[0]?.changes ?? [];
  });
  document.addEventListener("cro:source", (event) => {
    const name = event.detail?.name;
    if (!name) return;
    source = { name, version_kind: "unknown" };
    if (projectInput && (projectInput.value === lastProject || projectInput.value === "当前工作台预设")) {
      projectInput.value = name;
      lastProject = name;
      renderSnapshots();
    }
  });
  document.addEventListener("mcp:parsed-config-applied", (event) => {
    const sha256 = event.detail?.sourceSnapshot?.source?.sha256;
    if (sha256) source = { ...source, sha256 };
  });
  document.addEventListener("mcp:snapshot-restore-result", (event) => {
    if (event.detail?.error) {
      feedback.textContent = `恢复失败：${event.detail.error}`;
      return;
    }
    const adjusted = event.detail?.adjusted ?? [];
    feedback.textContent = adjusted.length
      ? `已恢复页面可映射字段；${adjusted.length} 个字段被页面控件调整，请核对后重新校验。源文件未修改。`
      : "已恢复页面方案；请等待重新校验。源文件未修改。";
    source = event.detail?.snapshot?.source ?? source;
    currentReport = null;
  });
  return { reveal };
}
