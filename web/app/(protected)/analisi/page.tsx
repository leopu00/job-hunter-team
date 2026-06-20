import Link from "next/link";
import { headers } from "next/headers";
import { getDashboardStats } from "@/lib/queries";
import PipelineFlow from "@/app/components/PipelineFlow";
import { getServerLocale } from "@/lib/server-locale";
import { getDashboardT } from "@/lib/dashboard-i18n";
import {
  getDemoDashboardData,
  isDashboardDemoMode,
} from "@/lib/dashboard-demo";

const STATUS_COLORS: Record<string, string> = {
  new: "var(--color-muted)",
  checked: "var(--color-blue)",
  scored: "var(--color-purple)",
  writing: "var(--color-yellow)",
  review: "var(--color-orange)",
  ready: "var(--color-ready)",
  applied: "var(--color-green)",
  response: "#58a6ff",
  excluded: "var(--color-red)",
};

// i18n: dict inline 7 lingue per le stringhe specifiche di questa pagina
// (sezione Conversion rate / mini-funnel). Le label di pipeline arrivano già
// tradotte da getDashboardT.
const AT: Record<string, Record<string, string>> = {
  conversion_rate: {
    it: "Conversion rate",
    en: "Conversion rate",
    hu: "Konverziós ráta",
    es: "Tasa de conversión",
    de: "Konversionsrate",
    fr: "Taux de conversion",
    pt: "Taxa de conversão",
  },
  pipeline_flow: {
    it: "Pipeline flow",
    en: "Pipeline flow",
    hu: "Folyamat-áramlás",
    es: "Flujo del pipeline",
    de: "Pipeline-Fluss",
    fr: "Flux du pipeline",
    pt: "Fluxo do pipeline",
  },
  analyst_filter: {
    it: "Filtro analisti",
    en: "Analyst filter",
    hu: "Elemző szűrő",
    es: "Filtro de analistas",
    de: "Analysten-Filter",
    fr: "Filtre des analystes",
    pt: "Filtro de analistas",
  },
  critic_verdict: {
    it: "Verdetto critici",
    en: "Critic verdict",
    hu: "Kritikus ítélet",
    es: "Veredicto de críticos",
    de: "Kritiker-Urteil",
    fr: "Verdict des critiques",
    pt: "Veredito dos críticos",
  },
  final_throughput: {
    it: "Throughput finale",
    en: "Final throughput",
    hu: "Végső áteresztőképesség",
    es: "Rendimiento final",
    de: "Endgültiger Durchsatz",
    fr: "Débit final",
    pt: "Taxa de saída final",
  },
  found_lc: {
    it: "trovate",
    en: "found",
    hu: "talált",
    es: "encontradas",
    de: "gefunden",
    fr: "trouvées",
    pt: "encontradas",
  },
  excluded_lc: {
    it: "escluse",
    en: "excluded",
    hu: "kizárva",
    es: "excluidas",
    de: "ausgeschlossen",
    fr: "exclues",
    pt: "excluídas",
  },
  exclusions: {
    it: "esclusioni",
    en: "exclusions",
    hu: "kizárás",
    es: "exclusiones",
    de: "Ausschlüsse",
    fr: "exclusions",
    pt: "exclusões",
  },
  passed_to_analysis: {
    it: "passate all'analisi",
    en: "passed to analysis",
    hu: "elemzésre került",
    es: "pasaron al análisis",
    de: "zur Analyse weitergeleitet",
    fr: "passées à l'analyse",
    pt: "passaram para a análise",
  },
  passed_lc: {
    it: "passate",
    en: "passed",
    hu: "továbbadva",
    es: "pasaron",
    de: "weitergeleitet",
    fr: "passées",
    pt: "passaram",
  },
  reviewed_lc: {
    it: "revisionate",
    en: "reviewed",
    hu: "felülvizsgálva",
    es: "revisadas",
    de: "überprüft",
    fr: "revues",
    pt: "revisadas",
  },
  needs_work: {
    it: "needs work",
    en: "needs work",
    hu: "javítandó",
    es: "necesita trabajo",
    de: "Nachbesserung",
    fr: "à retravailler",
    pt: "precisa de trabalho",
  },
  needs_lc: {
    it: "needs",
    en: "needs",
    hu: "javít.",
    es: "necesita",
    de: "Nachbess.",
    fr: "à revoir",
    pt: "precisa",
  },
  ready_lc: {
    it: "pronte",
    en: "ready",
    hu: "kész",
    es: "listas",
    de: "bereit",
    fr: "prêtes",
    pt: "prontas",
  },
  out_of_10_found: {
    it: "su 10 trovate",
    en: "out of 10 found",
    hu: "10 találatból",
    es: "de 10 encontradas",
    de: "von 10 gefundenen",
    fr: "sur 10 trouvées",
    pt: "de 10 encontradas",
  },
  arrive_ready: {
    it: "arrivano pronte",
    en: "arrive ready",
    hu: "lesz kész",
    es: "llegan listas",
    de: "werden bereit",
    fr: "arrivent prêtes",
    pt: "chegam prontas",
  },
  analyzed_lc: {
    it: "analizzate",
    en: "analyzed",
    hu: "elemezve",
    es: "analizadas",
    de: "analysiert",
    fr: "analysées",
    pt: "analisadas",
  },
};

