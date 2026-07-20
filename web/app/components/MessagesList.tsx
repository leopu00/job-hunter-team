"use client";

// [JHT-MESSAGES-CHAT] /messages come chat a tre sezioni — Mentor, Capitano,
// Assistente (scelta utente 20/07): selettore in alto, thread di bolle al
// centro e composer centrato in basso stile ChatGPT. La risposta rapida
// aggancia l'ultimo messaggio dell'agente senza user_reply (l'API di reply
// è per-messaggio); aprire una sezione marca i suoi non letti come letti,
// come nel drawer della navbar (MessagesDrawer).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import {
  agentInfo,
  formatRelative,
  kindLabel,
  KIND_BORDER,
} from "@/lib/message-display";
import MessageBody from "@/app/components/MessageBody";
import type { PendingMessage } from "@/lib/types";

interface Props {
  initialMessages: PendingMessage[];
}

// Le tre conversazioni fisse, nell'ordine voluto dall'utente. Eventuali
// mittenti fuori roster compaiono come sezioni extra in coda.
const CORE_AGENTS = ["mentor", "capitano", "assistente"];

const T: Record<string, Record<string, string>> = {
  empty_agent: {
    it: "Nessun messaggio da {name}, per ora.",
    en: "No messages from {name} yet.",
    hu: "Egyelőre nincs üzenet tőle: {name}.",
    es: "Aún no hay mensajes de {name}.",
    de: "Noch keine Nachrichten von {name}.",
    fr: "Pas encore de messages de {name}.",
    pt: "Ainda não há mensagens de {name}.",
  },
  reply_placeholder: {
    it: "Scrivi una risposta…",
    en: "Write a reply…",
    hu: "Írj választ…",
    es: "Escribe una respuesta…",
    de: "Antwort schreiben…",
    fr: "Écrivez une réponse…",
    pt: "Escreva uma resposta…",
  },
  no_reply_target: {
    it: "Nessun messaggio in attesa di risposta",
    en: "No message awaiting a reply",
    hu: "Nincs válaszra váró üzenet",
    es: "Ningún mensaje espera respuesta",
    de: "Keine Nachricht wartet auf Antwort",
    fr: "Aucun message en attente de réponse",
    pt: "Nenhuma mensagem aguardando resposta",
  },
  send: {
    it: "Invia",
    en: "Send",
    hu: "Küldés",
    es: "Enviar",
    de: "Senden",
    fr: "Envoyer",
    pt: "Enviar",
  },
  see_position: {
    it: "→ vedi posizione",
    en: "→ view position",
    hu: "→ állás megtekintése",
    es: "→ ver posición",
    de: "→ Stelle ansehen",
    fr: "→ voir le poste",
    pt: "→ ver vaga",
  },
  you: {
    it: "Tu",
    en: "You",
    hu: "Te",
    es: "Tú",
    de: "Du",
    fr: "Vous",
    pt: "Você",
  },
};

