"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applicationAckAccepted } from "@/lib/positions/application-ack";
import { useLocale } from "@/lib/use-locale";
import { intlTag } from "@/lib/locale-tag";
import type { Locale } from "@/i18n/config";
import {
  IconX,
  IconThumbsMeh,
  IconThumbsUp,
  IconStar,
} from "@/app/(protected)/swipe/icons";

// Giudizio a 4 livelli dalla pagina posizione — stessa semantica della
// pagina /swipe (event-log position_feedback, l'ultimo evento prevale):
//   no         → dislike/1/less_like_this (solo apprendimento futuro)
//   review_low → like/2 (keep con entusiasmo basso, NIENTE esclusione)
//   review_ok  → like/4/more_like_this
//   top        → star/5/more_like_this
// L'esclusione esplicita resta nell'azione ExcludeButton separata: i giudizi
// non mutano status/user_excluded_note della posizione che li riceve (O-76).
import {
  VERDICT_ORDER,
  VERDICT_SIGNAL,
  type Verdict,
  type VerdictSignal,
} from "@/lib/position-verdict";
export type { Verdict };

// Segnale (che cosa si spedisce) da lib/position-verdict; qui sopra solo
// icona e colore, che sono presentazione.
const VERDICTS: Record<
  Verdict,
  VerdictSignal & {
    Icon: (p: { size?: number }) => React.ReactElement;
    color: string;
  }
> = {
  no: { ...VERDICT_SIGNAL.no, Icon: IconX, color: "var(--color-red)" },
  review_low: {
    ...VERDICT_SIGNAL.review_low,
    Icon: IconThumbsMeh,
    color: "var(--color-orange)",
  },
  review_ok: {
    ...VERDICT_SIGNAL.review_ok,
    Icon: IconThumbsUp,
    color: "var(--color-blue)",
  },
  // Giallo oro: la stella è oro ovunque (21/07).
  top: { ...VERDICT_SIGNAL.top, Icon: IconStar, color: "var(--color-yellow)" },
};

const ORDER = VERDICT_ORDER;

const T: Record<
  Locale,
  {
    verdicts: Record<Verdict, string>;
    networkError: string;
    markApplied: string;
    markAppliedDone: string;
    markAppliedError: string;
    markAppliedUndoHint: string;
    markAppliedUndoError: string;
    markAppliedByTeam: string;
  }
