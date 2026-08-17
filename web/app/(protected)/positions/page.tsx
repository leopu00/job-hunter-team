import Link from "next/link";
import {
  getPositions,
  getSeenPositionIds,
  getSourceDistribution,
  getVerdictMapByLegacyId,
} from "@/lib/queries";
import { colorForFamily } from "@/lib/position-classifier";
import { scoreSpectrumCss } from "@/lib/score-color";
import DeckSaver from "./DeckSaver";
import { IconStar, IconThumbsMeh, IconThumbsUp, IconX } from "../swipe/icons";
import {
  getExchangeRates,
  convertCurrency,
  currencySymbol,
  formatMoneyCompact,
  type Rates,
} from "@/lib/exchange-rates";
import {
  DISPLAY_CURRENCY_COOKIE,
  sanitizeDisplayCurrency,
} from "@/lib/display-currency";
import { getServerLocale } from "@/lib/server-locale";
import type { PositionWithScore } from "@/lib/types";
import { cookies } from "next/headers";
import ActorIcon from "@/app/components/ActorIcon";
import CloudSyncStatusBanner from "@/app/components/CloudSyncStatusBanner";
import UnseenDot from "@/app/components/UnseenDot";
import ColumnsPicker from "./ColumnsPicker";
import {
  POSITIONS_COLUMNS,
  POSITIONS_COLS_COOKIE,
  POSITIONS_COL_MIN_WIDTH,
  columnAlignClass,
  columnFlexAlignClass,
  parseColumnsCookie,
  type PositionsColumnKey,
} from "./columns";
import { IconSort } from "./icons";
import PositionsShell from "./PositionsShell";
import TableScrollSync from "./TableScrollSync";
import { intlTag } from "@/lib/locale-tag";
import { formatPositionEventStamp } from "@/lib/position-event-stamp";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./page.i18n";
import PositionStateCell from "@/app/components/PositionStateCell";
import { positionStatusesForFilters } from "@/lib/position-state";