export default function MessagesList({ initialMessages }: Props) {
  const [messages, setMessages] = useState<PendingMessage[]>(initialMessages);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Sezioni: i tre core sempre presenti + eventuali mittenti extra.
  const agents = useMemo(() => {
    const extra = Array.from(new Set(messages.map((m) => m.agent))).filter(
      (a) => !CORE_AGENTS.includes(a),
    );
    return [...CORE_AGENTS, ...extra];
  }, [messages]);

  // Sezione iniziale: l'agente col messaggio più recente, altrimenti Mentor.
  const [activeAgent, setActiveAgent] = useState<string>(() => {
    const latest = [...initialMessages].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )[0];
    return latest?.agent && CORE_AGENTS.includes(latest.agent)
      ? latest.agent
      : (latest?.agent ?? "mentor");
  });

  const thread = useMemo(
    () =>
      messages
        .filter((m) => m.agent === activeAgent)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages, activeAgent],
  );

  const unreadBy = (agent: string) =>
    messages.filter((m) => m.agent === agent && !m.acknowledged_at).length;

  // Aprire una sezione marca i suoi non letti (stile messenger, come nel
  // drawer): ottimista + fire-and-forget, il server riallinea al reload.
  function ackAgent(agent: string) {
    const ids = messages
      .filter((m) => m.agent === agent && !m.acknowledged_at)
      .map((m) => m.id);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setMessages((ms) =>
      ms.map((m) =>
        m.agent === agent && !m.acknowledged_at
          ? { ...m, acknowledged_at: now }
          : m,
      ),
    );
    for (const id of ids) {
      void fetch(`/api/pending-messages/${id}/ack`, { method: "POST" }).catch(
        () => {},
      );
    }
  }

  // Ack anche della sezione aperta di default al primo mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => ackAgent(activeAgent), [activeAgent]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeAgent, messages.length]);

  const replyTarget = [...thread].reverse().find((m) => !m.user_reply);

  async function handleSend() {
    if (!replyTarget) return;
    const reply = replyText.trim();
    if (!reply) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pending-messages/${replyTarget.id}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      const now = new Date().toISOString();
      setMessages((ms) =>
        ms.map((m) =>
          m.id === replyTarget.id
            ? {
                ...m,
                user_reply: reply,
                user_reply_at: now,
                acknowledged_at: m.acknowledged_at ?? now,
              }
            : m,
        ),
      );
      setReplyText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const activeInfo = agentInfo(activeAgent, locale);

  return (
    // Altezza piena sotto la navbar (h-14): thread scrollabile al centro,
    // selettore e composer fissi. Il body ha `zoom: var(--zoom)` (vedi
    // globals.css): i dvh NON scalano con lo zoom, quindi vanno divisi.
    <div
      className="flex flex-col"
      style={{ height: "calc(100dvh / var(--zoom, 1) - 56px)" }}
    >
      {/* ── Selettore delle tre sezioni ─────────────────────────────── */}
      <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
        <div
          className="max-w-3xl mx-auto px-5 flex items-stretch justify-center gap-1"
          role="tablist"
        >
          {agents.map((agent) => {
            const info = agentInfo(agent, locale);
            const unread = unreadBy(agent);
            const active = agent === activeAgent;
            return (
              <button
                key={agent}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveAgent(agent)}
                className="relative flex items-center gap-2 px-4 py-3 cursor-pointer transition-colors"
                style={{
                  color: active ? info.color : "var(--color-muted)",
                  boxShadow: active
                    ? `inset 0 -2px 0 0 ${info.color}`
                    : undefined,
                }}
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {info.emoji}
                </span>
                <span className="text-[11px] font-bold tracking-wide">
                  {info.name}
                </span>
                {unread > 0 && (
                  <span
                    className="min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center text-[8px] font-bold leading-none"
                    style={{
                      background: "var(--color-yellow)",
                      color: "var(--color-void)",
                    }}
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Thread ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div
          className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-4"
          style={{ animation: "fade-in 0.25s ease both" }}
        >
          {thread.length === 0 && (
            <p className="text-[12px] text-[var(--color-muted)] text-center py-12 m-0">
              {tr("empty_agent").replace("{name}", activeInfo.name)}
            </p>
          )}
          {thread.map((m) => (
            <div key={m.id} className="flex flex-col gap-2">
              {/* Bolla dell'agente */}
              <div className="flex items-end gap-2 max-w-[85%] self-start">
                <span aria-hidden className="text-[16px] leading-none mb-1">
                  {agentInfo(m.agent, locale).emoji}
                </span>
                <div
                  className="rounded-lg rounded-bl-sm px-4 py-3 border-l-2 min-w-0"
                  style={{
                    background: "var(--color-card)",
                    borderLeftColor: KIND_BORDER[m.kind],
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
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
                    className="m-0 text-[12.5px] leading-relaxed text-[var(--color-base)]"
                  />
                  {m.related_position_id && (
                    <Link
                      href={`/positions/${m.related_position_id}`}
                      className="inline-block mt-1.5 text-[10px] text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                    >
                      {tr("see_position")}
                    </Link>
                  )}
                </div>
              </div>
              {/* Risposta dell'utente */}
              {m.user_reply && (
                <div
                  className="max-w-[85%] self-end rounded-lg rounded-br-sm px-4 py-3"
                  style={{
                    background:
                      "color-mix(in srgb, var(--color-green) 10%, var(--color-card))",
                    border:
                      "1px solid color-mix(in srgb, var(--color-green) 30%, transparent)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5 justify-end">
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
                    className="m-0 text-[12.5px] leading-relaxed text-[var(--color-base)]"
                  />
                </div>
              )}
            </div>
          ))}
          <div ref={threadEndRef} />
        </div>
      </div>

      {/* ── Composer centrato, stile ChatGPT ────────────────────────── */}
      <div className="shrink-0 px-5 pb-5 pt-2">
        <div className="max-w-2xl mx-auto">
          {error && (
            <div
              className="mb-2 px-3 py-1.5 rounded border text-[10px]"
              style={{
                borderColor: "var(--color-red)",
                color: "var(--color-red)",
              }}
              role="alert"
            >
              {error}
            </div>
          )}
          <div
            className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors focus-within:border-[var(--color-border-glow)]"
            style={{
              background: "var(--color-card)",
              borderColor: "var(--color-border)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            }}
          >
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
              maxLength={4000}
              disabled={!replyTarget || sending}
              placeholder={
                replyTarget ? tr("reply_placeholder") : tr("no_reply_target")
              }
              className="flex-1 px-2 py-1.5 text-[12.5px] bg-transparent border-none resize-none text-[var(--color-base)] disabled:opacity-50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={
                !replyTarget || sending || replyText.trim().length === 0
              }
              aria-label={tr("send")}
              className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
              style={{
                background: "var(--color-green)",
                color: "var(--color-void)",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