> = {
  it: {
    verdicts: {
      no: "Non interessante",
      review_low: "Poco interessante",
      review_ok: "Interessante",
      top: "Molto interessante",
    },
    networkError: "Errore di rete",
    markApplied: "Mi sono candidato",
    markAppliedDone: "Candidatura segnata",
    markAppliedError:
      "Candidatura non registrata. Riprova tra poco e segnalalo se continua.",
    markAppliedUndoHint: "tocca per annullare",
    markAppliedUndoError: "Non è riuscito ad annullare la candidatura",
    markAppliedByTeam:
      "Questa candidatura l’ha inviata il team: da qui non si annulla",
  },
  en: {
    verdicts: {
      no: "Not interesting",
      review_low: "Slightly interesting",
      review_ok: "Interesting",
      top: "Very interesting",
    },
    networkError: "Network error",
    markApplied: "I applied myself",
    markAppliedDone: "Application recorded",
    markAppliedError:
      "Application not recorded. Try again shortly and report it if it continues.",
    markAppliedUndoHint: "tap to undo",
    markAppliedUndoError: "Could not undo the application",
    markAppliedByTeam:
      "The team sent this application: it cannot be undone from here",
  },
  hu: {
    verdicts: {
      no: "Nem érdekes",
      review_low: "Kevéssé érdekes",
      review_ok: "Érdekes",
      top: "Nagyon érdekes",
    },
    networkError: "Hálózati hiba",
    markApplied: "Jelentkeztem",
    markAppliedDone: "Jelentkezés rögzítve",
    markAppliedError:
      "A jelentkezés nincs rögzítve. Próbáld újra rövidesen, és jelezd, ha továbbra is fennáll.",
    markAppliedUndoHint: "koppints a visszavonáshoz",
    markAppliedUndoError: "A jelentkezést nem sikerült visszavonni",
    markAppliedByTeam:
      "Ezt a jelentkezést a csapat küldte: innen nem vonható vissza",
  },
  es: {
    verdicts: {
      no: "No interesante",
      review_low: "Poco interesante",
      review_ok: "Interesante",
      top: "Muy interesante",
    },
    networkError: "Error de red",
    markApplied: "Me he postulado",
    markAppliedDone: "Candidatura registrada",
    markAppliedError:
      "La candidatura no se ha registrado. Inténtalo de nuevo en breve y avisa si continúa.",
    markAppliedUndoHint: "toca para deshacer",
    markAppliedUndoError: "No se pudo deshacer la candidatura",
    markAppliedByTeam:
      "Esta candidatura la envió el equipo: no se puede deshacer desde aquí",
  },
  de: {
    verdicts: {
      no: "Uninteressant",
      review_low: "Wenig interessant",
      review_ok: "Interessant",
      top: "Sehr interessant",
    },
    networkError: "Netzwerkfehler",
    markApplied: "Ich habe mich beworben",
    markAppliedDone: "Bewerbung vermerkt",
    markAppliedError:
      "Bewerbung nicht registriert. Bitte gleich erneut versuchen und melden, wenn das Problem bleibt.",
    markAppliedUndoHint: "zum Rückgängigmachen tippen",
    markAppliedUndoError: "Bewerbung konnte nicht rückgängig gemacht werden",
    markAppliedByTeam:
      "Diese Bewerbung hat das Team gesendet: von hier nicht widerrufbar",
  },
  fr: {
    verdicts: {
      no: "Pas intéressant",
      review_low: "Peu intéressant",
      review_ok: "Intéressant",
      top: "Très intéressant",
    },
    networkError: "Erreur réseau",
    markApplied: "J'ai postulé moi-même",
    markAppliedDone: "Candidature enregistrée",
    markAppliedError:
      "Candidature non enregistrée. Réessayez dans un instant et signalez-le si le problème persiste.",
    markAppliedUndoHint: "touchez pour annuler",
    markAppliedUndoError: "Impossible d’annuler la candidature",
    markAppliedByTeam:
      "Cette candidature a été envoyée par l’équipe : impossible de l’annuler ici",
  },
  pt: {
    verdicts: {
      no: "Não interessante",
      review_low: "Pouco interessante",
      review_ok: "Interessante",
      top: "Muito interessante",
    },
    networkError: "Erro de rede",
    markApplied: "Candidatei-me",
    markAppliedDone: "Candidatura registada",
    markAppliedError:
      "Candidatura não registada. Tente novamente daqui a pouco e avise se continuar.",
    markAppliedUndoHint: "toque para anular",
    markAppliedUndoError: "Não foi possível anular a candidatura",
    markAppliedByTeam:
      "Esta candidatura foi enviada pela equipa: não se anula aqui",
  },
};

