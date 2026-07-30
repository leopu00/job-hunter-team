"use client";

// [JHT-MESSAGES-DRAWER] Messenger compatto in navbar: icona con badge non
// letti che apre un pannello laterale destro sopra qualsiasi pagina. Vista
// "conversazioni" (un pallino per agente: Mentor, Capitano, Assistente…) e
// vista chat del singolo agente con risposta rapida. La panoramica completa
// resta in /messages; qui vive la lettura veloce.
// Niente polling (i poller scalano i costi Vercel): fetch al mount, alla
// riapertura del drawer e quando il tab torna visibile + eventi LIVE via
// Supabase Realtime (websocket diretto, zero Vercel) per i nuovi messaggi.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import {
  agentInfo,
  formatRelative,
  kindLabel,
  normalizeBody,
  KIND_BORDER,
} from "@/lib/message-display";
import MessageBody, { stripInlineMarkdown } from "@/app/components/MessageBody";
import { usePendingMessagesLive } from "@/app/hooks/usePendingMessagesLive";
import {
  optimisticUserTurn,
  postAcks,
  postChat,
  unreadIdsOf,
  withAgentAcked,
  withConfirmedTurn,
  withoutTurn,
} from "@/lib/messages-thread";
import { MAX_CHAT_BODY, isChatAgent } from "@/lib/chat-agents";
import AgentAvatar from "@/app/components/AgentAvatar";
import { useFocusTrap } from "@/app/components/AccessibilityProvider";
import type { PendingMessage } from "@/lib/types";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./MessagesDrawer.i18n";

type Conversation = {
  agent: string;
  messages: PendingMessage[]; // ordinati dal più vecchio al più recente
  unread: number;
  latest: PendingMessage;
};

// Ordina le conversazioni per ultimo messaggio; i tre core hanno comunque
// una posizione stabile a parità (mentor prima, poi capitano, assistente).
const AGENT_RANK: Record<string, number> = {
  mentor: 0,
  capitano: 1,
  assistente: 2,
};

function buildConversations(messages: PendingMessage[]): Conversation[] {
  const byAgent = new Map<string, PendingMessage[]>();
  for (const m of messages) {
    const list = byAgent.get(m.agent) ?? [];
    list.push(m);
    byAgent.set(m.agent, list);
  }
  const convs: Conversation[] = [];
  for (const [agent, list] of byAgent) {
    // L'API restituisce created_at desc → inverto per la vista chat.
    const asc = [...list].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    convs.push({
      agent,
      messages: asc,
      unread: asc.filter((m) => !m.acknowledged_at).length,
      latest: asc[asc.length - 1],
    });
  }
  convs.sort(
    (a, b) =>
      b.latest.created_at.localeCompare(a.latest.created_at) ||
      (AGENT_RANK[a.agent] ?? 9) - (AGENT_RANK[b.agent] ?? 9),
  );
  return convs;
}

// Pallino-avatar dell'agente. [JHT-CHAT-UNIFY] Non piu' l'emoji del ruolo
// ma il ritratto in stile fumetto ritagliato sul volto — lo stesso volto
// della pagina /agents. L'anello col colore del ruolo resta.
function AgentDot({
  agent,
  locale,
  size = 34,
}: {
  agent: string;
  locale: string;
  size?: number;
}) {
  return <AgentAvatar agent={agent} locale={locale} size={size} ring />;
}

