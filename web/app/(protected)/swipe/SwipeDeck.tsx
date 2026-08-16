"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import { currencySymbol, formatMoneyCompact } from "@/lib/exchange-rates";
import { scoreSpectrumCss } from "@/lib/score-color";
import type { Locale } from "@/i18n/config";
import {
  IconBan,
  IconCalendar,
  IconCards,
  IconChat,
  IconCheckCircle,
  IconChevronLeft,
  IconFilter,
  IconMic,
  IconPin,
  IconStar,
  IconThumbsMeh,
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
// feedback (append-only, l'ultimo prevale).
//
// Scritture — corsie ESISTENTI, nessuna route nuova:
//   giudizio positivo   → POST /api/positions/[legacyId]/feedback
//   giudizio negativo   → prima il MOTIVO, poi feedback OPPURE user-exclude
// Ottimistico: la carta vola subito, le POST viaggiano dietro; su errore
// toast non bloccante.
//
// O-77 — il «non interessante» NON è più ottimistico, ed è voluto: era
// l'unico gesto che scriveva `less_like_this` senza sapere perché, e lo
// Scout con quel segnale deprioritizza azienda, famiglia di ruolo e località
// (`agents/scout/scout.md`). Su una posizione ottima ma SCADUTA è la lezione
// sbagliata. Un selettore PRIMA del gesto però rovinerebbe lo swipe rapido,
// quindi: la carta vola, il mazzo avanza, e SUBITO DOPO si chiede il motivo.
// Finché il pannello è aperto non è stato scritto niente — e se l'utente lo
// abbandona non resta niente, né riga né timbro (il timbro prometterebbe un
// giudizio che nel database non c'è).
//
// Il confine di O-76 resta, riformulato: un GIUDIZIO non toglie di mezzo la
// posizione. Ci arriva solo un MOTIVO fattuale (scaduta, già gestita) — e
// quella strada non emette nessun segnale di gusto. A decidere quale delle
// due è `negativeSignalFor`, la stessa funzione pura della pagina dettaglio.

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
  // true = importi convertiti nella valuta di visualizzazione (server-side,
  // vedi toCard in page.tsx): la chip li mostra con "≈".
  salary_converted?: boolean;
  jd_summary: string | null;
};

import {
  VERDICT_ORDER,
  VERDICT_SIGNAL,
  needsReason,
  type Verdict,
  type VerdictSignal,
} from "@/lib/position-verdict";
import { ReasonPicker } from "@/app/(protected)/positions/[id]/ReasonPicker";
import {
  PICKER_T,
  isFactualReason,
  negativeSignalFor,
} from "@/app/(protected)/positions/[id]/exclusion-reasons";
import { T } from "./SwipeDeck.i18n";
import { Chip, DualRange, FilterSection } from "./SwipeDeckParts";
export type { Verdict };

// Mappatura giudizio → payload feedback (mig 028). Score 3 lasciato libero
// come neutro non usato. fly: solo
// 'no' esce a sinistra, gli altri tre a destra.
// Segnale (che cosa si spedisce) da lib/position-verdict; qui sopra solo
// icona, colore e il lato da cui la card esce.
const VERDICTS: Record<
  Verdict,
  VerdictSignal & {
    Icon: (p: { size?: number }) => React.ReactElement;
    color: string;
    fly: -1 | 1;
  }
> = {
  no: { ...VERDICT_SIGNAL.no, Icon: IconX, color: "var(--color-red)", fly: -1 },
  // Icona: mezza stella ("interessante, ma poco"), non un pollice giù.
  review_low: {
    ...VERDICT_SIGNAL.review_low,
    Icon: IconThumbsMeh,
    color: "var(--color-orange)",
    fly: 1,
  },
  review_ok: {
    ...VERDICT_SIGNAL.review_ok,
    Icon: IconThumbsUp,
    color: "var(--color-blue)",
    fly: 1,
  },
  // Giallo oro (scelta utente 21/07): la stella "Molto interessante"
  // è oro ovunque, non verde.
  top: {
    ...VERDICT_SIGNAL.top,
    Icon: IconStar,
    color: "var(--color-yellow)",
    fly: 1,
  },
};

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

