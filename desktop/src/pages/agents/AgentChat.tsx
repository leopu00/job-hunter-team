import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import ChatDeliveryMark from "@/app/components/ChatDeliveryMark";
import MessageBody from "@/app/components/MessageBody";
import { useBoxClient } from "@/app/hooks/useBoxClient";
import { useChatLaneLive } from "@/app/hooks/useChatLaneLive";
import { chatComposerBlocked } from "@/lib/box-client";
import { chatTurnDelivery } from "@/lib/chat-delivery";
import { CHAT_DELIVERY_T } from "@/lib/chat-delivery.i18n";
import { MAX_CHAT_BODY } from "@/lib/chat-agents";
import { makeT } from "@/lib/i18n-dict";
import { formatRelative, kindLabel, KIND_BORDER } from "@/lib/message-display";
import {
  optimisticUserTurn,
  postChat,
  retryChatSignal,
  THREAD_T,
  withConfirmedTurn,
  withoutTurn,
} from "@/lib/messages-thread";
import { serverNow } from "@/lib/server-clock";
import type { PendingMessage } from "@/lib/types";
import { useLocale } from "@/lib/use-locale";
import Link from "../../web-shims/next-link";
import { AgentIcon } from "./AgentList";
import { threadOf, type AgentDef, type Led } from "./load-agents";

/**
 * The conversation with one of the chat agents, under its bar: the same
 * turns, bubbles, delivery marks and composer as the web's Messaggi page
 * (web/app/components/MessagesList.tsx), built from the same pieces
 * (web/lib/messages-thread.ts, chat-delivery, MessageBody). Sending goes
 * through /api/pending-messages, the web route the desktop already runs
 * (pages/messages/messages-api.ts). The list of messages is the screen's:
 * the agent list reads the same one for previews and unread counts.
 */
