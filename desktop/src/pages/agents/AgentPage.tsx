import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeAgentState } from "@/lib/agent-state";
import { appLocale } from "../../lib/app-locale";
import { readPanelHistory, readPanelList, readTeamState, type Outcome, type PanelHistory, type PanelList, type TeamControlState } from "../../lib/agent-control";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { onStreamHint, streamPace } from "../../lib/state-stream";
import { useRefresh } from "../../shell/router";
import Link from "../../web-shims/next-link";
import { DIRECT_CHAT_TEXT } from "../messages/direct-chat.i18n";
import { directChatClient } from "../messages/direct-chat-client";
import { previewText, conversationTime } from "../messages/chat-kinds";
import { DICTATION_LOCALE } from "../messages/direct-chat.i18n";
import { lastChatMessage, type LastChatMessage } from "../../lib/chat-last-message";
import type { PageProps } from "../types";
import { AGENT_PAGE_TEXT } from "./AgentPage.i18n";
import { AGENTS_PANEL_TEXT } from "./AgentsPanel.i18n";
import AgentStatusBar from "./AgentStatusBar";
import { Lanes, SessionHistory } from "./AgentHistory";
import { roleOfSession } from "./history";
import {
  ago,
  fill,
  identityLine,
  identityParts,
  isUp,
  Led,
  LIST_REFRESH_LOCAL_MS,
  LIST_REFRESH_STREAMED_MS,
  LIST_REFRESH_VPS_MS,
  panelRows,
  readFailureText,
  stateLine,
  Terminal,
  TONE,
} from "./AgentsPanel";
import { agentTitle, chatIdOfSession, SESSION_NAME } from "./agent-names";

/** Hints of the channel closer than this are one read (a team starting changes its agents one after the other). */
const HINT_GAP_MS = 3_000;

/**
 * The page of one agent (/agents/:name, the name is its tmux session: ANALISTA-2): who it is, what it does and
 * has done, what it costs, and its terminal on the whole page, to be read and never typed in. Writing to the agent
 * is the chat's: the button leads there. The reads are the Agents panel's own (list, team, history), on the same
 * pace, so a team on a VPS is not asked more often than there.
 */
