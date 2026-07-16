"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import {
  agentInfo,
  formatRelative,
  kindLabel,
  normalizeBody,
  KIND_BORDER,
} from "@/lib/message-display";
import type { PendingMessage } from "@/lib/types";

interface Props {
  initialMessages: PendingMessage[];
}

const T: Record<string, Record<string, string>> = {
  page_title: {
    it: "Messaggi dal team",
    en: "Messages from the team",
    hu: "Üzenetek a csapattól",
    es: "Mensajes del equipo",
    de: "Nachrichten vom Team",
    fr: "Messages de l'équipe",
    pt: "Mensagens da equipe",
  },
  unread: {
    it: "{n} non letti",
    en: "{n} unread",
    hu: "{n} olvasatlan",
    es: "{n} sin leer",
    de: "{n} ungelesen",
    fr: "{n} non lus",
    pt: "{n} não lidas",
  },
  read_section: {
    it: "Letti",
    en: "Read",
    hu: "Olvasott",
    es: "Leídos",
    de: "Gelesen",
    fr: "Lus",
    pt: "Lidas",
  },
  empty: {
    it: "Nessun messaggio dal team, per ora.",
    en: "No messages from the team yet.",
    hu: "Egyelőre nincs üzenet a csapattól.",
    es: "Aún no hay mensajes del equipo.",
    de: "Noch keine Nachrichten vom Team.",
    fr: "Pas encore de messages de l'équipe.",
    pt: "Ainda não há mensagens da equipe.",
  },
  empty_reply: {
    it: "Scrivi qualcosa prima di inviare.",
    en: "Write something before sending.",
    hu: "Írj valamit, mielőtt elküldöd.",
    es: "Escribe algo antes de enviar.",
    de: "Schreibe etwas, bevor du sendest.",
    fr: "Écrivez quelque chose avant d'envoyer.",
    pt: "Escreva algo antes de enviar.",
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
  reply_placeholder: {
    it: "Scrivi la tua risposta...",
    en: "Write your reply...",
    hu: "Írd meg a válaszod...",
    es: "Escribe tu respuesta...",
    de: "Schreibe deine Antwort...",
    fr: "Écrivez votre réponse...",
    pt: "Escreva sua resposta...",
  },
  cancel: {
    it: "Annulla",
    en: "Cancel",
    hu: "Mégse",
    es: "Cancelar",
    de: "Abbrechen",
    fr: "Annuler",
    pt: "Cancelar",
  },
  send_reply: {
    it: "Invia risposta",
    en: "Send reply",
    hu: "Válasz küldése",
    es: "Enviar respuesta",
    de: "Antwort senden",
    fr: "Envoyer la réponse",
    pt: "Enviar resposta",
  },
  mark_read: {
    it: "Segna come letto",
    en: "Mark as read",
    hu: "Megjelölés olvasottként",
    es: "Marcar como leído",
    de: "Als gelesen markieren",
    fr: "Marquer comme lu",
    pt: "Marcar como lido",
  },
  mark_all_read: {
    it: "Segna tutti come letti",
    en: "Mark all as read",
    hu: "Összes megjelölése olvasottként",
    es: "Marcar todo como leído",
    de: "Alle als gelesen markieren",
    fr: "Tout marquer comme lu",
    pt: "Marcar tudo como lido",
  },
  reply: {
    it: "Rispondi →",
    en: "Reply →",
    hu: "Válasz →",
    es: "Responder →",
    de: "Antworten →",
    fr: "Répondre →",
    pt: "Responder →",
  },
  your_reply: {
    it: "La tua risposta",
    en: "Your reply",
    hu: "A válaszod",
    es: "Tu respuesta",
    de: "Deine Antwort",
    fr: "Votre réponse",
    pt: "Sua resposta",
  },
};

export default function MessagesList({ initialMessages }: Props) {
  const [messages, setMessages] = useState<PendingMessage[]>(initialMessages);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  const unread = messages.filter((m) => !m.acknowledged_at);
  const read = messages.filter((m) => m.acknowledged_at);

  // Ack in place: il messaggio passa nella sezione "Letti" invece di sparire
  // (in dashboard spariva; qui la pagina È lo storico).
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
        const now = new Date().toISOString();
        setMessages((ms) =>
          ms.map((m) =>
            m.id === id ? { ...m, acknowledged_at: now } : m,
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function handleAckAll() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/pending-messages/ack-all`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const now = new Date().toISOString();
        setMessages((ms) =>
          ms.map((m) =>
            m.acknowledged_at ? m : { ...m, acknowledged_at: now },
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function handleReply(id: string) {
    const reply = replyText.trim();
    if (!reply) {
      setError(tr("empty_reply"));
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
        const now = new Date().toISOString();
        setMessages((ms) =>
          ms.map((m) =>
            m.id === id
              ? {
                  ...m,
                  user_reply: reply,
                  user_reply_at: now,
                  acknowledged_at: m.acknowledged_at ?? now,
                }
              : m,
          ),
        );
        setActiveReplyId(null);
        setReplyText("");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function renderCard(m: PendingMessage, isRead: boolean) {
    const info = agentInfo(m.agent, locale);
    const kindBorder = isRead ? "var(--color-border)" : KIND_BORDER[m.kind];
    const isReplying = activeReplyId === m.id;

    return (
      <li
        key={m.id}
        className="bg-[var(--color-card)] rounded-lg p-4 border-l-2"
        style={{
          borderColor: kindBorder,
          borderLeftColor: kindBorder,
          borderLeftWidth: 3,
          opacity: isRead ? 0.65 : 1,
        }}
      >
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0" aria-hidden>
            {info.emoji}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="text-[11px] font-bold"
                style={{ color: info.color }}
              >
                {info.name}
              </span>
              <span
                className="text-[8px] font-semibold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded"
                style={{
                  color: KIND_BORDER[m.kind],
                  border: `1px solid ${KIND_BORDER[m.kind]}`,
                }}
              >
                {kindLabel(m.kind, locale)}
              </span>
              <span className="text-[10px] text-[var(--color-dim)]">
                {formatRelative(m.created_at, locale)}
              </span>
            </div>
            <p
              className="text-[12px] text-[var(--color-base)] m-0 mb-2 leading-relaxed"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {normalizeBody(m.body)}
            </p>
            {m.related_position_id && (
              <Link
                href={`/positions/${m.related_position_id}`}
                className="text-[10px] text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
              >
                {tr("see_position")}
              </Link>
            )}

            {m.user_reply && (
              <div
                className="mt-3 px-3 py-2 rounded border-l-2 text-[11px]"
                style={{
                  background: "var(--color-panel)",
                  borderLeftColor: "var(--color-green)",
                  color: "var(--color-muted)",
                }}
              >
                <span className="block text-[9px] font-semibold tracking-widest uppercase mb-1 text-[var(--color-dim)]">
                  {tr("your_reply")}
                </span>
                <span style={{ whiteSpace: "pre-wrap" }}>
                  {normalizeBody(m.user_reply)}
                </span>
              </div>
            )}

            {isReplying ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder={tr("reply_placeholder")}
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
                    {tr("cancel")}
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
                    {tr("send_reply")}
                  </button>
                </div>
              </div>
            ) : (
              (!isRead || !m.user_reply) && (
                <div className="mt-3 flex items-center gap-3">
                  {!isRead && (
                    <button
                      type="button"
                      onClick={() => handleAck(m.id)}
                      disabled={pending}
                      className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors disabled:opacity-50"
                    >
                      {tr("mark_read")}
                    </button>
                  )}
                  {!m.user_reply && (
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
                      {tr("reply")}
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </li>
    );
  }

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">{tr("page_title")}</span>
        <div className="flex items-center gap-3">
          {unread.length > 0 && (
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
              {tr("unread").replace("{n}", String(unread.length))}
            </span>
          )}
          {unread.length > 1 && (
            <button
              type="button"
              onClick={handleAckAll}
              disabled={pending}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors disabled:opacity-50"
            >
              {tr("mark_all_read")}
            </button>
          )}
        </div>
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

      {messages.length === 0 && (
        <p className="text-[12px] text-[var(--color-muted)]">{tr("empty")}</p>
      )}

      {unread.length > 0 && (
        <ul className="flex flex-col gap-3 list-none p-0 m-0">
          {unread.map((m) => renderCard(m, false))}
        </ul>
      )}

      {read.length > 0 && (
        <>
          <div className="flex items-center gap-3 mt-8 mb-4">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
              {tr("read_section")}
            </span>
            <div
              className="flex-1 h-px"
              style={{ background: "var(--color-border)" }}
            />
          </div>
          <ul className="flex flex-col gap-3 list-none p-0 m-0">
            {read.map((m) => renderCard(m, true))}
          </ul>
        </>
      )}
    </div>
  );
}