function formatSalary(
  min: number | null,
  max: number | null,
  currency: string,
  converted?: boolean,
): string | null {
  if (min == null && max == null) return null;
  // "≈" quando l'importo è stato convertito nella valuta di visualizzazione
  // (preferenza Impostazioni): non è il numero dell'annuncio.
  const pre = converted ? "≈ " : "";
  const sym = currencySymbol(currency).trim();
  const k = formatMoneyCompact;
  if (min != null && max != null && min !== max)
    return `${pre}${sym} ${k(min)}–${k(max)}`;
  return `${pre}${sym} ${k((min ?? max)!)}`;
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
  return scoreSpectrumCss(score);
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
    card.salary_converted,
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

// Valori distinti e ordinati, scartando vuoti e nulli. Non chiude su
// niente: sta fuori dal componente perché ricrearla a ogni render la
// rendeva una dipendenza instabile dei `useMemo` qui sotto, che infatti
// la omettevano dietro un `eslint-disable`.
const distinct = (vals: (string | null)[]) =>
  Array.from(new Set(vals.map((v) => (v ?? "").trim()).filter(Boolean))).sort();

export default function SwipeDeck({
  pending,
  reviewed,
  initialVerdicts,
  salaryAxisMaxK = 200,
}: {
  pending: SwipeCardData[];
  reviewed: SwipeCardData[];
  initialVerdicts: Record<string, Verdict>;
  // Tetto dell'asse stipendio (slider + istogramma) in MIGLIAIA della
  // valuta di visualizzazione: 200 va bene per EUR/USD/GBP, ma con la
  // preferenza valuta (es. HUF) la scala cambia — lo calcola il server
  // come equivalente di 200k EUR (vedi page.tsx).
  salaryAxisMaxK?: number;
}) {
  const locale = useLocale();
  const t = T[locale] ?? T.en;
  const pickerT = PICKER_T[locale] ?? PICKER_T.en;

  // Due mazzi (scelta utente 19/07): 'pending' = da giudicare (le già
  // recensite NON ricompaiono in sessione nuova), 'reviewed' = già
  // recensite col loro timbro, ri-giudicabili. Indice separato per mazzo.
  const [mode, setMode] = useState<"pending" | "reviewed">("pending");
  const [idxP, setIdxP] = useState(0);
  const [idxR, setIdxR] = useState(0);

  // ── Filtri (client-side, sul mazzo già caricato) ─────────────────
  // Stessa famiglia di filtri della pagina posizioni: range score, range
  // stipendio (in migliaia della valuta di visualizzazione — gli importi
  // arrivano già convertiti dal server), categorie, modalità. Con un
  // filtro attivo le card senza il dato corrispondente escono.
  const [filters, setFilters] = useState({
    sMin: 0,
    sMax: 100,
    salMin: 0,
    salMax: salaryAxisMaxK,
    fams: [] as string[],
    modes: [] as string[],
    countries: [] as string[],
    cities: [] as string[],
    sources: [] as string[],
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const filterActive =
    filters.sMin > 0 ||
    filters.sMax < 100 ||
    filters.salMin > 0 ||
    filters.salMax < salaryAxisMaxK ||
    filters.fams.length > 0 ||
    filters.modes.length > 0 ||
    filters.countries.length > 0 ||
    filters.cities.length > 0 ||
    filters.sources.length > 0;
  // Valori distinti per le chip (dal mazzo completo). Le città si
  // restringono ai paesi selezionati, come l'albero location di /positions.
  const deckForLists = mode === "pending" ? pending : reviewed;
  const countries = useMemo(
    () => distinct(deckForLists.map((c) => c.loc_country)),
    [deckForLists],
  );
  const cities = useMemo(
    () =>
      distinct(
        deckForLists
          .filter(
            (c) =>
              !filters.countries.length ||
              filters.countries.includes((c.loc_country ?? "").trim()),
          )
          .map((c) => c.loc_city),
      ),
    [deckForLists, filters.countries],
  );
  const sources = useMemo(
    () => distinct(deckForLists.map((c) => c.source)),
    [deckForLists],
  );
  const families = useMemo(
    () =>
      Array.from(
        new Set(
          deckForLists.map((c) => (c.role_family ?? "").trim()).filter(Boolean),
        ),
      ).sort(),
    [deckForLists],
  );
  // skip = criterio da ignorare: serve a istogrammi e contatori chip, che
  // mostrano il PROPRIO asse con gli ALTRI filtri applicati (stile Airbnb).
  const matches = useCallback(
    (
      c: SwipeCardData,
      skip?:
        | "score"
        | "salary"
        | "fams"
        | "modes"
        | "countries"
        | "cities"
        | "sources",
    ) => {
      if (skip !== "score" && (filters.sMin > 0 || filters.sMax < 100)) {
        if (c.score == null || c.score < filters.sMin || c.score > filters.sMax)
          return false;
      }
      if (
        skip !== "salary" &&
        (filters.salMin > 0 || filters.salMax < salaryAxisMaxK)
      ) {
        const lo = c.salary_min ?? c.salary_max;
        const hi = c.salary_max ?? c.salary_min;
        if (lo == null || hi == null) return false;
        if (hi / 1000 < filters.salMin || lo / 1000 > filters.salMax)
          return false;
      }
      if (
        skip !== "fams" &&
        filters.fams.length &&
        !filters.fams.includes((c.role_family ?? "").trim())
      )
        return false;
      if (
        skip !== "modes" &&
        filters.modes.length &&
        !filters.modes.includes(c.remote_type ?? "")
      )
        return false;
      if (
        skip !== "countries" &&
        filters.countries.length &&
        !filters.countries.includes((c.loc_country ?? "").trim())
      )
        return false;
      if (
        skip !== "cities" &&
        filters.cities.length &&
        !filters.cities.includes((c.loc_city ?? "").trim())
      )
        return false;
      if (
        skip !== "sources" &&
        filters.sources.length &&
        !filters.sources.includes((c.source ?? "").trim())
      )
        return false;
      return true;
    },
    [filters, salaryAxisMaxK],
  );
  const fPending = useMemo(
    () => pending.filter((c) => matches(c)),
    [pending, matches],
  );
  const fReviewed = useMemo(
    () => reviewed.filter((c) => matches(c)),
    [reviewed, matches],
  );
  // Istogrammi dei filtri (bin = step degli slider) sul mazzo corrente.
  const histoBase = mode === "pending" ? pending : reviewed;
  const scoreHisto = useMemo(() => {
    const bins = new Array(20).fill(0) as number[];
    for (const c of histoBase) {
      if (c.score == null || !matches(c, "score")) continue;
      bins[Math.min(19, Math.floor(c.score / 5))]++;
    }
    return bins;
  }, [histoBase, matches]);
  // Conteggi per chip: quante card del mazzo corrente (con gli ALTRI
  // filtri applicati) hanno quel valore.
  const countBy = useCallback(
    (
      get: (c: SwipeCardData) => string | null,
      skip: "fams" | "modes" | "countries" | "cities" | "sources",
    ) => {
      const m = new Map<string, number>();
      for (const c of histoBase) {
        if (!matches(c, skip)) continue;
        const k = (get(c) ?? "").trim();
        if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    },
    [histoBase, matches],
  );
  const famCounts = useMemo(
    () => countBy((c) => c.role_family, "fams"),
    [countBy],
  );
  const modeCounts = useMemo(
    () => countBy((c) => c.remote_type, "modes"),
    [countBy],
  );
  const countryCounts = useMemo(
    () => countBy((c) => c.loc_country, "countries"),
    [countBy],
  );
  const cityCounts = useMemo(
    () => countBy((c) => c.loc_city, "cities"),
    [countBy],
  );
  const sourceCounts = useMemo(
    () => countBy((c) => c.source, "sources"),
    [countBy],
  );
  // Ordinamento del mazzo. shuffleNonce: rimescolare = ricliccare la chip;
  // il seed tiene il mazzo stabile tra i render (niente Math.random in render).
  const [sortMode, setSortMode] = useState<
    "oldest" | "newest" | "score_desc" | "score_asc" | "salary_desc" | "shuffle"
  >("oldest");
  const [shuffleNonce, setShuffleNonce] = useState(1);
  // Sintesi JD on-demand (il deck arriva senza testi, vedi getSwipeDecks):
  // cache per id + set richieste in volo. null = fetch fatta, nessun testo.
  const [summaries, setSummaries] = useState<Record<string, string | null>>({});
  const summaryInflight = useRef<Set<string>>(new Set());
  // Sezioni collassabili: slider aperti di default, chip chiuse.
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({
    score: true,
    salary: true,
  });
  const toggleSec = (k: string) =>
    setOpenSecs((o) => ({ ...o, [k]: !(o[k] ?? false) }));
  const salHisto = useMemo(() => {
    const bins = new Array(40).fill(0) as number[];
    const binK = salaryAxisMaxK / 40;
    for (const c of histoBase) {
      const lo = c.salary_min ?? c.salary_max;
      const hi = c.salary_max ?? c.salary_min;
      if (lo == null || hi == null || !matches(c, "salary")) continue;
      const mid = (lo + hi) / 2 / 1000;
      bins[Math.max(0, Math.min(39, Math.floor(mid / binK)))]++;
    }
    return bins;
  }, [histoBase, matches, salaryAxisMaxK]);
  // Cambio filtri o ordinamento = mazzo diverso → dalla prima card.
  useEffect(() => {
    setIdxP(0);
    setIdxR(0);
  }, [filters, sortMode, shuffleNonce]);

  const cards = useMemo(() => {
    const base = mode === "pending" ? fPending : fReviewed;
    if (sortMode === "oldest") return base; // ordine server: found_at asc
    const arr = [...base];
    const mid = (c: SwipeCardData) => {
      const lo = c.salary_min ?? c.salary_max;
      const hi = c.salary_max ?? c.salary_min;
      return lo == null || hi == null ? null : (lo + hi) / 2;
    };
    switch (sortMode) {
      case "newest":
        return arr.reverse();
      case "score_desc":
        return arr.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      case "score_asc":
        return arr.sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
      case "salary_desc":
        return arr.sort((a, b) => (mid(b) ?? -1) - (mid(a) ?? -1));
      case "shuffle": {
        // Fisher-Yates su PRNG seedato (mulberry32) dal nonce.
        let seed = shuffleNonce * 0x9e3779b9;
        const rnd = () => {
          seed |= 0;
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      }
    }
  }, [mode, fPending, fReviewed, sortMode, shuffleNonce]);
  const idx = mode === "pending" ? idxP : idxR;

  // Prefetch della sintesi per la card corrente e le prossime tre.
  useEffect(() => {
    for (let i = idx; i < Math.min(idx + 4, cards.length); i++) {
      const c = cards[i];
      if (!c || c.jd_summary != null) continue;
      if (c.id in summaries || summaryInflight.current.has(c.id)) continue;
      summaryInflight.current.add(c.id);
      fetch(`/api/positions/${c.legacy_id}/summary`)
        .then((r) => (r.ok ? r.json() : { summary: null }))
        .catch(() => ({ summary: null }))
        .then((b: { summary?: string | null }) => {
          summaryInflight.current.delete(c.id);
          setSummaries((m) => ({ ...m, [c.id]: b.summary ?? null }));
        });
    }
  }, [idx, cards, summaries]);

  // Timbri: i giudizi storici (dal DB) + quelli dati in sessione.
  const [given, setGiven] = useState<Record<string, Verdict>>(initialVerdicts);
  const [chipAreaW, setChipAreaW] = useState(320);
  const [fly, setFly] = useState<{ x: number; rot: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  // Giudizio negativo SOSPESO: la carta è già volata via, ma niente è stato
  // scritto. `note` è il commento che l'utente aveva già digitato prima del
  // gesto — viaggia col motivo, non si perde per strada.
  const [pendingNo, setPendingNo] = useState<{
    card: SwipeCardData;
    note: string;
  } | null>(null);
  const [whyReason, setWhyReason] = useState("");
  const [whyNote, setWhyNote] = useState("");
  const [whyError, setWhyError] = useState<string | null>(null);
  const [whyBusy, setWhyBusy] = useState(false);
  // Le posizioni uscite dal giro per un motivo FATTUALE: non hanno un
  // giudizio (nessun evento di feedback), quindi non stanno in `given`.
  const [excluded, setExcluded] = useState<Record<string, true>>({});
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

  const setIdxCur = useCallback(
    (f: (i: number) => number) =>
      mode === "pending" ? setIdxP(f) : setIdxR(f),
    [mode],
  );

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

  // Scrive il giudizio nella sola pipeline feedback. Ritorna se la riga è
  // andata: chi chiama decide come dirlo (toast per i gesti secchi, errore
  // dentro il pannello per il giudizio che sta aspettando il motivo).
  const persist = useCallback(
    async (
      card: SwipeCardData,
      verdict: Verdict,
      note: string,
      reason?: string,
    ): Promise<boolean> => {
      const v = VERDICTS[verdict];
      try {
        const res = await fetch(`/api/positions/${card.legacy_id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: v.action,
            score: v.score,
            ...(v.direction ? { direction: v.direction } : {}),
            ...(reason ? { reason } : {}),
            ...(note ? { comment: note } : {}),
          }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [],
  );

  const judge = useCallback(
    (verdict: Verdict) => {
      if (flyingRef.current || finished || pendingNo) return;
      const card = cards[idx];
      flyingRef.current = true;
      stopVoice();
      const note = comment.trim().slice(0, 2000);
      // Il verdetto che insegna cosa EVITARE non si registra al buio: la
      // carta vola lo stesso (il gesto resta rapido), ma la scrittura
      // aspetta il motivo — e senza motivo non avviene.
      const needsWhy = needsReason(verdict);
      const dir = VERDICTS[verdict].fly;
      const width = typeof window !== "undefined" ? window.innerWidth : 800;
      setFly({ x: dir * (width + 200), rot: dir * 22 });
      setTimeout(() => {
        // Il timbro è la promessa che qualcosa è stato registrato: lo mette
        // solo un giudizio davvero scritto.
        if (!needsWhy) setGiven((g) => ({ ...g, [card.id]: verdict }));
        setIdxCur((i) => i + 1);
        setFly(null);
        setDrag(0);
        setComment("");
        setCommentOpen(false);
        flyingRef.current = false;
        // Il motivo si chiede DOPO il gesto, a carta uscita.
        if (needsWhy) {
          setWhyReason("");
          setWhyNote("");
          setWhyError(null);
          setPendingNo({ card, note });
        }
      }, FLY_MS);
      // Se il giudizio non cambia, registra comunque l'evento (magari col
      // commento nuovo), sempre senza effetti sullo stato corrente.
      if (!needsWhy) {
        void persist(card, verdict, note).then((ok) => {
          if (!ok) showToast(`${t.saveError} «${card.title}»`);
        });
      }
    },
    [
      cards,
      idx,
      finished,
      comment,
      pendingNo,
      persist,
      showToast,
      stopVoice,
      setIdxCur,
      t.saveError,
    ],
  );

  // Chiude il pannello del motivo. `abandoned` = l'utente se n'è andato
  // senza sceglierlo: non c'è niente da annullare, perché non era stato
  // scritto niente — ma va DETTO, altrimenti il gesto sembra registrato.
  const closeWhy = useCallback(
    (abandoned: boolean) => {
      setPendingNo(null);
      setWhyReason("");
      setWhyNote("");
      setWhyError(null);
      setWhyBusy(false);
      if (abandoned) showToast(t.whyDiscarded);
    },
    [showToast, t.whyDiscarded],
  );

  // Conferma del motivo. Due strade, ed è il punto del ticket:
  //  · motivo FATTUALE (scaduta, già gestita) → la posizione esce dal giro
  //    con la route dell'esclusione manuale e NESSUN `less_like_this` parte;
  //  · motivo di GUSTO → giudizio negativo, ma col motivo attaccato.
  // La regola sta in `negativeSignalFor`, pura e testata a parte: qui resta
  // solo l'esecuzione.
  const confirmWhy = useCallback(async () => {
    if (!pendingNo || whyBusy) return;
    const card = pendingNo.card;
    const signal = negativeSignalFor(
      whyReason,
      whyNote.trim() || pendingNo.note,
    );
    if (signal.kind === "invalid") {
      setWhyError(
        signal.missing === "reason" ? pickerT.pickReason : pickerT.writeReason,
      );
      return;
    }
    setWhyError(null);
    setWhyBusy(true);
    if (signal.kind === "exclude") {
      try {
        const res = await fetch(
          `/api/positions/${card.legacy_id}/user-exclude`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reason: signal.reason,
              ...(signal.note ? { note: signal.note } : {}),
            }),
          },
        );
        if (!res.ok) {
          // Il dettaglio del server va in console, non in faccia a chi cerca
          // lavoro: `query_failed` non gli dice cosa fare (W02).
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          console.error(`[swipe] user-exclude ${res.status} ${b?.error ?? ""}`);
          setWhyError(t.whySaveError);
          setWhyBusy(false);
          return;
        }
      } catch {
        setWhyError(t.whySaveError);
        setWhyBusy(false);
        return;
      }
      setExcluded((e) => ({ ...e, [card.id]: true }));
      closeWhy(false);
      return;
    }
    const ok = await persist(card, "no", signal.comment ?? "", signal.reason);
    if (!ok) {
      setWhyError(t.whySaveError);
      setWhyBusy(false);
      return;
    }
    setGiven((g) => ({ ...g, [card.id]: "no" }));
    closeWhy(false);
  }, [
    pendingNo,
    whyBusy,
    whyReason,
    whyNote,
    pickerT.pickReason,
    pickerT.writeReason,
    persist,
    closeWhy,
    t.whySaveError,
  ]);

  // Navigazione: nessuna scrittura, si sfoglia e basta. delta = +1
  // (prossima, card esce a sinistra) o -1 (precedente, esce a destra).
  const nav = useCallback(
    (delta: 1 | -1) => {
      // Col motivo in sospeso il mazzo sta fermo: sfogliare mentre una
      // domanda aspetta risposta è il modo più veloce per perderla.
      if (flyingRef.current || pendingNo) return;
      if (delta === 1 && finished) return;
      if (delta === -1 && idx === 0) return;
      flyingRef.current = true;
      stopVoice();
      const width = typeof window !== "undefined" ? window.innerWidth : 800;
      setFly({ x: -delta * (width + 100), rot: -delta * 8 });
      setTimeout(() => {
        setIdxCur((i) => i + delta);
        setFly(null);
        setDrag(0);
        setComment("");
        setCommentOpen(false);
        flyingRef.current = false;
      }, FLY_MS);
    },
    [finished, idx, pendingNo, stopVoice, setIdxCur],
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
      // Il pannello del motivo si prende la tastiera: la sua `<select>` non
      // è INPUT/TEXTAREA, e senza questo un '1' scelto col tasto passava
      // anche al mazzo sotto.
      if (pendingNo) return;
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
  }, [judge, nav, pendingNo]);

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
        <span className="flex items-center gap-2">
          {/* Switch mazzo: da giudicare ↔ già recensite */}
          <span
            className="flex items-center rounded-full border p-0.5"
            style={{ borderColor: "var(--color-border)" }}
          >
            {(["pending", "reviewed"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  if (m === mode || flyingRef.current) return;
                  stopVoice();
                  setDrag(0);
                  setComment("");
                  setCommentOpen(false);
                  setMode(m);
                }}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{
                  background: mode === m ? "var(--color-row)" : "transparent",
                  color:
                    mode === m ? "var(--color-bright)" : "var(--color-dim)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {m === "pending" ? t.modePending : t.modeReviewed}
              </button>
            ))}
          </span>
          {/* Filtri del mazzo (score/stipendio/categoria/modalità) */}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={t.filters}
            className="relative flex h-7 w-7 items-center justify-center rounded-full border"
            style={{
              borderColor: filterActive
                ? "var(--color-purple)"
                : "var(--color-border)",
              color: filterActive
                ? "var(--color-purple)"
                : "var(--color-muted)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            <IconFilter size={14} />
            {filterActive && (
              <span
                className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
                style={{ background: "var(--color-purple)" }}
                aria-hidden="true"
              />
            )}
          </button>
          {total > 0 && (
            <span
              className="text-[11px] font-semibold tabular-nums"
              style={{ color: "var(--color-muted)" }}
            >
              {Math.min(idx + 1, total)}/{total}
            </span>
          )}
        </span>
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
            {filterActive && total === 0
              ? t.fNoResults
              : mode === "reviewed" && total === 0
                ? t.reviewedEmpty
                : t.emptySubtitle}
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
                // Due timbri diversi perché sono due esiti diversi: un
                // giudizio (che il team impara) e un'uscita dal giro (che
                // non insegna niente). Mostrarne uno solo direbbe il falso
                // sull'altro.
                const stamp = excluded[card.id]
                  ? {
                      label: t.excludedStamp,
                      color: "var(--color-red)",
                      Icon: IconBan,
                    }
                  : verdictGiven
                    ? {
                        label: t.verdicts[verdictGiven],
                        color: VERDICTS[verdictGiven].color,
                        Icon: VERDICTS[verdictGiven].Icon,
                      }
                    : null;
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
                    {isTop && stamp && (
                      <div
                        className="absolute top-[68px] right-2 px-2 py-1 rounded border-2 text-[10px] font-black tracking-widest flex items-center gap-1.5"
                        style={{
                          color: stamp.color,
                          borderColor: stamp.color,
                          background: "var(--color-card)",
                          transform: "rotate(6deg)",
                          zIndex: 20,
                          opacity: 0.95,
                        }}
                      >
                        <stamp.Icon size={12} />
                        {stamp.label.toUpperCase()}
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
                          per rispettare gli accapi. Arriva on-demand (cache
                          summaries); undefined = fetch in corso → skeleton. */}
                      {(() => {
                        const text = card.jd_summary ?? summaries[card.id];
                        if (text) {
                          return (
                            <div
                              className="text-[12px] leading-relaxed flex-1 min-h-0 overflow-y-auto pr-1"
                              style={{
                                color: "var(--color-base)",
                                whiteSpace: "pre-line",
                                overscrollBehavior: "contain",
                              }}
                            >
                              {stripMd(text)}
                            </div>
                          );
                        }
                        if (text === undefined) {
                          return (
                            <div className="flex-1 min-h-0 space-y-2 pt-1">
                              {[92, 100, 78, 96, 60].map((w, i) => (
                                <div
                                  key={i}
                                  className="h-3 rounded animate-pulse"
                                  style={{
                                    width: `${w}%`,
                                    background: "var(--color-border)",
                                  }}
                                />
                              ))}
                            </div>
                          );
                        }
                        return null;
                      })()}
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

      {/* Il perché del «non interessante», CHIESTO DOPO IL GESTO. Finché è
          aperto non è stato scritto niente: si conferma o si abbandona, e
          abbandonare non lascia nessun segnale a metà. Portal su body come
          la schermata filtri (il wrapper di pagina è animato con transform
          e intrappolerebbe il fixed). */}
      {pendingNo &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-end justify-center p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label={t.whyNo}
          >
            <div
              className="absolute inset-0"
              style={{ background: "rgba(0,0,0,0.6)" }}
              onClick={() => closeWhy(true)}
            />
            <div
              className="relative w-full max-w-sm rounded-xl border p-4 flex flex-col gap-2.5"
              style={{
                background: "var(--color-panel)",
                borderColor: "var(--color-border-glow)",
                boxShadow: "0 18px 48px rgba(0,0,0,0.5)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="text-[13px] font-bold"
                    style={{ color: "var(--color-white)" }}
                  >
                    {t.whyNo}
                  </p>
                  {/* Di QUALE posizione: la carta è già uscita di scena, e
                      senza il titolo la domanda arriva senza soggetto. */}
                  <p
                    className="text-[11px] font-semibold truncate"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {pendingNo.card.title} · {pendingNo.card.company}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t.whyCancel}
                  title={t.whyCancel}
                  onClick={() => closeWhy(true)}
                  className="shrink-0 rounded-full border flex items-center justify-center"
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
              <ReasonPicker
                value={whyReason}
                onChange={(next) => {
                  setWhyReason(next);
                  setWhyError(null);
                }}
                note={whyNote}
                onNoteChange={setWhyNote}
                disabled={whyBusy}
                placeholder={t.whyPickPlaceholder}
                className="flex flex-wrap items-center gap-1.5"
              />
              {/* Che cosa succede DAVVERO con questo motivo: due esiti
                  diversi, letti prima di confermare e non dopo. */}
              {whyReason && (
                <p
                  className="text-[10px] leading-snug"
                  style={{ color: "var(--color-dim)" }}
                >
                  {isFactualReason(whyReason)
                    ? t.whyHintFactual
                    : t.whyHintTaste}
                </p>
              )}
              {whyError && (
                <p
                  className="text-[10px]"
                  style={{ color: "var(--color-red)" }}
                >
                  {whyError}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void confirmWhy()}
                  disabled={whyBusy}
                  className="rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-60"
                  style={{
                    color: "var(--color-red)",
                    borderColor: "var(--color-red)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {isFactualReason(whyReason)
                    ? t.whyConfirmFactual
                    : t.whyConfirmTaste}
                </button>
                <button
                  type="button"
                  onClick={() => closeWhy(true)}
                  disabled={whyBusy}
                  className="rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-60"
                  style={{
                    color: "var(--color-muted)",
                    borderColor: "var(--color-border)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {t.whyCancel}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Schermata filtri — portal su body (il wrapper di pagina è animato
          con transform e intrappolerebbe il fixed, vedi TeamActionsSheet).
          I filtri si applicano dal vivo; contatore in basso. */}
      {filtersOpen &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label={t.filters}
          >
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setFiltersOpen(false)}
            />
            <div
              className="relative w-full sm:max-w-md max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-card)",
              }}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="section-label">{t.filters}</div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  aria-label={t.commentClose}
                  className="rounded-lg p-1.5 transition-colors hover:bg-[var(--color-row)]"
                  style={{ color: "var(--color-dim)" }}
                >
                  <IconX size={18} />
                </button>
              </div>

              {/* Ordinamento del mazzo (singola scelta) */}
              <FilterSection
                label={t.fSort}
                meta={t.sortLabels[sortMode]}
                metaActive={sortMode !== "oldest"}
                open={openSecs.sort ?? false}
                onToggle={() => toggleSec("sort")}
              >
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      "oldest",
                      "newest",
                      "score_desc",
                      "score_asc",
                      "salary_desc",
                      "shuffle",
                    ] as const
                  ).map((k) => {
                    const on = sortMode === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setSortMode(k);
                          // Ri-cliccare shuffle rimescola di nuovo.
                          if (k === "shuffle") setShuffleNonce((n) => n + 1);
                        }}
                        className="rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors"
                        style={{
                          borderColor: on
                            ? "var(--color-purple)"
                            : "var(--color-border)",
                          color: on
                            ? "var(--color-purple)"
                            : "var(--color-muted)",
                          background: on
                            ? "color-mix(in srgb, var(--color-purple) 10%, transparent)"
                            : "transparent",
                        }}
                      >
                        {t.sortLabels[k]}
                      </button>
                    );
                  })}
                </div>
              </FilterSection>

              {/* Range score */}
              <FilterSection
                label={t.fScore}
                meta={`${filters.sMin} – ${filters.sMax}`}
                metaActive={filters.sMin > 0 || filters.sMax < 100}
                open={openSecs.score ?? false}
                onToggle={() => toggleSec("score")}
              >
                <DualRange
                  min={0}
                  max={100}
                  step={5}
                  lo={filters.sMin}
                  hi={filters.sMax}
                  histo={scoreHisto}
                  onChange={(lo, hi) =>
                    setFilters((f) => ({ ...f, sMin: lo, sMax: hi }))
                  }
                />
              </FilterSection>

              {/* Range stipendio (migliaia della valuta di visualizzazione) */}
              <FilterSection
                label={t.fSalary}
                meta={`${formatMoneyCompact(filters.salMin * 1000)} – ${formatMoneyCompact(filters.salMax * 1000)}`}
                metaActive={
                  filters.salMin > 0 || filters.salMax < salaryAxisMaxK
                }
                open={openSecs.salary ?? false}
                onToggle={() => toggleSec("salary")}
              >
                <DualRange
                  min={0}
                  max={salaryAxisMaxK}
                  step={salaryAxisMaxK / 40}
                  lo={filters.salMin}
                  hi={filters.salMax}
                  histo={salHisto}
                  onChange={(lo, hi) =>
                    setFilters((f) => ({ ...f, salMin: lo, salMax: hi }))
                  }
                />
              </FilterSection>

              {/* Sezioni a chip: Modalità / Categoria / Paese / Città / Fonte */}
              {(
                [
                  {
                    key: "modes" as const,
                    label: t.fMode,
                    vals: ["full_remote", "hybrid", "onsite"],
                    counts: modeCounts,
                    text: (v: string) => t.remote[v] ?? v,
                  },
                  {
                    key: "fams" as const,
                    label: t.fCategory,
                    vals: families,
                    counts: famCounts,
                    text: (v: string) => v,
                  },
                  {
                    key: "countries" as const,
                    label: t.fCountry,
                    vals: countries,
                    counts: countryCounts,
                    text: (v: string) => v,
                  },
                  {
                    key: "cities" as const,
                    label: t.fCity,
                    vals: cities,
                    counts: cityCounts,
                    text: (v: string) => v,
                  },
                  {
                    key: "sources" as const,
                    label: t.fSource,
                    vals: sources,
                    counts: sourceCounts,
                    text: (v: string) => v,
                  },
                ] as const
              ).map(
                (sec) =>
                  sec.vals.length > 0 && (
                    <FilterSection
                      key={sec.key}
                      label={sec.label}
                      meta={
                        filters[sec.key].length
                          ? String(filters[sec.key].length)
                          : undefined
                      }
                      metaActive={filters[sec.key].length > 0}
                      open={openSecs[sec.key] ?? false}
                      onToggle={() => toggleSec(sec.key)}
                    >
                      <div className="flex flex-wrap gap-2">
                        {sec.vals
                          .filter(
                            (v) =>
                              (sec.counts.get(v) ?? 0) > 0 ||
                              filters[sec.key].includes(v),
                          )
                          .map((v) => {
                            const on = filters[sec.key].includes(v);
                            const n = sec.counts.get(v) ?? 0;
                            return (
                              <button
                                key={v}
                                type="button"
                                onClick={() =>
                                  setFilters((f) => ({
                                    ...f,
                                    [sec.key]: on
                                      ? f[sec.key].filter((x) => x !== v)
                                      : [...f[sec.key], v],
                                  }))
                                }
                                className="rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors"
                                style={{
                                  borderColor: on
                                    ? "var(--color-purple)"
                                    : "var(--color-border)",
                                  color: on
                                    ? "var(--color-purple)"
                                    : "var(--color-muted)",
                                  background: on
                                    ? "color-mix(in srgb, var(--color-purple) 10%, transparent)"
                                    : "transparent",
                                }}
                              >
                                {sec.text(v)}
                                <span
                                  className="ml-1.5 font-normal tabular-nums"
                                  style={{ opacity: 0.65 }}
                                >
                                  {n}
                                </span>
                              </button>
                            );
                          })}
                      </div>
                    </FilterSection>
                  ),
              )}

              <div
                className="flex items-center justify-between border-t pt-4"
                style={{ borderColor: "var(--color-border)" }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setFilters({
                      sMin: 0,
                      sMax: 100,
                      salMin: 0,
                      salMax: salaryAxisMaxK,
                      fams: [],
                      modes: [],
                      countries: [],
                      cities: [],
                      sources: [],
                    })
                  }
                  disabled={!filterActive}
                  className="text-[11px] font-semibold disabled:opacity-40"
                  style={{
                    color: "var(--color-red)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {t.fReset}
                </button>
                <span className="text-[11px] font-semibold tabular-nums text-[var(--color-muted)]">
                  {t.fCount.replace(
                    "{n}",
                    String(
                      mode === "pending" ? fPending.length : fReviewed.length,
                    ),
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="rounded-lg border px-4 py-2 text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)]"
                  style={{
                    borderColor: "var(--color-purple)",
                    color: "var(--color-purple)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {t.commentDone}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Toast (non bloccante) — portal su body come la schermata filtri.
          MISURATO il 16/08: senza portal un antenato con `transform` fa da
          blocco contenitore al `fixed`, e il toast finiva a top 953 su un
          viewport alto 900 — fuori schermo, cioè mai letto. Vale doppio da
          quando ci passa «senza motivo non registriamo niente»: è l'unica
          cosa che dice all'utente che il suo gesto non ha lasciato traccia. */}
      {toast &&
        mounted &&
        createPortal(
          // La larghezza la limita il contenitore, non `max-w-[90vw]`: col
          // `zoom` del body i vw non tornano (misurati 404px di toast su un
          // viewport di 390) e a 390px sbordava di 7px per lato.
          <div
            className="fixed bottom-5 left-0 right-0 flex justify-center px-4"
            style={{ zIndex: 100 }}
          >
            <div
              // Niente `truncate`: qui passa anche il messaggio che spiega
              // perché non è stato registrato niente, e mezzo messaggio non
              // spiega niente. Va a capo, al massimo occupa due righe.
              className="px-4 py-2 rounded text-[12px] font-semibold max-w-full text-center break-words"
              style={{
                background: "var(--color-panel)",
                color: "var(--color-red)",
                border: "1px solid var(--color-red)",
              }}
            >
              {toast}
            </div>
          </div>,
          document.body,
        )}
    </div>
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
