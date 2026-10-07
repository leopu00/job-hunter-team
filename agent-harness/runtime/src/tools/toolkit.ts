/**
 * A role's toolkit: every built-in tool, and the policy that gates them.
 *
 * Built in one place so the CLI, a container entrypoint and the parity layer
 * hand an agent the same tools under the same rules. Subagents and the todo
 * list are the session's own (`subagents`, `todos` options), because they need
 * the loop itself.
 */

import { platform } from "node:os";
import { join } from "node:path";

import type { Config } from "../config.ts";
import { profileWritables, roleOf } from "../db/role-policy.ts";
import { maintainerLogbookPath } from "../parity/skills/maintainer.ts";
import { PermissionPolicy, type PermissionAsker } from "../core/permissions.ts";
import type { ProviderPort } from "../core/provider/port.ts";
import { createBashTool } from "./bash.ts";
import { connectMcpFromFile, type McpServerStatus } from "./mcp.ts";
import { portalSecretPaths } from "./paths.ts";
import type { ToolHandler } from "./registry.ts";
import { createSandbox, type SandboxKind } from "./sandbox.ts";
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
  /** The boundary `bash` runs in, what it leaves open, and why there is none when there is none. */
  sandbox: { kind: SandboxKind; missing?: string; gaps: string[] };
  /** Stops MCP servers and removes the sandbox's temporary folder. Call when the session ends. */
  close(): Promise<void>;
}

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS, with BSD command-line tools",
  linux: "Linux",
  win32: "Windows",
};

export async function buildToolkit(
  config: Pick<Config, "role" | "workdir" | "agentHome" | "apiHome" | "profileDir" | "permissionMode" | "mcpConfig" | "profile"> &
    Partial<Pick<Config, "userDir" | "userHistoryDir">>,
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

  // Inside the runtime state, only this role's own folders are its to touch — plus what
  // the team makes for the person (T25): the CV, the cover letter and the review are
  // deliverables, written by one role and read by the next.
  // T38: and, for the ASSISTENTE alone, the few files it writes inside the
  // person's profile — it is the only role that talks to them and the only one
  // that writes down what they said. The folder itself stays read-only for
  // everyone, this role included (SICUREZZA P2): what is writable is a list of
  // paths, so a script or a control flag that lives in there is not.
  const writable = config.profileDir === undefined ? [] : profileWritables(config.profileDir, config.role);
  const ownRoots = [workdir, config.agentHome, ...(config.userDir ? [config.userDir] : []), ...(writable.length > 0 ? [config.profileDir!] : [])];
  // The database may live outside apiHome (JHT_API_DB on a VPS): its files are
  // listed one by one, not its folder, which can be a JHT home the profile
  // lives in too.
  const stateRoots = [config.apiHome, ...(options.jobsDbFile ? jobsDbFiles(options.jobsDbFile) : [])];
  // T41: the MANTENITORE's logbook is its own state, though it sits in the team's
  // logs/ beside the other roles' (`<apiHome>/team`, the teamDir its tool gets).
  // One file, for the policy only: `maintainer_logbook` reaches it, the file tools
  // still do not, and nothing else in logs/ becomes the role's.
  const ownState = roleOf(config.role) === "mantenitore" ? [maintainerLogbookPath(join(config.apiHome, "team"))] : [];

  const mcp = config.mcpConfig ? await connectMcpFromFile(config.mcpConfig) : undefined;
  // The shell's boundary: writes in the role's working folder and a temporary one
  // only, the MCP config (its servers' Bearer headers) unreadable like a .env.
  // The JHT home's portal secrets too (P1, phase 0: reduces, does not close).
  const sandbox = createSandbox({
    workdir,
    protectedPaths: [...(config.mcpConfig ? [config.mcpConfig] : []), ...portalSecretPaths(process.env["JHT_HOME"])],
  });

  return {
    platform: PLATFORM_NAMES[platform()] ?? platform(),
    tools: [...createWorkspaceTools({ workdir, ownRoots, stateRoots }), createBashTool({ workdir, sandbox }), ...web, ...(mcp?.tools ?? [])],
    permissions: new PermissionPolicy({
      mode: config.permissionMode,
      // The person's own folders are read freely and written by nobody: the profile
      // (T10b) and, beside the deliverables, the documents they already had (T25).
      freeReadRoots: [workdir, ...personal(config)],
      readOnlyRoots: personal(config),
      writable,
      ownRoots: [...ownRoots, ...ownState],
      stateRoots,
      ask: options.ask,
    }),
    mcpServers: mcp?.servers ?? [],
    sandbox: { kind: sandbox.kind, ...(sandbox.missing ? { missing: sandbox.missing } : {}), gaps: sandbox.gaps },
    close: async () => {
      sandbox.dispose();
      await mcp?.close();
    },
  };
}

/** The person's own folders: read by every role, written by none. */
function personal(config: Partial<Pick<Config, "profileDir" | "userHistoryDir">>): string[] {
  return [config.profileDir, config.userHistoryDir].filter((dir): dir is string => dir !== undefined);
}

/** A SQLite database and the files it writes beside itself. */
export function jobsDbFiles(path: string): string[] {
  return [path, `${path}-wal`, `${path}-shm`, `${path}-journal`];
}
