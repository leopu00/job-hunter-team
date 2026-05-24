// Public /case-studies page.
// Server component: fetches the JSON payload from the local API, then composes
// the layout from the section components under ./_components.
//
// Data source = SQLite (dev) / Supabase (prod target).
// Narrative source of truth = docs/about/RESULTS.md.

import type { Payload } from "./_components/types"
import { KpiHero } from "./_components/KpiHero"
import { CaseStudyCard } from "./_components/CaseStudyCard"
import { CostPerCvBar } from "./_components/CostPerCvBar"
import { PipelineFunnel } from "./_components/PipelineFunnel"
import { TokenStackBar } from "./_components/TokenStackBar"
import { VelocityBar } from "./_components/VelocityBar"
import { CoverageMatrix } from "./_components/CoverageMatrix"
import { ContributeCta } from "./_components/ContributeCta"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Case studies · Job Hunter Team",
  description:
    "Real field data from Job Hunter Team runs — what the open-source AI agent team has produced on real candidate profiles with real LLM subscriptions.",
}

async function fetchData(): Promise<Payload> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"
  const r = await fetch(`${base}/api/case-studies`, { cache: "no-store" })
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

export default async function CaseStudiesPage() {
  let data: Payload
  try {
    data = await fetchData()
  } catch (e) {
    return (
      <main className="mx-auto max-w-3xl p-8 font-mono text-sm">
        <h1 className="mb-4 text-2xl font-bold">⚠️ /case-studies — data pipeline error</h1>
        <pre className="rounded bg-red-50 p-4 text-red-800">{String(e)}</pre>
        <p className="mt-4">
          Hint: run{" "}
          <code className="rounded bg-slate-100 px-2 py-1">
            web/data/case-studies/init.sh
          </code>{" "}
          to rebuild the local SQLite seed.
        </p>
      </main>
    )
  }

  const { caseStudies, coverage } = data

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <KpiHero caseStudies={caseStudies} />

      {/* Methodology disclaimer — visible, collapsible */}
      <section className="border-b border-slate-100 bg-amber-50/50 py-4">
        <div className="mx-auto max-w-6xl px-6">
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-amber-900">
              ⚠️ How to read these numbers (methodology &amp; caveats)
            </summary>
            <ul className="mt-3 ml-4 list-disc space-y-1 text-amber-900/90">
              <li>
                Each run is a <strong>burst</strong> of &lt;4 calendar days, not a steady-state
                month. A monthly subscription buys ~4 weeks of pacing — the numbers below reflect
                what the pipeline produces when pushed hard.
              </li>
              <li>
                <strong>Provider comparisons are confounded by profile differences</strong>: each
                case study uses a different candidate profile, so we cannot isolate provider
                quality from profile difficulty. A same-candidate × dual-provider experiment is on
                the roadmap.
              </li>
              <li>
                Profiles are <strong>anonymized</strong> (&quot;Beta tester N&quot;) with broad
                role descriptors. No personally identifying details, employers, or city names are
                published.
              </li>
              <li>
                <strong>Applied = 0</strong> in every case study is by design: JHT prepares
                applications but the human user decides when to submit. Interview / offer numbers
                are reported separately when relevant.
              </li>
            </ul>
          </details>
        </div>
      </section>

      {/* Cross-comparison visualizations */}
      <section className="border-b border-slate-100 bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-2 text-2xl font-bold text-slate-900">📊 Cross-run comparison</h2>
          <p className="mb-8 text-sm text-slate-600">
            Side-by-side views of the four dimensions where the providers diverge most: cost,
            conversion, token economics, and burn rate.
          </p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CostPerCvBar caseStudies={caseStudies} />
            <PipelineFunnel caseStudies={caseStudies} />
            <TokenStackBar caseStudies={caseStudies} />
            <VelocityBar caseStudies={caseStudies} />
          </div>
        </div>
      </section>

      {/* Individual case studies */}
      <section className="py-12">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="mb-2 text-2xl font-bold text-slate-900">🧪 Individual case studies</h2>
          <p className="mb-8 text-sm text-slate-600">
            Each card has the metadata, the headline metrics, and the &quot;what worked / what
            didn&apos;t&quot; notes from the run postmortem.
          </p>
          <div className="space-y-8">
            {caseStudies.map((cs) => (
              <CaseStudyCard key={cs.id} cs={cs} />
            ))}
          </div>
        </div>
      </section>

      {/* Coverage matrix */}
      <section className="border-t border-slate-100 bg-slate-50 py-12">
        <div className="mx-auto max-w-4xl px-6">
          <CoverageMatrix coverage={coverage} />
        </div>
      </section>

      {/* CTAs */}
      <ContributeCta />

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <p>
          Data source: SQLite (dev) → Supabase (prod target) ·{" "}
          <a href="https://github.com/leopu00/job-hunter-team/blob/master/docs/about/RESULTS.md" className="underline hover:text-slate-700">
            narrative source on GitHub
          </a>
        </p>
      </footer>
    </main>
  )
}
