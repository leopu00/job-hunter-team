import type { CaseStudy } from "./types"
import { metricNum, providerColor, fmtNumber } from "./types"

type Props = {
  caseStudies: CaseStudy[]
}

// Stacked horizontal bar per case study: fresh vs cache_read vs output.
// Some case studies only have a weighted/aggregate count (Codex telemetry) → shown as a single bar.
export function TokenStackBar({ caseStudies }: Props) {
  const rows = caseStudies
    .map((cs) => {
      const fresh = metricNum(cs, "tokens_fresh")
      const cache = metricNum(cs, "tokens_cache_read")
      const allIn = metricNum(cs, "tokens_all_in")
      const weighted = metricNum(cs, "tokens_weighted")

      // Two display modes:
      // - "stack": fresh + cache_read are both populated → stacked bar
      // - "single": only weighted is available → single bar
      if (fresh != null && cache != null) {
        return {
          mode: "stack" as const,
          case_number: cs.case_number,
          provider: cs.provider_name,
          color: providerColor(cs.provider_name),
          fresh,
          cache,
          total: fresh + cache,
          label: allIn != null ? `${fmtNumber(allIn)} all-in` : `${fmtNumber(fresh + cache)} all-in`,
        }
      }
      if (weighted != null) {
        return {
          mode: "single" as const,
          case_number: cs.case_number,
          provider: cs.provider_name,
          color: providerColor(cs.provider_name),
          weighted,
          total: weighted,
          label: `${fmtNumber(weighted)} weighted`,
        }
      }
      return null
    })
    .filter((r): r is NonNullable<typeof r> => r != null)

  const maxTotal = Math.max(...rows.map((r) => r.total), 1)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 text-sm font-bold text-slate-900">🧮 Token consumption</h3>
      <p className="mb-4 text-xs text-slate-500">
        Fresh tokens (non-cached input + output) vs cache_read (re-used context). Cached reads cost
        a fraction of fresh tokens.
      </p>
      <div className="space-y-4">
        {rows.map((r) => {
          const widthPct = Math.max(10, (r.total / maxTotal) * 100)
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
                <span className="font-mono text-sm font-bold text-slate-900">{r.label}</span>
              </div>
              <div
                className="flex h-7 overflow-hidden rounded bg-slate-100"
                style={{ width: `${widthPct}%` }}
              >
                {r.mode === "stack" ? (
                  <>
                    <div
                      className="flex h-full items-center justify-center text-[10px] font-semibold text-white"
                      style={{
                        width: `${(r.fresh / r.total) * 100}%`,
                        backgroundColor: r.color,
                      }}
                      title={`fresh ${fmtNumber(r.fresh)}`}
                    >
                      {r.fresh / r.total > 0.08 ? "fresh" : ""}
                    </div>
                    <div
                      className="flex h-full items-center justify-center text-[10px] font-semibold text-white"
                      style={{
                        width: `${(r.cache / r.total) * 100}%`,
                        backgroundColor: r.color,
                        opacity: 0.55,
                      }}
                      title={`cache_read ${fmtNumber(r.cache)}`}
                    >
                      {r.cache / r.total > 0.08 ? "cache_read" : ""}
                    </div>
                  </>
                ) : (
                  <div
                    className="flex h-full items-center justify-center text-[10px] font-semibold text-white"
                    style={{ width: "100%", backgroundColor: r.color }}
                    title={`weighted ${fmtNumber(r.weighted)}`}
                  >
                    weighted
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        ⚠️ Different providers expose different token counts: Codex publishes a proprietary
        &quot;weighted&quot; figure, Kimi exposes the raw breakdown. Direct comparison is indicative.
      </p>
    </div>
  )
}
