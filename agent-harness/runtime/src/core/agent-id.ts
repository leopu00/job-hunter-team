/**
 * An agent's canonical id: the one name it goes by wherever a name decides
 * who is who.
 *
 * `start-agent.sh scout` with no instance starts SCOUT-1, and the prompts
 * address and sign as scout-1 / SCOUT-1. So a run started as `scout` is
 * scout-1: the same lock, the same mailbox, the same rows in jobs.db. Any
 * comparison of two agent names goes through here, never through the raw
 * strings — `scout` and `scout-1` compared raw are two agents, and one
 * agent can then write to itself, miss its own mail, or not recognise its
 * own positions (T5-quater).
 */

/** Lowercase, and a bare name as instance 1 (`scout` → `scout-1`), as `start-agent.sh` numbers it. */
export function agentInstanceId(agent: string): string {
  const name = agent.trim().toLowerCase();
  return /-\d+$/.test(name) ? name : `${name}-1`;
}

/** True when the two names are the same agent. */
export function sameAgent(a: string, b: string): boolean {
  return agentInstanceId(a) === agentInstanceId(b);
}

/**
 * Every name that means this agent in data already written: the canonical
 * id, and for instance 1 the bare role name too — rows written by a run
 * started as `scout` before names were made canonical. Lowercase: compare
 * with `lower(column)`.
 */
export function agentAliases(agent: string): string[] {
  const id = agentInstanceId(agent);
  const bare = id.replace(/-1$/, "");
  return bare === id ? [id] : [id, bare];
}
