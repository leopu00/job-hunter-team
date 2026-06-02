"use client"

import type { CaseStudy, Window } from "./types"
import { providerColor } from "./types"
import { FiveHourBreakdown } from "./FiveHourBreakdown"
import { FullRunUsageChart } from "./FullRunUsageChart"
import { useChartTheme } from "./chart-theme"

type Props = {
  caseStudy: CaseStudy
  weekly: Window
}

// Dedicated tab section showing the 7 per-5h-window usage charts (cumulative
// burn curve, trend line, cap, agent activity tracks) for the Codex run.
export function FiveHourWindowsTab({ caseStudy, weekly }: Props) {
  const { mode } = useChartTheme()
  const isDark = mode === "dark"
  if (!weekly.five_hour_windows || weekly.five_hour_windows.length === 0) return null
  const accent = providerColor(caseStudy.provider_name)
  return (
    <section
      className={`py-10 ${isDark ? "bg-slate-950" : "bg-slate-50"}`}
      style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-6">
          <h2
            className="text-2xl font-bold sm:text-3xl"
            style={{ color: isDark ? "#ffffff" : "#0f172a" }}
          >
            📈 Finestre 5h — usage e attività
          </h2>
          <p
            className="mt-1 text-sm"
            style={{ color: isDark ? "#94a3b8" : "#475569" }}
          >
            {caseStudy.title} · weekly window suddivisa in{" "}
            {weekly.five_hour_windows.length} slice rolling 5h. Ogni grafico
            mostra la curva di burn cumulativo, la linea di trend, il cap di
            saturazione e le tracce di attività per agente.
          </p>
        </div>

        <div className="mb-8">
          <FullRunUsageChart weekly={weekly} accentColor={accent} />
        </div>

        <FiveHourBreakdown
          windows={weekly.five_hour_windows}
          accentColor={accent}
          burnSamples={weekly.burn_samples}
          agentActivity={weekly.agent_activity}
        />
      </div>
    </section>
  )
}
