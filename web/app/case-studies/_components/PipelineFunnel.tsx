import type { CaseStudy } from "./types"
import { metricNum, providerColor } from "./types"

type Props = {
  caseStudies: CaseStudy[]
}

// Funnel chart per case study: positions_analyzed → applications_sent/cvs_ready.
// Uses 2 stages when only outcome data is available, 3 when intermediate present.
export function PipelineFunnel({ caseStudies }: Props) {
  const rows = caseStudies.map((cs) => {
    const found = metricNum(cs, "positions_analyzed") ?? 0
    const ready = metricNum(cs, "cvs_ready") ?? metricNum(cs, "applications_sent") ?? 0
    const conversion = found > 0 ? (ready / found) * 100 : 0
    return {
      case_number: cs.case_number,
      provider: cs.provider_name,
      color: providerColor(cs.provider_name),
      found,
      ready,
      conversion,
    }
  })

  const maxFound = Math.max(...rows.map((r) => r.found), 1)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 text-sm font-bold text-slate-900">🌊 Pipeline conversion</h3>
      <p className="mb-4 text-xs text-slate-500">
        From positions analyzed by the pipeline to ready applications. Width reflects volume.
      </p>
      <div className="space-y-5">
        {rows.map((r) => {
          const foundPct = (r.found / maxFound) * 100
          const readyPct = (r.ready / maxFound) * 100
          return (
            <div key={r.case_number}>
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
                  {r.conversion.toFixed(0)}% conversion
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div
                    className="h-7 rounded text-right"
                    style={{ width: `${foundPct}%`, backgroundColor: r.color, opacity: 0.85 }}
                  >
                    <span className="inline-block px-2 py-1 text-xs font-semibold text-white">
                      {r.found} analyzed
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-7 rounded text-right"
                    style={{
                      width: `${Math.max(readyPct, 6)}%`,
                      backgroundColor: r.color,
                      opacity: 0.5,
                    }}
                  >
                    <span className="inline-block px-2 py-1 text-xs font-semibold text-white">
                      {r.ready} ready
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
