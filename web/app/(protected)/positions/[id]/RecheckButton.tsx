"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// Recheck/liveness ON-DEMAND. Il recheck NON è più autonomo: l'utente clicca qui
// per chiedere all'Analista di ri-verificare se l'offerta è ancora attiva
// (flag recheck_requested). Toggle come Geocodifica / Scrivi CV.
interface Props {
  legacyId: number;
  initialRequested: boolean;
  lastOpenCheck?: string | null;
}

const T: Record<
  Locale,
  {
    today: string;
    daysAgo: (n: number) => string;
    sent: string;
    cancelling: string;
    requested: string;
    recheck: string;
    networkError: string;
    titleWithCheck: (age: string) => string;
    titleNoCheck: string;
    lastCheck: (age: string) => string;
  }
> = {
  it: {
    today: "oggi",
    daysAgo: (n) => (n === 1 ? "1 giorno fa" : `${n} giorni fa`),
    sent: "Richiesta inviata…",
    cancelling: "Annullando…",
    requested: "Recheck richiesto · annulla",
    recheck: "Ricontrolla se attiva",
    networkError: "Errore di rete",
    titleWithCheck: (age) =>
      `Ultima verifica: ${age}. Il recheck non è automatico: chiedilo tu.`,
    titleNoCheck: "Il recheck non è automatico: chiedilo tu.",
    lastCheck: (age) => `ultima verifica: ${age}`,
  },
  en: {
    today: "today",
    daysAgo: (n) => (n === 1 ? "1 day ago" : `${n} days ago`),
    sent: "Request sent…",
    cancelling: "Cancelling…",
    requested: "Recheck requested · cancel",
    recheck: "Recheck if active",
    networkError: "Network error",
    titleWithCheck: (age) =>
      `Last check: ${age}. Recheck is not automatic: ask for it.`,
    titleNoCheck: "Recheck is not automatic: ask for it.",
    lastCheck: (age) => `last check: ${age}`,
  },
  es: {
    today: "hoy",
    daysAgo: (n) => (n === 1 ? "hace 1 día" : `hace ${n} días`),
    sent: "Solicitud enviada…",
    cancelling: "Cancelando…",
    requested: "Reverificación solicitada · cancelar",
    recheck: "Reverificar si está activa",
    networkError: "Error de red",
    titleWithCheck: (age) =>
      `Última comprobación: ${age}. La reverificación no es automática: pídela.`,
    titleNoCheck: "La reverificación no es automática: pídela.",
    lastCheck: (age) => `última comprobación: ${age}`,
  },
  fr: {
    today: "aujourd'hui",
    daysAgo: (n) => (n === 1 ? "il y a 1 jour" : `il y a ${n} jours`),
    sent: "Demande envoyée…",
    cancelling: "Annulation…",
    requested: "Revérification demandée · annuler",
    recheck: "Revérifier si active",
    networkError: "Erreur réseau",
    titleWithCheck: (age) =>
      `Dernière vérification : ${age}. La revérification n'est pas automatique : demandez-la.`,
    titleNoCheck: "La revérification n'est pas automatique : demandez-la.",
    lastCheck: (age) => `dernière vérification : ${age}`,
  },
  de: {
    today: "heute",
    daysAgo: (n) => (n === 1 ? "vor 1 Tag" : `vor ${n} Tagen`),
    sent: "Anfrage gesendet…",
    cancelling: "Wird abgebrochen…",
    requested: "Erneute Prüfung angefordert · abbrechen",
    recheck: "Erneut prüfen, ob aktiv",
    networkError: "Netzwerkfehler",
    titleWithCheck: (age) =>
      `Letzte Prüfung: ${age}. Die erneute Prüfung erfolgt nicht automatisch: bitte anfordern.`,
    titleNoCheck:
      "Die erneute Prüfung erfolgt nicht automatisch: bitte anfordern.",
    lastCheck: (age) => `letzte Prüfung: ${age}`,
  },
  hu: {
    today: "ma",
    daysAgo: (n) => `${n} napja`,
    sent: "Kérés elküldve…",
    cancelling: "Megszakítás…",
    requested: "Újraellenőrzés kérve · mégse",
    recheck: "Ellenőrizd újra, hogy aktív-e",
    networkError: "Hálózati hiba",
    titleWithCheck: (age) =>
      `Utolsó ellenőrzés: ${age}. Az újraellenőrzés nem automatikus: kérned kell.`,
    titleNoCheck: "Az újraellenőrzés nem automatikus: kérned kell.",
    lastCheck: (age) => `utolsó ellenőrzés: ${age}`,
  },
  pt: {
    today: "hoje",
    daysAgo: (n) => (n === 1 ? "há 1 dia" : `há ${n} dias`),
    sent: "Pedido enviado…",
    cancelling: "Cancelando…",
    requested: "Reverificação solicitada · cancelar",
    recheck: "Reverificar se está ativa",
    networkError: "Erro de rede",
    titleWithCheck: (age) =>
      `Última verificação: ${age}. A reverificação não é automática: peça-a.`,
    titleNoCheck: "A reverificação não é automática: peça-a.",
    lastCheck: (age) => `última verificação: ${age}`,
  },
};

function ageLabel(
  iso: string | null | undefined,
  t: (typeof T)[Locale],
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso.replace(" ", "T"));
  if (Number.isNaN(ms)) return null;
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return t.today;
  return t.daysAgo(days);
}

export function RecheckButton({
  legacyId,
  initialRequested,
  lastOpenCheck,
}: Props) {
  const t = T[useLocale()];
  const [requested, setRequested] = useState(initialRequested);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = async () => {
    setError(null);
    const next = !requested;
    setRequested(next);
    try {
      const res = await fetch(`/api/positions/${legacyId}/recheck-request`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRequested(!next);
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setRequested(!next);
      setError(e instanceof Error ? e.message : t.networkError);
    }
  };

  const checked = ageLabel(lastOpenCheck, t);
  const label = isPending
    ? requested
      ? t.sent
      : t.cancelling
    : requested
      ? t.requested
      : t.recheck;

  const color = requested ? "var(--color-green)" : "var(--color-purple)";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:opacity-60 disabled:cursor-wait"
        style={{ borderColor: color, color }}
        title={checked ? t.titleWithCheck(checked) : t.titleNoCheck}
      >
        {requested ? "✓" : "🔄"} {label}
      </button>
      {checked && !requested && (
        <span className="text-[10px]" style={{ color: "var(--color-dim)" }}>
          {t.lastCheck(checked)}
        </span>
      )}
      {error && (
        <span className="text-[10px]" style={{ color: "var(--color-red)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
