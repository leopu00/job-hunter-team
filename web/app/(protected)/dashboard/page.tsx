import Link from "next/link";
import dynamic from "next/dynamic";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getDashboardStats,
  getDashboardPositions,
  getPendingMessages,
  getCriticVerdictTotals,
} from "@/lib/queries";
import type { DashboardPosition } from "@/lib/queries";
import DashboardLinkedCharts from "@/app/components/DashboardLinkedCharts";
import PipelineFlow from "@/app/components/PipelineFlow";
import { isSupabaseConfigured, isLocalOnlyMode } from "@/lib/workspace";
import { readWorkspaceProfile } from "@/lib/profile-reader";
import { getServerLocale } from "@/lib/server-locale";
import { getDashboardT } from "@/lib/dashboard-i18n";
import { createClient } from "@/lib/supabase/server";
import { isLocalRequestFromHeaders } from "@/lib/auth";
import {
  getDemoDashboardData,
  isDashboardDemoMode,
} from "@/lib/dashboard-demo";
import PendingMessagesCard from "@/app/components/PendingMessagesCard";
import VpsLifecycleCard from "@/app/components/VpsLifecycleCard";
import OnboardingPopup from "@/app/components/OnboardingPopup";

const OnboardingWizard = dynamic(
  () => import("@/app/components/OnboardingWizard"),
);

const STATUS_COLORS: Record<string, string> = {
  new: "var(--color-muted)",
  checked: "var(--color-blue)",
  scored: "var(--color-purple)",
  writing: "var(--color-yellow)",
  review: "var(--color-orange)",
  ready: "#7fffb2",
  applied: "var(--color-green)",
  response: "#58a6ff",
  excluded: "var(--color-red)",
};

