"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import {
  IconCards,
  IconChat,
  IconCheckCircle,
  IconClock,
  IconEye,
  IconMic,
  IconPin,
  IconSkip,
  IconStar,
  IconStop,
  IconUndo,
  IconX,
} from "./icons";

// [JHT-POSITIONS-SWIPE-TRIAGE] Deck di carte per il triage rapido del
// backlog scored/ready. Non un like/nope binario: QUATTRO giudizi (scelta
// utente 18/07) mappati sui campi del mig 028 di position_feedback
// (score 1-5 + direction), più un commento libero opzionale che parte
// insieme al giudizio — scrivibile a tastiera o DETTATO a voce (Web
// Speech API del browser: su iOS è la dettatura Apple, niente backend;
// se non supportata il bottone microfono non compare). Gli swipe coprono
// gli estremi (sinistra = no assoluto, destra = molto interessante), i
// giudizi intermedi sono da bottone; tastiera 1-4 sul desktop, ⌫ = undo.
//
// Scritture — corsie ESISTENTI, nessuna route nuova:
//   ogni giudizio  → POST /api/positions/[legacyId]/feedback
//     (action + score + direction + comment: lo Scout consuma già la
//      direction per il pattern steering; lo score alimenta la visione
//      "Scorer re-score dai gusti reali")
//   'no' assoluto  → in più POST /api/positions/[legacyId]/user-exclude
//     (reason 'not_interested': status → excluded, il team ci smette di
//      lavorare; reversibile con DELETE — usato dall'undo)
// position_feedback è un event-log APPEND-ONLY: l'undo dei giudizi non-no
// ripristina solo la carta nella UI, la riga resta (l'ultimo giudizio
// prevale comunque nei consumatori "latest"). Ottimistico: la carta vola
// subito, le POST viaggiano dietro; su errore toast non bloccante.

export type SwipeCardData = {
  id: string;
  legacy_id: number;
  title: string;
  company: string;
  location: string | null;
  loc_city: string | null;
  loc_country: string | null;
  remote_type: "full_remote" | "hybrid" | "onsite" | null;
  role_family: string | null;
  source: string | null;
  found_at: string;
  score: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  jd_summary: string | null;
};

type Verdict = "no" | "review_low" | "review_ok" | "top";
// Lo skip NON è un giudizio: nessuna scrittura, la carta va in fondo al
// mazzo (e ricompare nei mazzi futuri finché non riceve un giudizio vero).
type HistoryAction = Verdict | "skip";

// Mappatura giudizio → payload feedback (mig 028). 'no' aggiunge anche
// l'esclusione. Score 3 lasciato libero come neutro non usato.
const VERDICTS: Record<
  Verdict,
  {
    Icon: (p: { size?: number }) => React.ReactElement;
    color: string;
    action: "like" | "dislike" | "star";
    score: number;
    direction: "more_like_this" | "less_like_this";
    exclude?: boolean;
    fly: -1 | 1;
  }
> = {
  no: {
    Icon: IconX,
    color: "var(--color-red)",
    action: "dislike",
    score: 1,
    direction: "less_like_this",
    exclude: true,
    fly: -1,
  },
  review_low: {
    Icon: IconClock,
    color: "var(--color-orange)",
    action: "dislike",
    score: 2,
    direction: "less_like_this",
    fly: -1,
  },
  review_ok: {
    Icon: IconEye,
    color: "var(--color-blue)",
    action: "like",
    score: 4,
    direction: "more_like_this",
    fly: 1,
  },
  top: {
    Icon: IconStar,
    color: "var(--color-green)",
    action: "star",
    score: 5,
    direction: "more_like_this",
    fly: 1,
  },
};

const VERDICT_ORDER: Verdict[] = ["no", "review_low", "review_ok", "top"];

// BCP-47 per la dettatura (SpeechRecognition.lang) dal locale dell'app.
const SPEECH_LANG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  hu: "hu-HU",
  es: "es-ES",
  de: "de-DE",
  fr: "fr-FR",
  pt: "pt-PT",
};

