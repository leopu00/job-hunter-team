import Link from "../../web-shims/next-link";
import { AgentIcon, LED_LABEL } from "./AgentList";
import { agentLed, lastActivity, type AgentDef, type AgentsData } from "./load-agents";
import { whenLong } from "./when";

/** One entry of the bar: label and value, always the same ones in the same order. */
export type BarEntry = { label: string; value: string };

/**
 * The entries of an agent's bar. The same list for every agent, and «—»
 * where the cloud has nothing: model and provider are never synced, and the
 * heartbeat and the last error belong to the whole team, not to one agent.
 * Adapted from FLEET's vociAgente (tmux-paradise
 * app/src/components/BarraAgente.tsx): labelled entries instead of bare
 * values, so nobody has to guess what a value is.
 */
export function barEntries(agent: AgentDef, data: AgentsData, now: number): BarEntry[] {
  const team = data.team;
  const enabled = team?.enabled[agent.role];
  return [
    { label: "ruolo", value: agent.name },
    { label: "stato", value: LED_LABEL[agentLed(team, agent.role, now)] },
    { label: "abilitato", value: enabled === undefined ? "—" : enabled ? "sì" : "no" },
    { label: "ultima attività", value: whenLong(lastActivity(data, agent.role), now) },
    { label: "heartbeat del team", value: whenLong(team?.heartbeatAt, now) },
    { label: "modello", value: "—" },
    { label: "provider", value: "—" },
  ];
}

/**
 * The bar over the conversation: who the agent is and what the cloud knows
 * of it, with the team's last error when there is one. One bar, the same for
 * every agent (FLEET's BarraAgente, 27/09: «è UNA barra, identica in ogni
 * posto»); what stays in FLEET is the machine's side (CPU, RAM, start/stop),
 * which the desktop cannot see.
 */
export default function AgentBar({ agent, data, now }: { agent: AgentDef; data: AgentsData; now: number }) {
  const led = agentLed(data.team, agent.role, now);
  const error = data.team?.lastError;
  return (
    <header className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-5 py-3" aria-label={`Barra di ${agent.name}`}>
      <div className="flex items-center gap-3">
        <AgentIcon agent={agent} led={led} size={38} />
        <div className="flex-1 min-w-0">
          <h1 className="m-0 text-[14px] font-bold tracking-wide" style={{ color: agent.color }}>
            {agent.name}
          </h1>
          <dl className="m-0 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
            {barEntries(agent, data, now).map((e) => (
              <div key={e.label} className="flex gap-1">
                <dt className="text-[var(--color-dim)]">{e.label}</dt>
                <dd className="m-0 text-[var(--color-base)]">{e.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {agent.page && (
          <Link
            href={agent.page}
            className="shrink-0 text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] no-underline transition-colors"
          >
            Pagina del ruolo
          </Link>
        )}
      </div>
      {error && (
        <p className="m-0 mt-2 text-[10px]" style={{ color: "var(--color-red)" }}>
          Ultimo errore del team ({whenLong(data.team?.lastErrorAt, now)}): {error}
        </p>
      )}
    </header>
  );
}