export default function MessagesDrawer() {
  const locale = useLocale();
  const tr = makeT(T, locale);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // Il drawer blocca lo scroll del body e copre la pagina con un backdrop:
  // e' modale di fatto, quindi il Tab non deve uscirne finche' e' aperto.
  useFocusTrap(drawerRef, open);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/pending-messages");
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages: PendingMessage[];
        unread: number;
      };
      setMessages(data.messages ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // Silenzioso: il badge resta com'era, niente da mostrare in navbar.
    }
  }, []);

  // Fetch al mount + quando il tab torna visibile (niente interval).
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // Mirror dello stato per il merge live (le callback Realtime non vedono
  // lo state corrente; gli updater devono restare puri).
  const messagesRef = useRef<PendingMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // [JHT-MSG-REALTIME] Merge degli eventi live nel drawer: nuovi messaggi
  // compaiono (e il badge sale) senza refetch né reload. Le UPDATE non
  // regrediscono mai lo stato ottimistico locale (ack/reply appena fatti).
  usePendingMessagesLive(
    useCallback((row, event) => {
      // [JHT-CHAT-UNIFY] Niente filtro su `delivered_via`: quella colonna
      // dice su quale canale e' stata spinta la notifica, non se il turno
      // fa parte della conversazione. Filtrarla nascondeva sul web tutte le
      // risposte anche inoltrate su Telegram.
      const cur = messagesRef.current;
      const idx = cur.findIndex((m) => m.id === row.id);
      if (idx < 0 && event === "UPDATE") return; // riga fuori finestra: ignora
      const wasUnread = idx >= 0 ? !cur[idx].acknowledged_at : false;
      let merged: PendingMessage;
      if (idx >= 0) {
        const prev = cur[idx];
        merged = {
          ...row,
          acknowledged_at: row.acknowledged_at ?? prev.acknowledged_at,
          user_reply: row.user_reply ?? prev.user_reply,
          user_reply_at: row.user_reply_at ?? prev.user_reply_at,
        };
        const next = [...cur];
        next[idx] = merged;
        setMessages(next);
      } else {
        merged = row;
        setMessages([row, ...cur]);
      }
      const isUnread = !merged.acknowledged_at;
      const delta = (isUnread ? 1 : 0) - (wasUnread ? 1 : 0);
      if (delta !== 0) setUnread((u) => Math.max(0, u + delta));
    }, []),
  );

  // ESC chiude (prima la chat, poi il drawer); body scroll lock da aperto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")
        setActiveAgent((cur) => {
          if (cur != null) return null;
          setOpen(false);
          return cur;
        });
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const conversations = buildConversations(messages);
  const active = conversations.find((c) => c.agent === activeAgent) ?? null;

  // Aprire una chat marca come letti i suoi non letti (stile messenger).
  const openChat = (agent: string) => {
    setActiveAgent(agent);
    setError(null);
    const ids = unreadIdsOf(messages, agent);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setMessages((ms) => withAgentAcked(ms, agent, now));
    setUnread((u) => Math.max(0, u - ids.length));
    postAcks(ids);
  };

  // Scroll in fondo alla chat quando si apre o arrivano righe nuove.
  useEffect(() => {
    if (active) chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeAgent, messages.length, active]);

  // [JHT-CHAT-UNIFY] Si scrive, non si "risponde": il composer non dipende
  // piu' dall'esistenza di un messaggio dell'agente senza risposta. Resta
  // spento solo per un mittente fuori dalle tre chat (un agente che notifica
  // e con cui, dal web, non si conversa: la sua chat vive nel videogioco).
  const canWrite = !!active && isChatAgent(active.agent);

  async function handleSend() {
    if (!active || !canWrite || sending) return;
    const text = replyText.trim();
    if (!text) return;
    const agent = active.agent;
    const optimistic = optimisticUserTurn(agent, text);
    setSending(true);
    setError(null);
    setReplyText("");
    setMessages((ms) => [optimistic, ...ms]);
    try {
      const confirmed = await postChat(agent, text);
      setMessages((ms) => withConfirmedTurn(ms, optimistic.id, confirmed));
    } catch (e) {
      setMessages((ms) => withoutTurn(ms, optimistic.id));
      setReplyText(text);
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <>
      {/* ── Bottone navbar: icona chat + badge non letti ──────────── */}
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setActiveAgent(null);
          void refresh();
        }}
        aria-label={tr("aria_open")}
        aria-expanded={open}
        className="relative w-8 h-8 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] flex items-center justify-center cursor-pointer hover:border-[var(--color-green)] transition-colors"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="text-[var(--color-muted)]"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center text-[8px] font-bold leading-none"
            style={{
              background: "var(--color-yellow)",
              color: "var(--color-void)",
              boxShadow: "0 0 0 2px var(--color-panel)",
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {/* ── Drawer sopra tutto ─────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-[90]">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{
              background: "rgba(0,0,0,0.55)",
              animation: "fade-in 0.2s ease both",
            }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Pannello */}
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={tr("title")}
            className="absolute inset-y-0 right-0 w-[min(94vw,400px)] flex flex-col border-l border-[var(--color-border)]"
            style={{
              background: "var(--color-panel)",
              boxShadow: "-16px 0 48px rgba(0,0,0,0.45)",
              animation: "jht-drawer-in 0.25s cubic-bezier(0.2,0.8,0.2,1) both",
            }}
          >
            <style>{`@keyframes jht-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 h-14 border-b border-[var(--color-border)] shrink-0">
              {active ? (
                <button
                  type="button"
                  onClick={() => setActiveAgent(null)}
                  aria-label={tr("back")}
                  className="w-7 h-7 -ml-1 rounded flex items-center justify-center cursor-pointer text-[var(--color-muted)] hover:text-[var(--color-bright)] hover:bg-[var(--color-card)] transition-colors"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              ) : null}
              {active ? (
                <span className="flex items-center gap-2 min-w-0">
                  <AgentDot agent={active.agent} locale={locale} size={26} />
                  <span
                    className="text-[12px] font-bold truncate"
                    style={{ color: agentInfo(active.agent, locale).color }}
                  >
                    {agentInfo(active.agent, locale).name}
                  </span>
                </span>
              ) : (
                <span className="section-label">{tr("title")}</span>
              )}
              <span className="ml-auto flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={tr("close")}
                  className="w-7 h-7 rounded flex items-center justify-center cursor-pointer text-[var(--color-muted)] hover:text-[var(--color-bright)] hover:bg-[var(--color-card)] transition-colors"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            </div>

            {/* ── Vista conversazioni ─────────────────────────────── */}
            {!active && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                {conversations.length === 0 && (
                  <p className="px-4 py-6 text-[11px] text-[var(--color-muted)] m-0">
                    {tr("empty")}
                  </p>
                )}
                <ul className="list-none m-0 p-0">
                  {conversations.map((c) => {
                    const info = agentInfo(c.agent, locale);
                    const preview = stripInlineMarkdown(
                      normalizeBody(c.latest.body)
                        .split("\n")
                        .map((l) => l.trim())
                        .filter(Boolean)[0] ?? "",
                    );
                    return (
                      <li key={c.agent}>
                        <button
                          type="button"
                          onClick={() => openChat(c.agent)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-card)] transition-colors"
                        >
                          <span className="relative shrink-0">
                            <AgentDot agent={c.agent} locale={locale} />
                            {c.unread > 0 && (
                              <span
                                aria-hidden
                                className="absolute -top-0.5 -right-0.5 w-[11px] h-[11px] rounded-full"
                                style={{
                                  background: "var(--color-yellow)",
                                  boxShadow: "0 0 0 2px var(--color-panel)",
                                }}
                              />
                            )}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-baseline gap-2">
                              <span
                                className="text-[12px] font-bold truncate"
                                style={{ color: info.color }}
                              >
                                {info.name}
                              </span>
                              <span className="ml-auto shrink-0 text-[9px] text-[var(--color-dim)]">
                                {formatRelative(c.latest.created_at, locale)}
                              </span>
                            </span>
                            <span
                              className="block text-[11px] truncate mt-0.5"
                              style={{
                                color:
                                  c.unread > 0
                                    ? "var(--color-bright)"
                                    : "var(--color-muted)",
                                fontWeight: c.unread > 0 ? 600 : 400,
                              }}
                            >
                              {preview}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* ── Vista chat ──────────────────────────────────────── */}
            {active && (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 flex flex-col gap-3">
                  {active.messages.map((m) => (
                    <div key={m.id} className="flex flex-col gap-2">
                      {/* Bolla dell'agente */}
                      <div
                        className="max-w-[88%] self-start rounded-lg rounded-tl-sm px-3 py-2 border-l-2"
                        style={{
                          background: "var(--color-card)",
                          borderLeftColor: KIND_BORDER[m.kind],
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {m.kind !== "notification" && (
                            <span
                              className="text-[7.5px] font-semibold tracking-[0.14em] uppercase px-1 py-px rounded"
                              style={{
                                color: KIND_BORDER[m.kind],
                                border: `1px solid ${KIND_BORDER[m.kind]}`,
                              }}
                            >
                              {kindLabel(m.kind, locale)}
                            </span>
                          )}
                          <span className="text-[9px] text-[var(--color-dim)]">
                            {formatRelative(m.created_at, locale)}
                          </span>
                        </div>
                        <MessageBody
                          text={m.body}
                          className="m-0 text-[11.5px] leading-relaxed text-[var(--color-base)]"
                        />
                        {m.related_position_id && (
                          <Link
                            href={`/positions/${m.related_position_id}`}
                            onClick={() => setOpen(false)}
                            className="inline-block mt-1 text-[10px] text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                          >
                            {tr("see_position")}
                          </Link>
                        )}
                      </div>
                      {/* Risposta dell'utente, a destra */}
                      {m.user_reply && (
                        <div
                          className="max-w-[88%] self-end rounded-lg rounded-tr-sm px-3 py-2"
                          style={{
                            background:
                              "color-mix(in srgb, var(--color-green) 10%, var(--color-card))",
                            border:
                              "1px solid color-mix(in srgb, var(--color-green) 30%, transparent)",
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1 justify-end">
                            <span className="text-[9px] font-semibold text-[var(--color-green)]">
                              {tr("you")}
                            </span>
                            {m.user_reply_at && (
                              <span className="text-[9px] text-[var(--color-dim)]">
                                {formatRelative(m.user_reply_at, locale)}
                              </span>
                            )}
                          </div>
                          <MessageBody
                            text={m.user_reply}
                            className="m-0 text-[11.5px] leading-relaxed text-[var(--color-base)]"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* Composer */}
                <div className="shrink-0 border-t border-[var(--color-border)] p-3">
                  {error && (
                    <div
                      className="mb-2 px-2 py-1.5 rounded border text-[10px]"
                      style={{
                        borderColor: "var(--color-red)",
                        color: "var(--color-red)",
                      }}
                      role="alert"
                    >
                      {error}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      rows={1}
                      maxLength={MAX_CHAT_BODY}
                      disabled={!canWrite || sending}
                      placeholder={tr("write_to").replace(
                        "{name}",
                        agentInfo(active.agent, locale).name,
                      )}
                      className="flex-1 px-3 py-2 text-[11.5px] bg-[var(--color-card)] border border-[var(--color-border)] rounded resize-none text-[var(--color-base)] disabled:opacity-50 focus:outline-none focus:border-[var(--color-border-glow)]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={
                        !canWrite || sending || replyText.trim().length === 0
                      }
                      aria-label={tr("send")}
                      className="w-8 h-8 shrink-0 rounded flex items-center justify-center cursor-pointer border transition-colors disabled:opacity-40 disabled:cursor-default"
                      style={{
                        color: "var(--color-green)",
                        borderColor: "var(--color-green)",
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
