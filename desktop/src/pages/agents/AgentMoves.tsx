import Link from "../../web-shims/next-link";
import type { AgentDef, AgentMove } from "./load-agents";
import { whenLong } from "./when";

/**
 * For an agent the user does not chat with, the body under the bar: its
 * latest moves on the positions (position_transitions, newest first), each
 * with the instance that made it and the link to the position.
 */
export default function AgentMoves({ agent, moves, now }: { agent: AgentDef; moves: AgentMove[]; now: number }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
      <div className="max-w-3xl mx-auto px-5 py-6">
        <h2 className="m-0 mb-3 text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
          Ultime mosse
        </h2>
        {moves.length === 0 ? (
          <p className="m-0 text-[12px] text-[var(--color-muted)]">
            Nessuna mossa di {agent.name} sul cloud: arrivano quando il team sincronizza.
          </p>
        ) : (
          <ol className="m-0 p-0 list-none flex flex-col gap-2">
            {moves.map((m) => (
              <li
                key={`${m.ts}:${m.actor}:${m.legacyId}:${m.to ?? ""}`}
                className="rounded-lg border-l-2 px-4 py-2.5"
                style={{ background: "var(--color-card)", borderLeftColor: agent.color }}
              >
                <div className="flex items-center gap-2 text-[9px] text-[var(--color-dim)] mb-1">
                  <span className="font-semibold" style={{ color: agent.color }}>
                    {m.actor}
                  </span>
                  <span>{whenLong(m.ts, now)}</span>
                </div>
                <div className="text-[12px] text-[var(--color-base)]">
                  {m.from ?? "—"} → <b>{m.to ?? "—"}</b>
                  {" · "}
                  {m.positionId ? (
                    <Link
                      href={`/positions/${m.positionId}`}
                      className="text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline"
                    >
                      {m.title ?? `posizione #${m.legacyId}`}
                      {m.company ? ` — ${m.company}` : ""}
                    </Link>
                  ) : (
                    <span className="text-[var(--color-muted)]">posizione #{m.legacyId}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
