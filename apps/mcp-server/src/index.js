#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createMcpServer } from "./server.js";

const server = createMcpServer();
const transport = new StdioServerTransport();

server.connect(transport).catch((error) => {
  console.error("mindspeed-config-mcp 启动失败：", error);
  process.exitCode = 1;
});
