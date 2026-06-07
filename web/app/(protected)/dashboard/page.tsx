import Link from "next/link";
import dynamic from "next/dynamic";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getDashboardStats,
  getDashboardPositions,
  getPendingMessages,
} from "@/lib/queries";
import type { DashboardPosition } from "@/lib/queries";
import { getExchangeRates } from "@/lib/exchange-rates";
import { getDisplayCurrencies } from "@/lib/dashboard-currencies";
import DashboardLinkedCharts from "@/app/components/DashboardLinkedCharts";
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

// Demo: stato corrente → attore plausibile dell'ultima azione.
const DEMO_ACTOR_BY_STATUS: Record<string, string> = {
  new: "scout",
  checked: "analista",
  scored: "scorer",
  writing: "scrittore",
  review: "critico",
  ready: "critico",
  applied: "user",
  response: "user",
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
        salary_min: p.salary_declared_min ?? null,
        salary_max: p.salary_declared_max ?? null,
        salary_currency: "EUR",
        found_at: p.found_at ?? null,
        last_action_at:
          (p as { last_action_at?: string }).last_action_at ??
          p.found_at ??
          "",
        // Demo: attore plausibile dedotto dallo stato corrente.
        last_action_by: DEMO_ACTOR_BY_STATUS[p.status] ?? "scout",
        last_action_actor: DEMO_ACTOR_BY_STATUS[p.status] ?? "scout",
      }))
    : [];
  const [stats, dashPositions, pendingMessages, rates] = demoData
    ? [
        demoData.stats,
        demoDashPositions,
        demoData.pendingMessages,
        { EUR: 1, USD: 1.16, GBP: 0.86, CHF: 0.92 },
      ]
    : await Promise.all([
        getDashboardStats(),
        getDashboardPositions(),
        getPendingMessages(20),
        getExchangeRates(),
      ]);

  const activeTotal = stats.total - stats.excluded;

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

  // Pipeline a 5 box che segue il flusso reale (2026-06-07):
  //   Da analizzare → Analizzate → Con lo score → Da scrivere → Scritte
  // "Con lo score" = scored NON ancora selezionate; "Da scrivere" =
  // selezionate dall'utente (write_requested) ma CV non ancora pronto
  // (scored/writing/review). Trovate/Inviate vivono nella pagina Analisi.
  const pipeline = [
    {
      key: "to_analyze",
      label: t.pl_to_analyze,
      count: stats.new,
      color: STATUS_COLORS.new,
      href: "/positions?status=new",
      basis: activeTotal,
    },
    {
      key: "analyzed",
      label: t.pl_analyzed,
      count: stats.checked,
      color: STATUS_COLORS.checked,
      href: "/positions?status=checked",
      basis: activeTotal,
    },
    {
      key: "with_score",
      label: t.pl_with_score,
      count: stats.scored_open,
      color: STATUS_COLORS.scored,
      // scored NON ancora selezionate → status=scored + writereq=0
      href: "/positions?status=scored&writereq=0",
      basis: activeTotal,
    },
    {
      key: "to_write",
      label: t.pl_to_write,
      count: stats.to_write,
      color: STATUS_COLORS.writing,
      // selezionate ma CV non pronto → status in (scored,writing,review) + writereq=1
      href: "/positions?status=scored,writing,review&writereq=1",
      basis: activeTotal,
    },
    {
      key: "written",
      label: t.pl_written,
      count: stats.ready,
      color: STATUS_COLORS.ready,
      href: "/positions?status=ready",
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
            className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-8"
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
                    {`${percent}%`}
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
              rates={rates}
              currencies={getDisplayCurrencies()}
              labels={{
                types: t.position_types,
                countries: t.position_countries,
                cities: t.position_cities,
                score: t.score_distribution,
                salary: t.salary_distribution,
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
                  colCategory: t.col_category,
                  colCountry: t.col_country,
                  colCity: t.col_city,
                  colRemote: t.col_remote,
                  colScore: t.col_score,
                  colSalary: t.col_salary,
                  colMonthly: t.col_monthly,
                  colStatus: t.col_status,
                  colUpdated: t.col_updated,
                  colUpdatedBy: t.col_updated_by,
                },
              }}
            />
          </div>
        </div>
      </div>

      <OnboardingWizard />
    </div>
  );
}
