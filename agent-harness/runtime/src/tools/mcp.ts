/**
 * MCP: tools from servers the person connects.
 *
 * The Model Context Protocol lets any program offer tools. The runtime is a client:
 * it starts or reaches the servers listed in a JSON file, lists their tools,
 * and registers each as `mcp__<server>__<tool>` in the same closed registry
 * as the built-in ones — so an MCP call goes through the same schema check,
 * permission gate, output cap and audit as `bash`.
 *
 * The file uses the shape Claude Code and other clients use:
 *
 *     { "mcpServers": {
 *         "fetch":  { "command": "uvx", "args": ["mcp-server-fetch"] },
 *         "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } } } }
 *
 * Every MCP call is classified as `execute`: what a server does is up to the
 * server, and its own description of itself is not a guarantee. A server that
 * fails to start is reported and skipped, not fatal.
 */

import { readFile } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import { HarnessError } from "../core/errors.ts";
import type { ToolHandler } from "./registry.ts";

const serverSchema = z.union([
  z
    .object({
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      cwd: z.string().optional(),
    })
    .strict(),
  z
    .object({
      url: z.string().url(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
]);

const configSchema = z.object({ mcpServers: z.record(z.string(), serverSchema) });

export type McpServerConfig = z.infer<typeof serverSchema>;

export interface McpServerStatus {
  name: string;
  toolCount: number;
  error?: string;
}

export interface McpConnection {
  tools: ToolHandler[];
  servers: McpServerStatus[];
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
/** Provider limit on tool names (OpenAI: 64). */
const MAX_NAME = 64;

/** Reads the config file and connects to every server in it. */
export async function connectMcpFromFile(path: string): Promise<McpConnection> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new HarnessError("config_invalid", `Could not read the MCP config at ${path}: ${(error as Error).message}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HarnessError("config_invalid", `The MCP config at ${path} is not valid: ${parsed.error.issues[0]?.message}`);
  }
  return connectMcpServers(parsed.data.mcpServers);
}

export async function connectMcpServers(servers: Record<string, McpServerConfig>): Promise<McpConnection> {
  const clients: Client[] = [];
  const tools: ToolHandler[] = [];
  const statuses: McpServerStatus[] = [];

  // Sequential and in file order: tool order is part of the prompt prefix, and
  // a stable prefix is what the provider's cache matches on.
  for (const [name, config] of Object.entries(servers)) {
    const client = new Client({ name: "jht-agent-runtime", version: "0.1.0" });
    try {
      // The cast bridges the SDK's own optional-property typing to our stricter
      // `exactOptionalPropertyTypes`; both classes implement `Transport`.
      const transport: Transport =
        "command" in config
          ? new StdioClientTransport({
              command: config.command,
              ...(config.args ? { args: config.args } : {}),
              // The SDK's safe defaults (PATH, HOME, …) plus what the file names —
              // never the runtime's own environment, which holds the provider key.
              env: { ...getDefaultEnvironment(), ...config.env },
              ...(config.cwd ? { cwd: config.cwd } : {}),
              stderr: "ignore",
            })
          : (new StreamableHTTPClientTransport(new URL(config.url), {
              requestInit: { headers: config.headers ?? {} },
            }) as unknown as Transport);
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `${name} did not start`);
      clients.push(client);

      const listed: McpToolInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_TIMEOUT_MS });
        listed.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);

      for (const tool of listed) tools.push(wrapTool(client, name, tool));
      statuses.push({ name, toolCount: listed.length });
    } catch (error) {
      await client.close().catch(() => {});
      statuses.push({ name, toolCount: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    tools,
    servers: statuses,
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}

interface McpToolInfo {
  name: string;
  description?: string | undefined;
  inputSchema: unknown;
}

function wrapTool(client: Client, server: string, tool: McpToolInfo): ToolHandler {
  const name = mcpToolName(server, tool.name);
  return {
    spec: {
      name,
      description: `[MCP server "${server}"] ${tool.description ?? tool.name}`.slice(0, 1_024),
      schema: toZod(tool.inputSchema),
    },

    classify(args) {
      const brief = JSON.stringify(args ?? {});
      return { risk: "execute", paths: [], summary: `${server}.${tool.name} ${brief.length > 120 ? `${brief.slice(0, 119)}…` : brief}` };
    },

    async execute(args, context) {
      const result = await client.callTool(
        { name: tool.name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { timeout: Math.min(CALL_TIMEOUT_MS, context.remainingMs()) },
      );
      return { ok: result.isError !== true, content: renderContent(result) };
    },
  };
}

export function mcpToolName(server: string, tool: string): string {
  const clean = (part: string) => part.replace(/[^A-Za-z0-9_-]/g, "_");
  return `mcp__${clean(server)}__${clean(tool)}`.slice(0, MAX_NAME);
}

/** The server's JSON Schema as zod, so its arguments are validated like any tool's. */
function toZod(inputSchema: unknown): z.ZodType {
  try {
    return z.fromJSONSchema(inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
  } catch {
    // A schema zod cannot express: still an object, validated by the server itself.
    return z.record(z.string(), z.unknown());
  }
}

function renderContent(result: Record<string, unknown>): string {
  const parts: string[] = [];
  const content = Array.isArray(result["content"]) ? (result["content"] as Array<Record<string, unknown>>) : [];
  for (const part of content) {
    switch (part["type"]) {
      case "text":
        parts.push(String(part["text"] ?? ""));
        break;
      case "image":
      case "audio":
        parts.push(`[${part["type"]}: ${String(part["mimeType"] ?? "unknown type")}, not shown]`);
        break;
      case "resource": {
        const resource = (part["resource"] ?? {}) as Record<string, unknown>;
        parts.push(typeof resource["text"] === "string" ? resource["text"] : `[resource ${String(resource["uri"] ?? "")}]`);
        break;
      }
      case "resource_link":
        parts.push(`[link: ${String(part["name"] ?? "")} ${String(part["uri"] ?? "")}]`);
        break;
    }
  }
  if (parts.length === 0 && result["structuredContent"] !== undefined) {
    parts.push(JSON.stringify(result["structuredContent"], null, 2));
  }
  return parts.join("\n") || "(the tool returned no content)";
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${message} within ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
