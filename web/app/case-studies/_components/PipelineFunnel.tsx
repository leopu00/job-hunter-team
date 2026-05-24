import type { CaseStudy, Window } from "./types"
import { metricNum, providerColor } from "./types"

type Props = {
  caseStudies: CaseStudy[]
}

// Multi-pane funnel: each case study gets a vertical stack of stages.
// - Codex has full state-transition data → 5-stage funnel with per-stage drop-off
// - Kimi has partial transitions (logging enabled mid-run) → 2-stage + breakdowns:
//   * Phase split (pre/post LinkedIn) from the windows
//   * Source split (LinkedIn vs other) from the source_* metrics
export function PipelineFunnel({ caseStudies }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 text-sm font-bold text-slate-900">🌊 Pipeline conversion</h3>
      <p className="mb-5 text-xs text-slate-500">
        From positions analyzed by the pipeline to ready applications. Width = absolute volume.
        Drop-off shows where positions were excluded.
      </p>
      <div className="space-y-8">
        {caseStudies.map((cs) => (
          <CaseFunnel key={cs.id} cs={cs} />
        ))}
      </div>
    </div>
  )
}

type FunnelStage = {
  key: string
  label: string
  count: number
  excludedHere?: number
}

function CaseFunnel({ cs }: { cs: CaseStudy }) {
  const accent = providerColor(cs.provider_name)
  const stages = buildStages(cs)
  const maxCount = Math.max(...stages.map((s) => s.count), 1)
  const conversion =
    stages.length > 0 ? (stages[stages.length - 1].count / stages[0].count) * 100 : 0

  // Side-panel data for Kimi (phase + source breakdown) when available
  const phases = cs.windows?.filter((w) => w.kind === "phase") ?? []
  const sources = buildSourceBreakdown(cs)

  return (
    <div className="border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <header className="mb-3 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-slate-900">
          <span
            className="mr-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            #{cs.case_number}
          </span>
          {cs.provider_name}
        </h4>
        <span className="font-mono text-sm font-bold text-slate-900">
          {conversion.toFixed(1)}% overall conversion
        </span>
      </header>

      <FunnelStages stages={stages} maxCount={maxCount} accent={accent} />

      {(phases.length > 0 || sources) && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {phases.length > 0 && <PhaseBreakdown phases={phases} accent={accent} />}
          {sources && <SourceBreakdown sources={sources} accent={accent} />}
        </div>
      )}
    </div>
  )
}

function buildStages(cs: CaseStudy): FunnelStage[] {
  // Detect 5-stage funnel data
  const newC = metricNum(cs, "pipeline_new")
  const checked = metricNum(cs, "pipeline_checked")
  const scored = metricNum(cs, "pipeline_scored")
  const writing = metricNum(cs, "pipeline_writing")
  const ready = metricNum(cs, "pipeline_ready")

  const exNew = metricNum(cs, "pipeline_excluded_at_new") ?? undefined
  const exChecked = metricNum(cs, "pipeline_excluded_at_checked") ?? undefined
  const exScored = metricNum(cs, "pipeline_excluded_at_scored") ?? undefined
  const exWriting = metricNum(cs, "pipeline_excluded_at_writing") ?? undefined

  if (newC != null && checked != null && scored != null && writing != null && ready != null) {
    return [
      { key: "new", label: "📥 Found", count: newC, excludedHere: exNew },
      { key: "checked", label: "🔍 Checked", count: checked, excludedHere: exChecked },
      { key: "scored", label: "📊 Scored", count: scored, excludedHere: exScored },
      { key: "writing", label: "✍️ Writing", count: writing, excludedHere: exWriting },
      { key: "ready", label: "✅ Ready", count: ready },
    ]
  }

  // Fallback to 2-stage with side-excluded total
  const found = metricNum(cs, "pipeline_new") ?? metricNum(cs, "positions_analyzed") ?? 0
  const readyFallback =
    metricNum(cs, "pipeline_ready") ?? metricNum(cs, "cvs_ready") ?? metricNum(cs, "applications_sent") ?? 0
  const excludedTotal = metricNum(cs, "pipeline_excluded_total") ?? undefined
  return [
    { key: "new", label: "📥 Found", count: found, excludedHere: excludedTotal },
    { key: "ready", label: "✅ Ready", count: readyFallback },
  ]
}

