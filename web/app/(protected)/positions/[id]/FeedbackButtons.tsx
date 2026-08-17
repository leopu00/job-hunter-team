"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applicationAckAccepted } from "@/lib/positions/application-ack";
import { useLocale } from "@/lib/use-locale";
import { RejectionReasonPicker } from "./RejectionReasonPicker";
import { intlTag } from "@/lib/locale-tag";
import type { Locale } from "@/i18n/config";
import {
  IconX,
  IconThumbsMeh,
  IconThumbsUp,
  IconStar,
} from "@/app/(protected)/swipe/icons";
import { ReasonPicker } from "./ReasonPicker";
import {
  PICKER_T,
  isFactualReason,
  negativeSignalFor,
} from "./exclusion-reasons";
import {
  DECLARABLE_OUTCOMES,
  outcomeClickIntent,
  type DeclarableOutcome,
} from "@/lib/applications/outcome";

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
    whyNo: string;
    pickPlaceholder: string;
    hintTaste: string;
    hintFactual: string;
    confirmTaste: string;
    confirmFactual: string;
    cancel: string;
    networkError: string;
    markApplied: string;
    markAppliedDone: string;
    markAppliedError: string;
    markAppliedUndoHint: string;
    markAppliedUndoError: string;
    markAppliedByTeam: string;
    outcomeQuestion: string;
    outcomeRejected: string;
    outcomeInterview: string;
    outcomeUndoHint: string;
    outcomeError: string;
    outcomeUndoError: string;
    outcomeNotApplied: string;
  }
