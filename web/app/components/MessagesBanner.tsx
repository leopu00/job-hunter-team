"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import {
  agentInfo,
  formatRelative,
  normalizeBody,
} from "@/lib/message-display";
import type { PendingMessage } from "@/lib/types";

// Banner compatto al posto della vecchia lista completa in dashboard
// (PendingMessagesCard): i digest lunghi del Capitano spingevano pipeline e
// grafici sotto il fold. Qui solo conteggio + anteprima a una riga; la
// lettura vera avviene in /messages.
interface Props {
  unreadCount: number;
  latest: PendingMessage | null;
}

const T: Record<string, Record<string, string>> = {
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
  one_unread: {
    it: "1 non letto",
    en: "1 unread",
    hu: "1 olvasatlan",
    es: "1 sin leer",
    de: "1 ungelesen",
    fr: "1 non lu",
    pt: "1 não lida",
  },
  open: {
    it: "Apri messaggi →",
    en: "Open messages →",
    hu: "Üzenetek megnyitása →",
    es: "Abrir mensajes →",
    de: "Nachrichten öffnen →",
    fr: "Ouvrir les messages →",
    pt: "Abrir mensagens →",
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
};

export default function MessagesBanner({ unreadCount, latest }: Props) {
  const [count, setCount] = useState(unreadCount);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  if (count === 0) return null;

  const countLabel =
    count === 1 ? tr("one_unread") : tr("unread").replace("{n}", String(count));

  const info = latest ? agentInfo(latest.agent, locale) : null;
  // Anteprima a una riga: prima riga non vuota del body, troncata dal clamp.
  const preview = latest
    ? (normalizeBody(latest.body)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)[0] ?? "")
    : "";

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
        setCount(0);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="mb-8" style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">{tr("section_title")}</span>
        {count > 1 && (
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

      <Link
        href="/messages"
        className="flex items-center gap-3 bg-[var(--color-card)] rounded-lg px-4 py-3 no-underline transition-colors hover:bg-[var(--color-panel)] border border-[var(--color-border)]"
      >
        <span className="text-xl shrink-0" aria-hidden>
          {info?.emoji ?? "💬"}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span
            className="text-[11px] font-bold shrink-0"
            style={{ color: "var(--color-yellow)" }}
          >
            {countLabel}
          </span>
          {latest && info && (
            <span className="text-[11px] text-[var(--color-muted)] truncate">
              {info.name} · {formatRelative(latest.created_at, locale)} —{" "}
              {preview}
            </span>
          )}
        </div>
        <span className="text-[10px] font-semibold tracking-widest uppercase shrink-0 text-[var(--color-blue)]">
          {tr("open")}
        </span>
      </Link>
    </div>
  );
}
