"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

interface Props {
  legacyId: number;
  initialRequested: boolean;
  // Quando il geocoding è gia' fatto mostriamo "Ricalcola" invece di
  // "Geocodifica": l'utente puo' richiedere un refresh anche su
  // posizioni già geocodate (city-level → precise).
  alreadyGeocoded?: boolean;
}

const T: Record<
  Locale,
  {
    geocode: string;
    recompute: string;
    sent: string;
    cancelling: string;
    requested: (verb: string) => string;
    networkError: string;
  }
> = {
  it: {
    geocode: "Geocodifica",
    recompute: "Ricalcola",
    sent: "Richiesta inviata…",
    cancelling: "Annullando…",
    requested: (verb) => `${verb} richiesto · annulla`,
    networkError: "Errore di rete",
  },
  en: {
    geocode: "Geocode",
    recompute: "Recompute",
    sent: "Request sent…",
    cancelling: "Cancelling…",
    requested: (verb) => `${verb} requested · cancel`,
    networkError: "Network error",
  },
  es: {
    geocode: "Geocodificar",
    recompute: "Recalcular",
    sent: "Solicitud enviada…",
    cancelling: "Cancelando…",
    requested: (verb) => `${verb} solicitado · cancelar`,
    networkError: "Error de red",
  },
  fr: {
    geocode: "Géocoder",
    recompute: "Recalculer",
    sent: "Demande envoyée…",
    cancelling: "Annulation…",
    requested: (verb) => `${verb} demandé · annuler`,
    networkError: "Erreur réseau",
  },
  de: {
    geocode: "Geokodieren",
    recompute: "Neu berechnen",
    sent: "Anfrage gesendet…",
    cancelling: "Wird abgebrochen…",
    requested: (verb) => `${verb} angefordert · abbrechen`,
    networkError: "Netzwerkfehler",
  },
  hu: {
    geocode: "Geokódolás",
    recompute: "Újraszámítás",
    sent: "Kérés elküldve…",
    cancelling: "Megszakítás…",
    requested: (verb) => `${verb} kérve · mégse`,
    networkError: "Hálózati hiba",
  },
  pt: {
    geocode: "Geocodificar",
    recompute: "Recalcular",
    sent: "Pedido enviado…",
    cancelling: "Cancelando…",
    requested: (verb) => `${verb} solicitado · cancelar`,
    networkError: "Erro de rede",
  },
};

export function GeocodeRequestButton({
  legacyId,
  initialRequested,
  alreadyGeocoded = false,
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
      const res = await fetch(`/api/positions/${legacyId}/geocode-request`, {
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

  const verb = alreadyGeocoded ? t.recompute : t.geocode;
  const label = isPending
    ? requested
      ? t.sent
      : t.cancelling
    : requested
      ? t.requested(verb)
      : verb;

  const color = requested ? "var(--color-green)" : "var(--color-purple)";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:opacity-60 disabled:cursor-wait"
        style={{ borderColor: color, color }}
      >
        {requested ? "✓ " : ""}
        {label}
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: "var(--color-red)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
