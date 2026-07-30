import dynamic from "next/dynamic";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { WELCOME_SEEN_COOKIE } from "@/lib/demo/mode";
import {
  getDashboardStats,
  getDashboardPositions,
  getSeenPositionIds,
} from "@/lib/queries";
import type { DashboardPosition } from "@/lib/queries";
import RecentPositionsTable from "@/app/components/RecentPositionsTable";
import { getExchangeRates } from "@/lib/exchange-rates";
import { getDisplayCurrencies } from "@/lib/dashboard-currencies";
import DashboardLinkedCharts from "@/app/components/DashboardLinkedCharts";
import { isSupabaseConfigured, isLocalOnlyMode } from "@/lib/workspace";
import { readWorkspaceProfile } from "@/lib/profile-reader";
import { getServerLocale } from "@/lib/server-locale";
import { getDashboardT } from "@/lib/dashboard-i18n";
import {
  getDemoDashboardData,
  isDashboardDemoMode,
} from "@/lib/dashboard-demo";
import OnboardingPopup from "@/app/components/OnboardingPopup";
import DemoPickerCard from "@/app/components/demo/DemoPickerCard";
import CloudRefreshButton from "@/app/components/CloudRefreshButton";

const OnboardingWizard = dynamic(
  () => import("@/app/components/OnboardingWizard"),
);

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
  const locale = await getServerLocale();
  const t = getDashboardT(locale);

  // [JHT-ONBOARDING-IN-GAME 18/07] Niente più redirect a /onboarding: la
  // pagina web è stata rimossa, l'onboarding vive nel wizard del videogioco
  // (game/scenes/wizard.tscn). Senza profilo la dashboard mostra l'empty
  // state con OnboardingPopup, su ogni deploy.
  const hdrs = await headers();
  const demoMode = isDashboardDemoMode(hdrs.get("x-search"));

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
        source: (p as { source?: string | null }).source ?? null,
        salary_min: p.salary_declared_min ?? null,
        salary_max: p.salary_declared_max ?? null,
        salary_currency: "EUR",
        found_at: p.found_at ?? null,
        // Demo: come proxy dello scored_at usa l'ultima azione (le demo
        // non hanno il timestamp dello Scorer).
        scored_at:
          (p.score ?? null) != null
            ? ((p as { last_action_at?: string }).last_action_at ??
              p.found_at ??
              null)
            : null,
        last_action_at:
          (p as { last_action_at?: string }).last_action_at ?? p.found_at ?? "",
        // Demo: attore plausibile dedotto dallo stato corrente.
        last_action_by: DEMO_ACTOR_BY_STATUS[p.status] ?? "scout",
        last_action_actor: DEMO_ACTOR_BY_STATUS[p.status] ?? "scout",
        critic_score:
          (p as { critic_score?: number | null }).critic_score ?? null,
        critic_verdict:
          (p as { critic_verdict?: string | null }).critic_verdict ?? null,
      }))
    : [];
  // Messaggi: niente più banner in dashboard — vivono nel drawer messenger
  // in navbar (MessagesDrawer) e nella panoramica /messages.
  const [stats, dashPositionsRaw, rates] = demoData
    ? [
        demoData.stats,
        demoDashPositions,
        { EUR: 1, USD: 1.16, GBP: 0.86, CHF: 0.92 },
      ]
    : await Promise.all([
        getDashboardStats(),
        getDashboardPositions(),
        getExchangeRates(),
      ]);

  // Marker "nuova": overlay del set position_views dell'utente (cloud).
  // In local mode il set è vuoto e seen resta undefined → decide il
  // client via localStorage (UnseenDot).
  const seenIds = demoData ? new Set<string>() : await getSeenPositionIds();
  const dashPositions = dashPositionsRaw.map((p) =>
    seenIds.has(p.id) ? { ...p, seen: true } : p,
  );

  // [JHT-WEB-DEMO] Utente cloud nuovo: niente dati (né demo — con demo
  // attiva stats.total è >0) e wizard mai visto → onboarding /welcome.
  // Il cookie jht_welcome_seen (settato dal wizard su skip/demo) evita di
  // riproporlo a ogni visita.
  if (isCloudDeploy() && !demoMode && stats.total === 0) {
    const seen = (await cookies()).get(WELCOME_SEEN_COOKIE)?.value === "1";
    if (!seen) redirect("/welcome");
  }

  const activeTotal = stats.total - stats.excluded;

  // "Le ultime posizioni valutate": score OBBLIGATORIO, mai escluse (la
  // query già le filtra, il predicato resta per il ramo demo), ordinate
  // per scored_at più recente. Stesse colonne della tabella "migliori",
  // ma con il timestamp dello score al posto dell'ID.
  const newestScored = dashPositions
    .filter(
      (p) => p.status !== "excluded" && p.score != null && p.scored_at != null,
    )
    .sort(
      (a, b) => Date.parse(b.scored_at ?? "") - Date.parse(a.scored_at ?? ""),
    )
    .slice(0, 8);

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

  return (
    <div style={{ animation: "fade-in 0.35s ease both", position: "relative" }}>
      <div
        style={{
          position: "relative",
          background: "var(--color-deep)",
        }}
      >
        <div className="max-w-6xl mx-auto px-5 pt-8 pb-8">
          {/* ── Header di pagina: titolo + conteggi ──────────────────── */}
          <div
            className="mb-6"
            style={{ animation: "fade-in 0.35s ease both" }}
          >
            <h1
              className="text-xl font-bold uppercase tracking-[0.18em] leading-none mb-2"
              style={{ color: "var(--color-white)" }}
            >
              {t.title}
            </h1>
            <div className="text-[11px] text-[var(--color-muted)]">
              {t.total_positions(stats.total, stats.excluded, activeTotal)}
            </div>
          </div>

          {/* ── Sync now (solo cloud): refresh dati on-demand, niente polling ─ */}
          <CloudRefreshButton />

          {/* Il ciclo di vita della VPS (pausa/snapshot/termina) non si comanda
          più da qui: le route /api/vps/* sono state rimosse il 25/07 con le
          altre di controllo, e la card restava con tre bottoni che chiamavano
          il vuoto. Si fa dal desktop, o via `hcloud` sulla VPS. */}

          {/* ── Empty state ─────────────────────────────────────────
          CLOUD [JHT-WEB-DEMO 22/07]: profilo e avvio team vivono SOLO
          nell'app desktop → niente popup "Configure your Profile". Al suo
          posto la scelta della categoria demo (per chi ha saltato il
          wizard /welcome). LOCALE: resta il popup profilo→team. */}
          {isEmpty && isCloudDeploy() && !demoMode && <DemoPickerCard />}
          {isEmpty && !isCloudDeploy() && (
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

          {/* ── Le ultime posizioni valutate (al posto del feed attività):
          stesse colonne della tabella "migliori", timestamp al posto
          dell'ID, 8 righe con score obbligatorio ordinate per score più
          recente. ─────────────────────────────────────────────────── */}
          <div style={{ animation: "fade-in 0.35s ease both 0.06s" }}>
            <RecentPositionsTable
              rows={newestScored}
              firstCol="scored"
              filtered={false}
              totalFiltered={newestScored.length}
              labels={{
                title: t.new_positions,
                titleFiltered: t.new_positions,
                viewAll: t.view_all,
                noPositions: t.no_positions,
                unseen: t.unseen_marker,
                colId: t.col_id,
                colScored: t.col_scored,
                colTitle: t.col_title,
                colCompany: t.col_company,
                colCountry: t.col_country,
                colCity: t.col_city,
                colScore: t.col_score,
              }}
            />
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
                  unseen: t.unseen_marker,
                  colId: t.col_id,
                  colTitle: t.col_title,
                  colCompany: t.col_company,
                  colCountry: t.col_country,
                  colCity: t.col_city,
                  colScore: t.col_score,
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