export default function AgentChat({
  agent,
  led,
  messages,
  setMessages,
}: {
  agent: AgentDef;
  led: Led;
  messages: PendingMessage[];
  setMessages: Dispatch<SetStateAction<PendingMessage[]>>;
}) {
  const locale = useLocale();
  const tr = (k: string) => THREAD_T[k]?.[locale] ?? THREAD_T[k]?.en ?? k;
  const td = makeT(CHAT_DELIVERY_T, locale);
  const thread = threadOf(messages, agent.role);
  const { lane } = useChatLaneLive();
  const box = useBoxClient();
  const blocked = chatComposerBlocked(box);
  const blockedNotice = box?.client_version
    ? td("blocked_no_chat").replace("{version}", box.client_version)
    : td("blocked_no_chat_unknown_version");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // The delivery marks compare server timestamps: a clock that ticks while a
  // turn waits, as in MessagesList.
  const waiting = thread.some((m) => m.author === "user" && !m.delivered_at && !m.id.startsWith("pending:"));
  useEffect(() => {
    setClock(serverNow());
    if (!waiting) return;
    const id = window.setInterval(() => setClock(serverNow()), 30_000);
    return () => window.clearInterval(id);
  }, [waiting]);

  // The newest message in view, when the conversation opens and when one arrives.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.role, thread.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    const optimistic = optimisticUserTurn(agent.role, body);
    setSending(true);
    setError(null);
    setText("");
    setMessages((ms) => [optimistic, ...ms]);
    try {
      const result = await postChat(agent.role, body);
      setMessages((ms) => withConfirmedTurn(ms, optimistic.id, result.message));
      if (!result.signalled && !(await retryChatSignal())) setError(tr("delivery_signal_failed"));
    } catch (e) {
      setMessages((ms) => withoutTurn(ms, optimistic.id));
      setText(body);
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-4">
          {thread.length === 0 && (
            <p className="text-[12px] text-[var(--color-muted)] text-center py-12 m-0">
              Nessun messaggio con {agent.name}, per ora.
            </p>
          )}
          {thread.map((m) =>
            m.author === "user" ? (
              <UserBubble key={m.id} text={m.body} at={m.created_at} pending={m.id.startsWith("pending:")} you={tr("you")} locale={locale}>
                <ChatDeliveryMark state={chatTurnDelivery(m, lane, clock)} locale={locale} />
              </UserBubble>
            ) : (
              <div key={m.id} className="flex flex-col gap-2">
                <div className="flex items-end gap-2 max-w-[85%] self-start">
                  <AgentIcon agent={agent} led={led} size={22} />
                  <div
                    className="rounded-lg rounded-bl-sm px-4 py-3 border-l-2 min-w-0"
                    style={{ background: "var(--color-card)", borderLeftColor: KIND_BORDER[m.kind] }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {m.kind !== "notification" && (
                        <span
                          className="text-[7.5px] font-semibold tracking-[0.14em] uppercase px-1 py-px rounded"
                          style={{ color: KIND_BORDER[m.kind], border: `1px solid ${KIND_BORDER[m.kind]}` }}
                        >
                          {kindLabel(m.kind, locale)}
                        </span>
                      )}
                      <span className="text-[9px] text-[var(--color-dim)]">{formatRelative(m.created_at, locale)}</span>
                    </div>
                    <MessageBody text={m.body} className="m-0 text-[12.5px] leading-relaxed text-[var(--color-base)]" />
                    {m.related_position_id && (
                      <Link
                        href={`/positions/${m.related_position_id}`}
                        className="inline-block mt-1.5 text-[10px] text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline"
                      >
                        {tr("see_position")}
                      </Link>
                    )}
                  </div>
                </div>
                {m.user_reply && (
                  <UserBubble text={m.user_reply} at={m.user_reply_at} you={tr("you")} locale={locale} />
                )}
              </div>
            ),
          )}
        </div>
      </div>

      <div className="shrink-0 px-5 pt-2 pb-5">
        <div className="max-w-2xl mx-auto">
          {(error || blocked) && (
            <div
              role={error ? "alert" : "status"}
              className="mb-2 px-3 py-1.5 rounded border text-[10px]"
              style={{
                borderColor: error ? "var(--color-red)" : "var(--color-yellow)",
                color: error ? "var(--color-red)" : "var(--color-yellow)",
              }}
            >
              {error ?? blockedNotice}
            </div>
          )}
          <div
            className="flex items-end gap-2 rounded-2xl border px-3 py-2 focus-within:border-[var(--color-border-glow)]"
            style={{ background: "var(--color-card)", borderColor: "var(--color-border)" }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={MAX_CHAT_BODY}
              disabled={sending || blocked}
              aria-label={tr("write_to").replace("{name}", agent.name)}
              placeholder={blocked ? blockedNotice : tr("write_to").replace("{name}", agent.name)}
              className="flex-1 px-2 py-1.5 text-[12.5px] bg-transparent border-none resize-none text-[var(--color-base)] disabled:opacity-50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || blocked || text.trim().length === 0}
              aria-label={tr("send")}
              className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-default"
              style={{ background: "var(--color-green)", color: "var(--color-void)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserBubble({
  text,
  at,
  pending = false,
  you,
  locale,
  children,
}: {
  text: string;
  at: string | null;
  pending?: boolean;
  you: string;
  locale: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="max-w-[85%] self-end rounded-lg rounded-br-sm px-4 py-3"
      style={{
        background: "color-mix(in srgb, var(--color-green) 10%, var(--color-card))",
        border: "1px solid color-mix(in srgb, var(--color-green) 30%, transparent)",
        opacity: pending ? 0.65 : 1,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5 justify-end">
        <span className="text-[9px] font-semibold text-[var(--color-green)]">{you}</span>
        {at && <span className="text-[9px] text-[var(--color-dim)]">{formatRelative(at, locale)}</span>}
        {children}
      </div>
      <MessageBody text={text} className="m-0 text-[12.5px] leading-relaxed text-[var(--color-base)]" />
    </div>
  );
}