const T: Record<
  Locale,
  {
    title: string;
    subtitle: string;
    stampTop: string;
    stampNo: string;
    verdicts: Record<Verdict, string>;
    btnUndo: string;
    btnSkip: string;
    commentPh: string;
    commentClose: string;
    voiceStart: string;
    voiceStop: string;
    voiceListening: string;
    voiceError: string;
    voiceDenied: string;
    emptyTitle: string;
    emptySubtitle: string;
    allPositions: string;
    details: string;
    remote: Record<string, string>;
    saveError: string;
    hintKeys: string;
  }
> = {
  it: {
    title: "Swipe",
    subtitle: "Quattro giudizi + commento — il team impara i tuoi gusti",
    stampTop: "TOP",
    stampNo: "NO",
    verdicts: {
      no: "Assolutamente no",
      review_low: "Da rivedere, poco",
      review_ok: "Da rivedere, interessante",
      top: "Molto interessante",
    },
    btnUndo: "Annulla ultima",
    btnSkip: "Salta",
    commentPh: "Aggiungi un commento (facoltativo)…",
    commentClose: "Chiudi il commento",
    voiceStart: "Detta il commento",
    voiceStop: "Ferma la dettatura",
    voiceListening: "Ti ascolto…",
    voiceError: "Dettatura non disponibile su questo dispositivo",
    voiceDenied: "Permesso per il microfono negato — controlla le impostazioni del browser",
    emptyTitle: "Mazzo finito!",
    emptySubtitle: "Hai fatto il triage di tutte le posizioni in coda.",
    allPositions: "Tutte le posizioni",
    details: "Dettagli",
    remote: { full_remote: "Remoto", hybrid: "Ibrido", onsite: "In sede" },
    saveError: "Errore di rete — azione non salvata per",
    hintKeys: "Tastiera: 1–4 giudizio · ← no · → top · ↓ salta · ⌫ annulla",
  },
  en: {
    title: "Swipe",
    subtitle: "Four verdicts + a comment — your team learns your taste",
    stampTop: "TOP",
    stampNo: "NO",
    verdicts: {
      no: "Hard no",
      review_low: "Review later, meh",
      review_ok: "Review later, interested",
      top: "Very interesting",
    },
    btnUndo: "Undo last",
    btnSkip: "Skip",
    commentPh: "Add a comment (optional)…",
    commentClose: "Close the comment",
    voiceStart: "Dictate the comment",
    voiceStop: "Stop dictation",
    voiceListening: "Listening…",
    voiceError: "Dictation not available on this device",
    voiceDenied: "Microphone permission denied — check your browser settings",
    emptyTitle: "Deck finished!",
    emptySubtitle: "You triaged every queued position.",
    allPositions: "All positions",
    details: "Details",
    remote: { full_remote: "Remote", hybrid: "Hybrid", onsite: "On-site" },
    saveError: "Network error — action not saved for",
    hintKeys: "Keyboard: 1–4 verdict · ← no · → top · ↓ skip · ⌫ undo",
  },
  hu: {
    title: "Swipe",
    subtitle: "Négy ítélet + megjegyzés — a csapat tanulja az ízlésedet",
    stampTop: "TOP",
    stampNo: "NEM",
    verdicts: {
      no: "Biztosan nem",
      review_low: "Később, kevésbé érdekel",
      review_ok: "Később, érdekel",
      top: "Nagyon érdekes",
    },
    btnUndo: "Visszavonás",
    btnSkip: "Kihagyás",
    commentPh: "Megjegyzés hozzáadása (opcionális)…",
    commentClose: "Megjegyzés bezárása",
    voiceStart: "Megjegyzés diktálása",
    voiceStop: "Diktálás leállítása",
    voiceListening: "Hallgatlak…",
    voiceError: "A diktálás nem érhető el ezen az eszközön",
    voiceDenied: "Mikrofonengedély megtagadva — ellenőrizd a böngésző beállításait",
    emptyTitle: "A pakli elfogyott!",
    emptySubtitle: "Minden sorban álló állást átnéztél.",
    allPositions: "Összes állás",
    details: "Részletek",
    remote: { full_remote: "Távoli", hybrid: "Hibrid", onsite: "Helyszíni" },
    saveError: "Hálózati hiba — nem mentett művelet:",
    hintKeys: "Billentyűk: 1–4 ítélet · ← nem · → top · ↓ kihagyás · ⌫ visszavonás",
  },
  es: {
    title: "Swipe",
    subtitle: "Cuatro juicios + comentario — tu equipo aprende tus gustos",
    stampTop: "TOP",
    stampNo: "NO",
    verdicts: {
      no: "No, para nada",
      review_low: "Revisar, poco interés",
      review_ok: "Revisar, me interesa",
      top: "Muy interesante",
    },
    btnUndo: "Deshacer",
    btnSkip: "Omitir",
    commentPh: "Añade un comentario (opcional)…",
    commentClose: "Cerrar el comentario",
    voiceStart: "Dictar el comentario",
    voiceStop: "Detener el dictado",
    voiceListening: "Escuchando…",
    voiceError: "Dictado no disponible en este dispositivo",
    voiceDenied: "Permiso de micrófono denegado — revisa la configuración del navegador",
    emptyTitle: "¡Mazo terminado!",
    emptySubtitle: "Has revisado todas las posiciones en cola.",
    allPositions: "Todas las posiciones",
    details: "Detalles",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Error de red — acción no guardada para",
    hintKeys: "Teclado: 1–4 juicio · ← no · → top · ↓ omitir · ⌫ deshacer",
  },
  de: {
    title: "Swipe",
    subtitle: "Vier Urteile + Kommentar — dein Team lernt deinen Geschmack",
    stampTop: "TOP",
    stampNo: "NEIN",
    verdicts: {
      no: "Klares Nein",
      review_low: "Später ansehen, wenig",
      review_ok: "Später ansehen, interessant",
      top: "Sehr interessant",
    },
    btnUndo: "Rückgängig",
    btnSkip: "Überspringen",
    commentPh: "Kommentar hinzufügen (optional)…",
    commentClose: "Kommentar schließen",
    voiceStart: "Kommentar diktieren",
    voiceStop: "Diktat beenden",
    voiceListening: "Ich höre zu…",
    voiceError: "Diktat auf diesem Gerät nicht verfügbar",
    voiceDenied: "Mikrofonzugriff verweigert — prüfe die Browser-Einstellungen",
    emptyTitle: "Stapel geschafft!",
    emptySubtitle: "Du hast alle anstehenden Stellen durchgesehen.",
    allPositions: "Alle Stellen",
    details: "Details",
    remote: { full_remote: "Remote", hybrid: "Hybrid", onsite: "Vor Ort" },
    saveError: "Netzwerkfehler — Aktion nicht gespeichert für",
    hintKeys: "Tastatur: 1–4 Urteil · ← nein · → top · ↓ überspringen · ⌫ rückgängig",
  },
  fr: {
    title: "Swipe",
    subtitle: "Quatre avis + un commentaire — votre équipe apprend vos goûts",
    stampTop: "TOP",
    stampNo: "NON",
    verdicts: {
      no: "Non catégorique",
      review_low: "À revoir, peu d'intérêt",
      review_ok: "À revoir, intéressé",
      top: "Très intéressant",
    },
    btnUndo: "Annuler",
    btnSkip: "Passer",
    commentPh: "Ajouter un commentaire (facultatif)…",
    commentClose: "Fermer le commentaire",
    voiceStart: "Dicter le commentaire",
    voiceStop: "Arrêter la dictée",
    voiceListening: "Je vous écoute…",
    voiceError: "Dictée non disponible sur cet appareil",
    voiceDenied: "Autorisation du micro refusée — vérifiez les réglages du navigateur",
    emptyTitle: "Paquet terminé !",
    emptySubtitle: "Vous avez trié tous les postes en attente.",
    allPositions: "Tous les postes",
    details: "Détails",
    remote: { full_remote: "Télétravail", hybrid: "Hybride", onsite: "Sur site" },
    saveError: "Erreur réseau — action non enregistrée pour",
    hintKeys: "Clavier : 1–4 avis · ← non · → top · ↓ passer · ⌫ annuler",
  },
  pt: {
    title: "Swipe",
    subtitle: "Quatro julgamentos + comentário — sua equipe aprende seu gosto",
    stampTop: "TOP",
    stampNo: "NÃO",
    verdicts: {
      no: "Não mesmo",
      review_low: "Rever depois, pouco",
      review_ok: "Rever depois, interessa",
      top: "Muito interessante",
    },
    btnUndo: "Desfazer",
    btnSkip: "Pular",
    commentPh: "Adicione um comentário (opcional)…",
    commentClose: "Fechar o comentário",
    voiceStart: "Ditar o comentário",
    voiceStop: "Parar o ditado",
    voiceListening: "Ouvindo…",
    voiceError: "Ditado não disponível neste dispositivo",
    voiceDenied: "Permissão do microfone negada — verifique as configurações do navegador",
    emptyTitle: "Baralho concluído!",
    emptySubtitle: "Você triou todas as vagas na fila.",
    allPositions: "Todas as vagas",
    details: "Detalhes",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Erro de rede — ação não salva para",
    hintKeys: "Teclado: 1–4 julgamento · ← não · → top · ↓ pular · ⌫ desfazer",
  },
};

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF",
  HUF: "Ft",
};

