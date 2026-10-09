const DEFAULT_TIMEOUT_MS = 15_000;

function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "未知错误");
}

export function classifyMcpHostError(error) {
  const message = errorText(error);
  const normalized = `${error?.code ?? ""} ${error?.name ?? ""} ${message}`.toLowerCase();
  if (normalized.includes("abort") || normalized.includes("cancel") || normalized.includes("取消")) {
    return { kind: "cancelled", message: "已取消 MCP 调用，可重试。", retryable: true };
  }
  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("超时")) {
    return { kind: "timeout", message: "MCP 调用超时，请检查服务状态后重试。", retryable: true };
  }
  if (/\b(401|403)\b/.test(normalized)
    || normalized.includes("unauthor") || normalized.includes("forbidden")
    || normalized.includes("bearer") || normalized.includes("token") || normalized.includes("鉴权")) {
    return { kind: "auth", message: "MCP 鉴权已失效，请更新 Token 或重新连接后重试。", retryable: true };
  }
  if (normalized.includes("mcp_tool_error") || normalized.includes("tool error")) {
    return { kind: "tool", message: `MCP Tool 返回错误：${message}`, retryable: true };
  }
  if (normalized.includes("connect") || normalized.includes("transport")
    || normalized.includes("closed") || normalized.includes("network") || normalized.includes("断开")) {
    return { kind: "disconnected", message: "MCP 连接已断开，请恢复服务后重试。", retryable: true };
  }
  return { kind: "host", message: `MCP 调用失败：${message}`, retryable: true };
}

function button(label, className) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

export function createMcpHostInteraction({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const active = new Map();
  let sequence = 0;
  let lastFailure = null;
  let region = null;
  let message = null;
  let cancelAction = null;
  let retryAction = null;

  function mount() {
    if (region || typeof document === "undefined") return region;
    region = document.createElement("section");
    region.className = "mcp-host-state";
    region.dataset.state = "idle";
    region.hidden = true;
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    message = document.createElement("span");
    message.className = "mcp-host-state__message";
    const actions = document.createElement("span");
    actions.className = "mcp-host-state__actions";
    cancelAction = button("取消", "btn btn-sm mcp-host-state__cancel");
    retryAction = button("重试", "btn btn-sm mcp-host-state__retry");
    cancelAction.addEventListener("click", () => cancelAll());
    retryAction.addEventListener("click", () => {
      if (!lastFailure?.tool) return;
      const tool = lastFailure.tool;
      region.hidden = true;
      region.dataset.state = "idle";
      document.dispatchEvent(new CustomEvent("mcp:retry-requested", { detail: { tool } }));
    });
    actions.append(cancelAction, retryAction);
    region.append(message, actions);
    const topbar = document.querySelector(".pto-ide-frame__topbar");
    if (topbar) topbar.insertAdjacentElement("afterend", region);
    else document.body.prepend(region);
    return region;
  }

  function paint(state, text, { cancel = false, retry = false } = {}) {
    mount();
    if (!region) return;
    region.hidden = state === "idle";
    region.dataset.state = state;
    region.setAttribute("role", state === "error" ? "alert" : "status");
    message.textContent = text;
    cancelAction.hidden = !cancel;
    retryAction.hidden = !retry;
  }

  function paintPending() {
    const count = active.size;
    paint("pending", count > 1 ? `正在调用 ${count} 个 MCP Tool…` : "正在调用 MCP Tool…", { cancel: true });
  }

  function beginConnection() {
    paint("connecting", "正在连接 MCP Host…");
  }

  function connected() {
    if (!active.size) paint("idle", "");
  }

  function report(error, tool = "host") {
    const detail = classifyMcpHostError(error);
    lastFailure = { tool, detail };
    paint("error", detail.message, { retry: detail.retryable });
    return detail;
  }

  function paintLastFailure() {
    if (!lastFailure) return;
    paint("error", lastFailure.detail.message, { retry: lastFailure.detail.retryable });
  }

  function cancelAll() {
    for (const controller of active.values()) controller.abort();
  }

  async function run(tool, invoke) {
    const id = ++sequence;
    const controller = new AbortController();
    active.set(id, controller);
    paintPending();
    try {
      const result = await invoke({
        signal: controller.signal,
        timeout: timeoutMs,
        maxTotalTimeout: timeoutMs,
      });
      lastFailure = null;
      return result;
    } catch (error) {
      const detail = report(error, tool);
      const wrapped = new Error(detail.message, { cause: error });
      wrapped.code = `MCP_UI_${detail.kind.toUpperCase()}`;
      throw wrapped;
    } finally {
      active.delete(id);
      if (active.size) paintPending();
      else if (lastFailure) paintLastFailure();
      else paint("idle", "");
    }
  }

  return { beginConnection, connected, report, run, cancelAll };
}
