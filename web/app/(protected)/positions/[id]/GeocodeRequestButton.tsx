"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  legacyId: number;
  initialRequested: boolean;
  // Quando il geocoding è gia' fatto mostriamo "Ricalcola" invece di
  // "Geocodifica": l'utente puo' richiedere un refresh anche su
  // posizioni già geocodate (city-level → precise).
  alreadyGeocoded?: boolean;
}

export function GeocodeRequestButton({
  legacyId,
  initialRequested,
  alreadyGeocoded = false,
}: Props) {
  const [requested, setRequested] = useState(initialRequested);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = async () => {
    setError(null);
    const next = !requested;
    setRequested(next);
    try {
      const res = await fetch(
        `/api/positions/${legacyId}/geocode-request`,
        { method: next ? "POST" : "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRequested(!next);
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setRequested(!next);
      setError(e instanceof Error ? e.message : "Errore di rete");
    }
  };

  const verb = alreadyGeocoded ? "Ricalcola" : "Geocodifica";
  const label = isPending
    ? requested
      ? "Richiesta inviata…"
      : "Annullando…"
    : requested
      ? `${verb} richiesto · annulla`
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
        {requested ? "✓" : "📍"} {label}
      </button>
      {error && (
        <span
          className="text-[10px]"
          style={{ color: "var(--color-red)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
