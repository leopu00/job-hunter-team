"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// Esclusione MANUALE dell'utente. Mette la posizione in 'excluded' con una causa
// scelta da dropdown (5 default + 'Altro' testo libero) → gli agenti smettono di
// ri-controllarne la liveness (esce da next-for-recheck). Reversibile.
// I CODICI (chiavi REASONS) sono il valore stabile nel DB; le label sono i18n.
type ReasonKey =
  | "closed"
  | "not_interested"
  | "already_applied"
  | "company"
  | "conditions"
  | "other";

const REASON_ORDER: ReasonKey[] = [
  "closed",
  "not_interested",
  "already_applied",
  "company",
  "conditions",
  "other",
];

const T: Record<
  Locale,
  {
    reasons: Record<ReasonKey, string>;
    pickReason: string;
    writeReason: string;
    networkError: string;
    undoTitle: string;
    excludedByYou: string;
    undo: string;
    selectPlaceholder: string;
    excludeTitle: string;
    notePlaceholder: string;
    excluding: string;
    exclude: string;
  }
> = {
  it: {
    reasons: {
      closed: "Chiusa / non più attiva",
      not_interested: "Non mi interessa",
      already_applied: "Già candidato / gestita altrove",
      company: "Azienda non desiderata",
      conditions: "Condizioni inadatte (stipendio/sede)",
      other: "Altro…",
    },
    pickReason: "Scegli una causa",
    writeReason: "Scrivi la causa",
    networkError: "Errore di rete",
    undoTitle:
      "Annulla l'esclusione manuale (riporta la posizione allo stato precedente)",
    excludedByYou: "Esclusa da te",
    undo: "annulla",
    selectPlaceholder: "⊘ Escludi offerta…",
    excludeTitle: "Escludi manualmente questa offerta",
    notePlaceholder: "Causa…",
    excluding: "Escludo…",
    exclude: "Escludi",
  },
  en: {
    reasons: {
      closed: "Closed / no longer active",
      not_interested: "Not interested",
      already_applied: "Already applied / handled elsewhere",
      company: "Unwanted company",
      conditions: "Unsuitable conditions (salary/location)",
      other: "Other…",
    },
    pickReason: "Pick a reason",
    writeReason: "Write the reason",
    networkError: "Network error",
    undoTitle:
      "Undo the manual exclusion (restores the position to its previous state)",
    excludedByYou: "Excluded by you",
    undo: "undo",
    selectPlaceholder: "⊘ Exclude position…",
    excludeTitle: "Manually exclude this position",
    notePlaceholder: "Reason…",
    excluding: "Excluding…",
    exclude: "Exclude",
  },
  es: {
    reasons: {
      closed: "Cerrada / ya no activa",
      not_interested: "No me interesa",
      already_applied: "Ya inscrito / gestionada en otro sitio",
      company: "Empresa no deseada",
      conditions: "Condiciones inadecuadas (salario/ubicación)",
      other: "Otro…",
    },
    pickReason: "Elige un motivo",
    writeReason: "Escribe el motivo",
    networkError: "Error de red",
    undoTitle:
      "Deshacer la exclusión manual (restaura la posición a su estado anterior)",
    excludedByYou: "Excluida por ti",
    undo: "deshacer",
    selectPlaceholder: "⊘ Excluir posición…",
    excludeTitle: "Excluir manualmente esta posición",
    notePlaceholder: "Motivo…",
    excluding: "Excluyendo…",
    exclude: "Excluir",
  },
  fr: {
    reasons: {
      closed: "Fermée / plus active",
      not_interested: "Pas intéressé",
      already_applied: "Déjà postulé / traité ailleurs",
      company: "Entreprise non souhaitée",
      conditions: "Conditions inadaptées (salaire/lieu)",
      other: "Autre…",
    },
    pickReason: "Choisissez un motif",
    writeReason: "Écrivez le motif",
    networkError: "Erreur réseau",
    undoTitle:
      "Annuler l'exclusion manuelle (rétablit le poste à son état précédent)",
    excludedByYou: "Exclu par vous",
    undo: "annuler",
    selectPlaceholder: "⊘ Exclure le poste…",
    excludeTitle: "Exclure manuellement ce poste",
    notePlaceholder: "Motif…",
    excluding: "Exclusion…",
    exclude: "Exclure",
  },
  de: {
    reasons: {
      closed: "Geschlossen / nicht mehr aktiv",
      not_interested: "Kein Interesse",
      already_applied: "Bereits beworben / anderweitig erledigt",
      company: "Unerwünschtes Unternehmen",
      conditions: "Ungeeignete Bedingungen (Gehalt/Standort)",
      other: "Sonstiges…",
    },
    pickReason: "Grund auswählen",
    writeReason: "Grund eingeben",
    networkError: "Netzwerkfehler",
    undoTitle:
      "Manuelle Ausschließung rückgängig machen (stellt die Stelle in den vorherigen Zustand zurück)",
    excludedByYou: "Von dir ausgeschlossen",
    undo: "rückgängig",
    selectPlaceholder: "⊘ Stelle ausschließen…",
    excludeTitle: "Diese Stelle manuell ausschließen",
    notePlaceholder: "Grund…",
    excluding: "Wird ausgeschlossen…",
    exclude: "Ausschließen",
  },
  hu: {
    reasons: {
      closed: "Lezárva / már nem aktív",
      not_interested: "Nem érdekel",
      already_applied: "Már jelentkeztem / máshol kezelve",
      company: "Nem kívánt cég",
      conditions: "Nem megfelelő feltételek (fizetés/helyszín)",
      other: "Egyéb…",
    },
    pickReason: "Válassz okot",
    writeReason: "Írd be az okot",
    networkError: "Hálózati hiba",
    undoTitle:
      "Kézi kizárás visszavonása (visszaállítja az állást a korábbi állapotba)",
    excludedByYou: "Általad kizárva",
    undo: "mégse",
    selectPlaceholder: "⊘ Állás kizárása…",
    excludeTitle: "Az állás kézi kizárása",
    notePlaceholder: "Ok…",
    excluding: "Kizárás…",
    exclude: "Kizárás",
  },
  pt: {
    reasons: {
      closed: "Fechada / já não ativa",
      not_interested: "Não tenho interesse",
      already_applied: "Já candidatado / tratado noutro lado",
      company: "Empresa indesejada",
      conditions: "Condições inadequadas (salário/local)",
      other: "Outro…",
    },
    pickReason: "Escolhe um motivo",
    writeReason: "Escreve o motivo",
    networkError: "Erro de rede",
    undoTitle:
      "Anular a exclusão manual (restaura a vaga ao seu estado anterior)",
    excludedByYou: "Excluída por ti",
    undo: "anular",
    selectPlaceholder: "⊘ Excluir vaga…",
    excludeTitle: "Excluir manualmente esta vaga",
    notePlaceholder: "Motivo…",
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
  const t = T[useLocale()];
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
      t.reasons[initialReason as ReasonKey] ?? initialReason;
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
          title={t.excludeTitle}
        >
          <option value="">{t.selectPlaceholder}</option>
          {REASON_ORDER.map((k) => (
            <option key={k} value={k}>
              {t.reasons[k]}
            </option>
          ))}
        </select>
        {reason === "other" && (
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t.notePlaceholder}
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
