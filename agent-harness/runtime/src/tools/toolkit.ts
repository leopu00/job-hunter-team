/**
 * A role's toolkit: every built-in tool, and the policy that gates them.
 *
 * Built in one place so the CLI, a container entrypoint and the parity layer
 * hand an agent the same tools under the same rules. Subagents and the todo
 * list are the session's own (`subagents`, `todos` options), because they need
 * the loop itself.
 */

import { platform } from "node:os";

import type { Config } from "../config.ts";
import { PermissionPolicy, type PermissionAsker } from "../core/permissions.ts";
import type { ProviderPort } from "../core/provider/port.ts";
import { createBashTool } from "./bash.ts";
import { connectMcpFromFile, type McpServerStatus } from "./mcp.ts";
import type { ToolHandler } from "./registry.ts";
import { createWebFetchTool, type WebFetchOptions } from "./web-fetch.ts";
import { createWebSearchTool } from "./web-search.ts";
import { createWorkspaceTools } from "./workspace.ts";

export interface Toolkit {
  tools: ToolHandler[];
  permissions: PermissionPolicy;
  /** The operating system in words, for a subagent's brief. */
  platform: string;
  /** Connected MCP servers and what each offered. Empty without a config. */
  mcpServers: McpServerStatus[];
  /** Stops MCP servers. Call when the session ends. */
  close(): Promise<void>;
}

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS, with BSD command-line tools",
  linux: "Linux",
  win32: "Windows",
};

export async function buildToolkit(
  config: Pick<Config, "workdir" | "profileDir" | "permissionMode" | "mcpConfig" | "profile">,
  options: { provider: ProviderPort; ask?: PermissionAsker | undefined; webFetch?: WebFetchOptions | undefined },
): Promise<Toolkit> {
  const { workdir } = config;
  const { provider } = options;

  const web: ToolHandler[] = [];
  if (provider.webSearch && config.profile.capabilities.webSearch) {
    web.push(createWebSearchTool(provider, config.profile.pricing?.webSearchPerCallUsd ?? 0));
  }
  web.push(createWebFetchTool(options.webFetch));

  const mcp = config.mcpConfig ? await connectMcpFromFile(config.mcpConfig) : undefined;

  return {
    platform: PLATFORM_NAMES[platform()] ?? platform(),
    tools: [...createWorkspaceTools({ workdir }), createBashTool({ workdir }), ...web, ...(mcp?.tools ?? [])],
    permissions: new PermissionPolicy({
      mode: config.permissionMode,
      freeReadRoots: [workdir, ...(config.profileDir ? [config.profileDir] : [])],
      ask: options.ask,
    }),
    mcpServers: mcp?.servers ?? [],
    close: async () => {
      await mcp?.close();
    },
  };
}
