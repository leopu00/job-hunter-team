import Link from "next/link";
import dynamic from "next/dynamic";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getDashboardStats,
  getRecentPositions,
  getScoreDistribution,
  getSourceDistribution,
  getPositionTypeDistribution,
  getPendingMessages,
  getCriticVerdictTotals,
} from "@/lib/queries";
import PositionTypesPie from "@/app/components/PositionTypesPie";
import ScoreDistribution from "@/app/components/ScoreDistribution";
import CompanyGlobe from "@/app/components/CompanyGlobe";
import { formatFoundAt } from "@/lib/format-time";
import { isSupabaseConfigured } from "@/lib/workspace";
import { readWorkspaceProfile } from "@/lib/profile-reader";
import { runBash } from "@/lib/shell";
import { getServerLocale } from "@/lib/server-locale";
import { getDashboardT } from "@/lib/dashboard-i18n";
import { createClient } from "@/lib/supabase/server";
import { isLocalRequestFromHeaders } from "@/lib/auth";
import {
  getDemoDashboardData,
  isDashboardDemoMode,
} from "@/lib/dashboard-demo";
import CloudDownloadLanding from "@/app/components/CloudDownloadLanding";
import VpsSetupCompleteLanding from "@/app/components/VpsSetupCompleteLanding";
import PendingMessagesCard from "@/app/components/PendingMessagesCard";
import VpsCompanycycleCard from "@/app/components/VpsCompanycycleCard";

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

function scoreClass(s?: number) {
  if (!s) return "text-[var(--color-dim)]";
  if (s >= 75) return "text-[var(--color-green)]";
  if (s >= 55) return "text-[var(--color-yellow)]";
  return "text-[var(--color-red)]";
}

function scoreBg(s?: number) {
  if (!s) return "var(--color-border)";
  if (s >= 75) return "var(--color-green)";
  if (s >= 55) return "var(--color-yellow)";
  return "var(--color-red)";
}

