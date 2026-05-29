"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  legacyId: number;
  initialRequested: boolean;
  // Disabilita il button se la posizione non e' nello stato giusto:
  //   - status !== 'scored' -> non puoi richiedere CV prima dello Scorer
  //   - applicationExists  -> CV gia' scritto / in coda con applications
  disabled?: boolean;
  disabledReason?: string;
}

export function WriteRequestButton({
  legacyId,
  initialRequested,
  disabled = false,
  disabledReason,
}: Props) {
  const [requested, setRequested] = useState(initialRequested);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = async () => {
    setError(null);
    const next = !requested;
    // Optimistic update: il Capitano vede comunque la verita' di SQLite,
    // qui ottimizziamo per la UX percepita. Se POST/DELETE fallisce
    // riportiamo lo stato indietro.
    setRequested(next);
    try {
      const res = await fetch(
        `/api/positions/${legacyId}/write-request`,
        { method: next ? "POST" : "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRequested(!next);
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Hard refresh dei dati server-side per allineare anche
      // applications/status post-spawn Scrittore (futuro).
      startTransition(() => router.refresh());
    } catch (e) {
      setRequested(!next);
      setError(e instanceof Error ? e.message : "Errore di rete");
    }
  };

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason ?? "Non disponibile"}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold opacity-40 cursor-not-allowed"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-dim)",
        }}
      >
        Scrivi CV
      </button>
    );
  }

  const label = isPending
    ? requested
      ? "Richiesta inviata…"
      : "Annullando…"
    : requested
      ? "CV richiesto · annulla"
      : "Scrivi CV";

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
        {requested ? "✓" : "🖊"} {label}
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
