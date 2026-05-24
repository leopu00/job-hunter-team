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
  // Computed once stages are built: how many positions passed forward from this
  // stage to the next one. Null on the last (terminal) stage.
  passedForward?: number | null
}

function CaseFunnel({ cs }: { cs: CaseStudy }) {
  const accent = providerColor(cs.provider_name)
  const stages = buildStages(cs)
  const maxCount = Math.max(...stages.map((s) => s.count), 1)

  // Conversion rates — two flavours:
  // - terminal: ready / (ready + excluded) → "of positions that reached a decision"
  // - loose:    ready / total_found       → naïve, biased by in-flight positions
  const totalFound = stages[0]?.count ?? 0
  const ready = stages[stages.length - 1]?.count ?? 0
  const excludedTotal = metricNum(cs, "pipeline_excluded_total") ?? 0
  const inFlight = Math.max(0, totalFound - ready - excludedTotal)
  const terminalConv =
    ready + excludedTotal > 0 ? (ready / (ready + excludedTotal)) * 100 : 0
  const looseConv = totalFound > 0 ? (ready / totalFound) * 100 : 0

  // Side-panel data for Kimi (phase + source breakdown) when available
  const phases = cs.windows?.filter((w) => w.kind === "phase") ?? []
  const sources = buildSourceBreakdown(cs)

  return (
    <div className="border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">
          <span
            className="mr-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            #{cs.case_number}
          </span>
          {cs.provider_name}
        </h4>
        <div className="flex items-baseline gap-2 text-right">
          <span className="font-mono text-sm font-bold text-slate-900">
            {terminalConv.toFixed(1)}% conversion
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            (on {ready + excludedTotal} decided)
          </span>
        </div>
      </header>

      <FunnelStages stages={stages} maxCount={maxCount} accent={accent} />

      {(inFlight > 0 || excludedTotal > 0) && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Of {totalFound} positions found: <strong>{ready}</strong> ready ·{" "}
          <strong>{excludedTotal}</strong> excluded ·{" "}
          {inFlight > 0 && (
            <>
              <strong>{inFlight}</strong> still in pipeline at HALT (
              {((inFlight / totalFound) * 100).toFixed(0)}% — not yet a terminal decision).{" "}
            </>
          )}
          Naïve conversion (ready / total found) = {looseConv.toFixed(1)}% — biased downward by
          in-flight positions.
        </p>
      )}

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

  let stages: FunnelStage[]
  if (newC != null && checked != null && scored != null && writing != null && ready != null) {
    stages = [
      { key: "new", label: "📥 Found", count: newC, excludedHere: exNew },
      { key: "checked", label: "🔍 Checked", count: checked, excludedHere: exChecked },
      { key: "scored", label: "📊 Scored", count: scored, excludedHere: exScored },
      { key: "writing", label: "✍️ Writing", count: writing, excludedHere: exWriting },
      { key: "ready", label: "✅ Ready", count: ready },
    ]
  } else {
    // Fallback to 2-stage with side-excluded total
    const found = metricNum(cs, "pipeline_new") ?? metricNum(cs, "positions_analyzed") ?? 0
    const readyFallback =
      metricNum(cs, "pipeline_ready") ??
      metricNum(cs, "cvs_ready") ??
      metricNum(cs, "applications_sent") ??
      0
    const excludedTotal = metricNum(cs, "pipeline_excluded_total") ?? undefined
    stages = [
      { key: "new", label: "📥 Found", count: found, excludedHere: excludedTotal },
      { key: "ready", label: "✅ Ready", count: readyFallback },
    ]
  }

  // Annotate each stage with passedForward = count of the NEXT stage.
  // Last (terminal) stage has passedForward = null.
  for (let i = 0; i < stages.length; i++) {
    stages[i].passedForward = i < stages.length - 1 ? stages[i + 1].count : null
  }
  return stages
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
        // Stage bar width is proportional to the absolute count vs the maxCount of the case.
        // INSIDE the bar we split into 2 colored segments + an implicit empty remainder
        // (positions still in-flight at this stage when the team was halted). The blue
        // ("passed forward") segment is exactly as wide as the NEXT stage's bar, so the
        // funnel drop-off is obvious.
        const widthPct = Math.max(4, (s.count / maxCount) * 100)
        const cumulativePct = (s.count / initial) * 100

        const passed = s.passedForward // null for terminal stage
        const excluded = s.excludedHere ?? 0

        // Internal proportions (0..100 = % of the bar's own width)
        const passedShare = passed != null && s.count > 0 ? (passed / s.count) * 100 : 100
        const excludedShare = s.count > 0 ? (excluded / s.count) * 100 : 0

        return (
          <div key={s.key} className="space-y-0.5">
            <div className="flex items-baseline gap-2 text-xs text-slate-600">
              <span className="w-24 shrink-0 font-medium text-slate-700">{s.label}</span>
              <span className="font-mono text-slate-900">
                {s.count.toLocaleString()}
                <span className="ml-1 text-slate-500">({cumulativePct.toFixed(0)}%)</span>
              </span>
              {excluded > 0 && (
                <span className="ml-auto font-mono text-xs text-red-600">
                  −{excluded} excluded
                </span>
              )}
            </div>
            <div
              className="flex h-5 overflow-hidden rounded bg-slate-100"
              style={{ width: `${widthPct}%` }}
              role="img"
              aria-label={`stage ${s.label}: ${s.count} total${passed != null ? `, ${passed} passed forward` : ""}, ${excluded} excluded`}
            >
              {/* blue: passed forward to the next stage (last stage is fully blue) */}
              <div
                className="h-full"
                style={{
                  width: `${passedShare}%`,
                  backgroundColor: accent,
                  opacity: 1 - i * 0.06,
                }}
                title={
                  passed != null
                    ? `${passed} passed to ${stages[i + 1]?.label ?? "next stage"}`
                    : `${s.count} reached this terminal stage`
                }
              />
              {/* red: excluded at this stage */}
              {excludedShare > 0 && (
                <div
                  className="h-full bg-red-400"
                  style={{ width: `${excludedShare}%`, opacity: 0.55 }}
                  title={`${excluded} excluded at ${s.label}`}
                />
              )}
              {/* implicit empty remainder = in-flight at this stage, no explicit segment */}
            </div>
          </div>
        )
      })}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-3 rounded" style={{ backgroundColor: accent }} />
          passed to next stage
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-3 rounded bg-red-400 opacity-55" />
          excluded at this stage
        </span>
      </div>
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
