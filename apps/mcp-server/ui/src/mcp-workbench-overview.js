function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function mountWorkbenchOverview() {
  const mount = () => {
    const topbar = document.querySelector(".pto-ide-frame__topbar");
    if (!topbar || document.getElementById("mcpWorkbenchOverview")) return;

    const overview = node("section", "mcp-overview");
    overview.id = "mcpWorkbenchOverview";
    overview.setAttribute("aria-label", "配置分析概览");
    const main = node("div", "mcp-overview__main");
    const verdict = node("div", "mcp-overview__verdict");
    const heading = node("strong", "mcp-overview__heading", "MindSpeed");
    verdict.append(heading);
    const actions = node("div", "mcp-overview__actions");
    const importConfig = node("button", "btn btn-sm mcp-overview__secondary", "导入其他配置");
    importConfig.type = "button";
    importConfig.addEventListener("click", () => {
      document.getElementById("croImportConfig")?.click();
    });
    const plan = node("button", "btn btn-sm mcp-overview__secondary", "按资源规划");
    plan.type = "button";
    plan.addEventListener("click", () => document.dispatchEvent(new CustomEvent("mcp:plan-open")));
    const notebook = node("button", "btn btn-sm mcp-overview__secondary", "报告与快照");
    notebook.type = "button";
    notebook.addEventListener("click", () => document.dispatchEvent(new CustomEvent("mcp:report-open")));
    function revealRankCanvas() {
      document.getElementById("cropCenter")?.scrollIntoView({ block: "start", behavior: "smooth" });
      window.dispatchEvent(new Event("resize"));
      document.dispatchEvent(new CustomEvent("cro:layout", { detail: { source: "mcp-overview" } }));
    }
    const applyToCode = node("button", "btn btn-sm mcp-overview__primary", "应用到代码");
    applyToCode.type = "button";
    actions.append(plan, notebook, importConfig, applyToCode);
    main.append(verdict, actions);
    overview.append(main);
    topbar.insertAdjacentElement("afterend", overview);

    document.addEventListener("mcp:workbench-handoff", (event) => {
      const handoff = event.detail ?? {};
      if (["compute_rank_topology", "estimate_training_capacity"].includes(handoff.target_tool)) revealRankCanvas();
      if (handoff.target_tool === "plan_training_config") plan.click();
    });
    document.addEventListener("mcp:validation-pending", () => {
      overview.dataset.state = "pending";
    });
    document.addEventListener("mcp:validation-result", (event) => {
      const { result, error } = event.detail ?? {};
      if (error) {
        overview.dataset.state = "unavailable";
        return;
      }
      if (!result) return;
      overview.dataset.state = result.errors?.length ? "invalid"
        : result.warnings?.length ? "warning" : "valid";
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
