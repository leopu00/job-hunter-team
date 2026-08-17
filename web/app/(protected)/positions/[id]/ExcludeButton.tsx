"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { ReasonPicker } from "./ReasonPicker";
import { REASON_LABELS, type ReasonKey } from "./exclusion-reasons";

// Esclusione MANUALE dell'utente. Mette la posizione in 'excluded' con una causa
// scelta da dropdown (sei motivi + 'Altro' testo libero) → gli agenti smettono di
// ri-controllarne la liveness (esce da next-for-recheck). Reversibile.
// Vocabolario e selettore sono condivisi con il giudizio «Non interessante»
// (O-43): le etichette e l'ordine vivono in `exclusion-reasons.ts`.

const T: Record<
  Locale,
  {
    pickReason: string;
    writeReason: string;
    networkError: string;
    undoTitle: string;
    excludedByYou: string;
    undo: string;
    selectPlaceholder: string;
    excludeTitle: string;
    excluding: string;
    exclude: string;
  }
> = {
  it: {
    pickReason: "Scegli una causa",
    writeReason: "Scrivi la causa",
    networkError: "Errore di rete",
    undoTitle:
      "Annulla l'esclusione manuale (riporta la posizione allo stato precedente)",
    excludedByYou: "Esclusa da te",
    undo: "annulla",
    selectPlaceholder: "⊘ Escludi offerta…",
    excludeTitle: "Escludi manualmente questa offerta",
    excluding: "Escludo…",
    exclude: "Escludi",
  },
  en: {
    pickReason: "Pick a reason",
    writeReason: "Write the reason",
    networkError: "Network error",
    undoTitle:
      "Undo the manual exclusion (restores the position to its previous state)",
    excludedByYou: "Excluded by you",
    undo: "undo",
    selectPlaceholder: "⊘ Exclude position…",
    excludeTitle: "Manually exclude this position",
    excluding: "Excluding…",
    exclude: "Exclude",
  },
  es: {
    pickReason: "Elige un motivo",
    writeReason: "Escribe el motivo",
    networkError: "Error de red",
    undoTitle:
      "Deshacer la exclusión manual (restaura la posición a su estado anterior)",
    excludedByYou: "Excluida por ti",
    undo: "deshacer",
    selectPlaceholder: "⊘ Excluir posición…",
    excludeTitle: "Excluir manualmente esta posición",
    excluding: "Excluyendo…",
    exclude: "Excluir",
  },
  fr: {
    pickReason: "Choisissez un motif",
    writeReason: "Écrivez le motif",
    networkError: "Erreur réseau",
    undoTitle:
      "Annuler l'exclusion manuelle (rétablit le poste à son état précédent)",
    excludedByYou: "Exclu par vous",
    undo: "annuler",
    selectPlaceholder: "⊘ Exclure le poste…",
    excludeTitle: "Exclure manuellement ce poste",
    excluding: "Exclusion…",
    exclude: "Exclure",
  },
  de: {
    pickReason: "Grund auswählen",
    writeReason: "Grund eingeben",
    networkError: "Netzwerkfehler",
    undoTitle:
      "Manuelle Ausschließung rückgängig machen (stellt die Stelle in den vorherigen Zustand zurück)",
    excludedByYou: "Von dir ausgeschlossen",
    undo: "rückgängig",
    selectPlaceholder: "⊘ Stelle ausschließen…",
    excludeTitle: "Diese Stelle manuell ausschließen",
    excluding: "Wird ausgeschlossen…",
    exclude: "Ausschließen",
  },
  hu: {
    pickReason: "Válassz okot",
    writeReason: "Írd be az okot",
    networkError: "Hálózati hiba",
    undoTitle:
      "Kézi kizárás visszavonása (visszaállítja az állást a korábbi állapotba)",
    excludedByYou: "Általad kizárva",
    undo: "mégse",
    selectPlaceholder: "⊘ Állás kizárása…",
    excludeTitle: "Az állás kézi kizárása",
    excluding: "Kizárás…",
    exclude: "Kizárás",
  },
  pt: {
    pickReason: "Escolhe um motivo",
    writeReason: "Escreve o motivo",
    networkError: "Erro de rede",
    undoTitle:
      "Anular a exclusão manual (restaura a vaga ao seu estado anterior)",
    excludedByYou: "Excluída por ti",
    undo: "anular",
    selectPlaceholder: "⊘ Excluir vaga…",
    excludeTitle: "Excluir manualmente esta vaga",
    excluding: "Excluindo…",
    exclude: "Excluir",
  },
};

interface Props {
  legacyId: number;
  status: string;
  initialReason: string | null;
}

export function ExcludeButton({ legacyId, status, initialReason }: Props) {
  const locale = useLocale();
  const t = T[locale];
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
      setError(t.pickReason);
      return;
    }
    if (reason === "other" && !note.trim()) {
      setError(t.writeReason);
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
      setError(e instanceof Error ? e.message : t.networkError);
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
      setError(e instanceof Error ? e.message : t.networkError);
    }
    setBusy(false);
  };

  // Già esclusa da te → mostra la causa + annulla.
  if (isUserExcluded) {
    const reasonLabel =
      REASON_LABELS[locale][initialReason as ReasonKey] ?? initialReason;
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={busy || isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:opacity-60 disabled:cursor-wait"
          style={{ borderColor: red, color: red }}
          title={t.undoTitle}
        >
          ⊘ {t.excludedByYou} · {reasonLabel} — {t.undo}
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
        <ReasonPicker
          value={reason}
          onChange={setReason}
          note={note}
          onNoteChange={setNote}
          disabled={busy || isPending}
          placeholder={t.selectPlaceholder}
          selectTitle={t.excludeTitle}
        />
        {reason && (
          <button
            type="button"
            onClick={doExclude}
            disabled={busy || isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:opacity-60 disabled:cursor-wait"
            style={{ borderColor: red, color: red }}
          >
            {busy ? t.excluding : t.exclude}
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
