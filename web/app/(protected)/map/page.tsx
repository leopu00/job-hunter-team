import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getScoreDistribution,
  getPositionTypeDistribution,
} from "@/lib/queries";
import MapCharts from "@/app/components/MapCharts";
import { isSupabaseConfigured } from "@/lib/workspace";
import { readWorkspaceProfile } from "@/lib/profile-reader";
import { getServerLocale } from "@/lib/server-locale";
import { getDashboardT } from "@/lib/dashboard-i18n";
import { createClient } from "@/lib/supabase/server";
import { isLocalRequestFromHeaders } from "@/lib/auth";
import {
  getDemoDashboardData,
  isDashboardDemoMode,
} from "@/lib/dashboard-demo";
// 2026-05-25 merge dev1+dev2: CloudDownloadLanding e VpsSetupCompleteLanding
// rimossi da dev2 (unificato in OnboardingPopup globale). Lasciato qui un
// redirect minimal a /onboarding quando profile non configurato.

export default async function MapPage() {
  const locale = getServerLocale();
  const t = getDashboardT(locale);

  const hdrs = await headers();
  const localRequest = isLocalRequestFromHeaders(hdrs);
  const demoMode = isDashboardDemoMode(hdrs.get("x-search"));

  if (isSupabaseConfigured && !demoMode) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: onboarding } = await supabase
        .from("user_onboarding_state")
        .select("vps_setup_completed_at, profile_configured_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!onboarding?.vps_setup_completed_at || !onboarding?.profile_configured_at) {
        redirect("/dashboard");
      }
    } else if (localRequest) {
      if (readWorkspaceProfile() === null) redirect("/onboarding");
    }
  } else if (!demoMode) {
    if (readWorkspaceProfile() === null) redirect("/onboarding");
  }

  const demoData = demoMode ? getDemoDashboardData() : null;
  // Genera score sintetici per ogni tipo nel demo: distribuiti attorno
  // a una media specifica per tipo, cosi' il filtro donut→histogram e'
  // dimostrabile anche senza dati reali.
  const synthScores = (avg: number, n: number, spread = 12) =>
    Array.from({ length: n }, () => {
      const v = avg + (Math.random() - 0.5) * 2 * spread;
      return Math.max(0, Math.min(100, Math.round(v)));
    });
  // Demo data: usa `family` post-dev2 refactor (data-driven, niente più enum).
  const demoTypeDist = demoMode
    ? [
        { family: "AI / ML", count: 8, color: "var(--color-purple)", avgScore: 82, avgCritic: null, scores: synthScores(82, 8) },
        { family: "Data", count: 15, color: "var(--color-blue)", avgScore: 63, avgCritic: null, scores: synthScores(63, 15) },
        { family: "DevOps / Cloud", count: 8, color: "var(--color-orange)", avgScore: 56, avgCritic: null, scores: synthScores(56, 8) },
        { family: "Full-stack", count: 6, color: "#7fffb2", avgScore: 70, avgCritic: null, scores: synthScores(70, 6) },
        { family: "Backend", count: 7, color: "var(--color-yellow)", avgScore: 64, avgCritic: null, scores: synthScores(64, 7) },
        { family: "Frontend", count: 5, color: "#58a6ff", avgScore: 62, avgCritic: null, scores: synthScores(62, 5) },
        { family: "Python", count: 15, color: "#3776ab", avgScore: 68, avgCritic: null, scores: synthScores(68, 15) },
        { family: "Software Engineer", count: 21, color: "var(--color-muted)", avgScore: 62, avgCritic: null, scores: synthScores(62, 21) },
        { family: "Other", count: 2, color: "var(--color-dim)", avgScore: 55, avgCritic: null, scores: synthScores(55, 2) },
      ]
    : null;
  const [scoreDist, typeDist] = demoData
    ? [demoData.scoreDistribution, demoTypeDist ?? []]
    : await Promise.all([
        getScoreDistribution(),
        getPositionTypeDistribution(),
      ]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        // Body ha zoom: var(--zoom) (1.15): per ottenere "viewport
        // visibile meno navbar" come altezza effettiva del container
        // sotto zoom, divido 100vh per --zoom prima di sottrarre la
        // navbar (3.5rem = h-14 in unita' pre-zoom). Senza questo,
        // position:absolute bottom:24 finisce oltre il bottom della
        // viewport reale.
        height: "calc(100vh / var(--zoom) - 3.5rem)",
        overflow: "hidden",
        animation: "fade-in 0.35s ease both",
      }}
    >
      {/* Scoped reset: chart components hanno wrapper card built-in
          (bg-[var(--color-card)] + border + p-5). In /map li vogliamo
          "bare", solo grafico su sfondo trasparente. */}
      <style>{`
        .map-bare-chart > div:first-child {
          background: transparent !important;
          border-color: transparent !important;
          padding: 0 !important;
        }
      `}</style>

      <MapCharts
        typeDist={typeDist}
        fallbackScores={scoreDist.scores ?? []}
        scoreTitle={t.score_distribution}
        emptyLabel={t.no_data}
        // Post-dev2: labels mapping enum→i18n rimosso; family stessa è
        // human-readable (popolata dal team analyst con stringhe libere).
        // Empty object = MapCharts userà la family literal come label.
        labels={{}}
      />
    </div>
  );
}
