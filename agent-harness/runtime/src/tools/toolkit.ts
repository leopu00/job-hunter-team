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
  config: Pick<Config, "workdir" | "agentHome" | "apiHome" | "profileDir" | "permissionMode" | "mcpConfig" | "profile">,
  options: {
    provider: ProviderPort;
    ask?: PermissionAsker | undefined;
    webFetch?: WebFetchOptions | undefined;
    /**
     * The team's jobs.db (`jobsDbPath`). Only the database tools may change
     * it; the file tools treat it, and SQLite's -wal, -shm and -journal beside
     * it, as another role's state, wherever it lives.
     */
    jobsDbFile?: string | undefined;
  },
): Promise<Toolkit> {
  const { workdir } = config;
  const { provider } = options;

  const web: ToolHandler[] = [];
  if (provider.webSearch && config.profile.capabilities.webSearch) {
    web.push(createWebSearchTool(provider, config.profile.pricing?.webSearchPerCallUsd ?? 0));
  }
  web.push(createWebFetchTool(options.webFetch));

  // Inside the runtime state, only this role's own folders are its to touch.
  const ownRoots = [workdir, config.agentHome];
  // The database may live outside apiHome (JHT_API_DB on a VPS): its files are
  // listed one by one, not its folder, which can be a JHT home the profile
  // lives in too.
  const stateRoots = [config.apiHome, ...(options.jobsDbFile ? jobsDbFiles(options.jobsDbFile) : [])];

  const mcp = config.mcpConfig ? await connectMcpFromFile(config.mcpConfig) : undefined;

  return {
    platform: PLATFORM_NAMES[platform()] ?? platform(),
    tools: [...createWorkspaceTools({ workdir, ownRoots, stateRoots }), createBashTool({ workdir }), ...web, ...(mcp?.tools ?? [])],
    permissions: new PermissionPolicy({
      mode: config.permissionMode,
      freeReadRoots: [workdir, ...(config.profileDir ? [config.profileDir] : [])],
      // The person's profile: every role reads it, none writes it (T10b).
      readOnlyRoots: config.profileDir ? [config.profileDir] : [],
      ownRoots,
      stateRoots,
      ask: options.ask,
    }),
    mcpServers: mcp?.servers ?? [],
    close: async () => {
      await mcp?.close();
    },
  };
}

/** A SQLite database and the files it writes beside itself. */
export function jobsDbFiles(path: string): string[] {
  return [path, `${path}-wal`, `${path}-shm`, `${path}-journal`];
}
