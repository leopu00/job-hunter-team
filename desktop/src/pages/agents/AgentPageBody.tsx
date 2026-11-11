import type { ReactNode } from "react";
import type { useAgentData } from "./AgentPage";
import { appLocale } from "../../lib/app-locale";
import { describeAgentState } from "@/lib/agent-state";
import Link from "../../web-shims/next-link";
import { conversationTime, previewText } from "../messages/chat-kinds";
import { DICTATION_LOCALE } from "../messages/direct-chat.i18n";
import { AGENT_PAGE_TEXT } from "./AgentPage.i18n";
import { ago, fill, identityLine, identityParts, isUp, Led, readFailureText, stateLine, Terminal, TONE } from "./AgentsPanel";
import AgentStatusBar from "./AgentStatusBar";
import KeyRefusedNotice from "../../components/KeyRefusedNotice";
import { Lanes, SessionHistory } from "./AgentHistory";
import { roleOfSession } from "./history";

type Data = ReturnType<typeof useAgentData>;
type Ready = Data & { row: NonNullable<Data["row"]> };

function AgentHeading({ data, back }: { data: Ready; back: ReactNode }) {
  const { t, row, title, chatId } = data;
  const p = AGENT_PAGE_TEXT[appLocale()];
  const tone = row.agent && isUp(row) ? TONE[describeAgentState(row.agent.state, appLocale()).tone] : "var(--color-dim)";
  return <header className="shrink-0 border-b px-5 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
    <div className="mb-1">{back}</div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><Led row={row} />
          <h1 data-testid="agent-page-title" className="m-0 text-[20px] font-bold" style={{ color: "var(--color-white)" }}>{title}</h1>
          <span className="text-[12px] uppercase tracking-widest text-[var(--color-dim)]">{row.session}</span>
        </div>
        <p data-testid="agent-page-state" className="m-0 mt-1 text-[14px]" style={{ color: tone }}>{stateLine(t, row)}</p>
        {row.agent && isUp(row) && <KeyRefusedNotice state={row.agent.state} />}
      </div>
      <div className="flex flex-col items-end gap-1">
        {chatId !== null ? <Link href={`/messages?agent=${chatId}`} data-testid="agent-page-chat"
          className="rounded border px-3 py-1.5 text-[14px] font-semibold no-underline"
          style={{ color: "var(--color-blue)", borderColor: "var(--color-blue)" }}>{fill(p.writeTo, { name: title })}</Link>
          : <span data-testid="agent-page-no-chat" className="text-[12px] text-[var(--color-muted)]">{fill(p.noChatYet, { name: title })}</span>}
      </div>
    </div>
  </header>;
}

function AgentLastWork({ data }: { data: Ready }) {
  const { t, row, chatId, lastMessage, title, history, now } = data;
  const p = AGENT_PAGE_TEXT[appLocale()];
  return <section aria-label={p.lastWork} className="shrink-0 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
    <h2 className="m-0 mb-1 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">{p.lastWork}</h2>
    {chatId !== null && <div data-testid="agent-page-last-message" className="mb-2">
      {lastMessage ? <>
        <p className="m-0 text-[14px] text-[var(--color-muted)]">{fill(p.lastMessage, {
          who: lastMessage.role === "user" ? p.you : title, time: conversationTime(lastMessage.at, DICTATION_LOCALE[appLocale()]),
        })}</p>
        <p className="m-0 mt-0.5 break-words text-[15px] text-[var(--color-bright)]">{previewText({ ...lastMessage, role: "agent" }, p.you)}</p>
      </> : <p className="m-0 text-[14px] text-[var(--color-muted)]">{p.noMessage}</p>}
    </div>}
    <p data-testid="agent-page-activity" className="m-0 text-[14px] text-[var(--color-bright)]">
      {row.agent?.activity != null ? fill(p.lastActive, { time: ago(row.agent.activity) }) : p.neverActive}
    </p>
    <details className="mt-2"><summary className="cursor-pointer text-[13px] text-[var(--color-muted)]">{p.sessions}</summary>
      <div className="mt-1"><SessionHistory t={t} history={history} session={row.session} nowS={Math.floor(now / 1000)} />
        <div className="mt-3"><Lanes t={t} history={history} roles={[roleOfSession(row.session)]} nowS={Math.floor(now / 1000)} only={row.session} /></div>
      </div>
    </details>
  </section>;
}

function AgentTerminal({ data }: { data: Ready }) {
  const { row, title, t } = data;
  const p = AGENT_PAGE_TEXT[appLocale()];
  return <section data-testid="agent-page-terminal" aria-label={fill(p.terminalTitle, { name: title })}
    className="flex min-h-[12rem] flex-1 flex-col border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
    <h2 className="m-0 mb-1 shrink-0 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">{fill(p.terminalTitle, { name: title })}</h2>
    {isUp(row) ? <>
      <p data-testid="agent-page-watch-only" className="m-0 mb-2 shrink-0 text-[13px] text-[var(--color-muted)]">{fill(p.watchOnly, { name: title })}</p>
      <div className="min-h-0 flex-1 overflow-hidden"><Terminal key={row.session} row={row} t={t} chatName={null} label={fill(p.terminalLog, { name: title })} tall /></div>
    </> : <p className="text-[14px] text-[var(--color-muted)]">{t.screenDown}</p>}
  </section>;
}

export function AgentPageBody({ data, back, requested }: { data: Data; back: ReactNode; requested: string }) {
  const { valid, list, row, title, t, where } = data;
  const p = AGENT_PAGE_TEXT[appLocale()];
  if (!valid || (list?.ok && row === null)) return <p role="alert" data-testid="agent-page-missing"
    className="text-[14px] text-[var(--color-muted)]">{fill(p.notFound, { name: valid ? title : requested })}</p>;
  if (list === null) return <p className="text-[14px] text-[var(--color-muted)]">{p.reading}</p>;
  if (!list.ok || row === null) return <p role="alert" data-testid="agent-page-error"
    className="text-[14px] text-[var(--color-red)]">{readFailureText(list.ok ? "agents_unavailable" : list.code)}</p>;
  const ready = { ...data, row };
  return <>
    <AgentHeading data={ready} back={back} />
    {row.agent && <AgentStatusBar t={t} identity={identityParts(t, row.agent.identity)}
      identityText={identityLine(t, row.agent.identity, where)} usage={isUp(row) ? row.agent.usage : null} />}
    <AgentLastWork data={ready} />
    <AgentTerminal data={ready} />
  </>;
}
