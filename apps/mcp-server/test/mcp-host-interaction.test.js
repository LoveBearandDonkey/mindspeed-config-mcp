import assert from "node:assert/strict";
import test from "node:test";

import { classifyMcpHostError } from "../ui/src/mcp-host-interaction.js";

test("宿主错误被归类为可操作的中文状态", () => {
  assert.deepEqual(classifyMcpHostError(new Error("401 Unauthorized: token expired")), {
    kind: "auth",
    message: "MCP 鉴权已失效，请更新 Token 或重新连接后重试。",
    retryable: true,
  });
  assert.equal(classifyMcpHostError(new Error("Request timed out")).kind, "timeout");
  assert.equal(classifyMcpHostError(new DOMException("aborted", "AbortError")).kind, "cancelled");
  assert.equal(classifyMcpHostError(new Error("transport closed")).kind, "disconnected");
  const toolError = new Error("输入未通过 Schema 校验");
  toolError.code = "MCP_TOOL_ERROR";
  assert.equal(classifyMcpHostError(toolError).kind, "tool");
});
