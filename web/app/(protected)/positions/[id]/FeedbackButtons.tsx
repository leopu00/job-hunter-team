"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
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
//   no         → "Escludi": popup con causa OBBLIGATORIA (regola 22/07:
//                mai un'esclusione senza motivo) → dislike/1 + esclusione
//   review_low → like/2 (keep con entusiasmo basso, NIENTE esclusione)
//   review_ok  → like/4/more_like_this
//   top        → star/5/more_like_this
// Il ri-giudizio riconcilia l'esclusione (no→altro: DELETE; altro→no: POST).
// Il popup è renderizzato in un PORTAL su document.body: la pagina ha
// un'animazione con transform che diventa containing block per i fixed —
// senza portal il popup si ancorava alla card, non al viewport (bug 22/07).
import {
  VERDICT_ORDER,
  VERDICT_SIGNAL,
  type Verdict,
  type VerdictSignal,
} from "@/lib/position-verdict";
export type { Verdict };

type ReasonKey =
  | "closed"
  | "not_interested"
  | "mismatch"
  | "company"
  | "conditions";

// 5 cause pronte, un tap e via; il motivo libero passa come 'other' + nota.
const REASON_ORDER: ReasonKey[] = [
  "not_interested",
  "mismatch",
  "conditions",
  "company",
  "closed",
];

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
    reasons: Record<ReasonKey, string>;
    popupTitle: string;
    customPlaceholder: string;
    cancel: string;
    confirm: string;
    removeExclusion: string;
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
      no: "Escludi",
      review_low: "Poco interessante",
      review_ok: "Interessante",
      top: "Molto interessante",
    },
    networkError: "Errore di rete",
    reasons: {
      closed: "Chiusa / non più attiva",
      not_interested: "Non mi interessa",
      mismatch: "Non in linea col mio profilo",
      company: "Azienda non desiderata",
      conditions: "Condizioni inadatte (stipendio/sede)",
    },
    popupTitle: "Perché escludi questa offerta?",
    customPlaceholder: "Oppure scrivi il motivo…",
    cancel: "Annulla",
    confirm: "Escludi",
    removeExclusion: "Annulla esclusione",
    markApplied: "Mi sono candidato",
    markAppliedDone: "Candidatura segnata",
    markAppliedError: "Non è riuscito a segnare la candidatura",
    markAppliedUndoHint: "tocca per annullare",
    markAppliedUndoError: "Non è riuscito ad annullare la candidatura",
    markAppliedByTeam:
      "Questa candidatura l’ha inviata il team: da qui non si annulla",
  },
  en: {
    verdicts: {
      no: "Exclude",
      review_low: "Slightly interesting",
      review_ok: "Interesting",
      top: "Very interesting",
    },
    networkError: "Network error",
    reasons: {
      closed: "Closed / no longer active",
      not_interested: "Not interested",
      mismatch: "Not a match for my profile",
      company: "Unwanted company",
      conditions: "Unsuitable conditions (salary/location)",
    },
    popupTitle: "Why are you excluding this offer?",
    customPlaceholder: "Or write the reason…",
    cancel: "Cancel",
    confirm: "Exclude",
    removeExclusion: "Remove exclusion",
    markApplied: "I applied myself",
    markAppliedDone: "Application recorded",
    markAppliedError: "Could not record the application",
    markAppliedUndoHint: "tap to undo",
    markAppliedUndoError: "Could not undo the application",
    markAppliedByTeam:
      "The team sent this application: it cannot be undone from here",
  },
  hu: {
    verdicts: {
      no: "Kizárás",
      review_low: "Kevéssé érdekes",
      review_ok: "Érdekes",
      top: "Nagyon érdekes",
    },
    networkError: "Hálózati hiba",
    reasons: {
      closed: "Lezárva / már nem aktív",
      not_interested: "Nem érdekel",
      mismatch: "Nem illik a profilomhoz",
      company: "Nem kívánt cég",
      conditions: "Nem megfelelő feltételek (fizetés/helyszín)",
    },
    popupTitle: "Miért zárod ki ezt az ajánlatot?",
    customPlaceholder: "Vagy írd le az okot…",
    cancel: "Mégse",
    confirm: "Kizárás",
    removeExclusion: "Kizárás visszavonása",
    markApplied: "Jelentkeztem",
    markAppliedDone: "Jelentkezés rögzítve",
    markAppliedError: "A jelentkezést nem sikerült rögzíteni",
    markAppliedUndoHint: "koppints a visszavonáshoz",
    markAppliedUndoError: "A jelentkezést nem sikerült visszavonni",
    markAppliedByTeam:
      "Ezt a jelentkezést a csapat küldte: innen nem vonható vissza",
  },
  es: {
    verdicts: {
      no: "Excluir",
      review_low: "Poco interesante",
      review_ok: "Interesante",
      top: "Muy interesante",
    },
    networkError: "Error de red",
    reasons: {
      closed: "Cerrada / ya no activa",
      not_interested: "No me interesa",
      mismatch: "No encaja con mi perfil",
      company: "Empresa no deseada",
      conditions: "Condiciones inadecuadas (salario/ubicación)",
    },
    popupTitle: "¿Por qué excluyes esta oferta?",
    customPlaceholder: "O escribe el motivo…",
    cancel: "Cancelar",
    confirm: "Excluir",
    removeExclusion: "Anular exclusión",
    markApplied: "Me he postulado",
    markAppliedDone: "Candidatura registrada",
    markAppliedError: "No se pudo registrar la candidatura",
    markAppliedUndoHint: "toca para deshacer",
    markAppliedUndoError: "No se pudo deshacer la candidatura",
    markAppliedByTeam:
      "Esta candidatura la envió el equipo: no se puede deshacer desde aquí",
  },
  de: {
    verdicts: {
      no: "Ausschließen",
      review_low: "Wenig interessant",
      review_ok: "Interessant",
      top: "Sehr interessant",
    },
    networkError: "Netzwerkfehler",
    reasons: {
      closed: "Geschlossen / nicht mehr aktiv",
      not_interested: "Kein Interesse",
      mismatch: "Passt nicht zu meinem Profil",
      company: "Unerwünschtes Unternehmen",
      conditions: "Ungeeignete Bedingungen (Gehalt/Standort)",
    },
    popupTitle: "Warum schließt du dieses Angebot aus?",
    customPlaceholder: "Oder schreib den Grund…",
    cancel: "Abbrechen",
    confirm: "Ausschließen",
    removeExclusion: "Ausschluss aufheben",
    markApplied: "Ich habe mich beworben",
    markAppliedDone: "Bewerbung vermerkt",
    markAppliedError: "Bewerbung konnte nicht vermerkt werden",
    markAppliedUndoHint: "zum Rückgängigmachen tippen",
    markAppliedUndoError: "Bewerbung konnte nicht rückgängig gemacht werden",
    markAppliedByTeam:
      "Diese Bewerbung hat das Team gesendet: von hier nicht widerrufbar",
  },
  fr: {
    verdicts: {
      no: "Exclure",
      review_low: "Peu intéressant",
      review_ok: "Intéressant",
      top: "Très intéressant",
    },
    networkError: "Erreur réseau",
    reasons: {
      closed: "Fermée / plus active",
      not_interested: "Pas intéressé",
      mismatch: "Pas adapté à mon profil",
      company: "Entreprise non souhaitée",
      conditions: "Conditions inadaptées (salaire/lieu)",
    },
    popupTitle: "Pourquoi excluez-vous cette offre ?",
    customPlaceholder: "Ou écrivez le motif…",
    cancel: "Annuler",
    confirm: "Exclure",
    removeExclusion: "Annuler l'exclusion",
    markApplied: "J'ai postulé moi-même",
    markAppliedDone: "Candidature enregistrée",
    markAppliedError: "Impossible d'enregistrer la candidature",
    markAppliedUndoHint: "touchez pour annuler",
    markAppliedUndoError: "Impossible d’annuler la candidature",
    markAppliedByTeam:
      "Cette candidature a été envoyée par l’équipe : impossible de l’annuler ici",
  },
  pt: {
    verdicts: {
      no: "Excluir",
      review_low: "Pouco interessante",
      review_ok: "Interessante",
      top: "Muito interessante",
    },
    networkError: "Erro de rede",
    reasons: {
      closed: "Fechada / já não ativa",
      not_interested: "Não tenho interesse",
      mismatch: "Não se adequa ao meu perfil",
      company: "Empresa indesejada",
      conditions: "Condições inadequadas (salário/local)",
    },
    popupTitle: "Porque excluis esta oferta?",
    customPlaceholder: "Ou escreve o motivo…",
    cancel: "Cancelar",
    confirm: "Excluir",
    removeExclusion: "Anular exclusão",
    markApplied: "Candidatei-me",
    markAppliedDone: "Candidatura registada",
    markAppliedError: "Não foi possível registar a candidatura",
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
  initialExcludedReason = null,
  initialExcludedNote = null,
  initialApplied = false,
  initialAppliedAt = null,
}: {
  legacyId: number;
  initialVerdict: Verdict | null;
  // Esclusione utente corrente (user_excluded_reason/note): serve al popup
  // per evidenziare la causa attiva e permettere il toggle-off.
  initialExcludedReason?: string | null;
  initialExcludedNote?: string | null;
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
  // Popup causa esclusione (pulsante "Escludi") — portal su body.
  const [popupOpen, setPopupOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [popupError, setPopupError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Causa/nota dell'esclusione ATTIVA (null = non esclusa dall'utente):
  // guida evidenziazione, toggle-off e "Annulla esclusione" nel popup.
  const [curReason, setCurReason] = useState<string | null>(
    initialExcludedReason,
  );
  const [curNote, setCurNote] = useState<string | null>(initialExcludedNote);

  const give = async (v: Verdict, excl?: { reason: string; note?: string }) => {
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
      const wasExcluded = prev ? Boolean(VERDICTS[prev].exclude) : false;
      if (cfg.exclude && excl) {
        // Sempre POST (anche se già esclusa): l'utente può correggere la causa.
        const ex = await fetch(`/api/positions/${legacyId}/user-exclude`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: excl.reason,
            ...(excl.note ? { note: excl.note } : {}),
          }),
        });
        if (!ex.ok) throw new Error(String(ex.status));
      } else if (!cfg.exclude && wasExcluded) {
        const ex = await fetch(`/api/positions/${legacyId}/user-exclude`, {
          method: "DELETE",
        });
        if (!ex.ok) throw new Error(String(ex.status));
      }
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

  const closePopup = () => {
    if (busy) return;
    setPopupOpen(false);
    setCustomText("");
    setPopupError(null);
  };

  // Un tap su una causa pronta = esclusione immediata.
  const excludeWithReason = async (reason: string, note?: string) => {
    setPopupError(null);
    const ok = await give("no", { reason, note });
    if (ok) {
      setCurReason(reason);
      setCurNote(note ?? null);
      setPopupOpen(false);
      setCustomText("");
    } else {
      setPopupError(t.networkError);
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

  // Toglie l'esclusione (tap sulla causa attiva o "Annulla esclusione"):
  // la posizione torna allo stato precedente e il giudizio si azzera
  // ANCHE nel log feedback (evento 'clear').
  const removeExclusion = async () => {
    if (busy) return;
    setPopupError(null);
    setBusy(true);
    try {
      const ex = await fetch(`/api/positions/${legacyId}/user-exclude`, {
        method: "DELETE",
      });
      if (!ex.ok) throw new Error(String(ex.status));
      const res = await postClear();
      if (!res.ok) throw new Error(String(res.status));
      setCurReason(null);
      setCurNote(null);
      setVerdict(null);
      setPopupOpen(false);
      setCustomText("");
      startTransition(() => router.refresh());
    } catch (e) {
      setPopupError(
        e instanceof Error
          ? `${t.networkError} (${e.message})`
          : t.networkError,
      );
    }
    setBusy(false);
  };

  const popup =
    popupOpen && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={closePopup}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t.popupTitle}
              className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[12px] font-semibold text-[var(--color-white)] mb-3">
                {t.popupTitle}
              </div>
              {/* Cause pronte: un tap esclude subito. La causa ATTIVA è
                  evidenziata e un tap su di lei ANNULLA l'esclusione. */}
              <div className="flex flex-col gap-1.5 mb-3">
                {REASON_ORDER.map((k) => {
                  const active = curReason === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={busy}
                      aria-pressed={active}
                      onClick={() =>
                        active
                          ? void removeExclusion()
                          : void excludeWithReason(k)
                      }
                      className="w-full rounded-lg border px-3 py-2 text-left text-[11px] font-medium transition-colors hover:border-[var(--color-red)] hover:text-[var(--color-red)] disabled:opacity-60"
                      style={
                        active
                          ? {
                              borderColor: "var(--color-red)",
                              color: "var(--color-red)",
                              background:
                                "color-mix(in srgb, var(--color-red) 10%, transparent)",
                            }
                          : {
                              borderColor: "var(--color-border)",
                              color: "var(--color-base)",
                            }
                      }
                    >
                      {t.reasons[k]}
                    </button>
                  );
                })}
              </div>
              {/* Motivo libero: testo → 'other' + nota. */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customText.trim())
                      void excludeWithReason("other", customText.trim());
                  }}
                  placeholder={t.customPlaceholder}
                  maxLength={200}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-[11px] text-[var(--color-base)] placeholder:text-[var(--color-dim)]"
                />
                <button
                  type="button"
                  disabled={busy || !customText.trim()}
                  onClick={() =>
                    void excludeWithReason("other", customText.trim())
                  }
                  className="shrink-0 rounded-lg border px-3.5 py-2 text-[11px] font-semibold transition-colors disabled:opacity-40"
                  style={{
                    borderColor: "var(--color-red)",
                    color: "var(--color-red)",
                    background:
                      "color-mix(in srgb, var(--color-red) 10%, transparent)",
                  }}
                >
                  {busy ? "…" : t.confirm}
                </button>
              </div>
              {popupError && (
                <p
                  className="mt-2 text-[10px]"
                  style={{ color: "var(--color-red)" }}
                >
                  {popupError}
                </p>
              )}
              <div className="mt-3 flex justify-between gap-2">
                {/* Già esclusa (anche con motivo personalizzato) → via
                    esplicita per togliere l'esclusione. */}
                {curReason ? (
                  <button
                    type="button"
                    onClick={() => void removeExclusion()}
                    disabled={busy}
                    className="rounded-lg border px-3.5 py-2 text-[11px] font-semibold transition-colors disabled:opacity-60"
                    style={{
                      borderColor: "var(--color-red)",
                      color: "var(--color-red)",
                    }}
                  >
                    {t.removeExclusion}
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={closePopup}
                  disabled={busy}
                  className="rounded-lg border border-[var(--color-border)] px-3.5 py-2 text-[11px] font-semibold text-[var(--color-muted)] transition-colors hover:bg-[var(--color-row)] disabled:opacity-60"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

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
      if (
        !saved ||
        (saved.source === "local" && saved.cloud_synced === false)
      ) {
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
                if (v === "no") {
                  // Esclusione: MAI senza causa → popup, non azione diretta.
                  // Motivo personalizzato attivo → prefill per correggerlo.
                  setPopupError(null);
                  setCustomText(curReason === "other" ? (curNote ?? "") : "");
                  setPopupOpen(true);
                } else if (selected) {
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
      {popup}
    </div>
  );
}
