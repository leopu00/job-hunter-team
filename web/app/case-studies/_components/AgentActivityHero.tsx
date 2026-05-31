import type { CaseStudy, Window } from "./types"
import { providerColor } from "./types"
import { AgentTracksChart } from "./AgentTracksChart"

type Props = {
  caseStudy: CaseStudy
  weekly: Window
}

// Hero section at the top of /case-studies dedicated to the per-5h-window
// agent activity charts. Same FiveHourWindowChart used inside the case study
// card, surfaced as the page's marquee analysis.
export function AgentActivityHero({ caseStudy, weekly }: Props) {
  const fiveHour = weekly.five_hour_windows ?? []
  if (fiveHour.length === 0) return null

  const accent = providerColor(caseStudy.provider_name)
  const activity = weekly.agent_activity ?? []

  return (
    <section className="border-b border-slate-800 bg-slate-950 py-10 text-slate-100">
      <div className="mx-auto max-w-[1500px] px-6">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              ⏱ Chi ha lavorato, quanto e quando
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {caseStudy.title} · finestra weekly suddivisa in {fiveHour.length} slice
              rolling 5h.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
            {caseStudy.provider_name}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {fiveHour.map((fhw) => {
            const start = new Date(fhw.started_at).getTime()
            const end = new Date(fhw.ended_at).getTime()
            const ivs = activity.filter((a) => {
              const s = new Date(a.ts_start).getTime()
              const e = new Date(a.ts_end).getTime()
              return s <= end && e >= start
            })
            return <AgentTracksChart key={fhw.window_number} fiveHourWindow={fhw} activity={ivs} />
          })}
        </div>
      </div>
    </section>
  )
}