export default function AgentPage({ params }: PageProps) {
  const t = AGENTS_PANEL_TEXT[appLocale()];
  const p = AGENT_PAGE_TEXT[appLocale()];
  const readOnly = useExistingTeamReadOnly() !== null;
  const session = (params.name ?? "").toUpperCase();
  const valid = SESSION_NAME.test(session);
  const [list, setList] = useState<Outcome<PanelList> | null>(null);
  const [team, setTeam] = useState<TeamControlState | null>(null);
  const [history, setHistory] = useState<Outcome<PanelHistory> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);

  const read = useCallback(async () => {
    const mine = ++latest.current;
    const [listed, state, past] = await Promise.all([readPanelList(), readTeamState(), readPanelHistory()]);
    if (latest.current !== mine) return;
    setList(listed);
    setTeam(state.ok ? state.value : null);
    setHistory(past);
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (!valid) return;
    void read();
    return () => {
      latest.current++;
    };
  }, [read, valid]);
  useRefresh(() => void read());
  useEffect(() => (valid ? onStreamHint("agents", () => void read(), HINT_GAP_MS) : undefined), [read, valid]);
  const everyMs = list?.ok && list.value.where !== "vps" ? LIST_REFRESH_LOCAL_MS : LIST_REFRESH_VPS_MS;
  useEffect(() => {
    if (!valid) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void read();
      timer = setTimeout(tick, streamPace(everyMs, LIST_REFRESH_STREAMED_MS));
    };
    timer = setTimeout(tick, streamPace(everyMs, LIST_REFRESH_STREAMED_MS));
    return () => clearTimeout(timer);
  }, [read, everyMs, valid]);

  // The last thing said in the chat with this agent: what this run of the app already read of it, and one read of
  // its own when the chat's connection is up (never one that opens a connection: this page only looks).
  const chatId = chatIdOfSession(session);
  const [lastMessage, setLastMessage] = useState<LastChatMessage | null>(() => (chatId ? lastChatMessage(chatId) : null));
  useEffect(() => {
    if (!valid || !chatId) {
      setLastMessage(null);
      return;
    }
    setLastMessage(lastChatMessage(chatId));
    let live = true;
    void (async () => {
      try {
        if ((await directChatClient.status()).state !== "ready") return;
        await directChatClient.read({ agentId: chatId });
        if (live) setLastMessage(lastChatMessage(chatId));
      } catch {
        // the chat is not reachable now: what was read before stays
      }
    })();
    return () => {
      live = false;
    };
  }, [chatId, valid]);

  const rows = useMemo(() => (list?.ok ? panelRows(list.value, team) : []), [list, team]);
  const row = rows.find((r) => r.session === session) ?? null;
  const title = agentTitle(session, DIRECT_CHAT_TEXT[appLocale()].agents);
  const where = list?.ok ? (list.value.where === "vps" ? fill(t.whereVps, { label: list.value.label ?? "" }) : t.whereLocal) : "";

  const back = (
    <Link href={`/agents?agent=${encodeURIComponent(session)}`} data-testid="agent-page-back" className="text-[13px] no-underline" style={{ color: "var(--color-blue)" }}>
      ← {p.back}
    </Link>
  );

  let body;
  if (!valid || (list?.ok && row === null)) {
    body = (
      <p role="alert" data-testid="agent-page-missing" className="text-[14px] text-[var(--color-muted)]">
        {fill(p.notFound, { name: valid ? title : (params.name ?? "") })}
      </p>
    );
  } else if (list === null) {
    body = <p className="text-[14px] text-[var(--color-muted)]">{p.reading}</p>;
  } else if (!list.ok || row === null) {
    body = (
      <p role="alert" data-testid="agent-page-error" className="text-[14px] text-[var(--color-red)]">
        {readFailureText(list.ok ? "agents_unavailable" : list.code)}
      </p>
    );
  } else {
    const up = isUp(row);
    const tone = row.agent && up ? TONE[describeAgentState(row.agent.state, appLocale()).tone] : "var(--color-dim)";
    body = (
      <>
        <header className="shrink-0 border-b px-5 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
          <div className="mb-1">{back}</div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Led row={row} />
                <h1 data-testid="agent-page-title" className="m-0 text-[20px] font-bold" style={{ color: "var(--color-white)" }}>
                  {title}
                </h1>
                <span className="text-[12px] uppercase tracking-widest text-[var(--color-dim)]">{row.session}</span>
              </div>
              <p data-testid="agent-page-state" className="m-0 mt-1 text-[14px]" style={{ color: tone }}>
                {stateLine(t, row)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {chatId !== null ? (
                <Link
                  href={`/messages?agent=${chatId}`}
                  data-testid="agent-page-chat"
                  className="rounded border px-3 py-1.5 text-[14px] font-semibold no-underline"
                  style={{ color: "var(--color-blue)", borderColor: "var(--color-blue)" }}
                >
                  {fill(p.writeTo, { name: title })}
                </Link>
              ) : (
                <span data-testid="agent-page-no-chat" className="text-[12px] text-[var(--color-muted)]">
                  {fill(p.noChatYet, { name: title })}
                </span>
              )}
            </div>
          </div>
        </header>

        {row.agent && (
          <AgentStatusBar t={t} identity={identityParts(t, row.agent.identity)} identityText={identityLine(t, row.agent.identity, where)} usage={up ? row.agent.usage : null} />
        )}

        <section aria-label={p.lastWork} className="shrink-0 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="m-0 mb-1 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">{p.lastWork}</h2>
          {chatId !== null && (
            <div data-testid="agent-page-last-message" className="mb-2">
              {lastMessage ? (
                <>
                  <p className="m-0 text-[14px] text-[var(--color-muted)]">
                    {fill(p.lastMessage, {
                      who: lastMessage.role === "user" ? p.you : title,
                      time: conversationTime(lastMessage.at, DICTATION_LOCALE[appLocale()]),
                    })}
                  </p>
                  <p className="m-0 mt-0.5 break-words text-[15px] text-[var(--color-bright)]">{previewText({ ...lastMessage, role: "agent" }, p.you)}</p>
                </>
              ) : (
                <p className="m-0 text-[14px] text-[var(--color-muted)]">{p.noMessage}</p>
              )}
            </div>
          )}
          <p data-testid="agent-page-activity" className="m-0 text-[14px] text-[var(--color-bright)]">
            {row.agent?.activity != null ? fill(p.lastActive, { time: ago(row.agent.activity) }) : p.neverActive}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] text-[var(--color-muted)]">{p.sessions}</summary>
            <div className="mt-1">
              <SessionHistory t={t} history={history} session={row.session} nowS={Math.floor(now / 1000)} />
              <div className="mt-3">
                <Lanes t={t} history={history} roles={[roleOfSession(row.session)]} nowS={Math.floor(now / 1000)} only={row.session} />
              </div>
            </div>
          </details>
        </section>

        <section
          data-testid="agent-page-terminal"
          aria-label={fill(p.terminalTitle, { name: title })}
          className="flex min-h-[12rem] flex-1 flex-col border-t px-5 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2 className="m-0 mb-1 shrink-0 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">{fill(p.terminalTitle, { name: title })}</h2>
          {up ? (
            <>
              <p data-testid="agent-page-watch-only" className="m-0 mb-2 shrink-0 text-[13px] text-[var(--color-muted)]">
                {fill(p.watchOnly, { name: title })}
              </p>
              <div className="min-h-0 flex-1 overflow-hidden">
                <Terminal key={row.session} row={row} t={t} chatName={null} label={fill(p.terminalLog, { name: title })} tall />
              </div>
            </>
          ) : (
            <p className="text-[14px] text-[var(--color-muted)]">{t.screenDown}</p>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agent-page">
      {!valid || (list?.ok && row === null) || list === null || !list.ok ? <div className="px-5 py-4">{back}{body}</div> : body}
    </div>
  );
}
