import type { CaseStudy } from "./types"
import { metricNum, providerColor } from "./types"

type Props = {
  caseStudies: CaseStudy[]
}

// Horizontal bar chart: cost per ready CV per case study.
// Uses subscription_cost_eur / cvs_ready when both present, else metric 'cost_per_cv'.
export function CostPerCvBar({ caseStudies }: Props) {
  const rows = caseStudies
    .map((cs) => {
      const explicit = metricNum(cs, "cost_per_cv")
      const sub = cs.subscription_cost_eur
      const ready = metricNum(cs, "cvs_ready") ?? metricNum(cs, "applications_sent")
      const cost = explicit ?? (sub && ready ? sub / ready : null)
      return {
        case_number: cs.case_number,
        title: cs.title,
        provider: cs.provider_name,
        color: providerColor(cs.provider_name),
        cost,
        sub,
        ready,
      }
    })
    .filter((r) => r.cost != null) as Array<{
    case_number: number
    title: string
    provider: string
    color: string
    cost: number
    sub: number | null
    ready: number | null
  }>

  const maxCost = Math.max(...rows.map((r) => r.cost))

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 text-sm font-bold text-slate-900">💰 Cost per ready CV</h3>
      <p className="mb-4 text-xs text-slate-500">
        Monthly subscription cost ÷ ready CVs in the first run window. Lower = cheaper per CV.
      </p>
      <ul className="space-y-3">
        {rows.map((r) => {
          const widthPct = Math.max(8, (r.cost / maxCost) * 100)
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
                  €{r.cost.toFixed(2)}/CV
                </span>
              </div>
              <div className="h-6 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded transition-all"
                  style={{ width: `${widthPct}%`, backgroundColor: r.color }}
                  title={`€${r.sub} / ${r.ready} CVs`}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
