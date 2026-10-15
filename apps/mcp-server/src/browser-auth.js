import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "mindspeed_config_session";
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function signatureFor(accessToken, expiresAt) {
  return createHmac("sha256", accessToken)
    .update(`mindspeed-config-browser-session:${expiresAt}`)
    .digest("base64url");
}
function equalText(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function cookieValue(request) {
  const header = request.get("cookie") ?? "";
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== COOKIE_NAME) continue;
    return pair.slice(separator + 1).trim();
  }
  return "";
}

function requestOrigin(request, publicOrigin) {
  if (publicOrigin) return publicOrigin;
  const host = request.get("host");
  return host ? `${request.protocol}://${host}` : "";
}

export function createBrowserSessionAuth({
  accessToken,
  basePath = "/mindspeed-config",
  publicOrigin,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof accessToken !== "string" || accessToken.length < 32) {
    throw new Error("浏览器访问码至少需要 32 个字符。");
  }
  if (!basePath.startsWith("/") || basePath.endsWith("/")) {
    throw new Error("浏览器基础路径必须以 / 开头且末尾不带 /。");
  }
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) {
    throw new Error("MCP_BROWSER_PUBLIC_ORIGIN 必须是只包含协议和主机的 Origin。");
  }

  function isAuthenticated(request) {
    const value = cookieValue(request);
    const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (!match) return false;
    const expiresAt = Number(match[1]);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) return false;
    return equalText(match[2], signatureFor(accessToken, expiresAt));
  }

  function verifyAccessToken(candidate) {
    return typeof candidate === "string" && equalText(candidate, accessToken);
  }

  function verifyOrigin(request) {
    const origin = request.get("origin") ?? "";
    return origin === requestOrigin(request, publicOrigin);
  }

  function setSessionCookie(request, response) {
    const expiresAt = now() + sessionTtlMs;
    const value = `${expiresAt}.${signatureFor(accessToken, expiresAt)}`;
    const secure = request.secure || publicOrigin?.startsWith("https://");
    const attributes = [
      `${COOKIE_NAME}=${value}`,
      `Path=${basePath}/`,
      `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
      "HttpOnly",
      "SameSite=Strict",
      ...(secure ? ["Secure"] : []),
    ];
    response.set("Set-Cookie", attributes.join("; "));
  }

  function clearSessionCookie(request, response) {
    const secure = request.secure || publicOrigin?.startsWith("https://");
    response.set("Set-Cookie", [
      `${COOKIE_NAME}=`,
      `Path=${basePath}/`,
      "Max-Age=0",
      "HttpOnly",
      "SameSite=Strict",
      ...(secure ? ["Secure"] : []),
    ].join("; "));
  }

  function requireOrigin(request, response, next) {
    if (!verifyOrigin(request)) {
      response.status(403).json({ error: "origin_denied" });
      return;
    }
    next();
  }

  function requireSession(request, response, next) {
    if (!isAuthenticated(request)) {
      response.status(401).json({ error: "browser_session_required" });
      return;
    }
    next();
  }

  return {
    clearSessionCookie,
    isAuthenticated,
    requireOrigin,
    requireSession,
    setSessionCookie,
    verifyAccessToken,
  };
}

