# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/mcp-server/package.json ./apps/mcp-server/package.json
COPY packages/config-core/package.json ./packages/config-core/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci

COPY apps/mcp-server/src ./apps/mcp-server/src
COPY apps/mcp-server/ui/src ./apps/mcp-server/ui/src
COPY apps/mcp-server/vite.config.js ./apps/mcp-server/vite.config.js
COPY apps/web/config-relation-plane-baseline ./apps/web/config-relation-plane-baseline
COPY packages/config-core ./packages/config-core
COPY packages/contracts ./packages/contracts

# Vite 8's HTML transform drops the generated entry when this large classic script is LF-only.
# Normalize the builder copy to the same CRLF form used by the verified Windows package flow.
RUN node -e "const fs=require('node:fs');const p='apps/web/config-relation-plane-baseline/training-run-twin-standalone/js/config-relation-observer.js';const s=fs.readFileSync(p,'utf8').replace(/\r?\n/g,'\r\n');fs.writeFileSync(p,s)" \
    && npm run build:ui \
    && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000
WORKDIR /app

COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/mcp-server/package.json ./apps/mcp-server/package.json
COPY --from=builder --chown=node:node /app/apps/mcp-server/src ./apps/mcp-server/src
COPY --from=builder --chown=node:node /app/apps/mcp-server/ui/dist ./apps/mcp-server/ui/dist
COPY --chown=node:node apps/web/prototypes/constraint-lens.html ./apps/web/prototypes/constraint-lens.html
COPY --from=builder --chown=node:node /app/packages/config-core/package.json ./packages/config-core/package.json
COPY --from=builder --chown=node:node /app/packages/config-core/src ./packages/config-core/src
COPY --from=builder --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder --chown=node:node /app/packages/contracts/src ./packages/contracts/src
COPY --from=builder --chown=node:node /app/packages/contracts/*.schema.json ./packages/contracts/

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/mcp-server/src/http-entry.js"]
