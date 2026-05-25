import type { CaseStudy } from "./types"
import { metricNum, providerColor } from "./types"

type Props = {
  caseStudies: CaseStudy[]
}

// Bridge velocity (%/h of budget consumed) per case study.
// Time-series visualization would require per-tick data not currently in the seed —
// we render a comparison bar of the average velocity instead, with the time-to-cap
// implied by the run duration.
export function VelocityBar({ caseStudies }: Props) {
  const rows = caseStudies
    .map((cs) => {
      const v = metricNum(cs, "velocity_pct_h")
      if (v == null) return null
      return {
        case_number: cs.case_number,
        provider: cs.provider_name,
        color: providerColor(cs.provider_name),
        velocity: v,
        // Days-to-100% extrapolation: 100 / (v * 24)
        daysToCap: 100 / (v * 24),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)

  const maxV = Math.max(...rows.map((r) => r.velocity), 1)

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="mb-1 text-sm font-bold text-slate-900">⚡ Bridge burn velocity</h3>
        <p className="text-xs text-slate-500">No velocity data published yet for these runs.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 text-sm font-bold text-slate-900">⚡ Bridge burn velocity</h3>
      <p className="mb-4 text-xs text-slate-500">
        Average % of budget consumed per hour. Higher = faster burn. The right column shows the
        extrapolated days to hit 100% at this rate.
      </p>
      <ul className="space-y-3">
        {rows.map((r) => {
          const widthPct = (r.velocity / maxV) * 100
          return (
            <li key={r.case_number}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-slate-700">
                  <span
                    className="mr-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: r.color }}
                  >
                    #{r.case_number}
                  </span>
                  {r.provider}
                </span>
                <span className="font-mono text-sm font-bold text-slate-900">
                  {r.velocity.toFixed(2)}%/h
                  <span className="ml-2 text-slate-500">→ ~{r.daysToCap.toFixed(1)}d to cap</span>
                </span>
              </div>
              <div className="h-5 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded transition-all"
                  style={{ width: `${widthPct}%`, backgroundColor: r.color }}
                />
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-4 text-xs text-slate-500">
        🧪 Note: token-based providers (Kimi) have no weekly cap to hit, so &quot;days to cap&quot;
        is informational only. Weekly-cap providers (Codex Pro) treat 100% as a hard limit.
      </p>
    </div>
  )
}
