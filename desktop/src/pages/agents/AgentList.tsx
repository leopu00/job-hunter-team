import type { CSSProperties } from "react";
import Link from "../../web-shims/next-link";
import { agentLed, lastActivity, unreadCount, type AgentDef, type AgentsData, type Led } from "./load-agents";
import { whenShort } from "./when";

/**
 * The list of the team's agents, one row each: icon with the led, name, time
 * of the last thing it did, a preview (its last chat message, or its last
 * move) and the unread badge. Adapted from FLEET's chat list
 * (tmux-paradise app/src/components/ElencoChat.tsx: the wa-row row with icon,
 * name, time, preview and badge; a click opens the conversation on the right).
 * Here every agent has a row, with or without messages: the team is fixed.
 */
export default function AgentList({
  agents,
  data,
  selected,
  now,
}: {
  agents: AgentDef[];
  data: AgentsData;
  selected: string;
  now: number;
}) {
  return (
    <nav aria-label="Agenti del team" className="flex flex-col gap-0.5 p-2">
      {agents.map((agent) => {
        const on = agent.role === selected;
        const led = agentLed(data.team, agent.role, now);
        const unread = agent.chat ? unreadCount(data.messages, agent.role) : 0;
        return (
          <Link
            key={agent.role}
            href={`/agents?agent=${agent.role}`}
            aria-current={on ? "page" : undefined}
            data-testid={`agent-${agent.role}`}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg no-underline transition-colors hover:bg-[var(--color-card)]"
            style={{ background: on ? "var(--color-card)" : undefined, "--ac": agent.color } as CSSProperties}
          >
            <AgentIcon agent={agent} led={led} />
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <b className="text-[11.5px] tracking-wide truncate" style={{ color: on ? agent.color : "var(--color-bright)" }}>
                  {agent.name}
                </b>
                <small className="ml-auto text-[9px] text-[var(--color-dim)] shrink-0">
                  {whenShort(lastActivity(data, agent.role), now)}
                </small>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--color-muted)] truncate flex-1 min-w-0">{preview(agent, data)}</span>
                {unread > 0 && (
                  <span
                    aria-label={`${unread} non letti`}
                    className="min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center text-[8px] font-bold leading-none shrink-0"
                    style={{ background: "var(--color-yellow)", color: "var(--color-void)" }}
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

const LED_COLOR: Record<Led, string> = {
  on: "var(--color-green)",
  stale: "var(--color-yellow)",
  off: "var(--color-dim)",
  unknown: "var(--color-border)",
};

export const LED_LABEL: Record<Led, string> = {
  on: "team acceso",
  stale: "heartbeat vecchio",
  off: "spento",
  unknown: "stato mai arrivato",
};

/** The role's emoji in its colour ring, with the led in the corner (FLEET's IconaAgente with stato). */
export function AgentIcon({ agent, led, size = 34 }: { agent: AgentDef; led: Led; size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        border: `1.5px solid ${agent.color}`,
        background: "var(--color-panel)",
      }}
      aria-hidden
    >
      {agent.emoji}
      <span
        title={LED_LABEL[led]}
        className="absolute -bottom-0.5 -right-0.5 rounded-full"
        style={{
          width: Math.round(size * 0.3),
          height: Math.round(size * 0.3),
          background: LED_COLOR[led],
          border: "2px solid var(--color-panel)",
        }}
      />
    </span>
  );
}

function preview(agent: AgentDef, data: AgentsData): string {
  if (agent.chat) {
    const last = data.messages.find((m) => m.agent === agent.role);
    if (last) return (last.author === "user" ? "Tu: " : "") + last.body.replace(/\s+/g, " ").trim();
  }
  const move = data.moves[agent.role]?.[0];
  if (move) return `${move.actor}: ${move.from ?? "—"} → ${move.to ?? "—"}`;
  return agent.chat ? "Nessun messaggio" : "Nessuna mossa sul cloud";
}
