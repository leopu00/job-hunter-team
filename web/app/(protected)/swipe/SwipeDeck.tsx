"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import {
  IconCalendar,
  IconCards,
  IconChat,
  IconCheckCircle,
  IconChevronLeft,
  IconMic,
  IconPin,
  IconStar,
  IconStarHalf,
  IconStop,
  IconThumbsUp,
  IconX,
} from "./icons";

// [JHT-POSITIONS-SWIPE-TRIAGE] Sequenza di carte per il triage rapido del
// backlog scored/ready, in ORDINE DI ARRIVO (dalla trovata meno di recente
// alla più recente). QUATTRO livelli di interesse mappati sui campi del
// mig 028 di position_feedback (score 1-5 + direction), più un commento
// libero opzionale che parte insieme al giudizio — icona nel footer della
// card, input in un pop-up dedicato con dettatura vocale (Web Speech API).
//
// I GIUDIZI sono SOLO da bottone (tre dei quattro sono "verso destra",
// uno swipe destro sarebbe ambiguo). Lo SWIPE però esiste ed è la
// NAVIGAZIONE (scelta utente 19/07): trascina a sinistra = prossima
// card, a destra = precedente — nessuna scrittura, si sfoglia e basta
// (←/→ da tastiera). Una card già giudicata resta al suo posto col
// TIMBRO e si può ri-giudicare: il ri-giudizio scrive un nuovo evento
// feedback (append-only, l'ultimo prevale) e riconcilia l'esclusione
// (no→altro DELETE, altro→no POST).
//
// Scritture — corsie ESISTENTI, nessuna route nuova:
//   ogni giudizio      → POST /api/positions/[legacyId]/feedback
//   'non interessante' → in più POST /api/positions/[legacyId]/user-exclude
//     (reason 'not_interested': status → excluded, il team ci smette di
//      lavorare; reversibile con DELETE)
// Ottimistico: la carta vola subito, le POST viaggiano dietro; su errore
// toast non bloccante.

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
  found_at: string;
  score: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  jd_summary: string | null;
};

type Verdict = "no" | "review_low" | "review_ok" | "top";