export default async function AnalisiPage() {
  const locale = getServerLocale();
  const t = getDashboardT(locale);
  const tr = (k: string) => AT[k]?.[locale] ?? AT[k]?.en ?? k;

  const hdrs = await headers();
  const demoMode = isDashboardDemoMode(hdrs.get("x-search"));
  const demoData = demoMode ? getDemoDashboardData() : null;

  const stats = demoData ? demoData.stats : await getDashboardStats();

  const activeTotal = stats.total - stats.excluded;

  // Conversion rate widget metrics
  const analystExcludedPct =
    stats.total > 0 ? Math.round((stats.excluded / stats.total) * 100) : 0;
  const analystKeptPct = 100 - analystExcludedPct;

  // Funnel end-to-end: quante posizioni "uscite vive" dal pipeline
  // (ready/applied/response = hanno passato Analista + Scorer + Critico)
  // su quelle trovate. È il dato più sintetico — il throughput vero.
  const funnelOutput = stats.ready + stats.applied + stats.response;
  const funnelRate = stats.total > 0 ? (funnelOutput / stats.total) * 100 : 0;
  const funnelRatePct = Math.round(funnelRate);
  // "Su 10 trovate → N arrivano pronte". 1 decimale per non perdere
  // info quando il rate è basso (es. 1.5 su 10 — arrotondato a 2 sarebbe
  // ottimistico, a 1 pessimistico).
  const funnelPer10 = (funnelRate / 10).toFixed(1).replace(/\.0$/, "");

  const pipeline = [
    {
      key: "found",
      label: t.found,
      count: stats.total,
      color: "var(--color-blue)",
      href: "/positions",
      basis: stats.total,
      note:
        stats.excluded > 0
          ? `${stats.excluded} ${t.status_excluded.toLowerCase()}`
          : undefined,
    },
    {
      key: "new",
      label: t.p_new,
      count: stats.new,
      color: STATUS_COLORS.new,
      href: "/positions?status=new",
      basis: activeTotal,
    },
    {
      key: "checked",
      label: t.p_checked,
      count: stats.checked,
      color: STATUS_COLORS.checked,
      href: "/positions?status=checked",
      basis: activeTotal,
    },
    {
      key: "scored",
      label: t.p_scored,
      count: stats.scored,
      color: STATUS_COLORS.scored,
      href: "/positions?status=scored",
      basis: activeTotal,
    },
    {
      key: "writing",
      label: t.p_writing,
      count: stats.writing,
      color: STATUS_COLORS.writing,
      href: "/positions?status=writing",
      basis: activeTotal,
    },
    {
      key: "review",
      label: t.p_review,
      count: stats.review,
      color: STATUS_COLORS.review,
      href: "/positions?status=review",
      basis: activeTotal,
    },
    {
      key: "ready",
      label: t.p_ready,
      count: stats.ready,
      color: STATUS_COLORS.ready,
      href: "/positions?status=ready",
      basis: activeTotal,
    },
    {
      key: "applied",
      label: t.p_applied,
      count: stats.applied,
      color: STATUS_COLORS.applied,
      href: "/positions?status=applied",
      basis: activeTotal,
    },
  ];

  // Box riepilogo spostate dalla pipeline della dashboard: gli estremi del
  // funnel (Trovate = totale ingresso, Inviate = output finale).
  const summaryBoxes = ["found", "applied"]
    .map((k) => pipeline.find((s) => s.key === k))
    .filter((s): s is (typeof pipeline)[number] => Boolean(s));

  return (
    <div style={{ animation: "fade-in 0.35s ease both", position: "relative" }}>
      <div
        style={{
          position: "relative",
          background: "var(--color-deep)",
        }}
      >
        <div className="max-w-6xl mx-auto px-5 pt-8 pb-8">
          {/* ── Box riepilogo pipeline: Trovate + Inviate ───────────── */}
          <div className="section-label mb-4">{t.pipeline}</div>
          <div
            className="grid grid-cols-2 gap-3 mb-8"
            style={{ animation: "fade-in 0.35s ease both" }}
          >
            {summaryBoxes.map((step, i) => {
              const percent =
                step.basis > 0
                  ? Math.round((step.count / step.basis) * 100)
                  : 0;
              return (
                <Link
                  key={step.key}
                  href={step.href}
                  className="min-h-[112px] flex flex-col justify-between bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] hover:bg-[var(--color-row)] transition-colors text-left no-underline"
                  style={{ animation: `fade-in 0.4s ease ${i * 0.04}s both` }}
                >
                  <div>
                    <div
                      className="text-[9px] font-semibold tracking-[0.14em] uppercase mb-3 truncate"
                      style={{ color: "var(--color-dim)" }}
                      title={step.label}
                    >
                      {step.label}
                    </div>
                    <div
                      className="text-3xl font-bold leading-none tracking-tight"
                      style={{ color: step.color }}
                    >
                      {step.count}
                    </div>
                  </div>
                  <div
                    className="h-0.5 rounded-full mt-3 mb-1 overflow-hidden"
                    style={{ background: "var(--color-border)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(percent, 100)}%`,
                        background: step.color,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <div className="text-[9px] text-[var(--color-dim)]">
                    {step.note ?? `${percent}%`}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* ── Conversion rate ─────────────────────────────────────── */}
          <div className="section-label mb-4">{tr("conversion_rate")}</div>
          <div
            className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"
            style={{ animation: "fade-in 0.35s ease both" }}
          >
            {/* Filtro Analisti: % escluse al primo check (status='excluded') */}
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">{tr("analyst_filter")}</span>
                <span className="text-[10px] text-[var(--color-dim)]">
                  {stats.total} {tr("found_lc")} · {stats.excluded}{" "}
                  {tr("excluded_lc")}
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                <span
                  className="text-3xl font-bold tracking-tight"
                  style={{ color: "var(--color-red)" }}
                >
                  {analystExcludedPct}%
                </span>
                <span className="text-[10px] text-[var(--color-muted)]">
                  {tr("exclusions")} · {analystKeptPct}%{" "}
                  {tr("passed_to_analysis")}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden flex"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  style={{
                    width: `${analystKeptPct}%`,
                    background: "var(--color-green)",
                    opacity: 0.85,
                  }}
                />
                <div
                  style={{
                    width: `${analystExcludedPct}%`,
                    background: "var(--color-red)",
                    opacity: 0.85,
                  }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-[var(--color-dim)] mt-1">
                <span style={{ color: "var(--color-green)" }}>
                  {tr("passed_lc")} · {stats.total - stats.excluded}
                </span>
                <span style={{ color: "var(--color-red)" }}>
                  {tr("excluded_lc")} · {stats.excluded}
                </span>
              </div>
            </div>

            {/* Funnel end-to-end: throughput vero del team — quante posizioni
            trovate diventano "ready" (CV pronto a partire) o oltre. */}
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">{tr("final_throughput")}</span>
                <span className="text-[10px] text-[var(--color-dim)]">
                  {funnelOutput}/{stats.total} {tr("ready_lc")}
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                <span
                  className="text-3xl font-bold tracking-tight"
                  style={{
                    color:
                      funnelRatePct >= 25
                        ? "var(--color-green)"
                        : funnelRatePct >= 10
                          ? "var(--color-yellow)"
                          : "var(--color-orange)",
                  }}
                >
                  {funnelRatePct}%
                </span>
                <span className="text-[10px] text-[var(--color-muted)]">
                  {tr("out_of_10_found")} · {funnelPer10} {tr("arrive_ready")}
                </span>
              </div>
              {/* Mini-funnel: 3 step "trovate → analizzate → pronte" */}
              <div className="space-y-2">
                {[
                  {
                    label: tr("found_lc"),
                    n: stats.total,
                    pct: 100,
                    color: "var(--color-blue)",
                  },
                  {
                    label: tr("analyzed_lc"),
                    n: stats.total - stats.excluded,
                    pct:
                      stats.total > 0
                        ? Math.round(
                            ((stats.total - stats.excluded) / stats.total) *
                              100,
                          )
                        : 0,
                    color: "var(--color-purple)",
                  },
                  {
                    label: tr("ready_lc"),
                    n: funnelOutput,
                    pct: funnelRatePct,
                    color: "var(--color-green)",
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2">
                    <span
                      className="text-[9px] font-semibold w-20 tracking-[0.08em] uppercase"
                      style={{ color: row.color }}
                    >
                      {row.label}
                    </span>
                    <div
                      className="flex-1 h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--color-border)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${row.pct}%`,
                          background: row.color,
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <span
                      className="text-[10px] font-semibold tabular-nums w-8 text-right"
                      style={{ color: row.color }}
                    >
                      {row.n}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Pipeline flow: area chart con linea ondulante (in fondo) ─ */}
          <div
            className="mb-8"
            style={{ animation: "fade-in 0.35s ease both 0.12s" }}
          >
            <PipelineFlow steps={pipeline} title={tr("pipeline_flow")} />
          </div>
        </div>
      </div>
    </div>
  );
}
