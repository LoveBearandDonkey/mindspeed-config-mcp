import { createHash, timingSafeEqual } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

import { createMcpServer, TOOL_DEFINITIONS } from "./server.js";

const SERVICE_VERSION = "0.1.0";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const MIN_TOKEN_LENGTH = 32;

export function loadHttpConfig(env = process.env) {
  const host = env.MCP_HTTP_HOST?.trim() || DEFAULT_HOST;
  const port = parsePort(env.MCP_HTTP_PORT);
  const token = env.MCP_BEARER_TOKEN?.trim();
  const allowedHosts = splitList(env.MCP_ALLOWED_HOSTS);
  const allowedOrigins = splitList(env.MCP_ALLOWED_ORIGINS);

  if (!token) {
    throw new Error("缺少 MCP_BEARER_TOKEN；HTTP 服务拒绝以无鉴权模式启动。");
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_BEARER_TOKEN 至少需要 ${MIN_TOKEN_LENGTH} 个字符。`);
  }
  if (["0.0.0.0", "::"].includes(host) && !allowedHosts?.length) {
    throw new Error("监听所有网卡时必须设置 MCP_ALLOWED_HOSTS，以启用 Host 校验。");
  }

  return { host, port, token, allowedHosts, allowedOrigins };
}

export function createHttpApp({
  token,
  host = DEFAULT_HOST,
  allowedHosts,
  allowedOrigins,
  createServer = createMcpServer,
} = {}) {
  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`HTTP MCP 需要至少 ${MIN_TOKEN_LENGTH} 个字符的 Bearer Token。`);
  }

  const app = createMcpExpressApp({
    host,
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    ...(allowedOrigins?.length ? { allowedOrigins } : {}),
    jsonLimit: "2mb",
  });
  app.disable("x-powered-by");

  app.get("/health", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.status(200).json({
      status: "ok",
      service: "mindspeed-config-mcp",
      version: SERVICE_VERSION,
      transport: "streamable-http",
      tools: TOOL_DEFINITIONS.length,
      uptime_seconds: Math.floor(process.uptime()),
    });
  });

  app.all("/mcp", requireStaticBearerToken(token), async (request, response) => {
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
  });

  app.use((request, response) => {
    response.status(404).json({ error: "not_found", path: request.path });
  });

  return app;
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