// Mappatura giudizio → payload feedback (mig 028). 'no' aggiunge anche
// l'esclusione. Score 3 lasciato libero come neutro non usato. fly: solo
// 'no' esce a sinistra, gli altri tre a destra.
const VERDICTS: Record<
  Verdict,
  {
    Icon: (p: { size?: number }) => React.ReactElement;
    color: string;
    action: "like" | "dislike" | "star";
    score: number;
    direction: "more_like_this" | "less_like_this" | null;
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
  // 'Poco interessante' NON è un dislike (scelta utente 18/07): la
  // posizione resta tenuta (niente esclusione) e non manda un segnale
  // less_like_this allo Scout — è un keep con entusiasmo basso (score 2).
  // Icona: mezza stella ("interessante, ma poco"), non un pollice giù.
  review_low: {
    Icon: IconStarHalf,
    color: "var(--color-orange)",
    action: "like",
    score: 2,
    direction: null,
    fly: 1,
  },
  review_ok: {
    Icon: IconThumbsUp,
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
    verdicts: Record<Verdict, string>;
    btnPrev: string;
    commentPh: string;
    commentClose: string;
    commentTitle: string;
    commentDone: string;
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
    today: string;
    yesterday: string;
    daysAgo: string; // template con {n}
  }
> = {
  it: {
    title: "Swipe",
    verdicts: {
      no: "Non interessante",
      review_low: "Poco interessante",
      review_ok: "Interessante",
      top: "Molto interessante",
    },
    btnPrev: "Precedente",
    commentPh: "Aggiungi un commento (facoltativo)…",
    commentClose: "Chiudi il commento",
    commentTitle: "Commento",
    commentDone: "Fatto",
    voiceStart: "Detta il commento",
    voiceStop: "Ferma la dettatura",
    voiceListening: "Ti ascolto…",
    voiceError: "Dettatura non disponibile su questo dispositivo",
    voiceDenied:
      "Permesso per il microfono negato — controlla le impostazioni del browser",
    emptyTitle: "Mazzo finito!",
    emptySubtitle: "Hai fatto il triage di tutte le posizioni in coda.",
    allPositions: "Tutte le posizioni",
    details: "Dettagli",
    remote: { full_remote: "Remoto", hybrid: "Ibrido", onsite: "In sede" },
    saveError: "Errore di rete — azione non salvata per",
    hintKeys: "Tastiera: 1–4 giudizio · ←/→ naviga",
    today: "oggi",
    yesterday: "ieri",
    daysAgo: "{n} giorni fa",
  },
  en: {
    title: "Swipe",
    verdicts: {
      no: "Not interesting",
      review_low: "Slightly interesting",
      review_ok: "Interesting",
      top: "Very interesting",
    },
    btnPrev: "Previous",
    commentPh: "Add a comment (optional)…",
    commentClose: "Close the comment",
    commentTitle: "Comment",
    commentDone: "Done",
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
    hintKeys: "Keyboard: 1–4 verdict · ←/→ navigate",
    today: "today",
    yesterday: "yesterday",
    daysAgo: "{n} days ago",
  },
  hu: {
    title: "Swipe",
    verdicts: {
      no: "Nem érdekes",
      review_low: "Kevéssé érdekes",
      review_ok: "Érdekes",
      top: "Nagyon érdekes",
    },
    btnPrev: "Előző",
    commentPh: "Megjegyzés hozzáadása (opcionális)…",
    commentClose: "Megjegyzés bezárása",
    commentTitle: "Megjegyzés",
    commentDone: "Kész",
    voiceStart: "Megjegyzés diktálása",
    voiceStop: "Diktálás leállítása",
    voiceListening: "Hallgatlak…",
    voiceError: "A diktálás nem érhető el ezen az eszközön",
    voiceDenied:
      "Mikrofonengedély megtagadva — ellenőrizd a böngésző beállításait",
    emptyTitle: "A pakli elfogyott!",
    emptySubtitle: "Minden sorban álló állást átnéztél.",
    allPositions: "Összes állás",
    details: "Részletek",
    remote: { full_remote: "Távoli", hybrid: "Hibrid", onsite: "Helyszíni" },
    saveError: "Hálózati hiba — nem mentett művelet:",
    hintKeys: "Billentyűk: 1–4 ítélet · ←/→ navigálás",
    today: "ma",
    yesterday: "tegnap",
    daysAgo: "{n} napja",
  },
  es: {
    title: "Swipe",
    verdicts: {
      no: "No interesante",
      review_low: "Poco interesante",
      review_ok: "Interesante",
      top: "Muy interesante",
    },
    btnPrev: "Anterior",
    commentPh: "Añade un comentario (opcional)…",
    commentClose: "Cerrar el comentario",
    commentTitle: "Comentario",
    commentDone: "Hecho",
    voiceStart: "Dictar el comentario",
    voiceStop: "Detener el dictado",
    voiceListening: "Escuchando…",
    voiceError: "Dictado no disponible en este dispositivo",
    voiceDenied:
      "Permiso de micrófono denegado — revisa la configuración del navegador",
    emptyTitle: "¡Mazo terminado!",
    emptySubtitle: "Has revisado todas las posiciones en cola.",
    allPositions: "Todas las posiciones",
    details: "Detalles",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Error de red — acción no guardada para",
    hintKeys: "Teclado: 1–4 juicio · ←/→ navegar",
    today: "hoy",
    yesterday: "ayer",
    daysAgo: "hace {n} días",
  },
  de: {
    title: "Swipe",
    verdicts: {
      no: "Uninteressant",
      review_low: "Wenig interessant",
      review_ok: "Interessant",
      top: "Sehr interessant",
    },
    btnPrev: "Zurück",
    commentPh: "Kommentar hinzufügen (optional)…",
    commentClose: "Kommentar schließen",
    commentTitle: "Kommentar",
    commentDone: "Fertig",
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
    hintKeys: "Tastatur: 1–4 Urteil · ←/→ navigieren",
    today: "heute",
    yesterday: "gestern",
    daysAgo: "vor {n} Tagen",
  },
  fr: {
    title: "Swipe",
    verdicts: {
      no: "Pas intéressant",
      review_low: "Peu intéressant",
      review_ok: "Intéressant",
      top: "Très intéressant",
    },
    btnPrev: "Précédent",
    commentPh: "Ajouter un commentaire (facultatif)…",
    commentClose: "Fermer le commentaire",
    commentTitle: "Commentaire",
    commentDone: "Terminé",
    voiceStart: "Dicter le commentaire",
    voiceStop: "Arrêter la dictée",
    voiceListening: "Je vous écoute…",
    voiceError: "Dictée non disponible sur cet appareil",
    voiceDenied:
      "Autorisation du micro refusée — vérifiez les réglages du navigateur",
    emptyTitle: "Paquet terminé !",
    emptySubtitle: "Vous avez trié tous les postes en attente.",
    allPositions: "Tous les postes",
    details: "Détails",
    remote: {
      full_remote: "Télétravail",
      hybrid: "Hybride",
      onsite: "Sur site",
    },
    saveError: "Erreur réseau — action non enregistrée pour",
    hintKeys: "Clavier : 1–4 avis · ←/→ naviguer",
    today: "aujourd’hui",
    yesterday: "hier",
    daysAgo: "il y a {n} jours",
  },
  pt: {
    title: "Swipe",
    verdicts: {
      no: "Não interessante",
      review_low: "Pouco interessante",
      review_ok: "Interessante",
      top: "Muito interessante",
    },
    btnPrev: "Anterior",
    commentPh: "Adicione um comentário (opcional)…",
    commentClose: "Fechar o comentário",
    commentTitle: "Comentário",
    commentDone: "Concluído",
    voiceStart: "Ditar o comentário",
    voiceStop: "Parar o ditado",
    voiceListening: "Ouvindo…",
    voiceError: "Ditado não disponível neste dispositivo",
    voiceDenied:
      "Permissão do microfone negada — verifique as configurações do navegador",
    emptyTitle: "Baralho concluído!",
    emptySubtitle: "Você triou todas as vagas na fila.",
    allPositions: "Todas as vagas",
    details: "Detalhes",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Erro de rede — ação não salva para",
    hintKeys: "Teclado: 1–4 julgamento · ←/→ navegar",
    today: "hoje",
    yesterday: "ontem",
    daysAgo: "há {n} dias",
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

// Data di ritrovamento + conteggio giorni passati (scelta utente 19/07).
function foundInfo(
  iso: string,
  locale: string,
  t: { today: string; yesterday: string; daysAgo: string },
): { date: string; ago: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  }).format(d);
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
  const ago =
    days === 0
      ? t.today
      : days === 1
        ? t.yesterday
        : t.daysAgo.replace("{n}", String(days));
  return { date, ago };
}

// ── Impacchettamento chips (scelta utente 19/07) ─────────────────────
// Il flex-wrap ingenuo lasciava i tag grandi da soli su una riga (3 righe
// totali). Qui: larghezza stimata dal font mono (larghezza carattere
// costante) + first-fit decreasing sulle righe → i grandi si affiancano
// ai piccoli e di norma bastano 2 righe.
type ChipDef = {
  key: string;
  icon?: React.ReactElement;
  text: string;
  color?: string;
};

function buildChips(
  card: SwipeCardData,
  locale: string,
  t: (typeof T)["en"],
): ChipDef[] {
  const out: ChipDef[] = [];
  const loc = card.loc_city
    ? `${card.loc_city}${card.loc_country ? `, ${card.loc_country}` : ""}`
    : (card.loc_country ?? card.location);
  if (loc) out.push({ key: "loc", icon: <IconPin size={11} />, text: loc });
  if (card.remote_type)
    out.push({
      key: "remote",
      text: t.remote[card.remote_type] ?? card.remote_type,
    });
  const sal = formatSalary(
    card.salary_min,
    card.salary_max,
    card.salary_currency,
  );
  if (sal) out.push({ key: "sal", text: sal, color: "var(--color-green)" });
  if (card.role_family) out.push({ key: "role", text: card.role_family });
  const fi = foundInfo(card.found_at, locale, t);
  if (fi)
    out.push({
      key: "date",
      icon: <IconCalendar size={11} />,
      text: `${fi.date} · ${fi.ago}`,
    });
  return out;
}

// JetBrains Mono ~11px: avanzamento carattere ≈ 6.9px; 18 = padding+bordo,
// 15 = icona+gap.
function chipWidth(c: ChipDef): number {
  return 18 + (c.icon ? 15 : 0) + c.text.length * 6.9;
}

function packChips(defs: ChipDef[], maxW: number): ChipDef[][] {
  const GAP = 6;
  const sorted = [...defs].sort((a, b) => chipWidth(b) - chipWidth(a));
  const rows: { items: ChipDef[]; w: number }[] = [];
  for (const c of sorted) {
    const w = chipWidth(c);
    const row = rows.find((r) => r.w + GAP + w <= maxW);
    if (row) {
      row.items.push(c);
      row.w += GAP + w;
    } else {
      rows.push({ items: [c], w });
    }
  }
  return rows.map((r) => r.items);
}

// Durata dell'animazione di uscita — deve combaciare con la transition CSS.
const FLY_MS = 280;
// Trascinamento orizzontale oltre questa soglia = cambio card.
const NAV_THRESHOLD = 90;

export default function SwipeDeck({ cards }: { cards: SwipeCardData[] }) {
  const locale = useLocale();
  const t = T[locale] ?? T.en;

  // Sequenza fissa + indice: le card giudicate restano al loro posto (col
  // timbro) e ci si può tornare sopra per cambiare idea.
  const [idx, setIdx] = useState(0);
  const [given, setGiven] = useState<Record<string, Verdict>>({});
  const [chipAreaW, setChipAreaW] = useState(320);
  const [fly, setFly] = useState<{ x: number; rot: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const [recording, setRecording] = useState(false);
  const flyingRef = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Offset della pagina dall'alto del viewport (navbar + header, stabile).
  // L'altezza vera è poi calc(100dvh - offset): è il dvh CSS a inseguire
  // la barra di Safari, non i valori JS (innerHeight/visualViewport la
  // ignorano su iOS e i bottoni finivano sommersi).
  const [topOffset, setTopOffset] = useState<number | null>(null);
  // Mirror per i listener touch nativi (chiusure senza stato stantio).
  const navRef = useRef<(delta: 1 | -1) => void>(() => {});
  const dragXRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const total = cards.length;
  const finished = idx >= total;
  const counts = VERDICT_ORDER.map(
    (v) => [v, Object.values(given).filter((g) => g === v).length] as const,
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

  // Misure: larghezza utile chips (card - padding) e altezza disponibile
  // per l'intera colonna (viewport - top della pagina). visualViewport
  // copre il collasso della barra di Safari.
  useEffect(() => {
    const measure = () => {
      const w = deckRef.current?.clientWidth;
      if (w) setChipAreaW(w - 40);
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setTopOffset(Math.max(0, rect.top + window.scrollY) + 8);
    };
    measure();
    window.addEventListener("resize", measure);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
    };
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
      const ev = e as {
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      };
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

  // Scrive il giudizio; se la card era già stata giudicata riconcilia
  // l'esclusione con la transizione (no→altro: DELETE; altro→no: POST).
  const persist = useCallback(
    async (
      card: SwipeCardData,
      verdict: Verdict,
      prev: Verdict | undefined,
      note: string,
    ) => {
      const v = VERDICTS[verdict];
      try {
        const res = await fetch(`/api/positions/${card.legacy_id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: v.action,
            score: v.score,
            ...(v.direction ? { direction: v.direction } : {}),
            ...(note ? { comment: note } : {}),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const wasExcluded = prev ? Boolean(VERDICTS[prev].exclude) : false;
        if (v.exclude && !wasExcluded) {
          const ex = await fetch(
            `/api/positions/${card.legacy_id}/user-exclude`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "not_interested" }),
            },
          );
          if (!ex.ok) throw new Error(String(ex.status));
        } else if (!v.exclude && wasExcluded) {
          const ex = await fetch(
            `/api/positions/${card.legacy_id}/user-exclude`,
            { method: "DELETE" },
          );
          if (!ex.ok) throw new Error(String(ex.status));
        }
      } catch {
        showToast(`${t.saveError} «${card.title}»`);
      }
    },
    [showToast, t.saveError],
  );

  const judge = useCallback(
    (verdict: Verdict) => {
      if (flyingRef.current || finished) return;
      const card = cards[idx];
      const prev = given[card.id];
      flyingRef.current = true;
      stopVoice();
      const note = comment.trim().slice(0, 2000);
      const dir = VERDICTS[verdict].fly;
      const width = typeof window !== "undefined" ? window.innerWidth : 800;
      setFly({ x: dir * (width + 200), rot: dir * 22 });
      setTimeout(() => {
        setGiven((g) => ({ ...g, [card.id]: verdict }));
        setIdx((i) => i + 1);
        setFly(null);
        setDrag(0);
        setComment("");
        setCommentOpen(false);
        flyingRef.current = false;
      }, FLY_MS);
      // Se il giudizio non cambia, registra comunque l'evento (magari col
      // commento nuovo); la riconciliazione esclusione è un no-op.
      void persist(card, verdict, prev, note);
    },
    [cards, idx, given, finished, comment, persist, stopVoice],
  );

  // Navigazione: nessuna scrittura, si sfoglia e basta. delta = +1
  // (prossima, card esce a sinistra) o -1 (precedente, esce a destra).
  const nav = useCallback(
    (delta: 1 | -1) => {
      if (flyingRef.current) return;
      if (delta === 1 && finished) return;
      if (delta === -1 && idx === 0) return;
      flyingRef.current = true;
      stopVoice();
      const width = typeof window !== "undefined" ? window.innerWidth : 800;
      setFly({ x: -delta * (width + 100), rot: -delta * 8 });
      setTimeout(() => {
        setIdx((i) => i + delta);
        setFly(null);
        setDrag(0);
        setComment("");
        setCommentOpen(false);
        flyingRef.current = false;
      }, FLY_MS);
    },
    [finished, idx, stopVoice],
  );

  navRef.current = nav;

  // ── Swipe di NAVIGAZIONE ─────────────────────────────────────────
  // TOUCH: listener nativi non-passivi sul contenitore del mazzo con
  // DIRECTION-LOCK — l'area di testo della card è scrollabile e su iOS
  // WebKit si prende il gesto (la pagina "rubber-banda" invece di
  // swipare). Ai primi pixel decidiamo l'asse: verticale → il browser
  // scrolla il testo; orizzontale → preventDefault() (la pagina resta
  // ferma) e trasciniamo la card. Il MOUSE usa i pointer events sotto.
  useEffect(() => {
    const el = deckRef.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let axis: "h" | "v" | null = null;
    const onStart = (e: TouchEvent) => {
      if (flyingRef.current || e.touches.length !== 1) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      axis = null;
      dragXRef.current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || flyingRef.current) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
      if (axis === "h") {
        e.preventDefault();
        dragXRef.current = dx;
        setDrag(dx);
      }
    };
    const onEnd = () => {
      if (!start) return;
      const dx = dragXRef.current;
      const wasH = axis === "h";
      start = null;
      axis = null;
      dragXRef.current = 0;
      if (wasH && Math.abs(dx) > NAV_THRESHOLD) {
        navRef.current(dx < 0 ? 1 : -1);
        return;
      }
      if (wasH) setDrag(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return; // touch → listener nativi
    if (flyingRef.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (!dragStart.current || flyingRef.current) return;
    setDrag(e.clientX - dragStart.current.x);
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (!dragStart.current) return;
    dragStart.current = null;
    if (Math.abs(drag) > NAV_THRESHOLD) {
      // Trascino a sinistra → prossima; a destra → precedente.
      const delta = drag < 0 ? 1 : -1;
      if ((delta === 1 && !finished) || (delta === -1 && idx > 0)) {
        nav(delta);
        return;
      }
    }
    setDrag(0);
  };

  // Tastiera per il desktop: 1-4 = giudizi, ←/→ = precedente/prossima.
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
      if (byDigit[e.key]) judge(byDigit[e.key]);
      else if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "ArrowRight") nav(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judge, nav]);

  return (
    // overflowX clip: la carta in volo esce dal viewport — senza clip
    // allargherebbe la pagina orizzontalmente (il layout "scappa" di lato
    // su mobile, con l'intera schermata che si sposta). clip e non hidden:
    // niente nuovo contesto di scroll.
    <div
      ref={rootRef}
      className="max-w-md mx-auto select-none flex flex-col"
      style={{
        overflowX: "clip",
        height: `calc(100dvh - ${topOffset ?? 170}px)`,
        minHeight: 420,
      }}
    >
      {/* Pulse del microfono in registrazione */}
      <style>{`@keyframes swipe-rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>

      {/* Header minimo: una riga sola, la card vuole spazio */}
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-[13px] font-bold tracking-wide flex items-center gap-1.5"
          style={{ color: "var(--color-white)" }}
        >
          <span style={{ color: "var(--color-green)" }}>
            <IconCards size={14} />
          </span>
          {t.title}
        </span>
        {total > 0 && (
          <span
            className="text-[11px] font-semibold tabular-nums"
            style={{ color: "var(--color-muted)" }}
          >
            {Math.min(idx + 1, total)}/{total}
          </span>
        )}
      </div>

      {/* Fine sequenza (o mazzo vuoto) */}
      {finished ? (
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
          <p
            className="text-[12px] mb-1"
            style={{ color: "var(--color-muted)" }}
          >
            {t.emptySubtitle}
          </p>
          {Object.keys(given).length > 0 && (
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
          <div className="flex items-center justify-center gap-3">
            {total > 0 && (
              <button
                type="button"
                onClick={() => nav(-1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border text-[12px] font-semibold"
                style={{
                  borderColor: "var(--color-border)",
                  background: "transparent",
                  color: "var(--color-muted)",
                  cursor: "pointer",
                }}
              >
                <IconChevronLeft size={14} />
                {t.btnPrev}
              </button>
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
        </div>
      ) : (
        <>
          <div ref={deckRef} className="relative flex-1 min-h-0">
            {/* Card corrente + le 2 successive come stack */}
            {cards
              .slice(idx, idx + 3)
              .map((card, i) => {
                const isTop = i === 0;
                const verdictGiven = given[card.id];
                const transform = isTop
                  ? fly
                    ? `translate(${fly.x}px, 0) rotate(${fly.rot}deg)`
                    : drag
                      ? `translate(${drag}px, 0) rotate(${drag * 0.04}deg)`
                      : "none"
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
                        isTop && !fly && dragStart.current
                          ? "none"
                          : `transform ${isTop && fly ? FLY_MS : 200}ms ease`,
                      zIndex: 10 - i,
                      boxShadow: isTop
                        ? "0 12px 32px rgba(0,0,0,0.35)"
                        : "none",
                      touchAction: isTop ? "pan-y" : undefined,
                    }}
                    onPointerDown={isTop ? onPointerDown : undefined}
                    onPointerMove={isTop ? onPointerMove : undefined}
                    onPointerUp={isTop ? onPointerEnd : undefined}
                    onPointerCancel={isTop ? onPointerEnd : undefined}
                  >
                    {/* Timbro del giudizio già dato (ri-giudicabile) */}
                    {isTop && verdictGiven && (
                      <div
                        className="absolute top-3 right-3 px-2 py-1 rounded border-2 text-[10px] font-black tracking-widest flex items-center gap-1.5"
                        style={{
                          color: VERDICTS[verdictGiven].color,
                          borderColor: VERDICTS[verdictGiven].color,
                          background: "var(--color-card)",
                          transform: "rotate(6deg)",
                          zIndex: 20,
                          opacity: 0.95,
                        }}
                      >
                        {(() => {
                          const { Icon } = VERDICTS[verdictGiven];
                          return <Icon size={12} />;
                        })()}
                        {t.verdicts[verdictGiven].toUpperCase()}
                      </div>
                    )}

                    {/* Contenuto card */}
                    <div className="p-5 flex flex-col gap-3 flex-1 min-h-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {/* Titolo cliccabile = apre i dettagli (il vecchio
                              link «Dettagli» del footer non esiste più). */}
                          <Link
                            href={`/positions/${card.id}`}
                            target="_blank"
                            onPointerDown={(e) => e.stopPropagation()}
                            className="block text-[15px] font-bold leading-snug no-underline"
                            style={{
                              color: "var(--color-white)",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {card.title}
                          </Link>
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

                      {/* Meta chips: righe impacchettate (first-fit
                          decreasing) — i tag grandi affiancati ai piccoli
                          invece del wrap ingenuo su 3 righe. */}
                      <div className="flex flex-col gap-1.5 text-[11px] font-semibold">
                        {packChips(buildChips(card, locale, t), chipAreaW).map(
                          (row, ri) => (
                            <div key={ri} className="flex flex-wrap gap-1.5">
                              {row.map((c) => (
                                <Chip key={c.key} color={c.color}>
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                    {c.icon}
                                    {c.text}
                                  </span>
                                </Chip>
                              ))}
                            </div>
                          ),
                        )}
                      </div>

                      {/* Sintesi JD: scrollabile se non c'entra; pre-line
                          per rispettare gli accapi del testo originale. */}
                      {card.jd_summary && (
                        <div
                          className="text-[12px] leading-relaxed flex-1 min-h-0 overflow-y-auto pr-1"
                          style={{
                            color: "var(--color-base)",
                            whiteSpace: "pre-line",
                            overscrollBehavior: "contain",
                          }}
                        >
                          {stripMd(card.jd_summary)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
              .reverse()}
          </div>

          {/* Bottoni: 4 giudizi + commento (quinto posto, scelta utente
              19/07) */}
          <div className="shrink-0 flex items-start justify-center gap-2 mt-3">
            {VERDICT_ORDER.map((v) => (
              <VerdictButton
                key={v}
                verdict={v}
                label={t.verdicts[v]}
                onClick={() => judge(v)}
              />
            ))}
            <div className="flex flex-col items-center gap-1 w-[64px]">
              <button
                type="button"
                aria-label={t.commentTitle}
                title={t.commentTitle}
                onClick={() => setCommentOpen(true)}
                className="rounded-full border-2 flex items-center justify-center font-bold transition-transform active:scale-90 relative"
                style={{
                  width: 48,
                  height: 48,
                  color: comment ? "var(--color-bright)" : "var(--color-muted)",
                  borderColor: comment
                    ? "var(--color-bright)"
                    : "var(--color-muted)",
                  background: "var(--color-card)",
                  cursor: "pointer",
                }}
              >
                <IconChat size={18} />
                {comment && (
                  <span
                    className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full"
                    style={{ background: "var(--color-green)" }}
                  />
                )}
              </button>
              <span
                className="text-[9px] font-semibold text-center leading-tight"
                style={{ color: "var(--color-muted)" }}
              >
                {t.commentTitle}
              </span>
            </div>
          </div>

          <p
            className="hidden md:block text-center text-[10px] mt-2"
            style={{ color: "var(--color-dim)" }}
          >
            {t.hintKeys}
          </p>
        </>
      )}

      {/* Pop-up commento: finestra dedicata con textarea + dettatura.
          Chiudere (X, Fatto o tap sul fondo) conserva il testo — verrà
          inviato col prossimo giudizio. */}
      {commentOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center p-5"
          style={{ background: "rgba(0,0,0,0.55)", zIndex: 90 }}
          onClick={() => {
            stopVoice();
            setCommentOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl border p-4"
            style={{
              background: "var(--color-panel)",
              borderColor: recording
                ? "var(--color-red)"
                : "var(--color-border-glow)",
              boxShadow: "0 18px 48px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-[13px] font-bold flex items-center gap-2"
                style={{ color: "var(--color-white)" }}
              >
                <IconChat size={14} />
                {t.commentTitle}
              </span>
              <button
                type="button"
                aria-label={t.commentClose}
                title={t.commentClose}
                onClick={() => {
                  stopVoice();
                  setCommentOpen(false);
                }}
                className="rounded-full border flex items-center justify-center"
                style={{
                  width: 24,
                  height: 24,
                  color: "var(--color-muted)",
                  borderColor: "var(--color-border)",
                  background: "var(--color-card)",
                  cursor: "pointer",
                }}
              >
                <IconX size={12} />
              </button>
            </div>
            <textarea
              autoFocus
              rows={6}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={recording ? t.voiceListening : t.commentPh}
              className="w-full rounded-lg border px-3 py-2 text-[12px] resize-none block"
              style={{
                borderColor: recording
                  ? "var(--color-red)"
                  : "var(--color-border)",
                background: "var(--color-row)",
                color: "var(--color-bright)",
                outline: "none",
              }}
            />
            <div className="flex items-center justify-between mt-3">
              {speechOk ? (
                <button
                  type="button"
                  aria-label={recording ? t.voiceStop : t.voiceStart}
                  title={recording ? t.voiceStop : t.voiceStart}
                  onClick={recording ? stopVoice : startVoice}
                  className="rounded-lg border flex items-center justify-center"
                  style={{
                    width: 38,
                    height: 38,
                    color: recording
                      ? "var(--color-red)"
                      : "var(--color-muted)",
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
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => {
                  stopVoice();
                  setCommentOpen(false);
                }}
                className="px-4 py-2 rounded-lg text-[12px] font-bold"
                style={{
                  background: "var(--color-green)",
                  color: "#04170c",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {t.commentDone}
              </button>
            </div>
          </div>
        </div>
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
    <div className="flex flex-col items-center gap-1 w-[64px]">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className="rounded-full border-2 flex items-center justify-center font-bold transition-transform active:scale-90"
        style={{
          width: 48,
          height: 48,
          color,
          borderColor: color,
          background: "var(--color-card)",
          cursor: "pointer",
        }}
      >
        <Icon size={20} />
      </button>
      <span
        className="text-[9px] font-semibold text-center leading-tight"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}