function FunnelStages({
  stages,
  maxCount,
  accent,
}: {
  stages: FunnelStage[]
  maxCount: number
  accent: string
}) {
  const initial = stages[0]?.count ?? 1
  return (
    <div className="space-y-1.5">
      {stages.map((s, i) => {
        const widthPct = Math.max(8, (s.count / maxCount) * 100)
        const cumulativePct = (s.count / initial) * 100
        const isLast = i === stages.length - 1
        const exPct = s.excludedHere ? Math.max(2, (s.excludedHere / maxCount) * 100) : 0
        return (
          <div key={s.key} className="space-y-0.5">
            <div className="flex items-baseline gap-2 text-xs text-slate-600">
              <span className="w-24 shrink-0 font-medium text-slate-700">{s.label}</span>
              <span className="font-mono text-slate-900">
                {s.count.toLocaleString()}
                <span className="ml-1 text-slate-500">({cumulativePct.toFixed(0)}%)</span>
              </span>
              {s.excludedHere != null && s.excludedHere > 0 && (
                <span className="ml-auto font-mono text-xs text-red-600">
                  −{s.excludedHere} excluded
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <div
                className={`h-5 rounded ${isLast ? "" : "rounded-r"}`}
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: accent,
                  opacity: 1 - i * 0.12,
                }}
              />
              {exPct > 0 && (
                <div
                  className="h-5 rounded bg-red-300"
                  style={{ width: `${exPct}%`, opacity: 0.5 }}
                  title={`${s.excludedHere} excluded at this stage`}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PhaseBreakdown({ phases, accent }: { phases: Window[]; accent: string }) {
  const maxFound = Math.max(...phases.map((p) => p.positions_found ?? 0), 1)
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h5 className="mb-2 text-xs font-bold text-slate-800">📅 By phase (within window)</h5>
      <div className="space-y-2">
        {phases.map((p) => {
          const found = p.positions_found ?? 0
          const ready = p.ready_cvs ?? 0
          const widthPct = (found / maxFound) * 100
          const readyWidth = found > 0 ? (ready / found) * widthPct : 0
          return (
            <div key={p.id}>
              <div className="flex items-baseline justify-between text-[11px] text-slate-600">
                <span>{p.label.replace("Phase: ", "")}</span>
                <span className="font-mono font-bold text-slate-900">
                  {p.conversion_pct}% ({ready}/{found})
                </span>
              </div>
              <div className="mt-0.5 h-3 overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full"
                  style={{ width: `${widthPct}%`, backgroundColor: accent, opacity: 0.3 }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${(readyWidth / widthPct) * 100}%`,
                      backgroundColor: accent,
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type SourceBreakdownData = Array<{
  label: string
  emoji: string
  total: number
  ready: number
  conversion: number
}>

function buildSourceBreakdown(cs: CaseStudy): SourceBreakdownData | null {
  const linkedinTotal = metricNum(cs, "source_linkedin_total")
  const linkedinReady = metricNum(cs, "source_linkedin_ready")
  const otherTotal = metricNum(cs, "source_other_total")
  const otherReady = metricNum(cs, "source_other_ready")
  if (linkedinTotal == null || linkedinReady == null || otherTotal == null || otherReady == null) {
    return null
  }
  return [
    {
      label: "LinkedIn",
      emoji: "💼",
      total: linkedinTotal,
      ready: linkedinReady,
      conversion: linkedinTotal > 0 ? (linkedinReady / linkedinTotal) * 100 : 0,
    },
    {
      label: "Other sources",
      emoji: "🔗",
      total: otherTotal,
      ready: otherReady,
      conversion: otherTotal > 0 ? (otherReady / otherTotal) * 100 : 0,
    },
  ]
}

function SourceBreakdown({ sources, accent }: { sources: SourceBreakdownData; accent: string }) {
  const maxTotal = Math.max(...sources.map((s) => s.total), 1)
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h5 className="mb-2 text-xs font-bold text-slate-800">📡 By source</h5>
      <div className="space-y-2">
        {sources.map((s) => {
          const widthPct = (s.total / maxTotal) * 100
          const readyWidth = s.total > 0 ? (s.ready / s.total) * widthPct : 0
          return (
            <div key={s.label}>
              <div className="flex items-baseline justify-between text-[11px] text-slate-600">
                <span>
                  {s.emoji} {s.label}
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {s.conversion.toFixed(1)}% ({s.ready}/{s.total})
                </span>
              </div>
              <div className="mt-0.5 h-3 overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full"
                  style={{ width: `${widthPct}%`, backgroundColor: accent, opacity: 0.3 }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${(readyWidth / widthPct) * 100}%`,
                      backgroundColor: accent,
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
