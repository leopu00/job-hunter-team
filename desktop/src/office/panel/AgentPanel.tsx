import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { describeAgentState } from "@/lib/agent-state";
import { formatRelative } from "@/lib/message-display";
import { useLocale } from "@/lib/use-locale";
import { appLocale } from "../../lib/app-locale";
import { controlAgent, readPanelList, readTeamState, type Outcome, type PanelList, type TeamControlState } from "../../lib/agent-control";
import { lastChatMessage } from "../../lib/chat-last-message";
import { AGENTS_PANEL_TEXT } from "../../pages/agents/AgentsPanel.i18n";
import { Confirm, displayName, failureText, identityLine, resultText, Terminal, type Pending } from "../../pages/agents/AgentsPanel";
import { UsageShort } from "../../pages/agents/AgentUsage";
import { isDirectChatAgentId, type DirectChatAgentId } from "../../pages/messages/DirectChatScreen";
import { DIRECT_CHAT_TEXT } from "../../pages/messages/direct-chat.i18n";
import type { AgentStatuses, OfficeClick } from "../contract";
import { fill, ofCount, officeText } from "../office.i18n";
import { tagOf } from "../status";
import { agentView, type AgentGesture } from "./agent-view";
import { Heading, hex, Section, SecondaryLink } from "./panel-parts";

/**
 * An agent's panel in the office: what it is doing now, what it last did where the team publishes it, the
 * questions it asked, the last thing said to it, and the three things one can do: write to it (the Messages
 * page, with the agent chosen), turn it off or on (the Agents page's own action and confirmation) and read its
 * terminal (read only, only while it is open). Every value is one the Agents page and the chat already read:
 * the list of agents and the team's held sessions once when the panel opens, the terminal while it is shown.
 * Where the cloud keeps the agent's positions and moves, the page gives them as `children`; on this computer and
 * on a VPS the team does not publish them and the panel says so.
 */
export type AgentPanelProps = {
  target: Extract<OfficeClick, { kind: "agent" }>;
  subtitle: string;
  statuses: AgentStatuses | null;
  /** the existing team's read-only view: nothing may be done to an agent */
  readOnly: boolean;
  /** the agent's positions and moves, when the cloud has them: otherwise the panel says the team does not publish them */
  children?: ReactNode;
  onNavigate: (path: string) => void;
  /** after an agent was turned off or on: the office reads the team again */
  onActed?: () => void;
};

type Control = { list: Outcome<PanelList>; team: Outcome<TeamControlState> };

