import { randomBytes } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 20;
const pending = new Map();

function prune(now = Date.now()) {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token);
  }
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
}

export function createWorkbenchHandoff(data) {
  prune();
  const token = randomBytes(32).toString("base64url");
  pending.set(token, { data: structuredClone(data), expiresAt: Date.now() + TTL_MS });
  return token;
}

export function consumeWorkbenchHandoff(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.data;
}