export default async function DashboardPage() {
  const locale = getServerLocale();
  const t = getDashboardT(locale);

  // Routing precedence (vedi docs/internal/2026-05-19-dashboard-routing-cases.md):
  //   1. demo mode  → demo data (più sotto)
  //   2. Supabase + utente loggato → 3-way cloud routing su user_onboarding_state,
  //      ANCHE su localhost: se l'utente ha già fatto sign-in con un account
  //      VPS-paired, il funnel onboarding-locale (pensato per PC standalone con
  //      container Docker) non ha senso e fallisce su WSL.
  //   3. Supabase + no user + localhost → PC standalone: check ~/.jht/profile/.
  //   4. Supabase + no user + remote → il middleware redirecta a /login.
  //   5. No Supabase env → pure local deploy: check ~/.jht/profile/.
  const hdrs = await headers();
  const localRequest = isLocalRequestFromHeaders(hdrs);
  const demoMode = isDashboardDemoMode(hdrs.get("x-search"));

  // JHT-LOCAL-NO-API: salta auth check Supabase in local-only mode.
  // Cade direttamente nel branch "no-Supabase" che legge solo dal workspace.
  if (isSupabaseConfigured && !demoMode && !isLocalOnlyMode()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user && localRequest) {
      if (readWorkspaceProfile() === null) redirect("/onboarding");
    }
  } else if (!demoMode) {
    if (readWorkspaceProfile() === null) redirect("/onboarding");
  }

  const demoData = demoMode ? getDemoDashboardData() : null;
  // Demo: le posizioni demo non hanno role_family/loc strutturati → li
  // mappo a null (i grafici li mostrano come "Da categorizzare"/"Senza
  // paese", la tabella resta pienamente funzionante).
  const demoDashPositions: DashboardPosition[] = demoData
    ? demoData.positions.map((p) => ({
        id: p.id,
        legacy_id: p.legacy_id ?? null,
        title: p.title ?? null,
        company: p.company ?? null,
        location: p.location ?? null,
        remote_type: p.remote_type ?? null,
        status: p.status,
        score: p.score ?? null,
        role_family: null,
        loc_country: null,
        loc_city: null,
        found_at: p.found_at ?? null,
        last_action_at:
          (p as { last_action_at?: string }).last_action_at ??
          p.found_at ??
          "",
      }))
    : [];
  const [stats, dashPositions, pendingMessages, criticTotals] = demoData
    ? [
        demoData.stats,
        demoDashPositions,
        demoData.pendingMessages,
        { pass: 0, needs_work: 0, reject: 0, total: 0 },
      ]
    : await Promise.all([
        getDashboardStats(),
        getDashboardPositions(),
        getPendingMessages(20),
        getCriticVerdictTotals(),
      ]);

  const activeTotal = stats.total - stats.excluded;

  // Conversion rate widget metrics
  const analystExcludedPct =
    stats.total > 0 ? Math.round((stats.excluded / stats.total) * 100) : 0;
  const analystKeptPct = 100 - analystExcludedPct;
  const criticRejectPct =
    criticTotals.total > 0
      ? Math.round((criticTotals.reject / criticTotals.total) * 100)
      : 0;
  const criticPassPct =
    criticTotals.total > 0
      ? Math.round((criticTotals.pass / criticTotals.total) * 100)
      : 0;
  const criticNeedsPct = Math.max(0, 100 - criticPassPct - criticRejectPct);

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

  // Check if profile exists for onboarding status
  let hasProfile = false;
  if (demoMode) {
    hasProfile = true;
  } else if (isSupabaseConfigured && !isLocalOnlyMode()) {
    hasProfile = false;
  } else {
    // No-Supabase deploy OR local-only mode: leggi dal workspace YAML.
    hasProfile = readWorkspaceProfile() !== null;
  }

  const isEmpty = stats.total === 0;

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

  return (
    <div style={{ animation: "fade-in 0.35s ease both", position: "relative" }}>
      <div
        style={{
          position: "relative",
          background: "var(--color-deep)",
        }}
      >
        <div className="max-w-6xl mx-auto px-5 pt-8 pb-8">
          {/* ── Messaggi del team (fallback web quando Telegram down) ─ */}
          <PendingMessagesCard initialMessages={pendingMessages} />

          {/* ── VPS lifecycle: 3 bottoni (pausa/snapshot/termina) ────
          Solo in VPS mode (JHT_HOST_TYPE=vps): in Local PC mode i
          bottoni non hanno senso — niente "snapshot Hetzner" della
          tua MacBook. Vedi docs/internal/vps.md § "Lifecycle". */}
          <VpsLifecycleCard visible={process.env.JHT_HOST_TYPE === "vps"} />

          {/* ── Onboarding popup (empty state) ────────────────────── */}
          {isEmpty && (
            <OnboardingPopup
              hasProfile={hasProfile}
              translations={{
                start_here: t.start_here,
                setup_intro: t.setup_intro,
                step1_title: t.step1_title,
                step1_completed: t.step1_completed,
                step1_desc_done: t.step1_desc_done,
                step1_desc_todo: t.step1_desc_todo,
                step2_title: t.step2_title,
                step2_desc_done: t.step2_desc_done,
                step2_desc_todo: t.step2_desc_todo,
                help_text: t.help_text,
                open_assistant: t.open_assistant,
              }}
            />
          )}

          {/* ── Pipeline ────────────────────────────────────────────── */}
          <div className="section-label mb-4">{t.pipeline}</div>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-8"
            style={{ animation: "fade-in 0.35s ease both" }}
          >
            {pipeline.map((step, i) => {
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

          {/* ── Grafici collegati: Types + Score + Paesi + Città ─────────
          Cliccando una sezione di un grafico si filtrano gli altri
          (cross-filter lato client sui facets per-posizione). */}
          <div
            className="mb-8"
            style={{ animation: "fade-in 0.35s ease both 0.08s" }}
          >
            <DashboardLinkedCharts
              positions={dashPositions}
              labels={{
                types: t.position_types,
                countries: t.position_countries,
                cities: t.position_cities,
                score: t.score_distribution,
                noData: t.no_data,
                reset: t.reset_filters,
                table: {
                  title: t.recent_positions,
                  titleFiltered: t.recent_positions_filtered,
                  viewAll: t.view_all,
                  noPositions: t.no_positions,
                  colId: t.col_id,
                  colTitle: t.col_title,
                  colCompany: t.col_company,
                  colLocation: t.col_location,
                  colRemote: t.col_remote,
                  colScore: t.col_score,
                  colStatus: t.col_status,
                  colUpdated: t.col_updated,
                },
              }}
            />
          </div>

          {/* ── Conversion rate ─────────────────────────────────────── */}
          <div className="section-label mb-4">Conversion rate</div>
          <div
            className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8"
            style={{ animation: "fade-in 0.35s ease both" }}
          >
            {/* Filtro Analisti: % escluse al primo check (status='excluded') */}
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">Filtro analisti</span>
                <span className="text-[10px] text-[var(--color-dim)]">
                  {stats.total} trovate · {stats.excluded} escluse
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
                  esclusioni · {analystKeptPct}% passate all&apos;analisi
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
                  passate · {stats.total - stats.excluded}
                </span>
                <span style={{ color: "var(--color-red)" }}>
                  escluse · {stats.excluded}
                </span>
              </div>
            </div>

            {/* Verdetto Critici: PASS / NEEDS_WORK / REJECT su totali revisionati */}
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">Verdetto critici</span>
                <span className="text-[10px] text-[var(--color-dim)]">
                  {criticTotals.total} revisionate
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                <span
                  className="text-3xl font-bold tracking-tight"
                  style={{ color: "var(--color-green)" }}
                >
                  {criticPassPct}%
                </span>
                <span className="text-[10px] text-[var(--color-muted)]">
                  pass · {criticRejectPct}% reject · {criticNeedsPct}% needs
                  work
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden flex"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  style={{
                    width: `${criticPassPct}%`,
                    background: "var(--color-green)",
                    opacity: 0.85,
                  }}
                />
                <div
                  style={{
                    width: `${criticNeedsPct}%`,
                    background: "var(--color-yellow)",
                    opacity: 0.85,
                  }}
                />
                <div
                  style={{
                    width: `${criticRejectPct}%`,
                    background: "var(--color-red)",
                    opacity: 0.85,
                  }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-[var(--color-dim)] mt-1">
                <span style={{ color: "var(--color-green)" }}>
                  pass · {criticTotals.pass}
                </span>
                <span style={{ color: "var(--color-yellow)" }}>
                  needs · {criticTotals.needs_work}
                </span>
                <span style={{ color: "var(--color-red)" }}>
                  reject · {criticTotals.reject}
                </span>
              </div>
            </div>

            {/* Funnel end-to-end: throughput vero del team — quante posizioni
            trovate diventano "ready" (CV pronto a partire) o oltre. */}
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">Throughput finale</span>
                <span className="text-[10px] text-[var(--color-dim)]">
                  {funnelOutput}/{stats.total} pronte
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
                  su 10 trovate · {funnelPer10} arrivano pronte
                </span>
              </div>
              {/* Mini-funnel: 3 step "trovate → analizzate → pronte" */}
              <div className="space-y-2">
                {[
                  {
                    label: "trovate",
                    n: stats.total,
                    pct: 100,
                    color: "var(--color-blue)",
                  },
                  {
                    label: "analizzate",
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
                    label: "pronte",
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
            <PipelineFlow steps={pipeline} title="Pipeline flow" />
          </div>
        </div>
      </div>

      <OnboardingWizard />
    </div>
  );
}