export default function AgentPanel({ target, subtitle, statuses, readOnly, children, onNavigate, onActed }: AgentPanelProps) {
  const locale = useLocale();
  const t = officeText(locale);
  const at = AGENTS_PANEL_TEXT[locale];
  const [control, setControl] = useState<Control | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // the Agents page's own reads, once when the panel opens and again after an action
  const read = useCallback(async () => {
    const [list, team] = await Promise.all([readPanelList(), readTeamState()]);
    if (alive.current) setControl({ list, team });
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  const list = control?.list.ok ? control.list.value : null;
  const team = control?.team.ok ? control.team.value : null;
  const view = agentView({ uid: target.uid, role: target.role, list, team, readOnly });
  const { row } = view;
  const name = displayName(view.session);
  const status = statuses?.agents[target.uid.toLowerCase()];
  const tag = status ? tagOf(status, Date.now(), locale) : null;
  const chatId: DirectChatAgentId | null = isDirectChatAgentId(target.role) ? target.role : null;
  const last = chatId ? lastChatMessage(chatId) : null;
  const where = list ? (list.where === "vps" ? fill(at.whereVps, { label: list.label ?? "" }) : at.whereLocal) : "";
  const questions = row.agent?.questions ?? null;

  const act = async () => {
    if (!pending || pending.kind !== "agent" || !list) return;
    setActing(true);
    const done = await controlAgent(pending.op, pending.row.session, list.target);
    if (!alive.current) return;
    setNotice(done.ok ? { ok: true, text: resultText(at, done.value, name) } : { ok: false, text: failureText(done.code) });
    setActing(false);
    setPending(null);
    await read();
    if (alive.current) onActed?.();
  };

  return (
    <>
      <Heading title={name.toUpperCase()} sub={subtitle} />
      {(view.held !== null || (view.listed && !view.up)) && (
        <p
          data-testid="office-agent-held"
          className="m-0 mb-3 rounded border px-2 py-1 text-[11px] font-semibold"
          style={{ color: "var(--color-yellow)", borderColor: "var(--color-yellow)" }}
        >
          {view.held === "user" ? t.heldByYou : view.held === "safety" ? t.heldBySafety : t.notRunning}
        </p>
      )}

      <Section title={t.sectionNow}>
        {tag ? (
          <span className="rounded border px-2 py-0.5 text-[11px] font-bold tracking-widest" style={{ color: hex(tag.color), borderColor: hex(tag.color) }}>
            {tag.label}
          </span>
        ) : !row.agent ? (
          <span className="text-[11px] text-[var(--color-muted)]">{t.statusNotPublished}</span>
        ) : null}
        {row.agent && view.up && (
          <div data-testid="office-agent-state" className="mt-1.5 text-[11px] text-[var(--color-muted)]">
            <p className="m-0">{describeAgentState(row.agent.state, appLocale()).line}</p>
            <p className="m-0 mt-0.5">{identityLine(at, row.agent.identity, "")}</p>
            <div className="mt-0.5">
              <UsageShort t={at} usage={row.agent.usage} />
            </div>
          </div>
        )}
      </Section>

      {children ?? <p data-testid="office-agent-not-published" className="m-0 mb-4 text-[11px] text-[var(--color-muted)]">{t.notPublishedHere}</p>}

      {questions && (
        <Section title={t.sectionQuestions}>
          <p className="m-0 text-[11px]">{questions.open > 0 ? ofCount(locale, questions.open, t.questionsOpen) : t.questionsNone}</p>
        </Section>
      )}

      {chatId && (
        <Section title={t.sectionLastMessage}>
          {last ? (
            <p data-testid="office-agent-last-message" className="m-0 break-words text-[11px]">
              <span className="text-[var(--color-dim)]">
                {last.role === "user" ? t.lastFromYou : DIRECT_CHAT_TEXT[locale].agents[chatId]} · {formatRelative(new Date(last.at * 1000).toISOString(), locale)}
              </span>
              <br />
              {last.text}
            </p>
          ) : (
            <p className="m-0 text-[11px] text-[var(--color-muted)]">{t.lastNone}</p>
          )}
        </Section>
      )}

      <div role="group" aria-label={fill(t.agentActionsAria, { name })} className="mb-3 flex flex-wrap items-center gap-2">
        {chatId && (
          <button
            type="button"
            data-testid="office-agent-write"
            onClick={() => onNavigate(`/messages?agent=${encodeURIComponent(chatId)}`)}
            className="rounded border px-3 py-1 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-bright)]"
            style={{ color: "var(--color-blue)", borderColor: "var(--color-blue)" }}
          >
            {fill(t.writeTo, { name })}
          </button>
        )}
        {view.gestures.map((op) => (
          <GestureButton key={op} op={op} label={op === "stop" ? at.stop : at.start} name={name} onClick={() => setPending({ kind: "agent", op, row })} />
        ))}
      </div>
      <div role="status" aria-live="polite" data-testid="office-agent-notice" className="mb-3 text-[11px]" style={{ color: "var(--color-green)" }}>
        {notice?.ok ? notice.text : null}
      </div>
      {notice && !notice.ok && (
        <p role="alert" data-testid="office-agent-notice-error" className="m-0 mb-3 text-[11px]" style={{ color: "var(--color-red)" }}>
          {notice.text}
        </p>
      )}
      {control && !control.list.ok && (
        <p role={readOnly ? undefined : "alert"} data-testid="office-agent-unavailable" className="m-0 mb-3 text-[11px] text-[var(--color-muted)]">
          {children !== undefined ? t.detailsUnavailable : failureText(control.list.code)}
        </p>
      )}

      {view.listed && view.up && (
        <section className="mb-3" aria-label={t.terminalToggle}>
          <button
            type="button"
            data-testid="office-agent-terminal-toggle"
            aria-expanded={terminalOpen}
            aria-controls="office-agent-terminal"
            onClick={() => setTerminalOpen((open) => !open)}
            className="mb-1.5 rounded text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)] hover:text-[var(--color-bright)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-bright)]"
          >
            {terminalOpen ? "▾" : "▸"} {t.terminalToggle}
          </button>
          <div id="office-agent-terminal">
            {terminalOpen && (
              <Terminal
                key={view.session}
                row={row}
                t={at}
                chatName={chatId ? DIRECT_CHAT_TEXT[locale].agents[chatId] : null}
                label={fill(t.terminalLogAria, { name })}
              />
            )}
          </div>
        </section>
      )}

      <SecondaryLink label={t.openAgentPage} onClick={() => onNavigate(`/agents/${encodeURIComponent(view.session)}`)} />

      {pending && list && (
        <ConfirmLayer onCancel={() => !acting && setPending(null)}>
          <Confirm t={at} pending={pending} where={where} busy={acting} onCancel={() => setPending(null)} onConfirm={() => void act()} />
        </ConfirmLayer>
      )}
    </>
  );
}

function GestureButton({ op, label, name, onClick }: { op: AgentGesture; label: string; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={`office-agent-${op}`}
      aria-label={`${label} ${name}`}
      onClick={onClick}
      className="rounded border px-3 py-1 text-[11px] font-semibold uppercase tracking-widest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-bright)]"
      style={op === "stop" ? { color: "var(--color-red)", borderColor: "var(--color-red)" } : { color: "var(--color-green)", borderColor: "var(--color-green)" }}
    >
      {label}
    </button>
  );
}

/**
 * The confirmation is a modal over the office: the keyboard lands in it, Tab stays inside it, Esc closes IT (and
 * not the panel under it), and the focus goes back to where it was.
 */
function ConfirmLayer({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    self.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    return () => before?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(self.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const lastItem = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && document.activeElement === lastItem) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div ref={self} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
