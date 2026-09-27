/**
 * team_state.agents_status as a box may write it through PATCH /api/team-state
 * (token branch): each agent's status for the desktop office's tags.
 *
 * The box sends only its own source's key, { tui: { agents: {...} } }; the
 * database merges it next to the other sources and stamps its "at"
 * (migration 089). Here the value is rebuilt from what is recognised, never
 * passed through: a box is the user's own, but the route is the boundary.
 *
 * The vocabulary stays loose on purpose (a word the desktop does not know is
 * dropped by the desktop, cli/src/lib/agents-status.js is the producer);
 * what is checked is the shape and the sizes.
 */

/** The sources a paired box may write: the TUI team, the JHT API executor (its own account). */
export const AGENTS_STATUS_SOURCES = ["tui", "api"] as const;

/** More agents than any team runs: a bigger map is not a team's. */
export const AGENTS_STATUS_MAX_AGENTS = 64;

const UID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const WORD = /^[a-z_]{1,24}$/;
const ENTRY_KEYS = new Set(["status", "since", "throttle_left_s"]);

export type AgentStatusEntry = {
  status: string;
  since: string;
  throttle_left_s?: number;
};
export type AgentsStatusPatch = Partial<
  Record<
    (typeof AGENTS_STATUS_SOURCES)[number],
    { agents: Record<string, AgentStatusEntry> }
  >
>;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The value to write, or why it is refused. */
export function sanitizeAgentsStatus(
  value: unknown,
): { ok: true; value: AgentsStatusPatch } | { ok: false; error: string } {
  if (!isObject(value))
    return { ok: false, error: "agents_status deve essere un oggetto JSON" };
  const sources = Object.keys(value);
  if (sources.length === 0) return { ok: false, error: "agents_status vuoto" };
  const out: AgentsStatusPatch = {};
  for (const source of sources) {
    if (!(AGENTS_STATUS_SOURCES as readonly string[]).includes(source))
      return {
        ok: false,
        error: `agents_status: sorgente non scrivibile da un box: ${source.slice(0, 16)}`,
      };
    const entry = value[source];
    if (
      !isObject(entry) ||
      Object.keys(entry).some((k) => k !== "agents") ||
      !isObject(entry.agents)
    )
      return {
        ok: false,
        error: `agents_status.${source} deve essere { agents: {...} }`,
      };
    const agents = Object.entries(entry.agents);
    if (agents.length > AGENTS_STATUS_MAX_AGENTS)
      return { ok: false, error: `agents_status.${source}: troppi agenti` };
    const clean: Record<string, AgentStatusEntry> = {};
    for (const [uid, raw] of agents) {
      if (!UID.test(uid))
        return {
          ok: false,
          error: `agents_status.${source}: nome agente non valido`,
        };
      if (!isObject(raw) || Object.keys(raw).some((k) => !ENTRY_KEYS.has(k)))
        return {
          ok: false,
          error: `agents_status.${source}.${uid}: campi non riconosciuti`,
        };
      const { status, since, throttle_left_s } = raw;
      if (typeof status !== "string" || !WORD.test(status))
        return {
          ok: false,
          error: `agents_status.${source}.${uid}: status non valido`,
        };
      if (
        typeof since !== "string" ||
        since.length > 40 ||
        Number.isNaN(Date.parse(since))
      )
        return {
          ok: false,
          error: `agents_status.${source}.${uid}: since non valido`,
        };
      const item: AgentStatusEntry = { status, since };
      if (throttle_left_s !== undefined) {
        if (
          typeof throttle_left_s !== "number" ||
          !Number.isFinite(throttle_left_s) ||
          throttle_left_s < 0 ||
          throttle_left_s > 86_400
        )
          return {
            ok: false,
            error: `agents_status.${source}.${uid}: throttle_left_s non valido`,
          };
        item.throttle_left_s = Math.round(throttle_left_s);
      }
      clean[uid] = item;
    }
    out[source as keyof AgentsStatusPatch] = { agents: clean };
  }
  return { ok: true, value: out };
}
