"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Recheck/liveness ON-DEMAND. Il recheck NON è più autonomo: l'utente clicca qui
// per chiedere all'Analista di ri-verificare se l'offerta è ancora attiva
// (flag recheck_requested). Toggle come Geocodifica / Scrivi CV.
interface Props {
  legacyId: number;
  initialRequested: boolean;
  lastOpenCheck?: string | null;
}

function ageLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.replace(" ", "T"));
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "oggi";
  if (days === 1) return "1 giorno fa";
  return `${days} giorni fa`;
}

export function RecheckButton({
  legacyId,
  initialRequested,
  lastOpenCheck,
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
      setError(e instanceof Error ? e.message : "Errore di rete");
    }
  };

  const checked = ageLabel(lastOpenCheck);
  const label = isPending
    ? requested
      ? "Richiesta inviata…"
      : "Annullando…"
    : requested
      ? "Recheck richiesto · annulla"
      : "Ricontrolla se attiva";

  const color = requested ? "var(--color-green)" : "var(--color-purple)";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:opacity-60 disabled:cursor-wait"
        style={{ borderColor: color, color }}
        title={
          checked
            ? `Ultima verifica: ${checked}. Il recheck non è automatico: chiedilo tu.`
            : "Il recheck non è automatico: chiedilo tu."
        }
      >
        {requested ? "✓" : "🔄"} {label}
      </button>
      {checked && !requested && (
        <span className="text-[10px]" style={{ color: "var(--color-dim)" }}>
          ultima verifica: {checked}
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