export default async function DashboardCompany() {
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
      if (!onboarding?.vps_setup_completed_at) {
        return <CloudDownloadLanding userEmail={user.email ?? null} />;
      }
      if (!onboarding?.profile_configured_at) {
        return <VpsSetupCompleteLanding userEmail={user.email ?? null} />;
      }
    } else if (localRequest) {
      if (readWorkspaceProfile() === null) redirect("/onboarding");
    }
  } else if (!demoMode) {
    if (readWorkspaceProfile() === null) redirect("/onboarding");
  }

  const demoData = demoMode ? getDemoDashboardData() : null;
  const [stats, positions, scoreDist, sourceDist, typeDist, pendingMessages, criticTotals] =
    demoData
      ? [
          demoData.stats,
          demoData.positions,
          demoData.scoreDistribution,
          demoData.sourceDistribution,
          [],
          demoData.pendingMessages,
          { pass: 0, needs_work: 0, reject: 0, total: 0 },
        ]
      : await Promise.all([
          getDashboardStats(),
          getRecentPositions(15),
          getScoreDistribution(),
          getSourceDistribution(),
          getPositionTypeDistribution(),
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
  const criticNeedsPct = Math.max(
    0,
    100 - criticPassPct - criticRejectPct,
  );

  // Funnel end-to-end: quante posizioni "uscite vive" dal pipeline
  // (ready/applied/response = hanno passato Analista + Scorer + Critico)
  // su quelle trovate. È il dato più sintetico — il throughput vero.
  const funnelOutput = stats.ready + stats.applied + stats.response;
  const funnelRate =
    stats.total > 0 ? (funnelOutput / stats.total) * 100 : 0;
  const funnelRatePct = Math.round(funnelRate);
  // "Su 10 trovate → N arrivano pronte". 1 decimale per non perdere
  // info quando il rate è basso (es. 1.5 su 10 — arrotondato a 2 sarebbe
  // ottimistico, a 1 pessimistico).
  const funnelPer10 = (funnelRate / 10).toFixed(1).replace(/\.0$/, "");

  // Check if profile exists for onboarding status
  let hasProfile = false;
  if (demoMode) {
    hasProfile = true;
  } else if (isSupabaseConfigured) {
    hasProfile = false;
  } else {
    hasProfile = readWorkspaceProfile() !== null;
  }

  // Check if team is active (tmux JHT sessions)
  let teamActive = demoMode;
  if (!demoMode) {
    try {
      const { stdout } = await runBash(
        'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""',
      );
      const sessions = stdout.trim().split("\n").filter(Boolean);
      const JH_PREFIXES = [
        "CAPITANO",
        "SCOUT",
        "ANALISTA",
        "SCORER",
        "SCRITTORE",
        "CRITICO",
        "SENTINELLA",
      ];
      teamActive = sessions.some((s) =>
        JH_PREFIXES.some(
          (p) => s.toUpperCase() === p || s.toUpperCase().startsWith(`${p}-`),
        ),
      );
    } catch {}
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
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: teamActive
                ? "var(--color-green)"
                : "var(--color-dim)",
              animation: teamActive
                ? "pulse-dot 2s ease-in-out infinite"
                : undefined,
            }}
          />
          <span
            className="text-[10px] font-semibold tracking-[0.18em] uppercase"
            style={{
              color: teamActive ? "var(--color-green)" : "var(--color-dim)",
            }}
          >
            {demoMode ? "DEMO DATA" : teamActive ? t.live : t.data_updated}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          {t.title}
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {t.total_positions(stats.total, stats.excluded, activeTotal)}
        </p>
      </div>

      {/* ── Messaggi del team (fallback web quando Telegram down) ─ */}
      <PendingMessagesCard initialMessages={pendingMessages} />

      {/* ── VPS lifecycle: 3 bottoni (pausa/snapshot/termina) ────
          Solo in VPS mode (JHT_HOST_TYPE=vps): in Local PC mode i
          bottoni non hanno senso — niente "snapshot Hetzner" della
          tua MacBook. Vedi docs/internal/vps.md § "Companycycle". */}
      <VpsCompanycycleCard visible={process.env.JHT_HOST_TYPE === "vps"} />

      {/* ── Onboarding (empty state) ──────────────────────────── */}
      {isEmpty && (
        <div className="mb-10" style={{ animation: "fade-in 0.35s ease both" }}>
          <div className="section-label mb-5">{t.start_here}</div>
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 mb-6">
            <p className="text-[var(--color-muted)] text-[12px] mb-6 leading-relaxed">
              {t.setup_intro}
            </p>

            <div className="flex flex-col gap-4">
              {/* Step 1 — Configure Profile (required) */}
              <Link
                href="/profile"
                className={`group flex items-start gap-4 p-4 rounded-lg border bg-[var(--color-panel)] no-underline transition-colors ${
                  hasProfile
                    ? "border-[var(--color-green)]/30"
                    : "border-[var(--color-border)] hover:border-[#00e87a55]"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border text-[13px] font-bold shrink-0 mt-0.5 ${
                    hasProfile
                      ? "border-[var(--color-green)] text-[var(--color-green)] bg-[var(--color-green)]/10"
                      : "border-[var(--color-green)] text-[var(--color-green)]"
                  }`}
                >
                  {hasProfile ? "✓" : "1"}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[12px] font-bold mb-1 ${hasProfile ? "text-[var(--color-green)]" : "text-[var(--color-bright)] group-hover:text-[var(--color-green)] transition-colors"}`}
                  >
                    {t.step1_title}
                    {hasProfile && (
                      <span className="ml-2 text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-green)] bg-[var(--color-green)]/10 px-2 py-0.5 rounded-full border border-[var(--color-green)]/20">
                        {t.step1_completed}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
                    {hasProfile ? t.step1_desc_done : t.step1_desc_todo}
                  </p>
                </div>
                {!hasProfile && (
                  <span className="text-[var(--color-dim)] group-hover:text-[var(--color-green)] text-[14px] transition-colors shrink-0 mt-1">
                    →
                  </span>
                )}
              </Link>

              {/* Step 2 — Start the Team */}
              <Link
                href="/team"
                className={`group flex items-start gap-4 p-4 rounded-lg border bg-[var(--color-panel)] no-underline transition-colors ${
                  hasProfile
                    ? "border-[var(--color-border)] hover:border-[#ffc10755]"
                    : "border-[var(--color-border)] opacity-50 pointer-events-none"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border text-[13px] font-bold shrink-0 mt-0.5 ${
                    hasProfile
                      ? "border-[var(--color-yellow)] text-[var(--color-yellow)]"
                      : "border-[var(--color-dim)] text-[var(--color-dim)]"
                  }`}
                >
                  2
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[12px] font-bold mb-1 ${hasProfile ? "text-[var(--color-bright)] group-hover:text-[var(--color-yellow)]" : "text-[var(--color-dim)]"} transition-colors`}
                  >
                    {t.step2_title}
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
                    {hasProfile ? t.step2_desc_done : t.step2_desc_todo}
                  </p>
                </div>
                {hasProfile && (
                  <span className="text-[var(--color-dim)] group-hover:text-[var(--color-yellow)] text-[14px] transition-colors shrink-0 mt-1">
                    →
                  </span>
                )}
              </Link>
            </div>

            {/* Assistant — optional helper */}
            <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
              <Link
                href="/team/assistente"
                className="group flex items-center gap-3 no-underline"
              >
                <span className="text-[11px] text-[var(--color-dim)] group-hover:text-[var(--color-muted)] transition-colors">
                  {t.help_text}
                </span>
                <span className="text-[var(--color-dim)] group-hover:text-[var(--color-muted)] text-[12px] transition-colors shrink-0">
                  {t.open_assistant}
                </span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── World globe (hero) ──────────────────────────────────── */}
      <div
        className="mb-8"
        style={{ animation: "fade-in 0.35s ease both 0.05s" }}
      >
        <CompanyGlobe hero />
      </div>

      {/* ── Pipeline ────────────────────────────────────────────── */}
      <div className="section-label mb-4">{t.pipeline}</div>
      <div
        className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-8"
        style={{ animation: "fade-in 0.35s ease both" }}
      >
        {pipeline.map((step, i) => {
          const percent =
            step.basis > 0 ? Math.round((step.count / step.basis) * 100) : 0;

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

      {/* ── Charts ──────────────────────────────────────────────── */}
      <div
        className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8"
        style={{ animation: "fade-in 0.35s ease both 0.1s" }}
      >
        {/* Score distribution — histogram fine-grained */}
        <ScoreDistribution
          scores={scoreDist.scores ?? []}
          title={t.score_distribution}
          emptyLabel={t.no_data}
        />

        {/* Source distribution */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
          <div className="section-label mb-4">{t.sources}</div>
          <div className="space-y-3">
            {sourceDist.length === 0 ? (
              <p className="text-[11px] text-[var(--color-dim)]">{t.no_data}</p>
            ) : (
              (() => {
                const max = sourceDist[0]?.count ?? 1;
                return sourceDist.map((s) => (
                  <div key={s.source} className="flex items-center gap-3">
                    <span
                      className="text-[9.5px] text-[var(--color-muted)] w-28 truncate shrink-0"
                      title={s.source}
                    >
                      {s.source}
                    </span>
                    <div
                      className="flex-1 h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--color-border)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(s.count / max) * 100}%`,
                          background: "var(--color-blue)",
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-[var(--color-blue)] w-6 text-right shrink-0">
                      {s.count}
                    </span>
                  </div>
                ));
              })()
            )}
          </div>
        </div>

        {/* Position types pie */}
        <PositionTypesPie
          data={typeDist}
          title={t.position_types}
          emptyLabel={t.no_data}
          labels={{
            ai_ml: t.pt_ai_ml,
            data: t.pt_data,
            devops_cloud: t.pt_devops_cloud,
            full_stack: t.pt_full_stack,
            backend: t.pt_backend,
            frontend: t.pt_frontend,
            python: t.pt_python,
            software_engineer: t.pt_software_engineer,
            other: t.pt_other,
          }}
        />
      </div>

      {/* ── Positions table ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">{t.recent_positions}</span>
        <Link
          href="/positions"
          className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
        >
          {t.view_all}
        </Link>
      </div>
      <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg mb-8">
        <table
          className="w-full text-[12px]"
          style={{ borderCollapse: "collapse" }}
          aria-label={t.recent_positions}
        >
          <thead>
            <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
              {[
                t.col_id,
                t.col_title,
                t.col_company,
                t.col_location,
                t.col_remote,
                t.col_score,
                t.col_status,
                t.col_updated,
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-4 py-3 text-left text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap"
                  style={{ color: "var(--color-dim)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-[var(--color-dim)] text-[11px]"
                >
                  {t.no_positions}
                </td>
              </tr>
            ) : (
              positions.map((p, i: number) => (
                <tr
                  key={p.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
                  style={{
                    borderBottomColor:
                      i === positions.length - 1 ? "transparent" : undefined,
                    background:
                      i % 2 === 1 ? "rgba(255,255,255,0.008)" : undefined,
                  }}
                >
                  <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap">
                    {p.legacy_id
                      ? `JHT-${String(p.legacy_id).padStart(3, "0")}`
                      : p.id.slice(0, 8)}
                  </td>
                  <td
                    className="px-4 py-3 font-medium whitespace-nowrap max-w-[200px] truncate"
                    title={p.title}
                  >
                    <Link
                      href={`/positions/${p.id}`}
                      className="text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors"
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-base)] whitespace-nowrap">
                    {p.company}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                    {p.location ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-[10px]"
                      style={{
                        color:
                          p.remote_type === "full_remote"
                            ? "var(--color-green)"
                            : p.remote_type === "hybrid"
                              ? "var(--color-yellow)"
                              : "var(--color-red)",
                      }}
                    >
                      {p.remote_type?.replace("_", " ") ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <span
                        className={`text-[12px] font-semibold w-6 text-right ${scoreClass(p.score)}`}
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
                            background: scoreBg(p.score),
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border"
                      style={{
                        color: STATUS_COLORS[p.status] ?? "var(--color-dim)",
                        borderColor:
                          STATUS_COLORS[p.status] ?? "var(--color-border)",
                        background: `${STATUS_COLORS[p.status]}18`,
                      }}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap font-mono tabular-nums">
                    {formatFoundAt(p.last_action_at ?? p.found_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
              esclusioni · {analystKeptPct}% passate all'analisi
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
              pass · {criticRejectPct}% reject · {criticNeedsPct}% needs work
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
                        ((stats.total - stats.excluded) / stats.total) * 100,
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

      <OnboardingWizard />
    </div>
  );
}
