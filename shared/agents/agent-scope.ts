/**
 * Agent Scope — Risoluzione e gestione agenti da config
 *
 * Risolve configurazione agente, workspace, path,
 * modello e provider a partire dalla config centralizzata.
 */

import path from "node:path";
import os from "node:os";
import { JHT_AGENTS_DIR } from "../paths.js";
import type {
  AgentConfig,
  AgentsConfig,
  AgentDefaults,
  ResolvedAgent,
  ThinkLevel,
} from "./types.js";

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_CONTEXT_TOKENS = 200_000;
const DEFAULT_THINKING: ThinkLevel = "medium";
const DEFAULT_WORKSPACE = "~/.jht/workspace";

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Lista gli ID di tutti gli agenti configurati */
export function listAgentIds(agents: AgentsConfig): string[] {
  return agents.list.map((a) => a.id);
}

/** Trova l'agente di default dalla lista */
export function resolveDefaultAgentId(agents: AgentsConfig): string | undefined {
  const defaultAgent = agents.list.find((a) => a.default);
  return defaultAgent?.id ?? agents.list[0]?.id;
}

/** Trova la config grezza di un agente per ID */
export function getAgentConfig(agents: AgentsConfig, agentId: string): AgentConfig | undefined {
  return agents.list.find((a) => a.id === agentId);
}

/** Risolve workspace directory per un agente */
export function resolveAgentWorkspaceDir(
  agents: AgentsConfig,
  agentId: string,
): string {
  const agent = getAgentConfig(agents, agentId);
  const workspace = agent?.workspace ?? agents.defaults.workspace ?? DEFAULT_WORKSPACE;
  return expandHome(workspace);
}

/** Risolve la directory dati dell'agente (~/.jht/agents/{id}) */
export function resolveAgentDir(agentId: string): string {
  return path.join(JHT_AGENTS_DIR, agentId);
}

/** Risolve un agente completo con tutti i default applicati */
export function resolveAgent(
  agents: AgentsConfig,
  agentId: string,
): ResolvedAgent | undefined {
  const agent = getAgentConfig(agents, agentId);
  if (!agent) return undefined;

  const defaults = agents.defaults;

  return {
    id: agent.id,
    name: agent.name,
    model: agent.model ?? defaults.model ?? DEFAULT_MODEL,
    provider: agent.provider ?? defaults.provider ?? DEFAULT_PROVIDER,
    workspaceDir: resolveAgentWorkspaceDir(agents, agentId),
    agentDir: resolveAgentDir(agentId),
    skills: agent.skills,
    thinking: agent.thinking ?? defaults.thinking ?? DEFAULT_THINKING,
    contextTokens: agent.contextTokens ?? defaults.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
  };
}

/** Risolve il modello primario di un agente */
export function resolveAgentModel(
  agents: AgentsConfig,
  agentId: string,
): string {
  const agent = getAgentConfig(agents, agentId);
  return agent?.model ?? agents.defaults.model ?? DEFAULT_MODEL;
}

/** Risolve il provider di un agente */
export function resolveAgentProvider(
  agents: AgentsConfig,
  agentId: string,
): string {
  const agent = getAgentConfig(agents, agentId);
  return agent?.provider ?? agents.defaults.provider ?? DEFAULT_PROVIDER;
}

/** Crea una config agenti minima con un solo agente */
export function createSingleAgentConfig(opts: {
  id?: string;
  name?: string;
  model?: string;
  provider?: string;
  workspace?: string;
}): AgentsConfig {
  return {
    defaults: {
      model: opts.model ?? DEFAULT_MODEL,
      provider: opts.provider ?? DEFAULT_PROVIDER,
      workspace: opts.workspace ?? DEFAULT_WORKSPACE,
    },
    list: [
      {
        id: opts.id ?? "default",
        name: opts.name ?? "Agente JHT",
        default: true,
        model: opts.model,
        provider: opts.provider,
        workspace: opts.workspace,
      },
    ],
  };
}
