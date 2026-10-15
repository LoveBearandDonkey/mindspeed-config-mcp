import { createHash, timingSafeEqual } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { assertToolResult } from "@mindspeed-config/contracts";

import { loadPackagedAppHtml } from "./app-resource.js";
import { createBrowserSessionAuth } from "./browser-auth.js";
import { createMcpServer, REGISTERED_TOOL_COUNT, TOOL_DEFINITIONS } from "./server.js";

const SERVICE_VERSION = "0.1.0";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const MIN_TOKEN_LENGTH = 32;
const DEFAULT_BROWSER_BASE_PATH = "/mindspeed-config";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 10;

export function loadHttpConfig(env = process.env) {
  const host = env.MCP_HTTP_HOST?.trim() || DEFAULT_HOST;
  const port = parsePort(env.MCP_HTTP_PORT);
  const token = env.MCP_BEARER_TOKEN?.trim();
  const allowedHosts = splitList(env.MCP_ALLOWED_HOSTS);
  const allowedOrigins = splitList(env.MCP_ALLOWED_ORIGINS);
  const browserAccessToken = env.MCP_BROWSER_ACCESS_TOKEN?.trim() || token;
  const browserBasePath = parseBasePath(env.MCP_BROWSER_BASE_PATH);
  const browserPublicOrigin = parseOrigin(env.MCP_BROWSER_PUBLIC_ORIGIN);

  if (!token) {
    throw new Error("缺少 MCP_BEARER_TOKEN；HTTP 服务拒绝以无鉴权模式启动。");
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_BEARER_TOKEN 至少需要 ${MIN_TOKEN_LENGTH} 个字符。`);
  }
  if (["0.0.0.0", "::"].includes(host) && !allowedHosts?.length) {
    throw new Error("监听所有网卡时必须设置 MCP_ALLOWED_HOSTS，以启用 Host 校验。");
  }

  if (browserAccessToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_BROWSER_ACCESS_TOKEN 至少需要 ${MIN_TOKEN_LENGTH} 个字符。`);
  }

  return {
    host,
    port,
    token,
    allowedHosts,
    allowedOrigins,
    browserAccessToken,
    browserBasePath,
    browserPublicOrigin,
  };
}

