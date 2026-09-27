import { useCallback, useEffect, useRef, useState } from "react";
import { usePendingMessagesLive } from "@/app/hooks/usePendingMessagesLive";
import { postAcks, unreadIdsOf, withAgentAcked } from "@/lib/messages-thread";
import type { PendingMessage } from "@/lib/types";
import AgentBar from "./AgentBar";
import AgentChat from "./AgentChat";
import AgentList from "./AgentList";
import AgentMoves from "./AgentMoves";
import { AGENTS, agentLed, type AgentDef, type AgentsData } from "./load-agents";

/**
 * The agents page, laid out as FLEET's Messaggi (tmux-paradise
 * app/src/views/Messaggi.tsx): the list of the agents on the left, and for
 * the chosen one, at full width, its bar on top and under it the
 * conversation. FLEET keeps the list in its side menu; the desktop has no
 * side menu, so the list is the page's own left column. For the three agents
 * the user chats with the body is the chat; for the others, which have no
 * chat, their latest moves.
 */
export default function AgentsScreen({ data, selected }: { data: AgentsData; selected: AgentDef }) {
  const [messages, setMessages] = useState<PendingMessage[]>(data.messages);
  // A new read (Aggiorna) brings its own history.
  useEffect(() => setMessages(data.messages), [data.messages]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Opening a conversation marks its unread as read, as MessagesList does.
  useEffect(() => {
    if (!selected.chat) return;
    const ids = unreadIdsOf(
      messages.filter((m) => m.author !== "user"),
      selected.role,
    );
    if (ids.length === 0) return;
    setMessages((ms) => withAgentAcked(ms, selected.role, new Date().toISOString()));
    postAcks(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.role, messages.length]);

  // New messages and updates arrive live (Supabase Realtime), merged in place.
  const latest = useRef(messages);
  latest.current = messages;
  usePendingMessagesLive(
    useCallback((row: PendingMessage, event: "INSERT" | "UPDATE") => {
      const cur = latest.current;
      const idx = cur.findIndex((m) => m.id === row.id);
      if (idx < 0 && event === "UPDATE") return;
      if (idx >= 0) {
        const prev = cur[idx];
        const next = [...cur];
        next[idx] = {
          ...row,
          acknowledged_at: row.acknowledged_at ?? prev.acknowledged_at,
          user_reply: row.user_reply ?? prev.user_reply,
          user_reply_at: row.user_reply_at ?? prev.user_reply_at,
        };
        setMessages(next);
      } else {
        setMessages([row, ...cur]);
      }
    }, []),
  );

  const view: AgentsData = { ...data, messages };
  return (
    <div className="flex" style={{ height: "calc(100svh / var(--zoom, 1) - 56px)" }}>
      <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-panel)]">
        <AgentList agents={AGENTS} data={view} selected={selected.role} now={now} />
      </aside>
      <section className="flex-1 min-w-0 min-h-0 flex flex-col" aria-label={`Conversazione con ${selected.name}`}>
        <AgentBar agent={selected} data={view} now={now} />
        {selected.chat ? (
          <AgentChat
            key={selected.role}
            agent={selected}
            led={agentLed(data.team, selected.role, now)}
            messages={messages}
            setMessages={setMessages}
          />
        ) : (
          <AgentMoves agent={selected} moves={data.moves[selected.role] ?? []} now={now} />
        )}
      </section>
    </div>
  );
}
