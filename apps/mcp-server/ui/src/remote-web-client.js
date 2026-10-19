import "@mcp-bridge/remote-web-client.css";

function errorWithCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
export function createRemoteWebClient({ apiBase, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  if (typeof apiBase !== "string" || !apiBase.startsWith("/")) {
    throw new Error("远程工作台缺少有效的 API 基础路径。");
  }

  let authenticated = false;
  let gate = null;
  let form = null;
  let input = null;
  let feedback = null;
  let submit = null;
  let waiters = [];

  function mountGate() {
    if (gate) return gate;
    gate = document.createElement("section");
    gate.className = "mcp-web-access";
    gate.hidden = true;
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "mcpWebAccessTitle");
    gate.innerHTML = `
      <form class="mcp-web-access__card">
        <p class="mcp-web-access__eyebrow">腾讯云动态服务</p>
        <h1 id="mcpWebAccessTitle">进入 MindSpeed 配置工作台</h1>
        <p class="mcp-web-access__description">计算将在腾讯云服务端执行。请输入管理员提供的访问码，本页不会把访问码写入浏览器存储。</p>
        <label class="mcp-web-access__label" for="mcpWebAccessCode">访问码</label>
        <input id="mcpWebAccessCode" class="mcp-web-access__input" type="password"
               autocomplete="current-password" minlength="32" required>
        <p class="mcp-web-access__feedback" role="alert" aria-live="polite"></p>
        <button class="btn mcp-web-access__submit" type="submit">连接腾讯云服务</button>
        <p class="mcp-web-access__privacy">连接成功后仅保存安全会话 Cookie；配置内容只发送到本服务进行计算。</p>
      </form>`;
    document.body.append(gate);
    form = gate.querySelector("form");
    input = gate.querySelector("input");
    feedback = gate.querySelector("[role='alert']");
    submit = gate.querySelector("button[type='submit']");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      feedback.textContent = "正在验证访问码…";
      try {
        const response = await fetchImpl(`${apiBase}/session`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ access_token: input.value }),
        });
        if (response.status === 429) {
          const body = await response.json().catch(() => ({}));
          throw errorWithCode(
            `尝试次数过多，请在 ${body.retry_after_seconds ?? "稍后"} 秒后重试。`,
            "REMOTE_RATE_LIMIT",
          );
        }
        if (!response.ok) throw errorWithCode("访问码不正确或已失效。", "REMOTE_AUTH");
        authenticated = true;
        input.value = "";
        feedback.textContent = "";
        gate.hidden = true;
        document.documentElement.dataset.mcpWorkbench = "remote-ready";
        const pending = waiters;
        waiters = [];
        for (const waiter of pending) waiter.resolve();
      } catch (error) {
        authenticated = false;
        feedback.textContent = error instanceof Error ? error.message : "连接失败，请稍后重试。";
        input.focus();
      } finally {
        submit.disabled = false;
      }
    });
    return gate;
  }

  function waitForAccess() {
    mountGate();
    gate.hidden = false;
    document.documentElement.dataset.mcpWorkbench = "remote-auth-required";
    window.setTimeout(() => input.focus(), 0);
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  async function connect() {
    mountGate();
    let response;
    try {
      response = await fetchImpl(`${apiBase}/session`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
    } catch (error) {
      gate.hidden = false;
      feedback.textContent = "无法连接腾讯云服务，请检查网络后刷新页面。";
      await waitForAccess();
      return;
    }
    const body = response.ok ? await response.json() : {};
    authenticated = body.authenticated === true;
    if (!authenticated) await waitForAccess();
    document.documentElement.dataset.mcpWorkbench = "remote-ready";
  }

  async function invoke(name, args, allowReauthentication = true) {
    if (!authenticated) await waitForAccess();
    let response;
    try {
      response = await fetchImpl(`${apiBase}/tools/${encodeURIComponent(name)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      throw errorWithCode("腾讯云计算服务暂时不可达，请检查网络后重试。", "REMOTE_NETWORK");
    }
    if (response.status === 401 && allowReauthentication) {
      authenticated = false;
      await waitForAccess();
      return invoke(name, args, false);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.structuredContent) {
      const message = body.message || `${name} 调用失败（HTTP ${response.status}）。`;
      throw errorWithCode(message, response.status === 401 ? "REMOTE_AUTH" : "REMOTE_TOOL_ERROR");
    }
    return body.structuredContent;
  }

  async function redeemHandoff(token, allowReauthentication = true) {
    if (!authenticated) await waitForAccess();
    const response = await fetchImpl(`${apiBase}/handoff`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.status === 401 && allowReauthentication) {
      authenticated = false;
      await waitForAccess();
      return redeemHandoff(token, false);
    }
    if (!response.ok) {
      throw errorWithCode(
        response.status === 404 ? "配置交接链接已使用或过期，请由 Agent 重新打开工作台。"
          : "无法读取配置交接内容，请检查 Web 会话。",
        "REMOTE_HANDOFF",
      );
    }
    const body = await response.json();
    return body.handoff;
  }

  return { callTool: invoke, connect, redeemHandoff };
}

