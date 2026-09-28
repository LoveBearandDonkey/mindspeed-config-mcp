import { loadHttpConfig, startHttpServer } from "./http.js";

const config = loadHttpConfig();
const httpServer = await startHttpServer(config);

console.log(`MindSpeed Config MCP listening on http://${config.host}:${config.port}/mcp`);
console.log(`Health check: http://${config.host}:${config.port}/health`);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  httpServer.close((error) => {
    if (error) {
      console.error("HTTP server shutdown failed:", error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
