"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PendingMessage, PendingMessageKind } from "@/lib/types";

interface Props {
  initialMessages: PendingMessage[];
}

const AGENT_LABEL: Record<
  string,
  { name: string; emoji: string; color: string }
> = {
  capitano: { name: "Capitano", emoji: "🎯", color: "var(--color-yellow)" },
  mentor: { name: "Mentor", emoji: "🧙‍♂️", color: "var(--color-purple)" },
  assistente: { name: "Assistente", emoji: "👨‍💼", color: "var(--color-blue)" },
};

const KIND_BORDER: Record<PendingMessageKind, string> = {
  notification: "var(--color-border)",
  question: "var(--color-blue)",
  digest: "var(--color-purple)",
  alert: "var(--color-red)",
};

const KIND_LABEL: Record<PendingMessageKind, string> = {
  notification: "NOTIFICA",
  question: "DOMANDA",
  digest: "DIGEST",
  alert: "ALERT",
};

function fmtRelative(iso: string): string {
  const ts = new Date(
    iso.includes("T") ? iso : iso.replace(" ", "T") + "Z",
  ).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s fa`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m fa`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h fa`;
  return `${Math.round(diffSec / 86400)}g fa`;
}

export default function PendingMessagesCard({ initialMessages }: Props) {
  // L'array e' state interno: ack/reply rimuovono il messaggio dalla lista
  // senza dover ricaricare la pagina. Il polling per nuove notifiche verra'
  // in una iterazione successiva (oggi: refresh manuale).
  const [messages, setMessages] = useState<PendingMessage[]>(initialMessages);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (messages.length === 0) return null;

  async function handleAck(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/pending-messages/${id}/ack`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setMessages((ms) => ms.filter((m) => m.id !== id));
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function handleReply(id: string) {
    const reply = replyText.trim();
    if (!reply) {
      setError("Scrivi qualcosa prima di inviare.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/pending-messages/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setMessages((ms) => ms.filter((m) => m.id !== id));
        setActiveReplyId(null);
        setReplyText("");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="mb-8" style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">Messaggi dal team</span>
        <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
          {messages.length} non letti
        </span>
      </div>

      {error && (
        <div
          className="mb-3 px-3 py-2 rounded border text-[11px]"
          style={{
            background: "var(--color-red-bg, rgba(255,80,80,0.08))",
            borderColor: "var(--color-red)",
            color: "var(--color-red)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      <ul className="flex flex-col gap-3 list-none p-0 m-0">
        {messages.map((m) => {
          const agentInfo = AGENT_LABEL[m.agent] ?? {
            name: m.agent,
            emoji: "🤖",
            color: "var(--color-muted)",
          };
          const kindBorder = KIND_BORDER[m.kind] ?? "var(--color-border)";
          const isReplying = activeReplyId === m.id;

          return (
            <li
              key={m.id}
              className="bg-[var(--color-card)] rounded-lg p-4 border-l-2"
              style={{
                borderColor: kindBorder,
                borderLeftColor: kindBorder,
                borderLeftWidth: 3,
              }}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0" aria-hidden>
                  {agentInfo.emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: agentInfo.color }}
                    >
                      {agentInfo.name}
                    </span>
                    <span
                      className="text-[8px] font-semibold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded"
                      style={{
                        color: kindBorder,
                        border: `1px solid ${kindBorder}`,
                      }}
                    >
                      {KIND_LABEL[m.kind] ?? m.kind}
                    </span>
                    <span className="text-[10px] text-[var(--color-dim)]">
                      {fmtRelative(m.created_at)}
                    </span>
                  </div>
                  <p
                    className="text-[12px] text-[var(--color-base)] m-0 mb-2 leading-relaxed"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {m.body}
                  </p>
                  {m.related_position_id && (
                    <Link
                      href={`/positions/${m.related_position_id}`}
                      className="text-[10px] text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                    >
                      → vedi posizione
                    </Link>
                  )}

                  {isReplying ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={3}
                        maxLength={4000}
                        placeholder="Scrivi la tua risposta..."
                        className="w-full px-3 py-2 text-[12px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded resize-y text-[var(--color-base)]"
                        autoFocus
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveReplyId(null);
                            setReplyText("");
                          }}
                          disabled={pending}
                          className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors disabled:opacity-50"
                        >
                          Annulla
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReply(m.id)}
                          disabled={pending || replyText.trim().length === 0}
                          className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border transition-colors disabled:opacity-50"
                          style={{
                            color: "var(--color-green)",
                            borderColor: "var(--color-green)",
                          }}
                        >
                          Invia risposta
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleAck(m.id)}
                        disabled={pending}
                        className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors disabled:opacity-50"
                      >
                        Segna come letto
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveReplyId(m.id);
                          setReplyText("");
                          setError(null);
                        }}
                        disabled={pending}
                        className="text-[10px] font-semibold tracking-widest uppercase transition-colors disabled:opacity-50"
                        style={{ color: "var(--color-blue)" }}
                      >
                        Rispondi →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
