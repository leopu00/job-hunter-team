"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { PendingMessage, PendingMessageKind } from "@/lib/types";

interface Props {
  initialMessages: PendingMessage[];
}

const T: Record<string, Record<string, string>> = {
  agent_capitano: {
    it: "Capitano",
    en: "Captain",
    hu: "Kapitány",
    es: "Capitán",
    de: "Kapitän",
    fr: "Capitaine",
    pt: "Capitão",
  },
  agent_mentor: {
    it: "Mentor",
    en: "Mentor",
    hu: "Mentor",
    es: "Mentor",
    de: "Mentor",
    fr: "Mentor",
    pt: "Mentor",
  },
  agent_assistente: {
    it: "Assistente",
    en: "Assistant",
    hu: "Asszisztens",
    es: "Asistente",
    de: "Assistent",
    fr: "Assistant",
    pt: "Assistente",
  },
  kind_notification: {
    it: "NOTIFICA",
    en: "NOTIFICATION",
    hu: "ÉRTESÍTÉS",
    es: "NOTIFICACIÓN",
    de: "BENACHRICHTIGUNG",
    fr: "NOTIFICATION",
    pt: "NOTIFICAÇÃO",
  },
  kind_question: {
    it: "DOMANDA",
    en: "QUESTION",
    hu: "KÉRDÉS",
    es: "PREGUNTA",
    de: "FRAGE",
    fr: "QUESTION",
    pt: "PERGUNTA",
  },
  kind_digest: {
    it: "DIGEST",
    en: "DIGEST",
    hu: "ÖSSZEFOGLALÓ",
    es: "RESUMEN",
    de: "ZUSAMMENFASSUNG",
    fr: "RÉSUMÉ",
    pt: "RESUMO",
  },
  kind_alert: {
    it: "ALERT",
    en: "ALERT",
    hu: "RIASZTÁS",
    es: "ALERTA",
    de: "WARNUNG",
    fr: "ALERTE",
    pt: "ALERTA",
  },
  section_title: {
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
  reply: {
    it: "Rispondi →",
    en: "Reply →",
    hu: "Válasz →",
    es: "Responder →",
    de: "Antworten →",
    fr: "Répondre →",
    pt: "Responder →",
  },
  ago_s: {
    it: "{n}s fa",
    en: "{n}s ago",
    hu: "{n} mp",
    es: "hace {n}s",
    de: "vor {n}s",
    fr: "il y a {n}s",
    pt: "há {n}s",
  },
  ago_m: {
    it: "{n}m fa",
    en: "{n}m ago",
    hu: "{n} p",
    es: "hace {n}m",
    de: "vor {n}m",
    fr: "il y a {n}m",
    pt: "há {n}m",
  },
  ago_h: {
    it: "{n}h fa",
    en: "{n}h ago",
    hu: "{n} ó",
    es: "hace {n}h",
    de: "vor {n}h",
    fr: "il y a {n}h",
    pt: "há {n}h",
  },
  ago_d: {
    it: "{n}g fa",
    en: "{n}d ago",
    hu: "{n} nap",
    es: "hace {n}d",
    de: "vor {n}T",
    fr: "il y a {n}j",
    pt: "há {n}d",
  },
};

const AGENT_META: Record<string, { labelKey: string; emoji: string; color: string }> = {
  capitano: { labelKey: "agent_capitano", emoji: "🎯", color: "var(--color-yellow)" },
  mentor: { labelKey: "agent_mentor", emoji: "🧙‍♂️", color: "var(--color-purple)" },
  assistente: { labelKey: "agent_assistente", emoji: "👨‍💼", color: "var(--color-blue)" },
};

const KIND_BORDER: Record<PendingMessageKind, string> = {
  notification: "var(--color-border)",
  question: "var(--color-blue)",
  digest: "var(--color-purple)",
  alert: "var(--color-red)",
};

const KIND_LABEL_KEY: Record<PendingMessageKind, string> = {
  notification: "kind_notification",
  question: "kind_question",
  digest: "kind_digest",
  alert: "kind_alert",
};

export default function PendingMessagesCard({ initialMessages }: Props) {
  // L'array e' state interno: ack/reply rimuovono il messaggio dalla lista
  // senza dover ricaricare la pagina. Il polling per nuove notifiche verra'
  // in una iterazione successiva (oggi: refresh manuale).
  const [messages, setMessages] = useState<PendingMessage[]>(initialMessages);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  function fmtRelative(iso: string): string {
    const ts = new Date(
      iso.includes("T") ? iso : iso.replace(" ", "T") + "Z",
    ).getTime();
    if (!Number.isFinite(ts)) return iso;
    const diffSec = Math.round((Date.now() - ts) / 1000);
    if (diffSec < 60) return tr("ago_s").replace("{n}", String(diffSec));
    if (diffSec < 3600)
      return tr("ago_m").replace("{n}", String(Math.round(diffSec / 60)));
    if (diffSec < 86400)
      return tr("ago_h").replace("{n}", String(Math.round(diffSec / 3600)));
    return tr("ago_d").replace("{n}", String(Math.round(diffSec / 86400)));
  }

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
        <span className="section-label">{tr("section_title")}</span>
        <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
          {tr("unread").replace("{n}", String(messages.length))}
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
          const agentMeta = AGENT_META[m.agent];
          const agentInfo = agentMeta
            ? { name: tr(agentMeta.labelKey), emoji: agentMeta.emoji, color: agentMeta.color }
            : { name: m.agent, emoji: "🤖", color: "var(--color-muted)" };
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
                      {KIND_LABEL_KEY[m.kind] ? tr(KIND_LABEL_KEY[m.kind]) : m.kind}
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
                      {tr("see_position")}
                    </Link>
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
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleAck(m.id)}
                        disabled={pending}
                        className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors disabled:opacity-50"
                      >
                        {tr("mark_read")}
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
                        {tr("reply")}
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
