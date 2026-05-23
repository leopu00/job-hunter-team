// /case-studies — placeholder pre-design.
// Renders the raw API payload to validate the data pipeline.
// UI redesign is the next iteration after the layout is approved.

export const dynamic = "force-dynamic"

type ApiMetric = {
  metric_key: string
  metric_label: string
  value_num: number | null
  value_text: string | null
  unit: string | null
  emoji: string | null
  category: string
  display_order: number
  highlighted: boolean
}

type ApiNote = {
  note_type: "worked" | "didnt_work" | "tweak" | "caveat"
  body_md: string
  display_order: number
}

type ApiCaseStudy = {
  id: number
  slug: string
  case_number: number
  title: string
  tester_handle: string
  profile_summary: string
  target_geography: string | null
  target_industry: string | null
  provider_name: string
  provider_tier: string | null
  subscription_cost_eur: number | null
  host_kind: string | null
  host_cost_eur_run: number | null
  duration_label: string | null
  metrics: ApiMetric[]
  notes: ApiNote[]
}

type ApiCoverage = {
  cell_number: number
  persona_label: string
  provider_label: string
  status: "done" | "open" | "in_progress"
  linked_case_study_id: number | null
}

type ApiPayload = {
  caseStudies: ApiCaseStudy[]
  coverage: ApiCoverage[]
  meta: {
    generated_at: string
    total_published: number
    total_metrics: number
    total_notes: number
    total_coverage_cells: number
    coverage_done: number
  }
}

async function fetchData(): Promise<ApiPayload> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"
  const r = await fetch(`${base}/api/case-studies`, { cache: "no-store" })
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

const noteHeader: Record<ApiNote["note_type"], string> = {
  worked: "✅ What worked",
  didnt_work: "⚠️ What didn't work",
  tweak: "🧰 Tweaks",
  caveat: "📝 Caveats",
}

export default async function CaseStudiesPage() {
  let data: ApiPayload
  try {
    data = await fetchData()
  } catch (e) {
    return (
      <main className="mx-auto max-w-4xl p-8 font-mono text-sm">
        <h1 className="mb-4 text-2xl font-bold">⚠️ /case-studies — data pipeline error</h1>
        <pre className="rounded bg-red-50 p-4 text-red-800">{String(e)}</pre>
        <p className="mt-4">
          Hint: run <code className="rounded bg-gray-100 px-2 py-1">web/data/case-studies/init.sh</code> to
          rebuild the SQLite seed.
        </p>
      </main>
    )
  }

  const { caseStudies, coverage, meta } = data

  return (
    <main className="mx-auto max-w-5xl p-8 font-mono">
      <header className="mb-8 border-b pb-4">
        <h1 className="text-3xl font-bold">📂 Case studies — pre-design dump</h1>
        <p className="mt-2 text-sm text-gray-600">
          Source: SQLite (dev) → Supabase (prod target). This page renders raw API data — UI design
          coming next iteration.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Generated {meta.generated_at} · {meta.total_published} published · {meta.total_metrics} metrics ·{" "}
          {meta.total_notes} notes · coverage {meta.coverage_done}/{meta.total_coverage_cells}
        </p>
      </header>

      <section className="mb-12">
        <h2 className="mb-4 text-xl font-bold">🧪 Field tests ({caseStudies.length})</h2>
        <div className="space-y-8">
          {caseStudies.map((cs) => (
            <article key={cs.id} className="rounded-lg border bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-baseline gap-3">
                <span className="rounded bg-gray-900 px-2 py-1 text-xs font-bold text-white">
                  #{cs.case_number}
                </span>
                <h3 className="text-lg font-bold">{cs.title}</h3>
              </div>
              <p className="mb-4 text-sm text-gray-700">{cs.profile_summary}</p>

              <details open className="mb-3">
                <summary className="cursor-pointer text-sm font-semibold">📊 Metrics ({cs.metrics.length})</summary>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {cs.metrics.map((m) => (
                      <tr key={m.metric_key} className="border-b">
                        <td className="py-1 pr-2 text-gray-500">
                          {m.emoji} {m.metric_label}
                        </td>
                        <td className={`py-1 ${m.highlighted ? "font-bold" : ""}`}>
                          {m.value_text ?? (m.value_num !== null ? `${m.value_num}` : "—")}
                          {m.unit && m.value_num !== null && !m.value_text ? ` ${m.unit}` : ""}
                        </td>
                        <td className="py-1 pl-2 text-right text-gray-400">{m.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              {(["worked", "didnt_work", "tweak", "caveat"] as const).map((t) => {
                const ns = cs.notes.filter((n) => n.note_type === t)
                if (ns.length === 0) return null
                return (
                  <details key={t} className="mb-2">
                    <summary className="cursor-pointer text-sm font-semibold">
                      {noteHeader[t]} ({ns.length})
                    </summary>
                    <ul className="ml-4 mt-2 list-disc space-y-1 text-xs text-gray-700">
                      {ns.map((n, i) => (
                        <li key={i}>{n.body_md}</li>
                      ))}
                    </ul>
                  </details>
                )
              })}
            </article>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-xl font-bold">
          🎯 Coverage matrix ({meta.coverage_done}/{meta.total_coverage_cells} done)
        </h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Persona</th>
              <th className="py-2 pr-2">Provider</th>
              <th className="py-2 pr-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => (
              <tr key={c.cell_number} className="border-b">
                <td className="py-2 pr-2 text-gray-500">{c.cell_number}</td>
                <td className="py-2 pr-2">{c.persona_label}</td>
                <td className="py-2 pr-2">{c.provider_label}</td>
                <td className="py-2 pr-2">
                  {c.status === "done" ? "✅" : c.status === "in_progress" ? "🟡" : "⬜"} {c.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="mt-12 border-t pt-4 text-xs text-gray-500">
        <p>
          Raw API: <code>GET /api/case-studies</code> · Schema:{" "}
          <code>web/data/case-studies/schema.sql</code> · Seed:{" "}
          <code>web/data/case-studies/seed.sql</code>
        </p>
      </footer>
    </main>
  )
}