export function createHttpApp({
  token,
  host = DEFAULT_HOST,
  allowedHosts,
  allowedOrigins,
  browserAccessToken = token,
  browserBasePath = DEFAULT_BROWSER_BASE_PATH,
  browserPublicOrigin,
  createServer = createMcpServer,
} = {}) {
  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`HTTP MCP 需要至少 ${MIN_TOKEN_LENGTH} 个字符的 Bearer Token。`);
  }

  const effectiveAllowedOrigins = browserPublicOrigin
    ? [...new Set([...(allowedOrigins ?? []), new URL(browserPublicOrigin).hostname])]
    : allowedOrigins;

  const app = createMcpExpressApp({
    host,
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    ...(effectiveAllowedOrigins?.length ? { allowedOrigins: effectiveAllowedOrigins } : {}),
    jsonLimit: "2mb",
  });
  app.disable("x-powered-by");
  app.enable("strict routing");
  app.set("trust proxy", "loopback");

  const browserAuth = createBrowserSessionAuth({
    accessToken: browserAccessToken,
    basePath: browserBasePath,
    publicOrigin: browserPublicOrigin,
  });
  const loginFailures = new Map();

  const health = (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.status(200).json({
      status: "ok",
      service: "mindspeed-config-mcp",
      version: SERVICE_VERSION,
      transport: "streamable-http",
      tools: REGISTERED_TOOL_COUNT,
      uptime_seconds: Math.floor(process.uptime()),
    });
  };
  app.get("/health", health);
  app.get(`${browserBasePath}/health`, health);

  const handleMcp = async (request, response) => {
    const server = createServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([transport.close(), server.close()]);
    };
    response.on("close", () => void close());

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("HTTP MCP request failed:", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
      await close();
    }
  };
  const bearerAuth = requireStaticBearerToken(token);
  app.all("/mcp", bearerAuth, handleMcp);
  app.all(`${browserBasePath}/mcp`, bearerAuth, handleMcp);

  app.use((request, response, next) => {
    if (request.method === "GET" && request.path === browserBasePath) {
      response.redirect(308, `${browserBasePath}/`);
      return;
    }
    next();
  });

  app.get(`${browserBasePath}/`, async (_request, response) => {
    try {
      const html = await loadPackagedAppHtml();
      const config = JSON.stringify({ apiBase: `${browserBasePath}/api` }).replaceAll("<", "\\u003c");
      const browserHtml = html.replace(
        "<head>",
        `<head><script>globalThis.__MINDSPEED_WEB_SERVICE__=${config};</script>`,
      );
      response.set({
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; base-uri 'none'; connect-src 'self'; font-src data:; form-action 'none'; frame-ancestors 'self'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      response.status(200).send(browserHtml);
    } catch (error) {
      console.error("Browser workbench resource failed:", error);
      response.status(503).type("text/plain").send("MindSpeed 配置工作台暂时不可用。");
    }
  });

  app.get(`${browserBasePath}/api/session`, (request, response) => {
    response.set("Cache-Control", "no-store");
    response.status(200).json({ authenticated: browserAuth.isAuthenticated(request) });
  });

  app.post(`${browserBasePath}/api/session`, browserAuth.requireOrigin, (request, response) => {
    response.set("Cache-Control", "no-store");
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const failure = activeLoginFailure(loginFailures, key);
    if (failure?.count >= LOGIN_FAILURE_LIMIT) {
      response.status(429).json({
        error: "too_many_attempts",
        retry_after_seconds: Math.max(1, Math.ceil((failure.resetAt - Date.now()) / 1000)),
      });
      return;
    }
    if (!browserAuth.verifyAccessToken(request.body?.access_token)) {
      recordLoginFailure(loginFailures, key);
      response.status(401).json({ error: "invalid_access_code" });
      return;
    }
    loginFailures.delete(key);
    browserAuth.setSessionCookie(request, response);
    response.status(200).json({ authenticated: true });
  });

  app.delete(
    `${browserBasePath}/api/session`,
    browserAuth.requireOrigin,
    (request, response) => {
      browserAuth.clearSessionCookie(request, response);
      response.status(200).json({ authenticated: false });
    },
  );

  app.post(
    `${browserBasePath}/api/tools/:toolName`,
    browserAuth.requireOrigin,
    browserAuth.requireSession,
    (request, response) => {
      response.set("Cache-Control", "no-store");
      try {
        const structuredContent = executeCoreTool(request.params.toolName, request.body);
        response.status(200).json({ structuredContent });
      } catch (error) {
        if (error instanceof RangeError) {
          response.status(404).json({ error: "tool_not_found" });
          return;
        }
        if (error instanceof TypeError) {
          response.status(400).json({ error: "invalid_tool_input", message: error.message });
          return;
        }
        console.error("Browser tool request failed:", error);
        response.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.use((request, response) => {
    response.status(404).json({ error: "not_found", path: request.path });
  });

  return app;
}

function activeLoginFailure(failures, key, now = Date.now()) {
  const value = failures.get(key);
  if (!value) return undefined;
  if (value.resetAt <= now) {
    failures.delete(key);
    return undefined;
  }
  return value;
}

function recordLoginFailure(failures, key, now = Date.now()) {
  const current = activeLoginFailure(failures, key, now);
  failures.set(key, current
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt: now + LOGIN_WINDOW_MS });
}

function executeCoreTool(name, args) {
  const definition = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) throw new RangeError(`未知计算工具：${name}`);
  const input = definition.assertInput(args);
  const result = definition.run(input);
  assertToolResult(result);
  return result;
}

export async function startHttpServer(config = loadHttpConfig()) {
  const app = createHttpApp(config);
  return new Promise((resolve, reject) => {
    const httpServer = app.listen(config.port, config.host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(httpServer);
    });
    httpServer.on("error", reject);
  });
}

function requireStaticBearerToken(expectedToken) {
  return (request, response, next) => {
    const authorization = request.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match || !tokensEqual(match[1], expectedToken)) {
      response.set("WWW-Authenticate", 'Bearer realm="mindspeed-config-mcp"');
      response.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  };
}

function tokensEqual(actual, expected) {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function parsePort(value) {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MCP_HTTP_PORT 必须是 1～65535 的整数，实际为 ${JSON.stringify(value)}。`);
  }
  return port;
}

function splitList(value) {
  if (!value?.trim()) return undefined;
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function parseBasePath(value) {
  const basePath = value?.trim() || DEFAULT_BROWSER_BASE_PATH;
  if (!/^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/.test(basePath) || basePath.includes("//")) {
    throw new Error("MCP_BROWSER_BASE_PATH 必须是末尾不带 / 的绝对 URL 路径。");
  }
  return basePath;
}

function parseOrigin(value) {
  if (!value?.trim()) return undefined;
  const origin = value.trim();
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("MCP_BROWSER_PUBLIC_ORIGIN 必须是有效的 http(s) Origin。");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error("MCP_BROWSER_PUBLIC_ORIGIN 必须只包含 http(s) 协议和主机。");
  }
  return origin;
}
