import type { ChatScreenModel } from "./use-direct-chat-screen-model";
import Link from "../../web-shims/next-link";
import { TEAM_TABS_TEXT } from "./team-tabs.i18n";
import { unreadLabel } from "./chat-unread";
function AgentPicker({ m }: { m: ChatScreenModel }) {
  const { t, squadSelected, otherSelected, agentId, setOtherOn, setSquadOn, setAgentId, squad, agents, unread, others } = m;
  return (
    <>
      {/* the wrapper is a div: the global rule of `label` (display: block) beats the utility `md:hidden` */}
      <div data-testid="direct-chat-agent-picker" className="md:hidden">
      <label className="text-[14px] uppercase tracking-wider text-[var(--color-dim)]">
        {t.agentSelect}
        <select
          aria-label={t.agentSelect}
          value={squadSelected ? "__squad" : otherSelected ? `__other:${otherSelected.session}` : agentId}
          onChange={(event) => {
            if (event.target.value === "__squad") {
              setOtherOn(null);
              setSquadOn(true);
              return;
            }
            if (event.target.value.startsWith("__other:")) {
              setSquadOn(false);
              setOtherOn(event.target.value.slice("__other:".length));
              return;
            }
            setSquadOn(false);
            setOtherOn(null);
            setAgentId(event.target.value as typeof agentId);
          }}
          className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-[14px] text-[var(--color-bright)]"
        >
          {squad && <option value="__squad">{squad!.label}</option>}
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {unread.counts[agent.id] > 0 ? `${agent.label} (${unreadLabel(unread.counts[agent.id])})` : agent.label}
            </option>
          ))}
          {others.map((entry) => (
            <option key={entry.session} value={`__other:${entry.session}`}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      </div>
    </>
  );
}
export function ChatHeader({ m }: { m: ChatScreenModel }) {
  const { squadSelected, agentTabs, locale, t, squad, otherSelected, selected } = m;
  return (
    <header className="shrink-0 min-h-14 px-4 sm:px-5 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
      <div>
        {!squadSelected && <div className="text-[14px] uppercase tracking-[0.14em] text-[var(--color-dim)]">{agentTabs ? TEAM_TABS_TEXT[locale].squad : t.title}</div>}
        <h1 className="m-0 text-[18px] font-bold tracking-wide text-[var(--color-white)]">
          {squadSelected ? squad!.label : otherSelected ? otherSelected.label : <Link
            href={`/agents/${encodeURIComponent(selected.session)}`}
            data-testid="direct-chat-agent-page"
            className="text-inherit no-underline hover:underline"
            // the global colour of a link is green: the name of an agent is not green (the one in pause least of all)
            style={{ color: "var(--color-white)" }}
          >
            {selected.label}
          </Link>}
        </h1>
      </div>
      <AgentPicker m={m} />
    </header>
  );
}
export function ChatTabs({ m }: { m: ChatScreenModel }) {
  const { locale, squadSelected, squad, otherSelected, agentTabs, squadTab, otherTab, tab, setSquadTab, setOtherTab, setTab, agentId } = m;
  return (
    <div
      role="tablist"
      aria-label={TEAM_TABS_TEXT[locale].aria}
      data-testid="team-tabs"
      className="shrink-0 flex gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 sm:px-4"
    >
      {(squadSelected ? squad!.tabs : otherSelected ? agentTabs!.tabs : [{ id: "chat", label: TEAM_TABS_TEXT[locale].chat }, ...agentTabs!.tabs]).map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`team-tab-${item.id}`}
          aria-selected={(squadSelected ? squadTab : otherSelected ? otherTab : tab) === item.id}
          data-testid={`team-tab-${item.id}`}
          onClick={() => {
            if (squadSelected) {
              setSquadTab(item.id);
              return;
            }
            if (otherSelected) {
              setOtherTab(item.id);
              return;
            }
            setTab(item.id);
            agentTabs!.onChange?.(agentId, item.id);
          }}
          className="min-h-10 shrink-0 border-b-2 px-3 text-[14px] font-semibold"
          style={{
            borderColor: (squadSelected ? squadTab : otherSelected ? otherTab : tab) === item.id ? "var(--color-green)" : "transparent",
            color: (squadSelected ? squadTab : otherSelected ? otherTab : tab) === item.id ? "var(--color-bright)" : "var(--color-muted)",
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function ChatTabPanel({ m }: { m: ChatScreenModel }) {
  const { squadSelected, squadTab, otherSelected, otherTab, tab, squad, agentTabs, selected } = m;
  return (
    <div role="tabpanel" aria-labelledby={`team-tab-${squadSelected ? squadTab : otherSelected ? otherTab : tab}`} data-testid="team-tab-panel" className="flex-1 min-h-0 overflow-y-auto">
      {squadSelected
        ? squad!.render(squadTab)
        : otherSelected
          ? agentTabs!.render({ id: otherSelected.session.toLowerCase(), session: otherSelected.session, label: otherSelected.label, up: otherSelected.up }, otherTab)
          : agentTabs!.render({ id: selected.id, session: selected.session, label: selected.label, up: selected.up }, tab)}
    </div>
  );
}
