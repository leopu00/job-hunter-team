import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getPositionById,
  getLatestFeedbackForLegacyId,
  isCloudDataMode,
} from "@/lib/queries";
import { gazetteerCity } from "@/lib/city-gazetteer";
import {
  getExchangeRates,
  convertCurrency,
  currencySymbol,
  formatMoneyCompact,
} from "@/lib/exchange-rates";
import {
  DISPLAY_CURRENCY_COOKIE,
  sanitizeDisplayCurrency,
} from "@/lib/display-currency";
import { countryFlag } from "@/lib/country-flag";
import {
  parseAnalysisNotes,
  parseScoreBreakdown,
  tagColor,
} from "@/lib/parse-analysis";
import { colorForFamily } from "@/lib/position-classifier";
import { sourceDisplayName } from "@/lib/case-study-sources";
import { scoreSpectrumCss } from "@/lib/score-color";
import { MarkdownLite } from "@/lib/markdown-lite";
import { locales, defaultLocale, type Locale } from "@/i18n/config";
import { WriteRequestButton } from "./WriteRequestButton";
import { ExcludeButton } from "./ExcludeButton";
import { RecheckButton } from "./RecheckButton";
import { TicketPanel } from "./TicketPanel";
import { GeocodeRequestButton } from "./GeocodeRequestButton";
import { TeamActionsSheet } from "./TeamActionsSheet";
import { FeedbackButtons } from "./FeedbackButtons";
import { verdictOf, type Verdict } from "@/lib/position-verdict";
import PositionMapCardLazy from "./PositionMapCardLazy";
import PrevNextNav from "./PrevNextNav";
import { CvDownloadButton } from "./CvDownloadButton";
import MarkSeenAfterView from "@/app/components/MarkSeenAfterView";
import { Avatar } from "@/app/components/Avatar";
import { isLocalRequest } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/workspace";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./page.i18n";

// Normalizzazione dei valori a vocabolario chiuso che l'Analista scrive in
// inglese (es. "not specified", "mandatory"): per le altre stringhe aperte
// (anni, nomi lingua, livelli seniority) si rende il valore grezzo.
const VAL: Record<string, Record<string, string>> = {
  "not specified": {
    it: "non specificato",
    en: "not specified",
    hu: "nincs megadva",
    es: "no especificado",
    de: "nicht angegeben",
    fr: "non spécifié",
    pt: "não especificado",
  },
  "not required": {
    it: "non richiesta",
    en: "not required",
    hu: "nem szükséges",
    es: "no requerida",
    de: "nicht erforderlich",
    fr: "non requise",
    pt: "não exigida",
  },
  "not mentioned": {
    it: "non indicato",
    en: "not mentioned",
    hu: "nincs említve",
    es: "no mencionado",
    de: "nicht erwähnt",
    fr: "non mentionné",
    pt: "não mencionado",
  },
  mandatory: {
    it: "obbligatoria",
    en: "mandatory",
    hu: "kötelező",
    es: "obligatoria",
    de: "obligatorisch",
    fr: "obligatoire",
    pt: "obrigatória",
  },
  required: {
    it: "richiesta",
    en: "required",
    hu: "szükséges",
    es: "requerida",
    de: "erforderlich",
    fr: "requise",
    pt: "exigida",
  },
  preferred: {
    it: "preferita",
    en: "preferred",
    hu: "előnyben",
    es: "preferida",
    de: "bevorzugt",
    fr: "souhaitée",
    pt: "preferida",
  },
};

// Colori dello stato della CANDIDATURA (applications.status), distinto dallo
// stato della posizione. 'ready' = CV finito e approvato dal Critico.
const APP_STATUS_COLORS: Record<string, string> = {
  draft: "var(--color-yellow)",
  review: "var(--color-orange)",
  ready: "var(--color-ready)",
  approved: "var(--color-green)",
  applied: "var(--color-green)",
  response: "#58a6ff",
};

const VERDICT_COLORS: Record<string, string> = {
  PASS: "var(--color-green)",
  NEEDS_WORK: "var(--color-yellow)",
  REJECT: "var(--color-red)",
};

// Ultimo evento feedback → giudizio della scala a 4 (stessa mappatura
// inversa della pagina /swipe; i vecchi eventi senza score cadono sul
// giudizio più vicino all'action).
function scoreColor(s: number | null) {
  return scoreSpectrumCss(s);
}

// Colore di un sotto-punteggio relativo al SUO massimo (stack /40, remote
// /25, …): un 26/40 (65%) è "buono", non "rosso". Il colore precedente
// usava soglie assolute → tutte le barre apparivano rosse anche con fit ok.
function ratioColor(value: number | null, max: number) {
  if (value == null || max <= 0) return "var(--color-dim)";
  const pct = (value / max) * 100;
  if (pct >= 70) return "var(--color-green)";
  if (pct >= 45) return "var(--color-yellow)";
  return "var(--color-red)";
}

