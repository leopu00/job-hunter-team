import type { CaseStudy } from "./types"
import { metricText, providerColor } from "./types"

type Props = {
  cs: CaseStudy
}

const NOTE_LABEL: Record<
  CaseStudy["notes"][number]["note_type"],
  { title: string; tone: string }
> = {
  worked: { title: "✅ What worked", tone: "text-emerald-700 border-emerald-200 bg-emerald-50" },
  didnt_work: {
    title: "⚠️ What didn't work",
    tone: "text-amber-800 border-amber-200 bg-amber-50",
  },
  tweak: { title: "🧰 Tweaks", tone: "text-slate-700 border-slate-200 bg-slate-50" },
  caveat: { title: "📝 Caveats", tone: "text-slate-600 border-slate-200 bg-white" },
}

export function CaseStudyCard({ cs }: Props) {
  const accent = providerColor(cs.provider_name)

  const heroMetrics = cs.metrics
    .filter((m) => m.highlighted)
    .sort((a, b) => a.display_order - b.display_order)
  const metaMetrics = cs.metrics
    .filter((m) => m.category === "metadata")
    .sort((a, b) => a.display_order - b.display_order)

  return (
    <article
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md sm:p-8"
      id={cs.slug}
    >
      <header className="mb-6 flex flex-wrap items-baseline gap-3 border-b border-slate-100 pb-4">
        <span
          className="rounded-full px-3 py-1 text-xs font-bold text-white"
          style={{ backgroundColor: accent }}
        >
          Case #{cs.case_number}
        </span>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{cs.title}</h2>
        <span className="text-xs text-slate-500">· {cs.tester_handle}</span>
      </header>

      <p className="mb-6 text-sm leading-relaxed text-slate-700">{cs.profile_summary}</p>

      {/* metadata strip */}
      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        {metaMetrics.map((m) => (
          <div key={m.metric_key}>
            <dt className="text-slate-500">
              {m.emoji} {m.metric_label}
            </dt>
            <dd className="font-medium text-slate-800">{metricText(cs, m.metric_key)}</dd>
          </div>
        ))}
      </dl>

      {/* hero KPI strip */}
      {heroMetrics.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-4">
          {heroMetrics.map((m) => (
            <div key={m.metric_key}>
              <div className="text-xs text-slate-500">
                {m.emoji} {m.metric_label}
              </div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {m.value_text ?? m.value_num}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* notes — sections only render if non-empty */}
      <div className="space-y-3">
        {(["worked", "didnt_work", "tweak", "caveat"] as const).map((t) => {
          const ns = cs.notes
            .filter((n) => n.note_type === t)
            .sort((a, b) => a.display_order - b.display_order)
          if (ns.length === 0) return null
          const label = NOTE_LABEL[t]
          return (
            <details key={t} className={`rounded-lg border p-3 ${label.tone}`}>
              <summary className="cursor-pointer text-sm font-semibold">
                {label.title}{" "}
                <span className="ml-1 rounded-full bg-white/60 px-2 py-0.5 text-xs">
                  {ns.length}
                </span>
              </summary>
              <ul className="ml-4 mt-3 list-disc space-y-2 text-sm leading-relaxed">
                {ns.map((n, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: renderInlineMd(n.body_md) }} />
                ))}
              </ul>
            </details>
          )
        })}
      </div>
    </article>
  )
}

// Minimal markdown: **bold**, *italic*, `code`. Source content is trusted (we author it).
function renderInlineMd(md: string): string {
  const esc = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-white/70 px-1 py-0.5 text-xs">$1</code>')
}
