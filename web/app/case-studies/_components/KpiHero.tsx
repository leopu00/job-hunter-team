import type { CaseStudy } from "./types"
import { metricNum } from "./types"

type Props = {
  caseStudies: CaseStudy[]
}

// Aggregate KPIs across all published case studies.
export function KpiHero({ caseStudies }: Props) {
  const totalRuns = caseStudies.length

  const totalPositions = caseStudies.reduce(
    (sum, cs) => sum + (metricNum(cs, "positions_analyzed") ?? 0),
    0,
  )
  const totalReady = caseStudies.reduce(
    (sum, cs) => sum + (metricNum(cs, "cvs_ready") ?? metricNum(cs, "applications_sent") ?? 0),
    0,
  )

  const providers = new Set(caseStudies.map((cs) => cs.provider_name))
  const totalProviders = providers.size

  const kpis = [
    { value: totalRuns.toString(), label: "Field tests", sub: "real runs, no synthetic benchmarks" },
    { value: `~${totalPositions}`, label: "Positions analyzed", sub: "across all runs" },
    { value: `~${totalReady}`, label: "Ready applications", sub: "CV + critic PASS" },
    { value: totalProviders.toString(), label: "Providers tested", sub: "Claude, Codex, Kimi tiers" },
  ]

  return (
    <section className="border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white py-12">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-8">
          <div className="mb-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            Field data · not synthetic benchmarks
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Case studies
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-600">
            What Job Hunter Team has produced on real candidate profiles, with real LLM
            subscriptions, on real job markets. First-pass data — multi-week tests are the next
            milestone.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {k.label}
              </dt>
              <dd className="mt-1 text-3xl font-bold text-slate-900 sm:text-4xl">{k.value}</dd>
              <dd className="mt-1 text-xs text-slate-500">{k.sub}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
