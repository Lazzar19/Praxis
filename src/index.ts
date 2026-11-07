import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createCoachServer } from "./server.js";

serveStdio(() => createCoachServer());
console.error("learn-coach MCP server listening on stdio");
