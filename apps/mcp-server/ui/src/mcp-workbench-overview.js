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
    const context = node("div", "mcp-overview__context");
    const source = node("span", "mcp-overview__source", "来源：当前工作台预设");
    const objective = node("span", "mcp-overview__objective", "目标：检查训练配置");
    context.append(source, objective);

    const main = node("div", "mcp-overview__main");
    const verdict = node("div", "mcp-overview__verdict");
    const heading = node("strong", "mcp-overview__heading", "正在检查当前配置…");
    const evidence = node("p", "mcp-overview__evidence", "静态规则结果会显示在这里。无需打开图表即可先看结论。");
    const nextStep = node("p", "mcp-overview__next", "下一步：导入工程配置，或检查当前预设。 ");
    verdict.append(heading, evidence, nextStep);
    const actions = node("div", "mcp-overview__actions");
    const primary = node("button", "btn btn-sm mcp-overview__primary", "导入配置");
    primary.type = "button";
    primary.addEventListener("click", () => {
      if (overview.dataset.state === "invalid") {
        document.getElementById("croConfigError")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        document.getElementById("croImportConfig")?.click();
      }
    });
    const plan = node("button", "btn btn-sm mcp-overview__plan", "按资源规划");
    plan.type = "button";
    plan.addEventListener("click", () => document.dispatchEvent(new CustomEvent("mcp:plan-open")));
    const notebook = node("button", "btn btn-sm mcp-overview__notebook", "报告与快照");
    notebook.type = "button";
    notebook.addEventListener("click", () => document.dispatchEvent(new CustomEvent("mcp:report-open")));
    const detail = node("button", "btn btn-sm mcp-overview__detail", "查看 Rank 画布");
    detail.type = "button";
    detail.setAttribute("aria-controls", "cropCenter");
    detail.addEventListener("click", () => {
      document.getElementById("cropCenter")?.scrollIntoView({ block: "start", behavior: "smooth" });
      window.dispatchEvent(new Event("resize"));
      document.dispatchEvent(new CustomEvent("cro:layout", { detail: { source: "mcp-overview" } }));
    });
    actions.append(primary, plan, notebook, detail);
    main.append(verdict, actions);
    overview.append(context, main);
    topbar.insertAdjacentElement("afterend", overview);

    document.addEventListener("mcp:workbench-handoff", (event) => {
      const handoff = event.detail ?? {};
      if (handoff.objective) objective.textContent = `目标：${handoff.objective}`;
      if (handoff.source?.name) {
        source.textContent = `来源：${handoff.source.name} · Agent 已带入`;
        heading.textContent = "已接收训练配置，正在解析…";
        evidence.textContent = "请核对来源与解析结果，然后确认采用的补齐方案。";
        nextStep.textContent = "下一步：核对解析结果并选择补齐方案。";
      }
      if (["compute_rank_topology", "estimate_training_capacity"].includes(handoff.target_tool)) detail.click();
      if (handoff.target_tool === "plan_training_config") plan.click();
    });
    document.addEventListener("cro:source", (event) => {
      const name = event.detail?.name;
      if (name) source.textContent = `来源：${name}`;
    });
    document.addEventListener("mcp:validation-pending", () => {
      overview.dataset.state = "pending";
      heading.textContent = "正在检查当前配置…";
      evidence.textContent = "输入发生变化，等待本次静态校验结果。";
      nextStep.textContent = "下一步：等待本次结果后再决定是否修改。";
    });
    document.addEventListener("mcp:validation-result", (event) => {
      const { result, error } = event.detail ?? {};
      if (error) {
        overview.dataset.state = "unavailable";
        heading.textContent = "静态校验暂时不可用";
        evidence.textContent = error;
        nextStep.textContent = "下一步：检查服务连接或重试。";
        return;
      }
      if (!result) return;
      const assessment = result.quick_assessment;
      overview.dataset.state = result.errors?.length ? "invalid"
        : result.warnings?.length ? "warning" : "valid";
      heading.textContent = assessment?.conclusion ?? (result.errors?.length
        ? `发现 ${result.errors.length} 条静态规则问题` : "静态校验通过");
      evidence.textContent = assessment?.evidence?.[0]?.message
        ?? assessment?.next_step ?? "已完成静态检查；实际训练仍需在目标环境验证。";
      nextStep.textContent = `下一步：${assessment?.next_step ?? "按需要查看配置字段及证据。"}`;
      primary.textContent = result.errors?.length ? "查看问题与修复" : "导入其他配置";
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
