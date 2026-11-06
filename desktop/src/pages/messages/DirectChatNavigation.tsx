import type { ChatScreenModel } from "./use-direct-chat-screen-model";
import { conversationTime, previewText } from "./chat-kinds";
import { DICTATION_LOCALE } from "./direct-chat.i18n";
import { pluralText } from "../../lib/plural";
import { unreadLabel } from "./chat-unread";
function AgentDot({ agent }: { agent: ChatScreenModel["agents"][number] }) {
  // Paused by the person: amber in the dot's place, never green.
  return agent.up && agent.paused ? (
    <span aria-hidden data-testid={`direct-chat-paused-${agent.id}`} className="inline-block w-2 shrink-0 text-[11px] leading-none" style={{ color: "var(--color-yellow)" }}>
      ⏸
    </span>
  ) : (
    <span
      aria-hidden
      data-testid={`direct-chat-led-${agent.id}`}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: agent.up ? "var(--color-green)" : "var(--color-border)" }}
    />
  );
}
function AgentRowSummary({ m, agent }: { m: ChatScreenModel; agent: ChatScreenModel["agents"][number] }) {
  const { unread, locale, t } = m;
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <AgentDot agent={agent} />
        <span className="min-w-0 break-words">{agent.label}</span>
      </span>
      {unread.last[agent.id] && (
        <time
          aria-hidden
          data-testid={`direct-chat-last-time-${agent.id}`}
          dateTime={new Date(unread.last[agent.id].at * 1000).toISOString()}
          className="shrink-0 text-[14px] font-normal text-[var(--color-dim)]"
        >
          {conversationTime(unread.last[agent.id].at, DICTATION_LOCALE[locale])}
        </time>
      )}
      {unread.counts[agent.id] > 0 && (
        <span
          data-testid={`unread-${agent.id}`}
          role="img"
          aria-label={pluralText(locale, unread.counts[agent.id], t.unreadAria)}
          className="min-w-5 rounded-full px-1.5 text-center text-[12px] font-bold leading-5"
          style={{ background: "var(--color-green)", color: "var(--color-void)" }}
        >
          {unreadLabel(unread.counts[agent.id])}
        </span>
      )}
    </span>
  );
}
function AgentPreview({ m, agent }: { m: ChatScreenModel; agent: ChatScreenModel["agents"][number] }) {
  const { agentId, unread, t } = m;
  return (
    <>
      {agent.id !== agentId && unread.last[agent.id] && (
        // The open conversation shows its lines itself, so its row does not repeat them.
        // aria-hidden: the name of the button stays the agent's; the line is its description
        <span
          id={`direct-chat-preview-${agent.id}`}
          aria-hidden
          data-testid={`direct-chat-preview-${agent.id}`}
          className="mt-0.5 block min-w-0 truncate text-[14px] font-normal text-[var(--color-dim)]"
        >
          {previewText(unread.last[agent.id], t.you)}
        </span>
      )}
    </>
  );
}
function AgentRow({ m, agent }: { m: ChatScreenModel; agent: ChatScreenModel["agents"][number] }) {
  const { squadSelected, otherSelected, agentId, unread, setSquadOn, setOtherOn, setAgentId } = m;
  return (
    <button
      key={agent.id}
      type="button"
      aria-current={!squadSelected && !otherSelected && agent.id === agentId ? "page" : undefined}
      aria-describedby={agent.id !== agentId && unread.last[agent.id] ? `direct-chat-preview-${agent.id}` : undefined}
      onClick={() => {
        setSquadOn(false);
        setOtherOn(null);
        setAgentId(agent.id);
      }}
      className="min-h-9 w-full min-w-0 rounded px-3 py-2 text-left text-[14px] font-semibold transition-colors"
      style={{
        // the chosen row: its own background and a bar on the left, the name in the bright colour (not the green of «working»)
        color: !squadSelected && !otherSelected && agent.id === agentId ? "var(--color-bright)" : "var(--color-muted)",
        background: !squadSelected && !otherSelected && agent.id === agentId ? "var(--color-card)" : "transparent",
        // in pause the bar is amber too: nothing about a paused agent is green
        boxShadow: !squadSelected && !otherSelected && agent.id === agentId ? `inset 2px 0 0 ${agent.up && agent.paused ? "var(--color-yellow)" : "var(--color-green)"}` : undefined,
      }}
    >
      <AgentRowSummary m={m} agent={agent} />
      <AgentPreview m={m} agent={agent} />
    </button>
  );
}
function SquadRow({ m }: { m: ChatScreenModel }) {
  const { squad, squadSelected, setOtherOn, setSquadOn, sessions, agents, others } = m;
  return (
    <>
      {squad && (
        <button
          type="button"
          data-testid="team-squad-row"
          aria-current={squadSelected ? "page" : undefined}
          onClick={() => {
            setOtherOn(null);
            setSquadOn(true);
          }}
          className="min-h-9 w-full min-w-0 rounded border-b border-[var(--color-border)] px-3 py-2 text-left text-[14px] font-semibold uppercase tracking-wider"
          style={{ color: squadSelected ? "var(--color-bright)" : "var(--color-muted)", background: squadSelected ? "var(--color-card)" : "transparent", boxShadow: squadSelected ? "inset 2px 0 0 var(--color-green)" : undefined }}
        >
          {squad.label}
          {/* counted on the rows of this list, the same as the Commands tab counts: the agents with a chat and the sessions without one */}
          {squad.line && sessions !== null && <span className="mt-0.5 block min-w-0 truncate text-[14px] font-normal normal-case tracking-normal text-[var(--color-dim)]">{squad.line(agents.filter((agent) => agent.up).length + others.filter((entry) => entry.up).length, agents.length + others.length)}</span>}
        </button>
      )}
    </>
  );
}
function OtherRow({ m, entry }: { m: ChatScreenModel; entry: ChatScreenModel["others"][number] }) {
  const { otherSelected, squadSelected, setSquadOn, setOtherOn } = m;
  return (
    <button
      key={entry.session}
      type="button"
      data-testid={`team-other-${entry.session}`}
      aria-current={otherSelected?.session === entry.session && !squadSelected ? "page" : undefined}
      onClick={() => {
        setSquadOn(false);
        setOtherOn(entry.session);
      }}
      className="min-h-9 w-full min-w-0 rounded px-3 py-2 text-left text-[14px] font-semibold"
      style={{
        color: otherSelected?.session === entry.session && !squadSelected ? "var(--color-bright)" : "var(--color-muted)",
        background: otherSelected?.session === entry.session && !squadSelected ? "var(--color-card)" : "transparent",
        boxShadow: otherSelected?.session === entry.session && !squadSelected ? "inset 2px 0 0 var(--color-green)" : undefined,
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: entry.up ? "var(--color-green)" : "var(--color-border)" }} />
        <span className="min-w-0 break-words">{entry.label}</span>
      </span>
    </button>
  );
}
export function ChatSidebar({ m }: { m: ChatScreenModel }) {
  const { t, squad, agents, others } = m;
  return (
    <aside className="hidden md:flex w-60 shrink-0 min-h-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="shrink-0 px-4 pt-4 pb-2 text-[14px] font-semibold uppercase tracking-[0.14em] text-[var(--color-dim)]">
        {t.agentsHeading}
      </div>
      <nav aria-label={t.agentsNavAria} className="min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-3 grid grid-cols-[minmax(0,1fr)] content-start gap-1">
        {squad && <SquadRow m={m} />}
        {agents.map((agent) => <AgentRow key={agent.id} m={m} agent={agent} />)}
        {others.map((entry) => <OtherRow key={entry.session} m={m} entry={entry} />)}
      </nav>
    </aside>
  );
}