function formatFoundAt(ts: string | null | undefined, locale: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(intlTag(locale), {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleString(intlTag(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Mini-tag del giudizio utente sulle righe/card (stessi colori/icone di
// /swipe): rende visibile il feedback direttamente in lista.
const FB_TAG: Record<
  string,
  { color: string; Icon: (p: { size?: number }) => React.ReactElement }
> = {
  // Stella "Molto interessante" = giallo oro ovunque (21/07).
  top: { color: "var(--color-yellow)", Icon: IconStar },
  review_ok: { color: "var(--color-blue)", Icon: IconThumbsUp },
  review_low: { color: "var(--color-orange)", Icon: IconThumbsMeh },
  no: { color: "var(--color-red)", Icon: IconX },
};

interface PageProps {
  searchParams: Promise<{
    status?: string;
    remote?: string;
    source?: string;
    verdict?: string;
    // Filtri "intelligenti" sidebar (donut/location/score/voto critico).
    family?: string;
    country?: string;
    city?: string;
    band?: string; // "lo-hi" range score
    noscore?: string; // "1" = includi posizioni senza score
    cscore?: string; // "lo-hi" range voto critico (0-10)
    cnoscore?: string; // "1" = includi posizioni senza voto
    writereq?: string; // "1" = solo selezionate (write_requested); "0" = solo non
    fb?: string; // CSV giudizi utente: top,review_ok,review_low,no,none
    q?: string; // O-60 — testo libero: titolo, azienda, città, fonte, ID
    sort?: string;
    dir?: string;
    page?: string;
    pageSize?: string;
  }>;
}

// Parse CSV di range "90-94,85-89" → [{lo:90,hi:94},...]. parseFloat per
// supportare i decimali del voto critico ("4.5-9").
function parseBands(v: string | undefined): Array<{ lo: number; hi: number }> {
  if (!v) return [];
  return v
    .split(",")
    .map((tok) => {
      const [lo, hi] = tok.split("-").map((n) => parseFloat(n.trim()));
      return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
    })
    .filter((r): r is { lo: number; hi: number } => r != null);
}

// Parse CSV multi-valore da URL: "scored,checked" → ["scored","checked"].
// Empty / undefined → [].
function csv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

const SORTABLE_COLUMNS = new Set([
  "id",
  "title",
  "company",
  "role_family",
  "source",
  "location",
  "loc_city",
  "loc_country",
  "remote",
  "score",
  "salary",
  "monthly",
  "last_action_by",
  "critic",
  "found_at",
  "last_action_at",
  "status",
  "written_at",
  "applied_at",
]);

// Verdetto critico → colore badge.
const CRITIC_COLORS: Record<string, string> = {
  PASS: "var(--color-green)",
  NEEDS_WORK: "var(--color-yellow)",
  REJECT: "var(--color-red)",
};

// Range stipendio annuo compatto in "k", convertito nella valuta scelta
// (es. "€60–80k", "$≥70k"). null → "—". Stesso formato del dashboard.
// Lordo mensile = lordo annuo / 12, convertito e in "k" (es. "€5.0–6.7k").
function formatMonthly(
  min: number | null | undefined,
  max: number | null | undefined,
  from: string,
  to: string,
  rates: Rates,
): string {
  const sym = currencySymbol(to);
  const m = (n: number) =>
    formatMoneyCompact(convertCurrency(n, from, to, rates) / 12);
  if (min != null && max != null)
    return min === max ? `${sym}${m(min)}` : `${sym}${m(min)}–${m(max)}`;
  if (min != null) return `${sym}≥${m(min)}`;
  if (max != null) return `${sym}≤${m(max)}`;
  return "—";
}

// i18n: dict inline 7 lingue (pattern server-component del progetto, vedi
// architettura i18n). La testata di questa tabella era hardcoded in italiano.

export default async function PositionsPage({ searchParams }: PageProps) {
  const locale = await getServerLocale();
  const tr = makeT(T, locale);
  const params = await searchParams;

  // Colonne visibili dal cookie (vedi columns.ts): il server renderizza
  // solo quelle scelte, il picker riscrive il cookie e fa refresh.
  const cookieStore = await cookies();
  const visibleCols = parseColumnsCookie(
    cookieStore.get(POSITIONS_COLS_COOKIE)?.value,
  );
  const show = (k: PositionsColumnKey) => visibleCols.has(k);
  // Colonne visibili nell'ordine di render (identico a header/body sotto):
  // alimentano il <colgroup> di `table-fixed` e il min-width della tabella.
  // Le larghezze del colgroup sono percentuali proporzionali ai minimi, così
  // la tabella riempie il 100% quando le colonne ci stanno (testo troncato,
  // niente scroll) e scrolla solo quando la somma dei minimi eccede.
  const orderedCols = POSITIONS_COLUMNS.filter((c) => show(c));
  const tableMinWidth = orderedCols.reduce(
    (s, c) => s + POSITIONS_COL_MIN_WIDTH[c],
    0,
  );
  const selectedStates = csv(params.status);
  const statuses = positionStatusesForFilters(selectedStates);
  const remotes = csv(params.remote);
  const sources = csv(params.source);
  const verdicts = csv(params.verdict);
  const fbSel = csv(params.fb);
  const families = csv(params.family);
  const countries = csv(params.country);
  const cities = csv(params.city);
  // O-60 — testo libero della ricerca. Vive nell'URL come ogni altro filtro:
  // la tabella è un server component, quindi il match deve arrivare al
  // database, e per giunta il link di una ricerca diventa condivisibile.
  const query = (params.q ?? "").trim();
  const scoreBands = parseBands(params.band);
  const unscored = params.noscore === "1";
  const criticBands = parseBands(params.cscore);
  const criticUnscored = params.cnoscore === "1";
  // writereq: "1" = solo selezionate, "0" = solo non selezionate, assente = no filtro
  const writeRequested =
    params.writereq === "1"
      ? true
      : params.writereq === "0"
        ? false
        : undefined;

  const sortCol = SORTABLE_COLUMNS.has(params.sort ?? "")
    ? params.sort!
    : "last_action_at";
  const sortDir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";

  // Paginazione: pageSize (whitelist), page 1-based.
  const requestedPageSize = parseInt(params.pageSize ?? "", 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    requestedPageSize,
  )
    ? requestedPageSize
    : DEFAULT_PAGE_SIZE;
  const requestedPage = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const [allPositionsRaw, sourceList] = await Promise.all([
    getPositions({
      statuses: statuses.length ? statuses : undefined,
      remoteTypes: remotes.length ? remotes : undefined,
      sources: sources.length ? sources : undefined,
      verdicts: verdicts.length ? verdicts : undefined,
      families: families.length ? families : undefined,
      countries: countries.length ? countries : undefined,
      cities: cities.length ? cities : undefined,
      scoreBands: scoreBands.length ? scoreBands : undefined,
      unscored: unscored || undefined,
      criticBands: criticBands.length ? criticBands : undefined,
      criticUnscored: criticUnscored || undefined,
      writeRequested,
      q: query || undefined,
      limit: 2000,
      sort: sortCol,
      dir: sortDir,
    }),
    getSourceDistribution(),
  ]);
  // Marker "nuova": overlay del set position_views dell'utente (cloud).
  // In local mode il set è vuoto e seen resta undefined → decide il
  // client via localStorage (UnseenDot).
  const seenIds = await getSeenPositionIds();
  const allPositions = allPositionsRaw.map((p) =>
    seenIds.has(String(p.id)) ? { ...p, seen: true } : p,
  );
  const availableSources = sourceList.map((s) => s.source);

  // Tassi di cambio per le colonne Stipendio/Mensile. La valuta arriva
  // dalla preferenza utente (Impostazioni → Valuta stipendi, cookie);
  // default EUR. Errore rete → fallback già in getExchangeRates.
  const rates = await getExchangeRates();
  const displayCurrency = sanitizeDisplayCurrency(
    cookieStore.get(DISPLAY_CURRENCY_COOKIE)?.value,
  );

  // Default (scelta utente 19/07): SOLO posizioni con uno score e non
  // escluse — le 'new'/'checked' senza analisi non dicono nulla di utile e
  // le escluse sono rumore. La regola salta se l'utente sceglie stati
  // espliciti dalla sidebar (es. vuole proprio le escluse) o chiede le
  // senza-score (noscore=1).
  // La soglia sotto-40 NON vive qui: è la RULE-04 dello Scorer (score<40 →
  // excluded) e va rispettata NEI DATI — la vista non maschera niente.
  //
  // O-60 — e salta anche quando si sta CERCANDO. Chi scrive il nome di
  // un'azienda vuole quell'offerta, non «quell'offerta se ha un punteggio»:
  // nel database dell'operatore il default nasconde il 61% delle posizioni,
  // e una ricerca che lo eredita risponde "nessun risultato" su qualcosa che
  // esiste — una risposta sicura e falsa al posto di una fatica. Le righe che
  // il default avrebbe nascosto restano riconoscibili: la colonna Stato dice
  // già "excluded", e le senza punteggio mostrano "—" nello Score.
  let positions =
    selectedStates.length || unscored || query
      ? allPositions
      : allPositions.filter(
          (p) =>
            p.score != null &&
            // "Non interessante" implica escluse: col filtro fb=no attivo
            // il default nascondi-escluse si allenta, sennò risultato vuoto.
            (p.status !== "excluded" || fbSel.includes("no")),
        );

  // Giudizi utente (event-log, ultimo prevale): servono sia al filtro
  // "Il tuo feedback" sia ai mini-tag sulle righe/card.
  const vmap = await getVerdictMapByLegacyId();
  const verdictOfP = (p: PositionWithScore) =>
    p.legacy_id != null ? vmap[String(p.legacy_id)] : undefined;
  if (fbSel.length) {
    positions = positions.filter((p) => {
      const v = verdictOfP(p);
      return v ? fbSel.includes(v) : fbSel.includes("none");
    });
  }

  // Pagination computed values
  const totalResults = positions.length;
  const pageCount = Math.max(1, Math.ceil(totalResults / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const startIdx = (page - 1) * pageSize;
  const visiblePositions = positions.slice(startIdx, startIdx + pageSize);

  // Helper per costruire URL preservando filtri attivi.
  const buildHref = (
    overrides: Partial<Record<"sort" | "dir" | "page" | "pageSize", string>>,
  ) => {
    const merged: Record<string, string> = {};
    if (selectedStates.length) merged.status = selectedStates.join(",");
    if (remotes.length) merged.remote = remotes.join(",");
    if (sources.length) merged.source = sources.join(",");
    if (verdicts.length) merged.verdict = verdicts.join(",");
    if (fbSel.length) merged.fb = fbSel.join(",");
    if (families.length) merged.family = families.join(",");
    if (countries.length) merged.country = countries.join(",");
    if (cities.length) merged.city = cities.join(",");
    if (scoreBands.length)
      merged.band = scoreBands.map((b) => `${b.lo}-${b.hi}`).join(",");
    if (unscored) merged.noscore = "1";
    if (criticBands.length)
      merged.cscore = criticBands.map((b) => `${b.lo}-${b.hi}`).join(",");
    if (criticUnscored) merged.cnoscore = "1";
    if (writeRequested === true) merged.writereq = "1";
    else if (writeRequested === false) merged.writereq = "0";
    if (sortCol !== "last_action_at") merged.sort = sortCol;
    if (sortDir !== "desc") merged.dir = sortDir;
    if (page !== 1) merged.page = String(page);
    if (pageSize !== DEFAULT_PAGE_SIZE) merged.pageSize = String(pageSize);
    Object.assign(merged, overrides);
    // Cleanup default values → URL pulito
    for (const k of Object.keys(merged)) {
      if (k === "sort" && merged[k] === "last_action_at") delete merged[k];
      if (k === "dir" && merged[k] === "desc") delete merged[k];
      if (k === "page" && (merged[k] === "1" || merged[k] === ""))
        delete merged[k];
      if (k === "pageSize" && merged[k] === String(DEFAULT_PAGE_SIZE))
        delete merged[k];
    }
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/positions?${qs}` : "/positions";
  };

  // Link per ordinare cliccando un header: se la colonna è già attiva
  // toggla la direzione, altrimenti diventa la nuova attiva con dir
  // default (desc per metriche numeriche e id, asc per testo).
  const sortHref = (col: string) => {
    const isActive = sortCol === col;
    const NUMERIC = new Set([
      "id",
      "score",
      "critic",
      "found_at",
      "last_action_at",
      "written_at",
      "applied_at",
      "salary",
      "monthly",
    ]);
    const defaultDir = NUMERIC.has(col) ? "desc" : "asc";
    const nextDir = isActive
      ? sortDir === "asc"
        ? "desc"
        : "asc"
      : defaultDir;
    return buildHref({ sort: col, dir: nextDir });
  };

  // Freccetta su OGNI colonna: attiva = ↑/↓, inattiva = ↕ (segnala che è
  // ordinabile). Lo stile dim/bright lo dà già il colore del th.
  const sortIndicator = (col: string) => (
    <IconSort dir={sortCol === col ? sortDir : "none"} />
  );

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-4 pb-3 md:mb-8 md:pb-6 border-b border-[var(--color-border)]">
        <nav
          aria-label={tr("breadcrumb")}
          className="flex items-center gap-2 mb-1"
        >
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {tr("nav_dashboard")}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {tr("positions")}
          </span>
        </nav>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-[var(--color-white)] mt-2 md:mt-3">
          {tr("positions")}
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {positions.length} {tr("results")}
        </p>
      </div>

      {/* Banner stato cloud-sync (compatto, nascosto se non loggato). */}
      <CloudSyncStatusBanner />

      {/* ── Layout: sidebar filtri (collassabile) + contenuto ──
          PositionsShell gestisce il collapse: da chiuso niente sidebar (tabella
          full-width) e il pulsante "Filtri" passa nella toolbar a sinistra. ── */}
      <PositionsShell
        availableSources={availableSources}
        filtersLabel={tr("filters")}
        rowsControl={
          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
              {tr("rows_per_page")}
            </span>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <Link
                key={size}
                href={buildHref({ pageSize: String(size), page: "1" })}
                className="px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors no-underline"
                style={
                  pageSize === size
                    ? {
                        color: "var(--color-bright)",
                        borderColor: "var(--color-green)",
                        background: "var(--color-card)",
                      }
                    : {
                        color: "var(--color-dim)",
                        borderColor: "var(--color-border)",
                      }
                }
              >
                {size}
              </Link>
            ))}
            {/* Il picker colonne riguarda la TABELLA: su mobile c'è la
                vista card, quindi niente separatore né picker. */}
            <span className="hidden md:flex items-center gap-1.5">
              <span
                className="mx-1 h-3 w-px bg-[var(--color-border)]"
                aria-hidden="true"
              />
              <ColumnsPicker
                columns={[
                  { key: "id", label: "ID" },
                  { key: "last_action_at", label: tr("col_updated") },
                  { key: "found_at", label: tr("col_found_at") },
                  { key: "title", label: tr("col_title") },
                  { key: "company", label: tr("col_company") },
                  { key: "role_family", label: tr("col_category") },
                  { key: "loc_country", label: tr("col_country") },
                  { key: "loc_city", label: tr("col_city") },
                  { key: "remote", label: tr("col_remote") },
                  { key: "score", label: tr("col_score") },
                  { key: "monthly", label: tr("col_monthly") },
                  { key: "source", label: tr("col_source") },
                  { key: "last_action_by", label: tr("col_updated_by") },
                  { key: "critic", label: tr("col_voto") },
                  { key: "status", label: tr("col_status") },
                  { key: "written_at", label: tr("col_written_at") },
                  { key: "applied_at", label: tr("col_applied_at") },
                ]}
                visible={[...visibleCols]}
                texts={{ button: tr("cols_button"), reset: tr("cols_reset") }}
              />
            </span>
          </div>
        }
      >
        {/* ── Card list (solo mobile) ─────────────────────────────
            Sotto md la tabella è inutilizzabile (colonne fuori viewport):
            stessa query, stessa paginazione, ma una card compatta per
            posizione — titolo+score, azienda+località, stato+categoria+
            data. Tap sulla card = pagina dettaglio. */}
        {/* Sequenza corrente (filtri+ordinamento) per prev/next nel
            dettaglio: tutte le posizioni filtrate, non solo la pagina. */}
        <DeckSaver ids={positions.map((p) => String(p.id))} />
        <div className="md:hidden flex flex-col gap-2">
          {visiblePositions.length === 0 ? (
            <div className="rounded-lg border border-[var(--color-border)] px-4 py-12 text-center text-[var(--color-dim)] text-[11px]">
              {tr("no_positions_filtered")}
            </div>
          ) : (
            visiblePositions.map((p: PositionWithScore) => (
              <div
                key={p.id}
                className="rounded-lg border p-3"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* SOLO il titolo è il link: la card-link intera al tap
                      sottolineava ogni riga (a:hover globale; su touch la
                      variante hover: di Tailwind non esiste — media query
                      hover:hover — quindi non è sovrascrivibile lì). */}
                  <Link
                    href={`/positions/${p.id}`}
                    className="min-w-0 text-[13px] font-semibold leading-snug no-underline"
                    style={{
                      color: "var(--color-green)",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {p.title}{" "}
                    {/* NEW inline nel flusso del titolo (inline-block: non
                        eredita l'underline). Giudicata = letta: niente NEW. */}
                    <UnseenDot
                      id={String(p.id)}
                      label={tr("unseen_marker")}
                      initialSeen={p.seen || verdictOfP(p) != null}
                    />
                  </Link>
                  <span className="shrink-0 flex items-center gap-1.5">
                    {(() => {
                      const v = verdictOfP(p);
                      const tag = v ? FB_TAG[v] : null;
                      return tag ? (
                        <span
                          style={{ color: tag.color }}
                          title={tr(`fb_${v}`)}
                          aria-label={tr(`fb_${v}`)}
                        >
                          <tag.Icon size={13} />
                        </span>
                      ) : null;
                    })()}
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full border-2 text-[12px] font-bold tabular-nums"
                      style={{
                        color: scoreSpectrumCss(p.score),
                        borderColor: scoreSpectrumCss(p.score),
                      }}
                    >
                      {p.score ?? "—"}
                    </span>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[var(--color-muted)] truncate">
                  {p.company}
                  {p.loc_city?.trim() || p.loc_country?.trim()
                    ? ` · ${p.loc_city?.trim() || p.loc_country?.trim()}`
                    : p.remote_type === "full_remote"
                      ? ` · ${tr("remote_loc")}`
                      : ""}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                  <span className="flex items-center gap-2 min-w-0">
                    {/* Niente stato sulla card (scelta utente 19/07):
                        il default della pagina è già "con score, non
                        escluse", lo status è rumore. */}
                    {p.role_family?.trim() && (
                      <span className="inline-flex items-center gap-1 truncate text-[var(--color-muted)]">
                        <span
                          aria-hidden
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: colorForFamily(p.role_family.trim()),
                            flexShrink: 0,
                          }}
                        />
                        <span className="truncate">{p.role_family.trim()}</span>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-[var(--color-dim)]">
                    {formatFoundAt(p.last_action_at || p.found_at, locale)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Table (da md in su) ─────────────────────────────────── */}
        {/* La pagina /positions è in MainChrome FULLSCREEN_FLOWS, quindi
          il main è già full-width con padding 48px. La tabella prende
          100% e ha scroll-x se eccede. */}
        <div className="hidden md:block">
          <TableScrollSync className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
            <table
              className="w-full table-fixed text-[12px]"
              style={{ borderCollapse: "collapse", minWidth: tableMinWidth }}
              aria-label={tr("list_positions")}
            >
              <colgroup>
                {orderedCols.map((c) => (
                  <col
                    key={c}
                    style={{
                      width: `${(
                        (POSITIONS_COL_MIN_WIDTH[c] / tableMinWidth) *
                        100
                      ).toFixed(3)}%`,
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
                  {[
                    { col: "id", label: "ID", sortable: true },
                    {
                      col: "last_action_at",
                      label: tr("col_updated"),
                      sortable: true,
                    },
                    {
                      col: "found_at",
                      label: tr("col_found_at"),
                      sortable: true,
                    },
                    { col: "title", label: tr("col_title"), sortable: true },
                    {
                      col: "company",
                      label: tr("col_company"),
                      sortable: true,
                    },
                    {
                      col: "role_family",
                      label: tr("col_category"),
                      sortable: true,
                    },
                    {
                      col: "loc_country",
                      label: tr("col_country"),
                      sortable: true,
                    },
                    { col: "loc_city", label: tr("col_city"), sortable: true },
                    { col: "remote", label: tr("col_remote"), sortable: true },
                    {
                      col: "score",
                      label: tr("col_score"),
                      sortable: true,
                    },
                    {
                      col: "monthly",
                      label: tr("col_monthly"),
                      sortable: true,
                    },
                    { col: "source", label: tr("col_source"), sortable: true },
                    {
                      col: "last_action_by",
                      label: tr("col_updated_by"),
                      sortable: true,
                    },
                    {
                      col: "critic",
                      label: tr("col_voto"),
                      sortable: true,
                    },
                    {
                      col: "status",
                      label: tr("col_status"),
                      sortable: true,
                    },
                    {
                      col: "written_at",
                      label: tr("col_written_at"),
                      sortable: true,
                    },
                    {
                      col: "applied_at",
                      label: tr("col_applied_at"),
                      sortable: true,
                    },
                  ]
                    .filter(({ col }) => show(col as PositionsColumnKey))
                    .map(({ col, label, sortable }) => (
                      <th
                        key={col}
                        scope="col"
                        className={`px-4 py-3 ${columnAlignClass(col as PositionsColumnKey)} text-[9.5px] font-semibold tracking-[0.15em] uppercase truncate`}
                        style={{
                          color:
                            sortable && sortCol === col
                              ? "var(--color-bright)"
                              : "var(--color-dim)",
                        }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {sortable ? (
                            // gap-1 (4px) + icona 12px = i 16px che
                            // `SORT_ARROW_PX` mette in conto nella larghezza
                            // minima della colonna: ora è una misura vera e
                            // non la larghezza che il sistema operativo dà a
                            // una freccia di testo.
                            <Link
                              href={sortHref(col)}
                              className="inline-flex items-center gap-1 no-underline hover:text-[var(--color-green)] transition-colors"
                              style={{ color: "inherit" }}
                            >
                              {label}
                              {sortIndicator(col)}
                            </Link>
                          ) : (
                            <span>{label}</span>
                          )}
                        </span>
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {visiblePositions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleCols.size}
                      className="px-4 py-12 text-center text-[var(--color-dim)] text-[11px]"
                    >
                      {tr("no_positions_filtered")}
                    </td>
                  </tr>
                ) : (
                  visiblePositions.map((p: PositionWithScore, i: number) => (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
                      style={{
                        borderBottomColor:
                          i === visiblePositions.length - 1
                            ? "transparent"
                            : undefined,
                        background:
                          i % 2 === 1 ? "rgba(255,255,255,0.008)" : undefined,
                      }}
                    >
                      {/* ID */}
                      {show("id") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("id")} text-[10px] text-[var(--color-dim)] whitespace-nowrap`}
                        >
                          {p.legacy_id
                            ? `JHT-${String(p.legacy_id).padStart(3, "0")}`
                            : p.id.slice(0, 8)}
                        </td>
                      )}
                      {/* Aggiornato (ultima azione, fallback rilevazione) */}
                      {show("last_action_at") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("last_action_at")} text-[10px] text-[var(--color-muted)] whitespace-nowrap font-mono tabular-nums`}
                        >
                          {formatFoundAt(
                            p.last_action_at || p.found_at,
                            locale,
                          )}
                        </td>
                      )}
                      {/* Trovata (rilevazione dello Scout): ordinata
                          crescente mette in cima le più vecchie, cioè quelle
                          ferme in coda da più tempo. */}
                      {show("found_at") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("found_at")} text-[10px] text-[var(--color-muted)] whitespace-nowrap font-mono tabular-nums`}
                        >
                          {formatPositionEventStamp(p.found_at, locale) ?? (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      )}
                      {/* Titolo — una riga, troncato con … se troppo lungo */}
                      <td
                        className={`px-4 py-3 ${columnAlignClass("title")} font-medium`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Link
                            href={`/positions/${p.id}`}
                            title={p.title ?? undefined}
                            className="min-w-0 flex-1 truncate text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors"
                          >
                            {p.title}
                          </Link>
                          <UnseenDot
                            id={String(p.id)}
                            label={tr("unseen_marker")}
                            initialSeen={p.seen || verdictOfP(p) != null}
                          />
                          {(() => {
                            const v = verdictOfP(p);
                            const tag = v ? FB_TAG[v] : null;
                            return tag ? (
                              <span
                                className="shrink-0"
                                style={{ color: tag.color }}
                                title={tr(`fb_${v}`)}
                                aria-label={tr(`fb_${v}`)}
                              >
                                <tag.Icon size={12} />
                              </span>
                            ) : null;
                          })()}
                        </span>
                      </td>
                      {/* Azienda */}
                      {show("company") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("company")} text-[var(--color-base)] truncate`}
                          title={p.company}
                        >
                          {p.company}
                        </td>
                      )}
                      {/* Categoria */}
                      {show("role_family") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("role_family")} text-[11px] text-[var(--color-base)] truncate`}
                          title={p.role_family ?? undefined}
                        >
                          {p.role_family && p.role_family.trim() ? (
                            // `truncate` sulla cella non basta: il figlio è un
                            // inline-flex, e l'ellissi salta il box flex — la
                            // categoria finiva tagliata a metà parola contro il
                            // bordo, come se sconfinasse nella colonna accanto.
                            // L'ellissi va chiesta al testo, dentro il flex.
                            <span className="inline-flex items-center gap-1.5 max-w-full min-w-0">
                              <span
                                aria-hidden
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: colorForFamily(
                                    p.role_family.trim(),
                                  ),
                                  flexShrink: 0,
                                }}
                              />
                              <span className="truncate">
                                {p.role_family.trim()}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      )}
                      {/* Paese (Remote in corsivo se senza paese ma full remote) */}
                      {show("loc_country") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("loc_country")} text-[11px] truncate`}
                          title={p.loc_country ?? undefined}
                        >
                          {p.loc_country && p.loc_country.trim() ? (
                            <span className="text-[var(--color-base)]">
                              {p.loc_country.trim()}
                            </span>
                          ) : p.remote_type === "full_remote" ? (
                            <span className="italic text-[var(--color-dim)]">
                              {tr("remote_loc")}
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      )}
                      {/* Città */}
                      {show("loc_city") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("loc_city")} text-[11px] text-[var(--color-muted)] truncate`}
                          title={p.loc_city ?? undefined}
                        >
                          {p.loc_city && p.loc_city.trim() ? (
                            p.loc_city.trim()
                          ) : (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      )}
                      {/* Remote */}
                      {show("remote") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("remote")} whitespace-nowrap`}
                        >
                          <span className="text-[10px] text-[var(--color-muted)]">
                            {p.remote_type?.replace("_", " ") ?? "—"}
                          </span>
                        </td>
                      )}
                      {/* Score */}
                      {show("score") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("score")}`}
                        >
                          <div
                            className={`flex items-center gap-2 ${columnFlexAlignClass("score")}`}
                          >
                            <span
                              className="text-[12px] font-semibold w-6 text-right tabular-nums"
                              style={{ color: scoreSpectrumCss(p.score) }}
                            >
                              {p.score ?? "—"}
                            </span>
                            <div
                              className="w-10 h-1 rounded-full overflow-hidden"
                              style={{ background: "var(--color-border)" }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${p.score ?? 0}%`,
                                  background: scoreSpectrumCss(p.score),
                                }}
                              />
                            </div>
                          </div>
                        </td>
                      )}
                      {/* Stima lorda mensile */}
                      {show("monthly") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("monthly")} text-[11px] text-[var(--color-muted)] whitespace-nowrap tabular-nums`}
                        >
                          {formatMonthly(
                            p.salary_min,
                            p.salary_max,
                            p.salary_currency ?? "EUR",
                            displayCurrency,
                            rates,
                          )}
                        </td>
                      )}
                      {/* Fonte */}
                      {show("source") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("source")} text-[10px] text-[var(--color-muted)] truncate`}
                        >
                          {p.source ? (
                            <span className="capitalize">
                              {p.source.replace(/[-_]/g, " ")}
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      )}
                      {/* Aggiornato da */}
                      {show("last_action_by") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("last_action_by")} text-[10px] whitespace-nowrap font-mono`}
                        >
                          {p.last_action_actor ? (
                            <span className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
                              <ActorIcon role={p.last_action_by} />
                              {p.last_action_actor}
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      )}
                      {/* Voto critico */}
                      {show("critic") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("critic")} whitespace-nowrap tabular-nums`}
                        >
                          {p.critic_score != null ? (
                            <span
                              className="text-[12px] font-semibold"
                              style={{
                                color:
                                  CRITIC_COLORS[p.critic_verdict ?? ""] ??
                                  "var(--color-muted)",
                              }}
                            >
                              {p.critic_score.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)] text-[11px]">
                              —
                            </span>
                          )}
                        </td>
                      )}
                      {/* Stato */}
                      {show("status") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("status")}`}
                        >
                          <PositionStateCell
                            status={p.status}
                            hasOpenTicket={p.has_open_ticket}
                            locale={locale}
                          />
                        </td>
                      )}
                      {/* CV scritto il: ordinata crescente dice DA QUANTO un
                          CV aspetta — con un filtro su 'In revisione' o
                          'Pronte da inviare' è la coda vera e propria. */}
                      {show("written_at") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("written_at")}`}
                        >
                          {formatPositionEventStamp(p.written_at, locale) ? (
                            <span className="font-mono tabular-nums text-[11px] text-[var(--color-base)] whitespace-nowrap">
                              {formatPositionEventStamp(p.written_at, locale)}
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)] text-[11px]">
                              —
                            </span>
                          )}
                        </td>
                      )}
                      {/* Candidatura inviata: QUANDO, non solo se. Lo stato
                          dice 'applied', questa colonna dice l'ora esatta —
                          è ciò che serve scorrendo cinquanta righe. */}
                      {show("applied_at") && (
                        <td
                          className={`px-4 py-3 ${columnAlignClass("applied_at")}`}
                        >
                          {formatPositionEventStamp(p.applied_at, locale) ? (
                            <span className="font-mono tabular-nums text-[11px] text-[var(--color-base)] whitespace-nowrap">
                              {formatPositionEventStamp(p.applied_at, locale)}
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)] text-[11px]">
                              —
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScrollSync>
        </div>

        {/* ── Pagination ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-[11px] text-[var(--color-muted)]">
          <div>
            {totalResults === 0
              ? `0 ${tr("results")}`
              : `${startIdx + 1}–${Math.min(startIdx + pageSize, totalResults)} ${tr("of")} ${totalResults} · ${tr("page_label")} ${page} / ${pageCount}`}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              {page > 1 ? (
                <Link
                  href={buildHref({ page: String(page - 1) })}
                  className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors no-underline text-[var(--color-base)]"
                >
                  ← {tr("prev")}
                </Link>
              ) : (
                <span className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] text-[var(--color-dim)] opacity-50">
                  ← {tr("prev")}
                </span>
              )}
              {page < pageCount ? (
                <Link
                  href={buildHref({ page: String(page + 1) })}
                  className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors no-underline text-[var(--color-base)]"
                >
                  {tr("next")} →
                </Link>
              ) : (
                <span className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] text-[var(--color-dim)] opacity-50">
                  {tr("next")} →
                </span>
              )}
            </div>
          </div>
        </div>
      </PositionsShell>
    </div>
  );
}