> = {
  it: {
    verdicts: {
      no: "Non interessante",
      review_low: "Poco interessante",
      review_ok: "Interessante",
      top: "Molto interessante",
    },
    whyNo: "Perché non ti interessa?",
    pickPlaceholder: "Scegli un motivo…",
    hintTaste: "Il team lo userà per cercarti offerte più adatte.",
    hintFactual:
      "La posizione esce dal giro e basta: una scaduta non dice cosa ti piace, quindi il team non impara niente da qui.",
    confirmTaste: "Salva",
    confirmFactual: "Escludi",
    cancel: "Annulla",
    networkError: "Errore di rete",
    markApplied: "Mi sono candidato",
    markAppliedDone: "Candidatura segnata",
    markAppliedError:
      "Candidatura non registrata. Riprova tra poco e segnalalo se continua.",
    markAppliedUndoHint: "tocca per annullare",
    markAppliedUndoError: "Non è riuscito ad annullare la candidatura",
    markAppliedByTeam:
      "Questa candidatura l’ha inviata il team: da qui non si annulla",
    outcomeQuestion: "Com’è andata?",
    outcomeRejected: "Respinta",
    outcomeInterview: "Vogliono un colloquio",
    outcomeUndoHint: "tocca di nuovo per annullare",
    outcomeError:
      "Esito non registrato. Riprova tra poco e segnalalo se continua.",
    outcomeUndoError: "Non è riuscito ad annullare l’esito",
    outcomeNotApplied: "Segna prima la candidatura come inviata",
  },
  en: {
    verdicts: {
      no: "Not interesting",
      review_low: "Slightly interesting",
      review_ok: "Interesting",
      top: "Very interesting",
    },
    whyNo: "Why is it not interesting?",
    pickPlaceholder: "Pick a reason…",
    hintTaste: "The team will use it to look for offers that fit you better.",
    hintFactual:
      "The position simply leaves the pipeline: an expired one says nothing about your taste, so the team learns nothing from this.",
    confirmTaste: "Save",
    confirmFactual: "Exclude",
    cancel: "Cancel",
    networkError: "Network error",
    markApplied: "I applied myself",
    markAppliedDone: "Application recorded",
    markAppliedError:
      "Application not recorded. Try again shortly and report it if it continues.",
    markAppliedUndoHint: "tap to undo",
    markAppliedUndoError: "Could not undo the application",
    markAppliedByTeam:
      "The team sent this application: it cannot be undone from here",
    outcomeQuestion: "How did it go?",
    outcomeRejected: "Rejected",
    outcomeInterview: "They want an interview",
    outcomeUndoHint: "tap again to undo",
    outcomeError:
      "Outcome not recorded. Try again shortly and report it if it continues.",
    outcomeUndoError: "Could not undo the outcome",
    outcomeNotApplied: "Mark the application as sent first",
  },
  hu: {
    verdicts: {
      no: "Nem érdekes",
      review_low: "Kevéssé érdekes",
      review_ok: "Érdekes",
      top: "Nagyon érdekes",
    },
    whyNo: "Miért nem érdekes?",
    pickPlaceholder: "Válassz okot…",
    hintTaste:
      "A csapat ezt használja majd, hogy hozzád jobban illő ajánlatokat keressen.",
    hintFactual:
      "Az állás egyszerűen kikerül a körből: egy lejárt hirdetés nem árul el semmit az ízlésedről, így a csapat nem tanul belőle.",
    confirmTaste: "Mentés",
    confirmFactual: "Kizárás",
    cancel: "Mégse",
    networkError: "Hálózati hiba",
    markApplied: "Jelentkeztem",
    markAppliedDone: "Jelentkezés rögzítve",
    markAppliedError:
      "A jelentkezés nincs rögzítve. Próbáld újra rövidesen, és jelezd, ha továbbra is fennáll.",
    markAppliedUndoHint: "koppints a visszavonáshoz",
    markAppliedUndoError: "A jelentkezést nem sikerült visszavonni",
    markAppliedByTeam:
      "Ezt a jelentkezést a csapat küldte: innen nem vonható vissza",
    outcomeQuestion: "Hogy sikerült?",
    outcomeRejected: "Elutasítva",
    outcomeInterview: "Interjúra hívtak",
    outcomeUndoHint: "koppints újra a visszavonáshoz",
    outcomeError:
      "Az eredményt nem sikerült rögzíteni. Próbáld újra hamarosan, és jelezd, ha továbbra is fennáll.",
    outcomeUndoError: "Nem sikerült visszavonni az eredményt",
    outcomeNotApplied: "Előbb jelöld elküldöttként a jelentkezést",
  },
  es: {
    verdicts: {
      no: "No interesante",
      review_low: "Poco interesante",
      review_ok: "Interesante",
      top: "Muy interesante",
    },
    whyNo: "¿Por qué no te interesa?",
    pickPlaceholder: "Elige un motivo…",
    hintTaste: "El equipo lo usará para buscarte ofertas que encajen mejor.",
    hintFactual:
      "La posición sale del circuito y ya está: una caducada no dice qué te gusta, así que el equipo no aprende nada de aquí.",
    confirmTaste: "Guardar",
    confirmFactual: "Excluir",
    cancel: "Cancelar",
    networkError: "Error de red",
    markApplied: "Me he postulado",
    markAppliedDone: "Candidatura registrada",
    markAppliedError:
      "La candidatura no se ha registrado. Inténtalo de nuevo en breve y avisa si continúa.",
    markAppliedUndoHint: "toca para deshacer",
    markAppliedUndoError: "No se pudo deshacer la candidatura",
    markAppliedByTeam:
      "Esta candidatura la envió el equipo: no se puede deshacer desde aquí",
    outcomeQuestion: "¿Cómo ha ido?",
    outcomeRejected: "Rechazada",
    outcomeInterview: "Quieren una entrevista",
    outcomeUndoHint: "toca otra vez para deshacer",
    outcomeError:
      "Resultado no registrado. Inténtalo de nuevo en un momento y avísanos si continúa.",
    outcomeUndoError: "No se pudo deshacer el resultado",
    outcomeNotApplied: "Marca antes la candidatura como enviada",
  },
  de: {
    verdicts: {
      no: "Uninteressant",
      review_low: "Wenig interessant",
      review_ok: "Interessant",
      top: "Sehr interessant",
    },
    whyNo: "Warum ist sie nicht interessant?",
    pickPlaceholder: "Grund auswählen…",
    hintTaste: "Das Team nutzt ihn, um passendere Stellen für dich zu suchen.",
    hintFactual:
      "Die Stelle fällt einfach aus dem Umlauf: Eine abgelaufene sagt nichts über deinen Geschmack, das Team lernt hier also nichts.",
    confirmTaste: "Speichern",
    confirmFactual: "Ausschließen",
    cancel: "Abbrechen",
    networkError: "Netzwerkfehler",
    markApplied: "Ich habe mich beworben",
    markAppliedDone: "Bewerbung vermerkt",
    markAppliedError:
      "Bewerbung nicht registriert. Bitte gleich erneut versuchen und melden, wenn das Problem bleibt.",
    markAppliedUndoHint: "zum Rückgängigmachen tippen",
    markAppliedUndoError: "Bewerbung konnte nicht rückgängig gemacht werden",
    markAppliedByTeam:
      "Diese Bewerbung hat das Team gesendet: von hier nicht widerrufbar",
    outcomeQuestion: "Wie ist es gelaufen?",
    outcomeRejected: "Abgelehnt",
    outcomeInterview: "Sie wollen ein Gespräch",
    outcomeUndoHint: "zum Rückgängigmachen erneut tippen",
    outcomeError:
      "Ergebnis nicht gespeichert. Versuch es gleich noch einmal und melde es, wenn es weiterhin auftritt.",
    outcomeUndoError: "Das Ergebnis konnte nicht rückgängig gemacht werden",
    outcomeNotApplied: "Markiere die Bewerbung zuerst als gesendet",
  },
  fr: {
    verdicts: {
      no: "Pas intéressant",
      review_low: "Peu intéressant",
      review_ok: "Intéressant",
      top: "Très intéressant",
    },
    whyNo: "Pourquoi ne vous intéresse-t-il pas ?",
    pickPlaceholder: "Choisissez un motif…",
    hintTaste:
      "L'équipe s'en servira pour chercher des offres qui vous vont mieux.",
    hintFactual:
      "Le poste sort simplement du circuit : une offre expirée ne dit rien de vos goûts, l'équipe n'apprend donc rien d'ici.",
    confirmTaste: "Enregistrer",
    confirmFactual: "Exclure",
    cancel: "Annuler",
    networkError: "Erreur réseau",
    markApplied: "J'ai postulé moi-même",
    markAppliedDone: "Candidature enregistrée",
    markAppliedError:
      "Candidature non enregistrée. Réessayez dans un instant et signalez-le si le problème persiste.",
    markAppliedUndoHint: "touchez pour annuler",
    markAppliedUndoError: "Impossible d’annuler la candidature",
    markAppliedByTeam:
      "Cette candidature a été envoyée par l’équipe : impossible de l’annuler ici",
    outcomeQuestion: "Comment ça s’est passé ?",
    outcomeRejected: "Refusée",
    outcomeInterview: "Ils veulent un entretien",
    outcomeUndoHint: "touche à nouveau pour annuler",
    outcomeError:
      "Résultat non enregistré. Réessaie dans un instant et signale-le si cela persiste.",
    outcomeUndoError: "Impossible d’annuler le résultat",
    outcomeNotApplied: "Marque d’abord la candidature comme envoyée",
  },
  pt: {
    verdicts: {
      no: "Não interessante",
      review_low: "Pouco interessante",
      review_ok: "Interessante",
      top: "Muito interessante",
    },
    whyNo: "Porque não te interessa?",
    pickPlaceholder: "Escolhe um motivo…",
    hintTaste:
      "A equipa vai usá-lo para procurar ofertas que te encaixem melhor.",
    hintFactual:
      "A vaga sai do circuito e pronto: uma vaga expirada não diz o que gostas, por isso a equipa não aprende nada daqui.",
    confirmTaste: "Guardar",
    confirmFactual: "Excluir",
    cancel: "Cancelar",
    networkError: "Erro de rede",
    markApplied: "Candidatei-me",
    markAppliedDone: "Candidatura registada",
    markAppliedError:
      "Candidatura não registada. Tente novamente daqui a pouco e avise se continuar.",
    markAppliedUndoHint: "toque para anular",
    markAppliedUndoError: "Não foi possível anular a candidatura",
    markAppliedByTeam:
      "Esta candidatura foi enviada pela equipa: não se anula aqui",
    outcomeQuestion: "Como correu?",
    outcomeRejected: "Rejeitada",
    outcomeInterview: "Querem uma entrevista",
    outcomeUndoHint: "toca outra vez para anular",
    outcomeError:
      "Resultado não registado. Tenta novamente daqui a pouco e comunica se continuar.",
    outcomeUndoError: "Não foi possível anular o resultado",
    outcomeNotApplied: "Marca primeiro a candidatura como enviada",
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
  initialOutcome = null,
  initialRejectionReason = null,
  initialRejectionNote = null,
}: {
  legacyId: number;
  initialVerdict: Verdict | null;
  /** La posizione risulta già candidata (dal team o dall'utente). */
  initialApplied?: boolean;
  /** Quando: l'ora esatta, non "candidata" e basta (O-25). */
  initialAppliedAt?: string | null;
  /** L'esito già dichiarato, se c'è (`applications.response`). */
  initialOutcome?: DeclarableOutcome | null;
  /** O-105: il perché del rifiuto, se l'utente l'ha già dato. */
  initialRejectionReason?: string | null;
  initialRejectionNote?: string | null;
}) {
  const locale = useLocale();
  const t = T[locale];
  const pickerT = PICKER_T[locale];
  // O-24: candidatura mandata a mano dall'utente. Stato separato dal giudizio
  // — non è un voto sull'offerta, è un fatto sul suo stato.
  const [applied, setApplied] = useState(initialApplied);
  const [appliedAt, setAppliedAt] = useState<string | null>(initialAppliedAt);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  // O-102: com'è andata. Compare solo a candidatura inviata, perché l'esito è
  // la progressione dell'invio e non uno stato alternativo.
  const [outcome, setOutcome] = useState<DeclarableOutcome | null>(
    initialOutcome,
  );
  // O-105: il perché. Due stati separati perché sono due campi separati — il
  // motivo si conta, il testo si legge — e uno non è mai il ripiego dell'altro.
  const [rejectionReason, setRejectionReason] = useState(
    initialRejectionReason ?? "",
  );
  const [rejectionNote, setRejectionNote] = useState(
    initialRejectionNote ?? "",
  );
  // Cosa risulta già scritto sul server: senza questo il bottone «Salva»
  // comparirebbe sempre, e comparire sempre è lo stesso che non dire niente.
  const [salvato, setSalvato] = useState({
    reason: initialRejectionReason ?? "",
    note: initialRejectionNote ?? "",
  });
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [outcomePending, setOutcomePending] =
    useState<DeclarableOutcome | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [verdict, setVerdict] = useState<Verdict | null>(initialVerdict);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // O-43 — «Non interessante» non scrive più niente al primo click: apre il
  // motivo. Finché questo pannello è aperto non è stato registrato nulla.
  const [askWhy, setAskWhy] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const factual = isFactualReason(reason);

  // `why` accompagna il giudizio negativo: `reason` è il codice del
  // vocabolario condiviso (lo stesso di `user_excluded_reason`), `comment` il
  // testo che l'utente ha scritto. Il Mentor raggruppa proprio quel testo
  // (pattern F), lo Scout legge la direction: senza motivo il segnale dice
  // «meno cose così» e basta, e non c'è modo di sapere di cosa parlasse.
  const give = async (
    v: Verdict,
    why?: { reason?: string; comment?: string },
  ) => {
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
          ...(why?.reason ? { reason: why.reason } : {}),
          ...(why?.comment ? { comment: why.comment } : {}),
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

  // Conferma del pannello «perché». Due strade, e la differenza è il punto
  // del ticket:
  //  · motivo FATTUALE (scaduta, già gestita) → non è un gusto. La posizione
  //    esce dal giro con la stessa route dell'esclusione manuale, e NESSUN
  //    `less_like_this` parte: `agents/scout/scout.md` deprioritizza azienda,
  //    famiglia di ruolo e località quando lo vede, e su una posizione ottima
  //    ma scaduta sarebbe la lezione sbagliata;
  //  · motivo di GUSTO → giudizio negativo come prima, ma con il motivo
  //    attaccato, così quello che arriva allo scoring dice anche di cosa
  //    parlava.
  const confirmWhy = async () => {
    if (busy) return;
    // La regola sta in `negativeSignalFor`, che è pura e testata: qui resta
    // solo l'esecuzione.
    const signal = negativeSignalFor(reason, note);
    if (signal.kind === "invalid") {
      setError(
        signal.missing === "reason" ? pickerT.pickReason : pickerT.writeReason,
      );
      return;
    }
    if (signal.kind === "exclude") {
      setError(null);
      setBusy(true);
      try {
        const res = await fetch(`/api/positions/${legacyId}/user-exclude`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: signal.reason,
            ...(signal.note ? { note: signal.note } : {}),
          }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          setError(b?.error ?? `HTTP ${res.status}`);
          setBusy(false);
          return;
        }
        closeWhy();
        startTransition(() => router.refresh());
      } catch (e) {
        setError(
          e instanceof Error
            ? `${t.networkError} (${e.message})`
            : t.networkError,
        );
      }
      setBusy(false);
      return;
    }
    const ok = await give("no", {
      reason: signal.reason,
      comment: signal.comment,
    });
    if (ok) closeWhy();
  };

  const closeWhy = () => {
    setAskWhy(false);
    setReason("");
    setNote("");
    setError(null);
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

  // O-102 — «respinta» / «vogliono un colloquio».
  //
  // Il campo `applications.response` esisteva da sempre e non lo scriveva
  // nessuno: il Mentor ci calcola sopra i suoi tassi e trovava una colonna
  // vuota. Un click qui è l'unico modo perché quel conto esista.
  //
  // Cliccare l'esito già attivo lo ANNULLA, come il bottone della candidatura:
  // l'utente che sbaglia bersaglio non deve restare inchiodato a una risposta
  // che non è arrivata.
  //
  // `soloIlMotivo` distingue le due cose che il bottone «Salva» e il pulsante
  // dell'esito chiedono alla stessa funzione. Senza, salvare il perché di un
  // rifiuto già dichiarato passerebbe per `outcome === value` e ANNULLEREBBE
  // il rifiuto: un utente che spiega perché l'hanno scartato si vedrebbe
  // cancellare il fatto che l'hanno scartato.
  async function declareOutcome(
    value: DeclarableOutcome,
    { soloIlMotivo = false }: { soloIlMotivo?: boolean } = {},
  ) {
    if (outcomePending) return;
    setOutcomeError(null);
    setOutcomePending(value);
    const intento = outcomeClickIntent({
      current: outcome,
      clicked: value,
      reasonOnly: soloIlMotivo,
    });
    const undoing = intento === "undo";
    try {
      const res = await fetch(`/api/positions/${legacyId}/outcome`, {
        method: undoing ? "DELETE" : "POST",
        ...(undoing
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                outcome: value,
                // Il perché viaggia solo col rifiuto: su un colloquio il
                // server lo rifiuterebbe, ed è giusto che lo faccia.
                ...(value === "rejected"
                  ? {
                      rejection_reason: rejectionReason || null,
                      rejection_note: rejectionNote.trim() || null,
                    }
                  : {}),
              }),
            }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // 409: il server dice che qui e ora la scrittura direbbe una cosa
        // falsa. Non è un guasto e non si racconta come tale.
        if (body.error === "not_applied") {
          setOutcomeError(t.outcomeNotApplied);
          return;
        }
        if (body.error === "no_outcome") {
          // Nel frattempo è cambiato altro: la pagina si riallinea al vero.
          router.refresh();
          return;
        }
        throw new Error(String(res.status));
      }
      const saved = (await res.json().catch(() => null)) as {
        response?: string | null;
        source?: "local" | "cloud";
        cloud_synced?: boolean | null;
      } | null;
      // Stessa regola della candidatura: una scrittura locale il cui mirror
      // cloud non è confermato NON è un click andato a buon fine.
      if (!applicationAckAccepted(saved)) {
        throw new Error("cloud_sync_unconfirmed");
      }
      setOutcome(undoing ? null : value);
      // Annullare, o correggere un rifiuto in colloquio, porta via anche il
      // perché — sul database lo fa la funzione, qui lo si fa vedere subito
      // invece di lasciare a schermo un motivo che non esiste più.
      if (undoing || value !== "rejected") {
        setRejectionReason("");
        setRejectionNote("");
      }
      setSalvato({ reason: rejectionReason, note: rejectionNote });
      router.refresh();
    } catch {
      setOutcomeError(undoing ? t.outcomeUndoError : t.outcomeError);
    } finally {
      setOutcomePending(null);
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
                } else if (v === "no") {
                  // Il solo giudizio che chiede il perché: è quello che
                  // insegna al team cosa evitare, e senza motivo insegnava
                  // la cosa sbagliata. Qui non parte ancora nessuna scrittura.
                  setError(null);
                  setAskWhy(true);
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
      {/* Il perché del «Non interessante». Finché è aperto non è stato
          scritto niente: si conferma o si annulla. */}
      {askWhy && (
        <div
          className="mt-2 rounded-lg border p-3 flex flex-col gap-2"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-panel)",
          }}
        >
          <p className="text-[11px] font-semibold text-[var(--color-base)]">
            {t.whyNo}
          </p>
          <ReasonPicker
            value={reason}
            onChange={(next) => {
              setReason(next);
              setError(null);
            }}
            note={note}
            onNoteChange={setNote}
            disabled={busy}
            placeholder={t.pickPlaceholder}
            className="flex flex-wrap items-center gap-1.5"
          />
          {/* Che cosa succede DAVVERO con questo motivo: sono due esiti
              diversi, e l'utente lo legge prima di confermare, non dopo. */}
          {reason && (
            <p className="text-[10px] leading-snug text-[var(--color-dim)]">
              {factual ? t.hintFactual : t.hintTaste}
            </p>
          )}
          {/* L'errore vive DENTRO il pannello: riguarda questa scelta, e
              fuori si leggeva come un guasto della fila dei giudizi. */}
          {error && (
            <p className="text-[10px]" style={{ color: "var(--color-red)" }}>
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void confirmWhy()}
              disabled={busy}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-60"
              style={{
                color: "var(--color-red)",
                borderColor: "var(--color-red)",
              }}
            >
              {factual ? t.confirmFactual : t.confirmTaste}
            </button>
            <button
              type="button"
              onClick={closeWhy}
              disabled={busy}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-60"
              style={{
                color: "var(--color-muted)",
                borderColor: "var(--color-border)",
              }}
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      {error && !askWhy && (
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
      {/* L'esito viene DOPO l'invio e solo dopo: prima non è una domanda che
          si può fare. Due pulsanti e non tre — «nessuna risposta» non si
          dichiara, lo deriva il Mentor dopo 30 giorni di silenzio. */}
      {applied && (
        <div
          className="mt-3 border-t pt-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p className="mb-1.5 text-[10px] text-[var(--color-dim)]">
            {t.outcomeQuestion}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DECLARABLE_OUTCOMES.map((value) => {
              const selected = outcome === value;
              const color =
                value === "interview"
                  ? "var(--color-green)"
                  : "var(--color-red)";
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => void declareOutcome(value)}
                  disabled={outcomePending !== null}
                  aria-pressed={selected}
                  className="rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-60"
                  style={{
                    color: selected ? color : "var(--color-muted)",
                    borderColor: selected ? color : "var(--color-border)",
                    background: selected
                      ? `color-mix(in srgb, ${color} 12%, transparent)`
                      : "transparent",
                  }}
                >
                  {value === "interview"
                    ? t.outcomeInterview
                    : t.outcomeRejected}
                </button>
              );
            })}
          </div>
          {/* Il perché (O-105) compare solo col rifiuto: su un colloquio non
              c'è una domanda a cui risponderebbe. Motivo e testo sono due
              campi ACCANTO, mai uno al posto dell'altro — la lista di oggi non
              copre «hanno preso un altro», e quel caso deve poter essere
              scritto senza inventarsi una categoria. */}
          {outcome === "rejected" && (
            <RejectionReasonPicker
              reason={rejectionReason}
              note={rejectionNote}
              onReasonChange={setRejectionReason}
              onNoteChange={setRejectionNote}
              onSave={() =>
                void declareOutcome("rejected", { soloIlMotivo: true })
              }
              disabled={outcomePending !== null}
              dirty={
                rejectionReason !== salvato.reason ||
                rejectionNote.trim() !== salvato.note.trim()
              }
            />
          )}
          {/* Che si possa tornare indietro va DETTO, come per la candidatura:
              un bottone già premuto, senza questa riga, si legge come
              definitivo. */}
          {outcome && (
            <p className="mt-1 text-center text-[9px] text-[var(--color-dim)]">
              {t.outcomeUndoHint}
            </p>
          )}
          {outcomeError && (
            <p
              className="mt-2 text-[10px]"
              style={{ color: "var(--color-red)" }}
            >
              {outcomeError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
