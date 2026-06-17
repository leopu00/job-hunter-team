"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Esclusione MANUALE dell'utente. Mette la posizione in 'excluded' con una causa
// scelta da dropdown (5 default + 'Altro' testo libero) → gli agenti smettono di
// ri-controllarne la liveness (esce da next-for-recheck). Reversibile.
// Le label sono in italiano; i CODICI (chiavi) sono il valore stabile nel DB.
const REASONS: Record<string, string> = {
  closed: "Chiusa / non più attiva",
  not_interested: "Non mi interessa",
  already_applied: "Già candidato / gestita altrove",
  company: "Azienda non desiderata",
  conditions: "Condizioni inadatte (stipendio/sede)",
  other: "Altro…",
};

interface Props {
  legacyId: number;
  status: string;
  initialReason: string | null;
}

export function ExcludeButton({ legacyId, status, initialReason }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const isUserExcluded = !!initialReason;
  const red = "var(--color-red)";

  const post = async (body: object) => {
    const res = await fetch(`/api/positions/${legacyId}/user-exclude`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res;
  };

  const doExclude = async () => {
    setError(null);
    if (!reason) {
      setError("Scegli una causa");
      return;
    }
    if (reason === "other" && !note.trim()) {
      setError("Scrivi la causa");
      return;
    }
    setBusy(true);
    try {
      const res = await post({ reason, note: note.trim() || undefined });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di rete");
    }
    setBusy(false);
  };

  const undo = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/positions/${legacyId}/user-exclude`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di rete");
    }
    setBusy(false);
  };

  // Già esclusa da te → mostra la causa + annulla.
  if (isUserExcluded) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={busy || isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:opacity-60 disabled:cursor-wait"
          style={{ borderColor: red, color: red }}
          title="Annulla l'esclusione manuale (riporta la posizione allo stato precedente)"
        >
          ⊘ Esclusa da te · {REASONS[initialReason!] ?? initialReason} — annulla
        </button>
        {error && (
          <span className="text-[10px]" style={{ color: red }}>
            {error}
          </span>
        )}
      </div>
    );
  }

  // Esclusa dall'agente (status excluded ma non da utente): il banner notes
  // EXCLUDED:[TAG] spiega già il perché — niente controllo manuale qui.
  if (status === "excluded") return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy || isPending}
          className="px-2 py-2 rounded-lg border text-[11px] font-semibold disabled:opacity-60"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
            background: "var(--color-row)",
          }}
          title="Escludi manualmente questa offerta"
        >
          <option value="">⊘ Escludi offerta…</option>
          {Object.entries(REASONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {reason === "other" && (
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Causa…"
            disabled={busy || isPending}
            className="px-2 py-2 rounded-lg border text-[11px] w-40"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
              background: "var(--color-row)",
            }}
          />
        )}
        {reason && (
          <button
            type="button"
            onClick={doExclude}
            disabled={busy || isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:opacity-60 disabled:cursor-wait"
            style={{ borderColor: red, color: red }}
          >
            {busy ? "Escludo…" : "Escludi"}
          </button>
        )}
      </div>
      {error && (
        <span className="text-[10px]" style={{ color: red }}>
          {error}
        </span>
      )}
    </div>
  );
}
