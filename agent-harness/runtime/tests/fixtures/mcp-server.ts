// A minimal MCP server over stdio, for the client tests.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture", version: "1.0.0" });

server.registerTool(
  "add",
  { description: "Adds two numbers.", inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
);

server.registerTool(
  "fail",
  { description: "Always fails.", inputSchema: {} },
  async () => ({ isError: true, content: [{ type: "text", text: "it broke" }] }),
);

server.registerTool(
  "env",
  { description: "Reports whether a variable is set.", inputSchema: { name: z.string() } },
  async ({ name }) => ({ content: [{ type: "text", text: process.env[name] ? "set" : "unset" }] }),
);

await server.connect(new StdioServerTransport());