function formatSalary(
  min: number | null,
  max: number | null,
  currency: string,
): string | null {
  if (min == null && max == null) return null;
  const sym = CURRENCY_SYMBOL[currency] ?? currency;
  const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
  if (min != null && max != null && min !== max)
    return `${sym} ${k(min)}–${k(max)}`;
  return `${sym} ${k((min ?? max)!)}`;
}

// jd_summary arriva in markdown leggero (grassetti, heading): sulla card lo
// mostriamo come testo piano — via marker, non vale un renderer completo.
function stripMd(s: string): string {
  return s
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

function scoreColor(score: number | null): string {
  if (score == null) return "var(--color-dim)";
  if (score >= 70) return "var(--color-green)";
  if (score >= 50) return "var(--color-yellow)";
  return "var(--color-muted)";
}

// Soglia di commit dello swipe (px orizzontali).
const SWIPE_THRESHOLD = 110;
// Durata dell'animazione di uscita — deve combaciare con la transition CSS.
const FLY_MS = 280;

export default function SwipeDeck({ cards }: { cards: SwipeCardData[] }) {
  const locale = useLocale();
  const t = T[locale] ?? T.en;

  const [deck, setDeck] = useState<SwipeCardData[]>(cards);
  const [history, setHistory] = useState<
    { card: SwipeCardData; verdict: HistoryAction }[]
  >([]);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [fly, setFly] = useState<{ x: number; y: number; rot: number } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const [recording, setRecording] = useState(false);
  const flyingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const total = cards.length;
  const done = total - deck.length;
  const counts = VERDICT_ORDER.map(
    (v) => [v, history.filter((h) => h.verdict === v).length] as const,
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Dettatura vocale (Web Speech API) ────────────────────────────
  // Feature-detect solo sul client (in SSR window non c'è: lo stato parte
  // false su entrambi i lati, niente hydration mismatch).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSpeechOk(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recRef.current?.stop();
  }, []);

  const stopVoice = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const startVoice = useCallback(() => {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onresult: ((e: unknown) => void) | null;
          onerror: ((e: unknown) => void) | null;
          onend: (() => void) | null;
          start: () => void;
          stop: () => void;
        })
      | undefined;
    if (!Ctor) return;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = SPEECH_LANG[locale] ?? "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    // La dettatura APPENDE al testo già presente (base congelata all'avvio).
    const base = comment.trim() ? comment.trim() + " " : "";
    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      setComment((base + text).slice(0, 2000));
    };
    rec.onerror = (e: unknown) => {
      setRecording(false);
      // 'no-speech'/'aborted' non sono errori (silenzio o stop manuale).
      // 'not-allowed' = permesso microfono; il resto = servizio assente
      // (es. il simulatore iOS non ha la dettatura Apple).
      const code = (e as { error?: string }).error;
      if (code === "no-speech" || code === "aborted") return;
      showToast(code === "not-allowed" ? t.voiceDenied : t.voiceError);
    };
    rec.onend = () => setRecording(false);
    setCommentOpen(true);
    setRecording(true);
    rec.start();
  }, [comment, locale, showToast, t.voiceDenied, t.voiceError]);

  const persist = useCallback(
    async (card: SwipeCardData, verdict: Verdict, note: string) => {
      const v = VERDICTS[verdict];
      try {
        const res = await fetch(`/api/positions/${card.legacy_id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: v.action,
            score: v.score,
            direction: v.direction,
            ...(note ? { comment: note } : {}),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        if (v.exclude) {
          const ex = await fetch(
            `/api/positions/${card.legacy_id}/user-exclude`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "not_interested" }),
            },
          );
          if (!ex.ok) throw new Error(String(ex.status));
        }
      } catch {
        showToast(`${t.saveError} «${card.title}»`);
      }
    },
    [showToast, t.saveError],
  );

  const commit = useCallback(
    (verdict: Verdict) => {
      if (flyingRef.current || deck.length === 0) return;
      flyingRef.current = true;
      stopVoice();
      const card = deck[0];
      const note = comment.trim().slice(0, 2000);
      const dir = VERDICTS[verdict].fly;
      const width = typeof window !== "undefined" ? window.innerWidth : 800;
      setFly({ x: dir * (width + 200), y: drag.dy, rot: dir * 22 });
      setTimeout(() => {
        setDeck((d) => d.slice(1));
        setHistory((h) => [...h, { card, verdict }]);
        setDrag({ dx: 0, dy: 0, dragging: false });
        setFly(null);
        setComment("");
        setCommentOpen(false);
        flyingRef.current = false;
      }, FLY_MS);
      void persist(card, verdict, note);
    },
    [deck, comment, drag.dy, persist, stopVoice],
  );

  // Skip: nessuna scrittura, la carta scivola in basso e va in fondo al
  // mazzo — la si rincontra a fine giro (e nei mazzi futuri).
  const skip = useCallback(() => {
    if (flyingRef.current || deck.length === 0) return;
    flyingRef.current = true;
    stopVoice();
    const card = deck[0];
    setFly({ x: 0, y: 700, rot: -3 });
    setTimeout(() => {
      setDeck((d) => [...d.slice(1), card]);
      setHistory((h) => [...h, { card, verdict: "skip" }]);
      setDrag({ dx: 0, dy: 0, dragging: false });
      setFly(null);
      flyingRef.current = false;
    }, FLY_MS);
  }, [deck, stopVoice]);

  const undo = useCallback(() => {
    if (flyingRef.current || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    // Dopo uno skip la carta sta in FONDO al mazzo: toglila da lì prima di
    // rimetterla in cima (altrimenti duplicata).
    setDeck((d) =>
      last.verdict === "skip"
        ? [last.card, ...d.slice(0, -1)]
        : [last.card, ...d],
    );
    // Solo l'esclusione del 'no' è reversibile lato server (DELETE
    // ripristina lo status). Le righe feedback sono event-log immutabile:
    // restano, e l'eventuale giudizio successivo prevale nei "latest".
    if (last.verdict !== "skip" && VERDICTS[last.verdict].exclude) {
      void fetch(`/api/positions/${last.card.legacy_id}/user-exclude`, {
        method: "DELETE",
      }).catch(() => showToast(`${t.saveError} «${last.card.title}»`));
    }
  }, [history, showToast, t.saveError]);

  // Tastiera per il desktop: 1-4 = giudizi, frecce = estremi, ⌫ = undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
      )
        return;
      const byDigit: Record<string, Verdict> = {
        "1": "no",
        "2": "review_low",
        "3": "review_ok",
        "4": "top",
      };
      if (byDigit[e.key]) commit(byDigit[e.key]);
      else if (e.key === "ArrowLeft") commit("no");
      else if (e.key === "ArrowRight") commit("top");
      else if (e.key === "ArrowDown") skip();
      else if (e.key === "Backspace") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, skip, undo]);

  // ── Gesture (pointer events: touch + mouse unificati) ────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (flyingRef.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0, dragging: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || flyingRef.current) return;
    setDrag({
      dx: e.clientX - startRef.current.x,
      dy: e.clientY - startRef.current.y,
      dragging: true,
    });
  };
  const onPointerUp = () => {
    if (!startRef.current) return;
    const { dx } = drag;
    startRef.current = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      commit(dx > 0 ? "top" : "no");
    } else {
      setDrag({ dx: 0, dy: 0, dragging: false });
    }
  };

  const topOpacity = Math.min(Math.max(drag.dx, 0) / 90, 1);
  const noOpacity = Math.min(Math.max(-drag.dx, 0) / 90, 1);

  return (
    <div className="max-w-md mx-auto select-none">
      {/* Pulse del microfono in registrazione */}
      <style>{`@keyframes swipe-rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>

      {/* Header */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1
            className="text-lg font-bold tracking-wide flex items-center gap-2"
            style={{ color: "var(--color-white)" }}
          >
            <span style={{ color: "var(--color-green)" }}>
              <IconCards size={18} />
            </span>
            {t.title}
          </h1>
          <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {t.subtitle}
          </p>
        </div>
        {total > 0 && (
          <span
            className="text-[11px] font-semibold tabular-nums"
            style={{ color: "var(--color-muted)" }}
          >
            {done}/{total}
          </span>
        )}
      </div>

      {/* Deck */}
      {deck.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-14 text-center"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-card)",
          }}
        >
          <div
            className="flex justify-center mb-3"
            style={{ color: "var(--color-green)" }}
          >
            <IconCheckCircle size={36} />
          </div>
          <div
            className="text-base font-bold mb-1"
            style={{ color: "var(--color-white)" }}
          >
            {t.emptyTitle}
          </div>
          <p className="text-[12px] mb-1" style={{ color: "var(--color-muted)" }}>
            {t.emptySubtitle}
          </p>
          {history.length > 0 && (
            <p
              className="text-[12px] font-semibold mb-4 flex items-center justify-center gap-4"
              style={{ color: "var(--color-base)" }}
            >
              {counts.map(([v, n]) => {
                const { Icon, color } = VERDICTS[v];
                return (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1"
                    style={{ color }}
                  >
                    <Icon size={13} /> {n}
                  </span>
                );
              })}
            </p>
          )}
          <Link
            href="/positions"
            className="inline-block text-[12px] font-semibold px-4 py-2 rounded no-underline"
            style={{
              background: "var(--color-row)",
              color: "var(--color-bright)",
              border: "1px solid var(--color-border)",
            }}
          >
            {t.allPositions} →
          </Link>
        </div>
      ) : (
        <>
          <div
            className="relative"
            style={{ height: "min(47dvh, 470px)", touchAction: "none" }}
          >
            {/* Le 3 carte in cima, dal fondo verso la cima dello stack */}
            {deck
              .slice(0, 3)
              .map((card, i) => {
                const isTop = i === 0;
                const transform = isTop
                  ? fly
                    ? `translate(${fly.x}px, ${fly.y}px) rotate(${fly.rot}deg)`
                    : `translate(${drag.dx}px, ${drag.dy * 0.4}px) rotate(${drag.dx * 0.06}deg)`
                  : `translateY(${i * 10}px) scale(${1 - i * 0.035})`;
                return (
                  <div
                    key={card.id}
                    className="absolute inset-0 rounded-xl border flex flex-col overflow-hidden"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-card)",
                      transform,
                      transition:
                        isTop && (fly || !drag.dragging)
                          ? `transform ${fly ? FLY_MS : 200}ms ease`
                          : isTop
                            ? "none"
                            : "transform 200ms ease",
                      zIndex: 10 - i,
                      cursor: isTop ? "grab" : "default",
                      boxShadow: isTop
                        ? "0 12px 32px rgba(0,0,0,0.35)"
                        : "none",
                    }}
                    onPointerDown={isTop ? onPointerDown : undefined}
                    onPointerMove={isTop ? onPointerMove : undefined}
                    onPointerUp={isTop ? onPointerUp : undefined}
                    onPointerCancel={isTop ? onPointerUp : undefined}
                  >
                    {/* Timbri TOP/NO sulla carta in cima */}
                    {isTop && (
                      <>
                        <div
                          className="absolute top-5 left-4 px-2 py-1 rounded border-2 text-sm font-black tracking-widest flex items-center gap-1.5"
                          style={{
                            color: "var(--color-green)",
                            borderColor: "var(--color-green)",
                            transform: "rotate(-14deg)",
                            opacity: topOpacity,
                            zIndex: 20,
                          }}
                        >
                          <IconStar size={14} filled /> {t.stampTop}
                        </div>
                        <div
                          className="absolute top-5 right-4 px-2 py-1 rounded border-2 text-sm font-black tracking-widest flex items-center gap-1.5"
                          style={{
                            color: "var(--color-red)",
                            borderColor: "var(--color-red)",
                            transform: "rotate(14deg)",
                            opacity: noOpacity,
                            zIndex: 20,
                          }}
                        >
                          <IconX size={14} /> {t.stampNo}
                        </div>
                      </>
                    )}

                    {/* Contenuto card */}
                    <div className="p-5 flex flex-col gap-3 flex-1 min-h-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className="text-[15px] font-bold leading-snug"
                            style={{
                              color: "var(--color-white)",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {card.title}
                          </div>
                          <div
                            className="text-[13px] font-semibold mt-0.5 truncate"
                            style={{ color: "var(--color-base)" }}
                          >
                            {card.company}
                          </div>
                        </div>
                        <div
                          className="shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center text-[14px] font-black tabular-nums"
                          style={{
                            color: scoreColor(card.score),
                            borderColor: scoreColor(card.score),
                          }}
                        >
                          {card.score ?? "—"}
                        </div>
                      </div>

                      {/* Meta chips */}
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        {(card.loc_city || card.loc_country || card.location) && (
                          <Chip>
                            <span className="inline-flex items-center gap-1">
                              <IconPin size={11} />
                              {card.loc_city
                                ? `${card.loc_city}${card.loc_country ? `, ${card.loc_country}` : ""}`
                                : (card.loc_country ?? card.location)}
                            </span>
                          </Chip>
                        )}
                        {card.remote_type && (
                          <Chip>{t.remote[card.remote_type] ?? card.remote_type}</Chip>
                        )}
                        {formatSalary(
                          card.salary_min,
                          card.salary_max,
                          card.salary_currency,
                        ) && (
                          <Chip color="var(--color-green)">
                            {formatSalary(
                              card.salary_min,
                              card.salary_max,
                              card.salary_currency,
                            )}
                          </Chip>
                        )}
                        {card.role_family && <Chip>{card.role_family}</Chip>}
                      </div>

                      {/* Sintesi JD */}
                      {card.jd_summary && (
                        <p
                          className="text-[12px] leading-relaxed flex-1 min-h-0"
                          style={{
                            color: "var(--color-base)",
                            display: "-webkit-box",
                            WebkitLineClamp: 8,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {stripMd(card.jd_summary)}
                        </p>
                      )}

                      {/* Footer */}
                      <div className="mt-auto flex items-center justify-between text-[11px]">
                        <span style={{ color: "var(--color-dim)" }}>
                          {card.source ?? ""}
                        </span>
                        <Link
                          href={`/positions/${card.id}`}
                          target="_blank"
                          className="font-semibold no-underline"
                          style={{ color: "var(--color-blue)" }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {t.details} ↗
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
              .reverse()}
          </div>

          {/* Commento opzionale (tastiera o dettatura): parte col prossimo
              giudizio. La riga ha ALTEZZA FISSA: da aperta, la box si
              espande VERSO L'ALTO come overlay sopra la card (position
              absolute ancorata al bottom) senza spostare il layout; la X
              nell'angolo la richiude alla riga compatta (testo conservato,
              mostrato troncato). */}
          <div className="mt-4 flex items-start gap-2">
            <div className="relative flex-1 min-w-0" style={{ height: 38 }}>
              {commentOpen ? (
                <div
                  className="absolute left-0 right-0 bottom-0 rounded-lg border"
                  style={{
                    borderColor: recording
                      ? "var(--color-red)"
                      : "var(--color-border)",
                    background: "var(--color-panel)",
                    zIndex: 30,
                    boxShadow: "0 -10px 28px rgba(0,0,0,0.4)",
                  }}
                >
                  <textarea
                    autoFocus
                    rows={5}
                    maxLength={2000}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={recording ? t.voiceListening : t.commentPh}
                    className="w-full rounded-lg px-3 py-2 pr-9 text-[12px] resize-none block"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--color-bright)",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    aria-label={t.commentClose}
                    title={t.commentClose}
                    onClick={() => setCommentOpen(false)}
                    className="absolute top-1.5 right-1.5 rounded-full border flex items-center justify-center"
                    style={{
                      width: 22,
                      height: 22,
                      color: "var(--color-muted)",
                      borderColor: "var(--color-border)",
                      background: "var(--color-card)",
                      cursor: "pointer",
                    }}
                  >
                    <IconX size={11} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCommentOpen(true)}
                  className="w-full h-full rounded-lg border px-3 text-[12px] text-left flex items-center gap-2"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "transparent",
                    color: comment
                      ? "var(--color-bright)"
                      : "var(--color-dim)",
                    cursor: "text",
                  }}
                >
                  <IconChat size={13} />
                  <span className="truncate">
                    {comment ? comment : t.commentPh}
                  </span>
                </button>
              )}
            </div>
            {speechOk && (
              <button
                type="button"
                aria-label={recording ? t.voiceStop : t.voiceStart}
                title={recording ? t.voiceStop : t.voiceStart}
                onClick={recording ? stopVoice : startVoice}
                className="shrink-0 rounded-lg border flex items-center justify-center"
                style={{
                  width: 38,
                  height: 38,
                  color: recording ? "var(--color-red)" : "var(--color-muted)",
                  borderColor: recording
                    ? "var(--color-red)"
                    : "var(--color-border)",
                  background: "var(--color-card)",
                  cursor: "pointer",
                  animation: recording
                    ? "swipe-rec-pulse 1.2s ease-in-out infinite"
                    : undefined,
                }}
              >
                {recording ? <IconStop size={16} /> : <IconMic size={16} />}
              </button>
            )}
          </div>

          {/* Bottoni giudizio + undo */}
          <div className="flex items-start justify-center gap-3 mt-4">
            {VERDICT_ORDER.slice(0, 2).map((v) => (
              <VerdictButton
                key={v}
                verdict={v}
                label={t.verdicts[v]}
                onClick={() => commit(v)}
              />
            ))}
            <div className="flex flex-col items-center gap-1">
              <ActionCircle
                label={t.btnUndo}
                color="var(--color-yellow)"
                size={40}
                disabled={history.length === 0}
                onClick={undo}
              >
                <IconUndo size={16} />
              </ActionCircle>
            </div>
            {VERDICT_ORDER.slice(2).map((v) => (
              <VerdictButton
                key={v}
                verdict={v}
                label={t.verdicts[v]}
                onClick={() => commit(v)}
              />
            ))}
          </div>

          {/* Skip: azione secondaria, nessun giudizio registrato */}
          <div className="flex justify-center mt-3">
            <button
              type="button"
              onClick={skip}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-semibold"
              style={{
                borderColor: "var(--color-border)",
                background: "transparent",
                color: "var(--color-muted)",
                cursor: "pointer",
              }}
            >
              {t.btnSkip}
              <IconSkip size={13} />
            </button>
          </div>

          <p
            className="hidden md:block text-center text-[10px] mt-3"
            style={{ color: "var(--color-dim)" }}
          >
            {t.hintKeys}
          </p>
        </>
      )}

      {/* Toast errori rete (non bloccante) */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-[12px] font-semibold max-w-[90vw] truncate"
          style={{
            background: "var(--color-panel)",
            color: "var(--color-red)",
            border: "1px solid var(--color-red)",
            zIndex: 100,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="px-2 py-0.5 rounded-full border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-row)",
        color: color ?? "var(--color-base)",
      }}
    >
      {children}
    </span>
  );
}

function VerdictButton({
  verdict,
  label,
  onClick,
}: {
  verdict: Verdict;
  label: string;
  onClick: () => void;
}) {
  const { Icon, color } = VERDICTS[verdict];
  return (
    <div className="flex flex-col items-center gap-1 w-[72px]">
      <ActionCircle label={label} color={color} size={52} onClick={onClick}>
        <Icon size={20} />
      </ActionCircle>
      <span
        className="text-[9px] font-semibold text-center leading-tight"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}

function ActionCircle({
  children,
  label,
  color,
  size,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  color: string;
  size: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border-2 flex items-center justify-center font-bold transition-transform active:scale-90"
      style={{
        width: size,
        height: size,
        color,
        borderColor: color,
        background: "var(--color-card)",
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
