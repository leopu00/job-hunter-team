import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeAgentState } from "@/lib/agent-state";
import { appLocale } from "../../lib/app-locale";
import { usePageAgents } from "../../lib/page-agent-data";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { streamPace } from "../../lib/state-stream";
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
import { AgentPageBody } from "./AgentPageBody";
import { PageDataNotice } from "../../lib/PageDataNotice";

/** What the page of an agent (and its tabs on the Team page) reads: the Agents panel's own reads, on the same pace. */
export function useAgentData(session: string) {
  const t = AGENTS_PANEL_TEXT[appLocale()];
  const readOnly = useExistingTeamReadOnly() !== null;
  const valid = SESSION_NAME.test(session);
  const cached = usePageAgents(valid);
  const { list, team, history, now, refresh: read } = cached;
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
  return { t, valid, list, team, history, now, chatId, lastMessage, rows, row, title, where, readOnly, cacheAt: cached.at, cacheError: cached.error };
}

/**
 * The page of one agent (/agents/:name, the name is its tmux session: ANALISTA-2): who it is, what it does and
 * has done, what it costs, and its terminal on the whole page, to be read and never typed in. Writing to the agent
 * is the chat's: the button leads there. The reads are the Agents panel's own (list, team, history), on the same
 * pace, so a team on a VPS is not asked more often than there.
 */
export default function AgentPage({ params }: PageProps) {
  const p = AGENT_PAGE_TEXT[appLocale()];
  const data = useAgentData((params.name ?? "").toUpperCase());
  const back = <Link href={"/agents?agent=" + encodeURIComponent((params.name ?? "").toUpperCase())} data-testid="agent-page-back" className="text-[13px] no-underline" style={{ color: "var(--color-blue)" }}>← {p.back}</Link>;
  const missing = !data.valid || data.list === null || !data.list.ok || data.row === null;
  const body = <AgentPageBody data={data} back={back} requested={params.name ?? ""} />;
  return <div className="flex h-full min-h-0 flex-col" data-testid="agent-page">
    <PageDataNotice at={data.cacheAt} error={data.cacheError} />
    {missing ? <div className="px-5 py-4">{back}{body}</div> : body}
  </div>;
}

/**
 * The Info tab of an agent on the Team page: who it is, what it costs, the last thing said and done, its sessions.
 * The same sections as the page of the agent (which stays as it was); the title and the state are the Team page's.
 */
export function AgentInfoTab({ session }: { session: string }) {
  const p = AGENT_PAGE_TEXT[appLocale()];
  const { t, valid, list, history, now, chatId, lastMessage, row, title, where, cacheAt, cacheError } = useAgentData(session);
  if (!valid || (list?.ok && row === null)) {
    return (
      <p role="alert" data-testid="agent-info-missing" className="m-0 px-5 py-4 text-[14px] text-[var(--color-muted)]">
        {fill(p.notFound, { name: valid ? title : session })}
      </p>
    );
  }
  if (list === null) return <p className="m-0 px-5 py-4 text-[14px] text-[var(--color-muted)]">{p.reading}</p>;
  if (!list.ok || row === null) {
    return (
      <p role="alert" data-testid="agent-info-error" className="m-0 px-5 py-4 text-[14px] text-[var(--color-red)]">
        {readFailureText(list.ok ? "agents_unavailable" : list.code)}
      </p>
    );
  }
  const up = isUp(row);
  return (
    <div data-testid="agent-info-tab">
      <PageDataNotice at={cacheAt} error={cacheError} />
      {row.agent && (
        <AgentStatusBar t={t} identity={identityParts(t, row.agent.identity)} identityText={identityLine(t, row.agent.identity, where)} usage={up ? row.agent.usage : null} />
      )}
      <section aria-label={p.lastWork} className="px-5 py-3">
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
        <div className="mt-2">
          <SessionHistory t={t} history={history} session={row.session} nowS={Math.floor(now / 1000)} />
          <div className="mt-3">
            <Lanes t={t} history={history} roles={[roleOfSession(row.session)]} nowS={Math.floor(now / 1000)} only={row.session} />
          </div>
        </div>
      </section>
    </div>
  );
}

/** The Terminal tab of an agent on the Team page: its screen, to be read and never typed in; an agent that is off has none. */
export function AgentTerminalTab({ session }: { session: string }) {
  const p = AGENT_PAGE_TEXT[appLocale()];
  const { t, valid, list, row, title, cacheAt, cacheError } = useAgentData(session);
  if (!valid || list === null || !list.ok || row === null) {
    return <p className="m-0 px-5 py-4 text-[14px] text-[var(--color-muted)]">{list === null ? p.reading : fill(p.notFound, { name: title })}</p>;
  }
  const up = isUp(row);
  return (
    <section data-testid="agent-terminal-tab" aria-label={fill(p.terminalTitle, { name: title })} className="flex h-full min-h-[12rem] flex-col px-5 py-3">
      <PageDataNotice at={cacheAt} error={cacheError} />
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
        <p className="m-0 text-[14px] text-[var(--color-muted)]">{fill(p.terminalOff, { name: title })}</p>
      )}
    </section>
  );
}