// Data + ora della candidatura, nello stesso formato della colonna in lista
// (`04/08, 13:13`): la richiesta era l'orario ESATTO, e le due superfici
// devono dire la stessa cosa nello stesso modo.
function formatAppliedAt(ts: string, locale: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(intlTag(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FeedbackButtons({
  legacyId,
  initialVerdict,
  initialApplied = false,
  initialAppliedAt = null,
}: {
  legacyId: number;
  initialVerdict: Verdict | null;
  /** La posizione risulta già candidata (dal team o dall'utente). */
  initialApplied?: boolean;
  /** Quando: l'ora esatta, non "candidata" e basta (O-25). */
  initialAppliedAt?: string | null;
}) {
  const locale = useLocale();
  const t = T[locale];
  // O-24: candidatura mandata a mano dall'utente. Stato separato dal giudizio
  // — non è un voto sull'offerta, è un fatto sul suo stato.
  const [applied, setApplied] = useState(initialApplied);
  const [appliedAt, setAppliedAt] = useState<string | null>(initialAppliedAt);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [verdict, setVerdict] = useState<Verdict | null>(initialVerdict);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const give = async (v: Verdict) => {
    if (busy) return false;
    const prev = verdict;
    setError(null);
    setBusy(true);
    setVerdict(v);
    const cfg = VERDICTS[v];
    try {
      const res = await fetch(`/api/positions/${legacyId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: cfg.action,
          score: cfg.score,
          ...(cfg.direction ? { direction: cfg.direction } : {}),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      startTransition(() => router.refresh());
      setBusy(false);
      return true;
    } catch (e) {
      setVerdict(prev);
      setError(
        e instanceof Error
          ? `${t.networkError} (${e.message})`
          : t.networkError,
      );
      setBusy(false);
      return false;
    }
  };

  // Ritira il voto attivo (riclick sul giudizio selezionato): evento
  // 'clear' nel log (mig 059) → in DB non resta nessuna label attiva.
  const postClear = () =>
    fetch(`/api/positions/${legacyId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });

  const clearVerdict = async () => {
    if (busy) return;
    const prev = verdict;
    setError(null);
    setBusy(true);
    setVerdict(null);
    try {
      const res = await postClear();
      if (!res.ok) throw new Error(String(res.status));
      startTransition(() => router.refresh());
    } catch (e) {
      setVerdict(prev);
      setError(
        e instanceof Error
          ? `${t.networkError} (${e.message})`
          : t.networkError,
      );
    }
    setBusy(false);
  };

  // Segna la candidatura come inviata dall'utente. Senza questo il team non
  // sa che la posizione è già andata: continua a scriverci sopra e a
  // riproporla, spendendo token su qualcosa di già fatto.
  async function markApplied() {
    setApplyError(null);
    setApplyPending(true);
    try {
      const res = await fetch(`/api/positions/${legacyId}/mark-applied`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(String(res.status));
      const saved = (await res.json().catch(() => null)) as {
        applied_at?: string | null;
        source?: "local" | "cloud";
        cloud_synced?: boolean | null;
      } | null;
      // A local write whose cloud mirror was not acknowledged is not a
      // confirmed click: keep the UI pending/error and never claim applied.
      if (!applicationAckAccepted(saved)) {
        throw new Error("cloud_sync_unconfirmed");
      }
      setApplied(true);
      // L'ora la decide chi scrive, non il browser: così quella mostrata è
      // quella registrata, anche a orologi disallineati.
      setAppliedAt(saved?.applied_at ?? null);
      router.refresh();
    } catch {
      setApplyError(t.markAppliedError);
    } finally {
      setApplyPending(false);
    }
  }

  // O-36 — l'inverso. Un click per sbaglio lasciava la posizione 'applied'
  // per sempre e il team smetteva di lavorarci: era più facile candidarsi
  // che disdirlo. Stessa forma di RecheckButton: una route, POST e DELETE.
  async function undoApplied() {
    setApplyError(null);
    try {
      const res = await fetch(`/api/positions/${legacyId}/mark-applied`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        // Il 409 non è un guasto: è il server che dice che annullare, ora,
        // direbbe una cosa falsa. I due casi si spiegano in modo diverso.
        if (body.error === "applied_by_team") {
          setApplyError(t.markAppliedByTeam);
          return;
        }
        if (body.error === "not_applied") {
          // Nel frattempo è cambiato qualcos'altro: la pagina si riallinea
          // al vero invece di discutere.
          router.refresh();
          return;
        }
        throw new Error(String(res.status));
      }
      setApplied(false);
      setAppliedAt(null);
      router.refresh();
    } catch {
      setApplyError(t.markAppliedUndoError);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {ORDER.map((v) => {
          const { Icon, color } = VERDICTS[v];
          const selected = verdict === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => {
                if (selected) {
                  // Riclick sul voto attivo = lo ritira (nessun giudizio).
                  void clearVerdict();
                } else {
                  void give(v);
                }
              }}
              disabled={busy}
              aria-pressed={selected}
              className="flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors disabled:opacity-60"
              style={{
                color,
                borderColor: selected ? color : "var(--color-border)",
                background: selected
                  ? `color-mix(in srgb, ${color} 12%, transparent)`
                  : "transparent",
              }}
            >
              <Icon size={20} />
              <span className="text-[9px] font-semibold leading-tight text-center text-[var(--color-muted)]">
                {t.verdicts[v]}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-[10px]" style={{ color: "var(--color-red)" }}>
          {error}
        </p>
      )}
      {/* Fuori dalla fila dei giudizi di proposito: non è un voto
          sull'offerta, è lo stato della candidatura. */}
      <button
        type="button"
        onClick={() => {
          void (applied ? undoApplied() : markApplied());
        }}
        disabled={busy || applyPending}
        aria-pressed={applied}
        className="mt-2 w-full rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-60"
        style={{
          color: applied ? "var(--color-green)" : "var(--color-muted)",
          borderColor: applied ? "var(--color-green)" : "var(--color-border)",
          background: applied
            ? "color-mix(in srgb, var(--color-green) 12%, transparent)"
            : "transparent",
        }}
      >
        {applied ? (
          <span className="flex flex-col items-center gap-0.5">
            <span>{`✓ ${t.markAppliedDone}${appliedAt ? ` · ${formatAppliedAt(appliedAt, locale)}` : ""}`}</span>
            {/* Che si possa tornare indietro va DETTO: un bottone già
                premuto, senza questa riga, si legge come definitivo — ed è
                esattamente come l'operatore c'è cascato. */}
            <span className="text-[9px] font-normal text-[var(--color-dim)]">
              {t.markAppliedUndoHint}
            </span>
          </span>
        ) : (
          t.markApplied
        )}
      </button>
      {applyError && (
        <p className="mt-2 text-[10px]" style={{ color: "var(--color-red)" }}>
          {applyError}
        </p>
      )}
    </div>
  );
}