function ScoreBar({
  label,
  value,
  max,
  detail,
}: {
  label: string;
  value: number | null;
  max: number;
  // Razionale della dimensione (scores.breakdown, RULE-09 Scorer): se
  // presente la riga diventa espandibile via <details> nativo — niente
  // JS client, funziona anche nel render server.
  detail?: string;
}) {
  const pct = value ? Math.round((value / max) * 100) : 0;
  const color = ratioColor(value, max);
  const row = (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-[var(--color-dim)] w-28 shrink-0">
        {label}
      </span>
      <div
        className="flex-1 h-1 rounded-full overflow-hidden"
        style={{ background: "var(--color-border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        className="text-[11px] font-semibold w-12 text-right tabular-nums"
        style={{ color }}
      >
        {value ?? "—"}
        <span className="text-[var(--color-dim)] font-normal">/{max}</span>
      </span>
      {/* Slot fisso per il chevron: mantiene allineate le barre con e
          senza razionale. */}
      <span className="w-3 shrink-0 flex items-center justify-center">
        {detail && (
          <svg
            viewBox="0 0 10 6"
            className="w-2.5 h-2.5 text-[var(--color-dim)] transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
        )}
      </span>
    </div>
  );
  if (!detail) return row;
  return (
    <details className="group">
      <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
        {row}
      </summary>
      <MarkdownLite
        text={detail}
        className="mt-1.5 mb-1 ml-1 pl-3 border-l-2 border-[var(--color-border)] text-[11px] text-[var(--color-muted)] leading-relaxed"
      />
    </details>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PositionDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Locale corrente dalla fonte unica: il cookie NEXT_LOCALE.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale =
    cookieLocale && (locales as string[]).includes(cookieLocale)
      ? (cookieLocale as Locale)
      : defaultLocale;
  const t = makeT(T, locale);

  const data = await getPositionById(id);

  if (!data) notFound();

  // NB: data.highlights esiste ancora nel DB ma è segnale interno per gli
  // agenti (Scorer/Capitano) — la card Pro/Contro duplicava jd_summary,
  // note del team e razionale dello score (contratto contenuti 2026-07-23).
  const { position, score, company, application, tickets } = data;
  // Razionale dello score. `perDimension` (RULE-09) va espandibile sotto la
  // barra corrispondente; `rest` è ciò che non appartiene a una dimensione —
  // i breakdown vecchi, che restano visibili sotto le barre insieme alle
  // note invece di sparire.
  const scoreWhy = parseScoreBreakdown(score?.breakdown);

  // Analisi semi-strutturata dell'Analista (campo notes) → metadati,
  // motivo esclusione, disallineamenti, prosa. Vedi lib/parse-analysis.
  const analysis = parseAnalysisNotes(position.notes);
  const vt = (v: string) => {
    const k = v.trim().toLowerCase();
    return VAL[k]?.[locale] ?? VAL[k]?.en ?? v;
  };

  // Modalità di accesso ai file: cloud (web pubblico → bridge on-demand) vs
  // local (desktop → link diretto). Stesso criterio di /api/profile/files.
  const cloudMode = isSupabaseConfigured && !(await isLocalRequest());

  // Ultimo giudizio dell'utente (event-log condiviso con /swipe) →
  // inizializza i bottoni feedback nel popup. Il gate è la modalità DATI
  // (Supabase vs workspace locale), non cloudMode: quello guarda da dove
  // arriva la RICHIESTA e in dev locale sarebbe sempre false.
  const feedbackEnabled = await isCloudDataMode();
  const fb =
    feedbackEnabled && position.legacy_id != null
      ? await getLatestFeedbackForLegacyId(position.legacy_id)
      : null;
  const initialVerdict: Verdict | null = fb
    ? verdictOf(fb.action, fb.score)
    : null;

  // Card Località: per il full remote niente mappa (nessun posto dove
  // pinnare) ma la card c'è comunque — indica "Da remoto" e l'HQ
  // dell'azienda (scelta utente 22/07). Per il resto pin a LIVELLO CITTÀ —
  // ufficio esatto se geocodato, altrimenti gazetteer città→coordinate
  // (scelta utente 19/07: niente zoom sulla via).
  const isFullRemote = position.remote_type === "full_remote";
  const locCity = (position.loc_city ?? "").trim() || null;
  const locCountry = (position.loc_country ?? "").trim() || null;
  const hasLocationCard =
    isFullRemote || Boolean(locCity || locCountry || position.location);
  const mapCoords =
    !isFullRemote && position.office_lat != null && position.office_lon != null
      ? { lat: position.office_lat, lon: position.office_lon }
      : !isFullRemote
        ? gazetteerCity(locCountry, locCity)
        : null;
  const flag = countryFlag(position.loc_country_code ?? null, locCountry);
  // Indirizzo ESATTO dell'ufficio (office-geocoding): mostrato solo quando è
  // davvero un indirizzo (verificato o con civico) — il fallback città-paese
  // duplicherebbe il testo della card. Il link apre Google Maps (universal
  // link: app sul telefono, browser altrove) cercando l'INDIRIZZO testuale,
  // non le coordinate: così Maps mostra la via col civico, non un punto
  // anonimo "41°24'16.9\"N" (feedback utente 20/07).
  const exactAddress =
    position.office_address &&
    position.office_lat != null &&
    position.office_lon != null &&
    (position.office_verified === true || /\d/.test(position.office_address))
      ? position.office_address
      : null;
  const mapsUrl = exactAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(exactAddress)}`
    : null;
  // basename dei PDF: i path nel DB sono assoluti sul container VPS, ma il
  // bridge e il file-serving locale risolvono per basename.
  const cvFileName = application?.cv_pdf_path?.split("/").pop() || null;
  const clFileName = application?.cl_pdf_path?.split("/").pop() || null;

  // Valuta di visualizzazione (Impostazioni → Valuta stipendi): valuta
  // diversa da quella dell'annuncio → importo convertito ("≈") con
  // l'originale compatto tra parentesi, così il numero resta confrontabile
  // con le altre posizioni senza perdere il dato dichiarato.
  const displayCurrency = sanitizeDisplayCurrency(
    cookieStore.get(DISPLAY_CURRENCY_COOKIE)?.value,
  );
  const rates = await getExchangeRates();

  function formatSalary(
    min: number | null,
    max: number | null,
    currency?: string | null,
  ) {
    if (!min && !max) return null;
    const from = currency ?? "EUR";
    if (from === displayCurrency) {
      if (min && max)
        return `${from} ${min.toLocaleString()} – ${max.toLocaleString()}`;
      if (min) return `${from} ${min.toLocaleString()}+`;
      return null;
    }
    const conv = (v: number) =>
      Math.round(convertCurrency(v, from, displayCurrency, rates));
    const sym = currencySymbol(displayCurrency);
    const orig =
      min && max
        ? `${from} ${formatMoneyCompact(min)}–${formatMoneyCompact(max)}`
        : `${from} ${formatMoneyCompact((min ?? max)!)}+`;
    if (min && max)
      return `≈ ${sym}${conv(min).toLocaleString()} – ${conv(max).toLocaleString()} (${orig})`;
    if (min) return `≈ ${sym}${conv(min).toLocaleString()}+ (${orig})`;
    return null;
  }

  // Card Panoramica (prima card in assoluto): score + stipendio stimato +
  // modalità + categoria — i fatti decisivi tolti dall'header (19/07).
  const salaryEst = formatSalary(
    position.salary_estimated_min,
    position.salary_estimated_max,
    position.salary_estimated_currency,
  );
  const salaryDecl = formatSalary(
    position.salary_declared_min,
    position.salary_declared_max,
    position.salary_declared_currency,
  );
  // "Trovata 2026-07-17 (2 giorni fa)" — età calcolata al render server;
  // la pagina è force-dynamic quindi non resta congelata in una build.
  const foundDate = position.found_at.slice(0, 10);
  const foundDays = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(foundDate)) / 86_400_000),
  );
  const foundAge =
    foundDays === 0
      ? t("o_today")
      : foundDays === 1
        ? t("o_yesterday")
        : t("o_days_ago").replace("{n}", String(foundDays));
  // Posizione esclusa → il motivo è SEMPRE visibile in Panoramica
  // (regola utente 22/07): esclusione manuale → causa scelta + nota
  // (mig 041); esclusione agente → tag EXCLUDED nelle notes (skill
  // db-update); righe legacy senza motivo → fallback esplicito.
  const isExcluded = position.status === "excluded";
  const XR_KEYS = new Set([
    "closed",
    "not_interested",
    "mismatch",
    "already_applied",
    "company",
    "conditions",
    "other",
  ]);
  let exclusionByUser = false;
  let exclusionText: string | null = null;
  if (isExcluded) {
    const code = position.user_excluded_reason;
    if (code) {
      exclusionByUser = true;
      const label = XR_KEYS.has(code) ? t(`xr_${code}`) : code;
      const note = (position.user_excluded_note ?? "").trim();
      exclusionText =
        code === "other" && note ? note : note ? `${label} — ${note}` : label;
    } else if (analysis.excluded) {
      exclusionText =
        `${analysis.excluded.tag ? `[${analysis.excluded.tag}] ` : ""}${analysis.excluded.text}`.trim();
    } else {
      exclusionText = t("not_specified");
    }
  }
  // Panoramica SEMPRE presente: da 20/07 ospita anche titolo e azienda
  // (l'header nudo è sparito) e la fila dei giudizi in coda.
  const overviewCard = (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
      <div className="section-label mb-3">{t("overview")}</div>
      {/* Layout compatto (feedback 22/07, "come sul telefono"): su desktop
          titolo+azienda a sinistra e il gruppo score+fatti adiacente a
          destra, tutto su una fascia — niente zone vuote. Su mobile il
          gruppo va a capo sotto il titolo (score a sinistra, fatti a
          destra), che è la resa già approvata. */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
        <div className="min-w-0 md:flex-1">
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-[var(--color-white)] mb-1">
            {position.title}
          </h1>
          <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap">
            <span className="text-[13px] text-[var(--color-base)] font-medium">
              {position.company}
            </span>
            {position.location && !hasLocationCard && (
              <span className="text-[11px] text-[var(--color-muted)]">
                · {position.location}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 md:gap-6 min-w-0">
          {score && (
            <div
              className="w-14 h-14 rounded-full border-2 flex items-center justify-center font-bold text-xl shrink-0"
              style={{
                borderColor: scoreColor(score.total_score),
                color: scoreColor(score.total_score),
              }}
            >
              {score.total_score}
            </div>
          )}
          {/* Fatti: label e valore su due colonne adiacenti, niente vuoto
              tra label e valore (feedback 22/07). */}
          <div className="ml-auto md:ml-0 grid grid-cols-[auto_auto] gap-x-5 gap-y-1.5 items-baseline min-w-0">
            {(salaryEst || salaryDecl) && (
              <OverviewRow
                label={t(
                  salaryEst ? "d_salary_estimated" : "d_salary_declared",
                )}
              >
                {(salaryEst ?? salaryDecl)!}
              </OverviewRow>
            )}
            {position.remote_type && (
              <OverviewRow label={t("o_mode")}>
                {t(`rt_${position.remote_type}`)}
              </OverviewRow>
            )}
            {position.role_family && (
              <OverviewRow label={t("o_category")}>
                <span className="inline-flex items-center gap-1.5 max-w-full">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: colorForFamily(position.role_family.trim()),
                    }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{position.role_family}</span>
                </span>
              </OverviewRow>
            )}
            {position.source && (
              <OverviewRow label={t("d_source")}>
                {position.url ? (
                  <a
                    href={position.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                  >
                    {sourceDisplayName(position.source)} ↗
                  </a>
                ) : (
                  sourceDisplayName(position.source)
                )}
              </OverviewRow>
            )}
            <OverviewRow label={t("d_found")}>
              {`${foundDate} (${foundAge})`}
            </OverviewRow>
          </div>
        </div>
      </div>
      {/* Banner motivo esclusione: sempre presente su una posizione
          esclusa, chiunque l'abbia esclusa. */}
      {isExcluded && (
        <div
          className="mt-4 rounded-lg border p-3"
          style={{
            borderColor: "var(--color-red)",
            background: "color-mix(in srgb, var(--color-red) 9%, transparent)",
          }}
        >
          <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-red)] mb-1">
            {exclusionByUser ? t("excl_by_user") : t("excl_by_team")}
          </div>
          <p className="text-[11px] text-[var(--color-base)] leading-relaxed">
            {exclusionText}
          </p>
        </div>
      )}
      {/* Giudizio rapido in coda alla Panoramica: stessa fila di /swipe
            (evidenzia quello già dato; resta anche nel popup). */}
      {feedbackEnabled && position.legacy_id != null && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <FeedbackButtons
            legacyId={position.legacy_id}
            initialVerdict={initialVerdict}
            initialExcludedReason={position.user_excluded_reason ?? null}
            initialExcludedNote={position.user_excluded_note ?? null}
            initialApplied={position.status === "applied"}
            initialAppliedAt={application?.applied_at ?? null}
          />
        </div>
      )}
    </div>
  );

  // Card Località: città + paese (bandiera) + mini-mappa zoomabile col pin.
  // CON mappa → prima card della colonna principale (prima della JD, scelta
  // utente 19/07); senza mappa → tra i metadati della colonna destra.
  const locationCard = hasLocationCard ? (
    <div
      id="location"
      className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
    >
      <div className="section-label mb-3">{t("location")}</div>
      <div
        className={`flex items-start justify-between gap-3 ${mapCoords ? "mb-3" : ""}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {flag && (
            <span className="text-[24px] leading-none" aria-hidden="true">
              {flag}
            </span>
          )}
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--color-white)] truncate">
              {isFullRemote
                ? t("rt_full_remote")
                : (locCity ?? position.location)}
            </div>
            {locCountry && (
              <div className="text-[11px] text-[var(--color-muted)]">
                {locCountry}
              </div>
            )}
          </div>
        </div>
        {exactAddress && mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t("open_in_maps")}
            className="max-w-[55%] shrink-0 text-right text-[10px] leading-snug text-[var(--color-blue)] no-underline transition-colors hover:text-[var(--color-bright)]"
          >
            {exactAddress} ↗
          </a>
        )}
      </div>
      {/* Full remote: nessuna mappa, ma l'HQ dell'azienda sì — con
          fallback esplicito quando l'arricchimento non l'ha trovato. */}
      {isFullRemote && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex items-baseline gap-3">
          <span className="text-[10px] text-[var(--color-dim)]">
            {t("c_hq")}
          </span>
          <span className="text-[11px] text-[var(--color-base)] min-w-0 break-words">
            {company?.hq?.trim() || t("not_specified")}
          </span>
        </div>
      )}
      {mapCoords && (
        <PositionMapCardLazy lat={mapCoords.lat} lon={mapCoords.lon} />
      )}
    </div>
  ) : null;

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* Dopo 2s di permanenza la posizione perde il marker "nuova"
          (stato client-side, vedi lib/seen-positions). Si usa position.id
          perché è lo stesso id dei link riga nelle tabelle. */}
      <MarkSeenAfterView id={position.id} />
      {/* ── Breadcrumb ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 text-[10px]">
        <Link
          href="/dashboard"
          className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          {t("bc_dashboard")}
        </Link>
        <span className="text-[var(--color-border)]">/</span>
        <Link
          href="/positions"
          className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          {t("bc_positions")}
        </Link>
        <span className="text-[var(--color-border)]">/</span>
        <span className="text-[var(--color-muted)]">
          {position.legacy_id
            ? `JHT-${String(position.legacy_id).padStart(3, "0")}`
            : position.id.slice(0, 8)}
        </span>
      </div>

      {/* Precedente/Prossima SUBITO sotto il breadcrumb (scelta utente
          20/07): sequenza della lista con filtri e ordinamento correnti.
          Titolo e azienda vivono nella card Panoramica. */}
      <div className="mb-5 -mt-2">
        <PrevNextNav id={position.id} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column ─────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Panoramica: score, stipendio, modalità, categoria. */}
          {overviewCard}

          {/* Località CON mappa: prima della descrizione. */}
          {mapCoords && locationCard}

          {/* Job description — sintesi ottimizzata dell'Analista (jd_summary,
              markdown, lingua utente). Fallback al testo grezzo per le
              posizioni legacy non ancora ri-analizzate. */}
          {(position.jd_summary ||
            position.jd_text ||
            position.requirements) && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-3">{t("job_description")}</div>
              {position.jd_summary ? (
                <>
                  <MarkdownLite
                    text={position.jd_summary}
                    className="text-[12px] text-[var(--color-base)] leading-relaxed"
                  />
                  {position.url && (
                    <a
                      href={position.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                    >
                      {t("original_listing")} ↗
                    </a>
                  )}
                </>
              ) : (
                <>
                  {position.requirements && (
                    <div className="mb-4">
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("requirements")}
                      </div>
                      <pre className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap font-sans">
                        {position.requirements.slice(0, 2000)}
                        {position.requirements.length > 2000 ? "…" : ""}
                      </pre>
                    </div>
                  )}
                  {position.jd_text && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("full_description")}
                      </div>
                      <pre className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap font-sans">
                        {position.jd_text.slice(0, 3000)}
                        {position.jd_text.length > 3000 ? "…" : ""}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Score breakdown */}
          {score && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-4">{t("score_breakdown")}</div>
              <div className="space-y-3">
                <ScoreBar
                  label={t("sb_stack_match")}
                  value={score.stack_match}
                  max={40}
                  detail={scoreWhy.perDimension.stack}
                />
                <ScoreBar
                  label={t("sb_remote_fit")}
                  value={score.remote_fit}
                  max={25}
                  detail={scoreWhy.perDimension.remote}
                />
                <ScoreBar
                  label={t("sb_salary_fit")}
                  value={score.salary_fit}
                  max={20}
                  detail={scoreWhy.perDimension.salary}
                />
                <ScoreBar
                  label={t("sb_experience_fit")}
                  value={score.experience_fit}
                  max={10}
                  detail={scoreWhy.perDimension.experience}
                />
                <ScoreBar
                  label={t("sb_strategic_fit")}
                  value={score.strategic_fit}
                  max={15}
                  detail={scoreWhy.perDimension.strategic}
                />
              </div>
              {/* Sotto le barre: il commento che vale per l'intero score.
                  `rest` è il breakdown non attribuibile a una dimensione —
                  senza di lui gli score vecchi perderebbero il loro testo. */}
              {(scoreWhy.rest || score.notes) && (
                <div className="mt-4 border-t border-[var(--color-border)] pt-3 space-y-3">
                  {scoreWhy.rest && (
                    <MarkdownLite
                      text={scoreWhy.rest}
                      className="text-[11px] text-[var(--color-muted)] leading-relaxed"
                    />
                  )}
                  {score.notes && (
                    <MarkdownLite
                      text={score.notes}
                      className="text-[11px] text-[var(--color-muted)] leading-relaxed"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Application */}
          {application && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-4">{t("application")}</div>

              {/* Stato candidatura + verdetto + voto del Critico in evidenza */}
              <div className="flex items-center gap-2.5 flex-wrap mb-4">
                {(() => {
                  const c =
                    APP_STATUS_COLORS[application.status] ?? "var(--color-dim)";
                  return (
                    <span
                      className="text-[10px] font-semibold px-3 py-1 rounded-full border"
                      style={{
                        color: c,
                        borderColor: c,
                        background: `${c}18`,
                      }}
                    >
                      {T[`as_${application.status}`]
                        ? t(`as_${application.status}`)
                        : application.status}
                    </span>
                  );
                })()}
                {application.critic_verdict &&
                  (() => {
                    const c =
                      VERDICT_COLORS[application.critic_verdict] ??
                      "var(--color-dim)";
                    return (
                      <span
                        className="text-[10px] font-semibold px-3 py-1 rounded-full border"
                        style={{
                          color: c,
                          borderColor: c,
                          background: `${c}14`,
                        }}
                      >
                        {t("a_critic")}: {application.critic_verdict}
                      </span>
                    );
                  })()}
                {application.critic_score != null && (
                  <span className="text-[11px] text-[var(--color-muted)]">
                    {t("a_score")}:{" "}
                    <span className="font-semibold text-[var(--color-base)] tabular-nums">
                      {application.critic_score}/10
                    </span>
                  </span>
                )}
              </div>

              {/* Date + canale + round colloquio */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <InfoRow
                  label={t("a_written")}
                  value={
                    application.written_at
                      ? application.written_at.slice(0, 10)
                      : "—"
                  }
                />
                <InfoRow
                  label={t("a_sent")}
                  value={
                    application.applied_at
                      ? application.applied_at.slice(0, 10)
                      : "—"
                  }
                />
                {application.applied_via && (
                  <InfoRow label={t("a_via")} value={application.applied_via} />
                )}
                {application.interview_round && (
                  <InfoRow
                    label={t("a_interview_round")}
                    value={`#${application.interview_round}`}
                  />
                )}
              </div>

              {/* Feedback completo del Critico (prima si vedeva solo il verdetto) */}
              {application.critic_notes && (
                <div className="mb-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
                  <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                    {t("a_critic_feedback")}
                  </div>
                  <MarkdownLite
                    text={application.critic_notes}
                    className="text-[11px] text-[var(--color-muted)] leading-relaxed"
                  />
                </div>
              )}

              {/* Download PDF via bridge on-demand + link Drive (legacy) */}
              <div className="flex gap-3 flex-wrap">
                {cvFileName && (
                  <CvDownloadButton
                    fileName={cvFileName}
                    cloudMode={cloudMode}
                    color="var(--color-green)"
                    labels={{
                      idle: t("download_cv"),
                      preparing: t("cv_preparing"),
                      error: t("cv_dl_error"),
                    }}
                  />
                )}
                {clFileName && (
                  <CvDownloadButton
                    fileName={clFileName}
                    cloudMode={cloudMode}
                    color="var(--color-blue)"
                    labels={{
                      idle: t("download_cl"),
                      preparing: t("cv_preparing"),
                      error: t("cv_dl_error"),
                    }}
                  />
                )}
                {application.cv_drive_id && (
                  <a
                    href={`https://drive.google.com/file/d/${application.cv_drive_id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                    style={{
                      borderColor: "var(--color-green)",
                      color: "var(--color-green)",
                    }}
                  >
                    {t("cv_drive")} ↗
                  </a>
                )}
                {application.cl_drive_id && (
                  <a
                    href={`https://drive.google.com/file/d/${application.cl_drive_id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                    style={{
                      borderColor: "var(--color-blue)",
                      color: "var(--color-blue)",
                    }}
                  >
                    {t("cover_letter_drive")} ↗
                  </a>
                )}
              </div>
              {(cvFileName || clFileName) && cloudMode && (
                <p className="mt-2.5 text-[10px] text-[var(--color-dim)] leading-relaxed">
                  {t("cv_bridge_hint")}
                </p>
              )}

              {application.response && (
                <div className="mt-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
                  <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-1">
                    {t("response_received")}
                  </div>
                  <p className="text-[11px] text-[var(--color-base)]">
                    {application.response}
                  </p>
                  {application.response_at && (
                    <span className="text-[10px] text-[var(--color-dim)]">
                      {application.response_at.slice(0, 10)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right column ────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Località testuale (senza mappa): resta qui tra i metadati.
              La versione CON mappa vive in cima alla colonna principale. */}
          {hasLocationCard && !mapCoords && locationCard}

          {/* La vecchia card Dettagli è confluita nella Panoramica (19/07):
              fonte e data lì; "trovata da" non interessa l'utente; il link
              all'annuncio vive nell'header e nella card JD. */}

          {/* Company */}
          {company && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-3">{t("company")}</div>
              {/* [LOGO-V/B] Il logo vive SOLO qui: grande, col nome
                  dell'azienda accanto. Il lato destro della riga si riempie
                  con verdetto e Glassdoor quando esistono — niente vuoti
                  fissi (feedback 22/07). */}
              <div className="flex items-center gap-3 mb-3">
                {company.logo && (
                  <Avatar
                    name={company.name}
                    src={company.logo}
                    size="lg"
                    square
                    imgFit="contain"
                    className="shrink-0"
                  />
                )}
                <div className="text-[13px] font-semibold text-[var(--color-white)] min-w-0 flex-1 truncate">
                  {company.name}
                </div>
                {(company.verdict || company.glassdoor_rating) && (
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {company.verdict && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded border"
                        style={{
                          color:
                            company.verdict === "GO"
                              ? "var(--color-green)"
                              : company.verdict === "CAUTIOUS"
                                ? "var(--color-yellow)"
                                : "var(--color-red)",
                          borderColor:
                            company.verdict === "GO"
                              ? "var(--color-green)"
                              : company.verdict === "CAUTIOUS"
                                ? "var(--color-yellow)"
                                : "var(--color-red)",
                        }}
                      >
                        {company.verdict}
                      </span>
                    )}
                    {company.glassdoor_rating && (
                      <span className="text-[10px] text-[var(--color-muted)]">
                        Glassdoor: {company.glassdoor_rating}/5
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {company.hq && <InfoRow label={t("c_hq")} value={company.hq} />}
                {company.sector && (
                  <InfoRow label={t("c_sector")} value={company.sector} />
                )}
                {company.size && (
                  <InfoRow label={t("c_size")} value={company.size} />
                )}
                {company.culture_notes && (
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-2">
                    {company.culture_notes}
                  </p>
                )}
                {company.red_flags && (
                  <p
                    className="text-[11px] leading-relaxed mt-2"
                    style={{ color: "var(--color-red)" }}
                  >
                    <span aria-hidden="true">⚠</span> {company.red_flags}
                  </p>
                )}
              </div>
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                >
                  {t("company_website")} ↗
                </a>
              )}
            </div>
          )}

          {/* Team analysis — parsing del campo notes (vedi parse-analysis) */}
          {position.notes && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-3">{t("team_analysis")}</div>

              {analysis.raw ? (
                <p className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap">
                  {position.notes}
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Requisiti chiave estratti (seniority, esperienza, …) */}
                  {analysis.meta.length > 0 && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("an_requirements")}
                      </div>
                      <div className="space-y-2">
                        {analysis.meta.map((m) => (
                          <InfoRow
                            key={m.key}
                            label={t(`meta_${m.key}`)}
                            value={vt(m.value)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Motivo esclusione (banner rosso) */}
                  {analysis.excluded && (
                    <div
                      className="rounded-lg border p-3"
                      style={{
                        borderColor: "var(--color-red)",
                        background:
                          "color-mix(in srgb, var(--color-red) 9%, transparent)",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
                          style={{
                            color: "var(--color-red)",
                            borderColor: "var(--color-red)",
                          }}
                        >
                          {analysis.excluded.tag || t("an_excluded")}
                        </span>
                        <span className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-red)]">
                          {t("an_excluded")}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--color-base)] leading-relaxed">
                        {analysis.excluded.text}
                      </p>
                    </div>
                  )}

                  {/* Disallineamenti taggati (STACK / GEO / SENIORITY / …) */}
                  {analysis.mismatches.length > 0 && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("an_mismatches")}
                      </div>
                      <ul className="space-y-2.5">
                        {analysis.mismatches.map((mm, i) => (
                          <li key={i} className="flex gap-2">
                            {mm.tag && (
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 h-fit"
                                style={{
                                  color: tagColor(mm.tag),
                                  borderColor: tagColor(mm.tag),
                                }}
                              >
                                {mm.tag}
                              </span>
                            )}
                            <span className="text-[11px] text-[var(--color-muted)] leading-relaxed min-w-0 break-words">
                              {mm.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Prosa libera residua */}
                  {analysis.prose && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("an_notes")}
                      </div>
                      <MarkdownLite
                        text={analysis.prose}
                        className="text-[11px] text-[var(--color-muted)] leading-relaxed"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Azioni di coda (scelta utente 20/07): Feedback e richieste +
          annuncio originale come ULTIMI elementi, più prev/next ripetuto. */}
      <div className="mt-6 space-y-4">
        {position.legacy_id != null && (
          <div className="mt-4 flex items-center gap-3">
            <TeamActionsSheet
              active={
                initialVerdict != null ||
                position.geocode_requested === true ||
                position.recheck_requested === true ||
                position.write_requested === true ||
                !!position.user_excluded_reason ||
                tickets.some((tk) => tk.status !== "resolved")
              }
              feedback={
                feedbackEnabled ? (
                  <FeedbackButtons
                    legacyId={position.legacy_id}
                    initialVerdict={initialVerdict}
                    initialExcludedReason={
                      position.user_excluded_reason ?? null
                    }
                    initialExcludedNote={position.user_excluded_note ?? null}
                  />
                ) : undefined
              }
              actions={
                <>
                  {/* Geocoding-on-demand (V8): l'utente richiede coordinate
                      ufficio precise. Sempre attivo: l'Analista skippa
                      autonomamente quando non ha materiale geografico utile
                      (vedi BACKLOG [Cloud Sync — Geocoding opt-in/out]). */}
                  <GeocodeRequestButton
                    legacyId={position.legacy_id}
                    initialRequested={position.geocode_requested === true}
                    alreadyGeocoded={position.office_geocoded === true}
                  />
                  {/* Recheck ON-DEMAND (mig 042): il recheck non è più
                      automatico, l'utente lo richiede qui → l'Analista
                      ri-verifica la liveness. */}
                  <RecheckButton
                    legacyId={position.legacy_id}
                    initialRequested={position.recheck_requested === true}
                    lastOpenCheck={position.last_open_check}
                  />
                  {(() => {
                    // Writer-on-demand (V6): il button e' visibile solo se la
                    // posizione e' nello stato giusto. Il Capitano spawna lo
                    // Scrittore quando il flag e' acceso (vedi BACKLOG
                    // [JHT-WRITER-ON-DEMAND]).
                    const wrongStatus = position.status !== "scored";
                    const alreadyWriting = application != null;
                    const isDisabled = wrongStatus || alreadyWriting;
                    const reason = alreadyWriting
                      ? t("cv_in_progress")
                      : wrongStatus
                        ? t("cv_only_from_scored").replace(
                            "{status}",
                            position.status,
                          )
                        : undefined;
                    return (
                      <WriteRequestButton
                        legacyId={position.legacy_id}
                        initialRequested={position.write_requested === true}
                        disabled={isDisabled}
                        disabledReason={reason}
                      />
                    );
                  })()}
                  {/* Esclusione manuale utente (mig 041): l'utente esclude
                      l'offerta con una causa → status 'excluded', gli agenti
                      smettono di ri-verificarne la liveness. */}
                  <ExcludeButton
                    legacyId={position.legacy_id}
                    status={position.status}
                    initialReason={position.user_excluded_reason ?? null}
                  />
                </>
              }
              tickets={
                <TicketPanel
                  legacyId={position.legacy_id}
                  tickets={tickets}
                  hideTitle
                />
              }
            />
            {position.url && (
              <a
                href={position.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                style={{
                  borderColor: "var(--color-blue)",
                  color: "var(--color-blue)",
                }}
              >
                {t("original_listing")} ↗
              </a>
            )}
          </div>
        )}
        <PrevNextNav id={position.id} />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-[var(--color-dim)] shrink-0">
        {label}
      </span>
      <span className="text-[11px] text-[var(--color-base)] text-right">
        {value}
      </span>
    </div>
  );
}

// Riga della card Panoramica: due celle (label + valore) del grid a due
// colonne — il fragment si appiattisce nelle colonne del grid padre, così
// label e valore restano adiacenti qualunque sia la larghezza della card.
function OverviewRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <span className="text-[10px] text-[var(--color-dim)]">{label}</span>
      <span className="text-[11px] text-[var(--color-base)] text-right min-w-0 break-words">
        {children}
      </span>
    </>
  );
}
