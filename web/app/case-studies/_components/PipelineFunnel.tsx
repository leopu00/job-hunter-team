import type { CaseStudy } from "./types";
import { metricNum, providerColor } from "./types";

type Props = {
  caseStudies: CaseStudy[];
};

// Multi-pane funnel: each case study gets a vertical stack of stages.
// - Codex has full state-transition data → 5-stage funnel with per-stage drop-off
// - Kimi has partial transitions (logging enabled mid-run) → 2-stage + breakdowns:
//   * Phase split (pre/post LinkedIn) from the windows
//   * Source split (LinkedIn vs other) from the source_* metrics
export function PipelineFunnel({ caseStudies }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 text-sm font-bold text-slate-900">
        🌊 Pipeline conversion
      </h3>
      <p className="mb-5 text-xs text-slate-500">
        From positions analyzed by the pipeline to ready applications. Width =
        absolute volume. Drop-off shows where positions were excluded.
      </p>
      <div className="space-y-8">
        {caseStudies.map((cs) => (
          <CaseFunnel key={cs.id} cs={cs} />
        ))}
      </div>
    </div>
  );
}

type FunnelStage = {
  key: string;
  label: string;
  count: number;
  excludedHere?: number;
  // Computed once stages are built: how many positions passed forward from this
  // stage to the next one. Null on the last (terminal) stage.
  passedForward?: number | null;
};

function CaseFunnel({ cs }: { cs: CaseStudy }) {
  const accent = providerColor(cs.provider_name);
  const stages = buildStages(cs);
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  // stages[0].count = cumulative-terminal Found = ready + total excluded.
  // The "raw" total found in the run (which is larger, since it includes in-flight)
  // comes from a separate metric.
  const decidedTotal = stages[0]?.count ?? 0;
  const ready = stages[stages.length - 1]?.count ?? 0;
  const excludedTotal = metricNum(cs, "pipeline_excluded_total") ?? 0;
  // For the "raw found in the run" count, prefer the un-cascaded total
  // (positions_analyzed) when available. pipeline_new may be the cumulative-terminal
  // count of the cascade (which IS the funnel's top stage) and would understate the
  // raw total for VPSes where in-flight positions exist.
  const rawFound =
    metricNum(cs, "positions_analyzed") ??
    metricNum(cs, "pipeline_new") ??
    decidedTotal;
  const inFlight = Math.max(0, rawFound - decidedTotal);
  const terminalConv = decidedTotal > 0 ? (ready / decidedTotal) * 100 : 0;
  const looseConv = rawFound > 0 ? (ready / rawFound) * 100 : 0;

  const sources = buildSourceBreakdown(cs);

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
            (on {decidedTotal} decided)
          </span>
        </div>
      </header>

      <FunnelStages stages={stages} maxCount={maxCount} accent={accent} />

      {(inFlight > 0 || excludedTotal > 0) && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Of <strong>{rawFound}</strong> positions found in the run,{" "}
          <strong>{decidedTotal}</strong> reached a terminal decision (
          <strong>{ready}</strong> ready · <strong>{excludedTotal}</strong>{" "}
          excluded). The funnel above shows the flow of those {decidedTotal}.
          {inFlight > 0 && (
            <>
              {" "}
              The remaining <strong>{inFlight}</strong> (
              {((inFlight / rawFound) * 100).toFixed(0)}
              %) were still in-flight at HALT and are excluded from the chart
              for clarity.
            </>
          )}{" "}
          Naïve conversion (ready / total found) = {looseConv.toFixed(1)}% —
          biased downward by in-flight positions.
        </p>
      )}

      {/* Pre/Post LinkedIn phase 5-stage funnels (Kimi only) */}
      <PhaseFunnels cs={cs} accent={accent} />

      {/* By-source breakdown (Kimi only) */}
      {sources && (
        <div className="mt-4">
          <SourceBreakdown sources={sources} accent={accent} />
        </div>
      )}
    </div>
  );
}

function buildStages(cs: CaseStudy): FunnelStage[] {
  // Detect 5-stage funnel data
  const newC = metricNum(cs, "pipeline_new");
  const checked = metricNum(cs, "pipeline_checked");
  const scored = metricNum(cs, "pipeline_scored");
  const writing = metricNum(cs, "pipeline_writing");
  const ready = metricNum(cs, "pipeline_ready");

  let stages: FunnelStage[];
  if (
    newC != null &&
    checked != null &&
    scored != null &&
    writing != null &&
    ready != null
  ) {
    // ─── Cumulative-terminal cascade ───
    // Each stage count = positions that EVENTUALLY reached a terminal decision
    // (ready or excluded), ignoring still-in-flight positions. This makes the
    // funnel "complete": for every stage, blue (passed forward) + red (excluded
    // here) fill the bar entirely, AND blue of stage N == bar of stage N+1.
    //
    // Math example for Codex:
    //   Ready = 105 (terminal)
    //   Writing cum = ready + excluded_writing = 105 + 27 = 132
    //   Scored cum  = 132 + excluded_scored = 132 + 3 = 135
    //   Checked cum = 135 + excluded_checked = 135 + 23 = 158
    //   Found cum   = 158 + excluded_new = 158 + 10 = 168
    //   168 = 105 ready + 63 excluded total. ✓
    const exNew = metricNum(cs, "pipeline_excluded_at_new") ?? 0;
    const exChecked = metricNum(cs, "pipeline_excluded_at_checked") ?? 0;
    const exScored = metricNum(cs, "pipeline_excluded_at_scored") ?? 0;
    const exWriting = metricNum(cs, "pipeline_excluded_at_writing") ?? 0;

    const cReady = ready;
    const cWriting = cReady + exWriting;
    const cScored = cWriting + exScored;
    const cChecked = cScored + exChecked;
    const cNew = cChecked + exNew;

    stages = [
      { key: "new", label: "📥 Found", count: cNew, excludedHere: exNew },
      {
        key: "checked",
        label: "🔍 Checked",
        count: cChecked,
        excludedHere: exChecked,
      },
      {
        key: "scored",
        label: "📊 Scored",
        count: cScored,
        excludedHere: exScored,
      },
      {
        key: "writing",
        label: "✍️ Writing",
        count: cWriting,
        excludedHere: exWriting,
      },
      { key: "ready", label: "✅ Ready", count: cReady },
    ];
  } else {
    // ─── 2-stage fallback (Kimi: per-stage exclusion not tracked, only total) ───
    // Same cascade idea collapsed to 2 stages: Found cum = ready + excluded_total.
    const readyVal =
      metricNum(cs, "pipeline_ready") ??
      metricNum(cs, "cvs_ready") ??
      metricNum(cs, "applications_sent") ??
      0;
    const excludedTotal = metricNum(cs, "pipeline_excluded_total") ?? 0;
    const cFound = readyVal + excludedTotal;
    stages = [
      {
        key: "new",
        label: "📥 Found",
        count: cFound,
        excludedHere: excludedTotal,
      },
      { key: "ready", label: "✅ Ready", count: readyVal },
    ];
  }

  // Annotate each stage with passedForward = count of the NEXT stage.
  // Last (terminal) stage has passedForward = null.
  // Since this is a cumulative-terminal cascade, by construction:
  //   passed + excluded == count (no empty/in-flight space inside bars).
  for (let i = 0; i < stages.length; i++) {
    stages[i].passedForward =
      i < stages.length - 1 ? stages[i + 1].count : null;
  }
  return stages;
}

function FunnelStages({
  stages,
  maxCount,
  accent,
}: {
  stages: FunnelStage[];
  maxCount: number;
  accent: string;
}) {
  const initial = stages[0]?.count ?? 1;
  return (
    <div className="space-y-1.5">
      {stages.map((s, i) => {
        // Stage bar width is proportional to the absolute count vs the maxCount of the case.
        // INSIDE the bar we split into 2 colored segments + an implicit empty remainder
        // (positions still in-flight at this stage when the team was halted). The blue
        // ("passed forward") segment is exactly as wide as the NEXT stage's bar, so the
        // funnel drop-off is obvious.
        const widthPct = Math.max(4, (s.count / maxCount) * 100);
        const cumulativePct = (s.count / initial) * 100;

        const passed = s.passedForward; // null for terminal stage
        const excluded = s.excludedHere ?? 0;

        // Internal proportions (0..100 = % of the bar's own width)
        const passedShare =
          passed != null && s.count > 0 ? (passed / s.count) * 100 : 100;
        const excludedShare = s.count > 0 ? (excluded / s.count) * 100 : 0;

        return (
          <div key={s.key} className="space-y-0.5">
            <div className="flex items-baseline gap-2 text-xs text-slate-600">
              <span className="w-24 shrink-0 font-medium text-slate-700">
                {s.label}
              </span>
              <span className="font-mono text-slate-900">
                {s.count.toLocaleString()}
                <span className="ml-1 text-slate-500">
                  ({cumulativePct.toFixed(0)}%)
                </span>
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
        );
      })}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-3 rounded"
            style={{ backgroundColor: accent }}
          />
          passed to next stage
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-3 rounded bg-red-400 opacity-55" />
          excluded at this stage
        </span>
      </div>
    </div>
  );
}

// PhaseFunnels: per Kimi we have a Pre/Post-LinkedIn split with full 5-stage
// cascade metrics for each phase (when metric keys phase_pre_pipeline_*  and
// phase_post_pipeline_* exist). Each phase gets its own mini-funnel with the
// same cumulative-terminal cascade convention used for the main funnel.
function PhaseFunnels({ cs, accent }: { cs: CaseStudy; accent: string }) {
  const pre = buildPhaseStages(cs, "phase_pre_");
  const post = buildPhaseStages(cs, "phase_post_");
  if (!pre || !post) return null;

  // Shared max so the two funnels are visually comparable side-by-side.
  const sharedMax = Math.max(pre[0]?.count ?? 0, post[0]?.count ?? 0, 1);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h5 className="mb-3 text-xs font-bold text-slate-800">
        📅 5-stage funnel by phase (within the second weekly window)
      </h5>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MiniPhaseFunnel
          label="Pre-LinkedIn enable"
          stages={pre}
          maxCount={sharedMax}
          accent={accent}
          totalFound={118}
          caveat="84 of the excluded were pre-bug-#14-fix (no per-stage attribution) → aggregated to scout-level"
        />
        <MiniPhaseFunnel
          label="Post-LinkedIn enable"
          stages={post}
          maxCount={sharedMax}
          accent={accent}
          totalFound={133}
        />
      </div>
    </div>
  );
}

function buildPhaseStages(cs: CaseStudy, prefix: string): FunnelStage[] | null {
  const newC = metricNum(cs, `${prefix}pipeline_new`);
  const checked = metricNum(cs, `${prefix}pipeline_checked`);
  const scored = metricNum(cs, `${prefix}pipeline_scored`);
  const writing = metricNum(cs, `${prefix}pipeline_writing`);
  const ready = metricNum(cs, `${prefix}pipeline_ready`);
  if ([newC, checked, scored, writing, ready].some((v) => v == null))
    return null;

  const exNew = metricNum(cs, `${prefix}ex_new`) ?? 0;
  const exChecked = metricNum(cs, `${prefix}ex_checked`) ?? 0;
  const exScored = metricNum(cs, `${prefix}ex_scored`) ?? 0;
  const exWriting = metricNum(cs, `${prefix}ex_writing`) ?? 0;

  const stages: FunnelStage[] = [
    { key: "new", label: "📥 Found", count: newC!, excludedHere: exNew },
    {
      key: "checked",
      label: "🔍 Checked",
      count: checked!,
      excludedHere: exChecked,
    },
    {
      key: "scored",
      label: "📊 Scored",
      count: scored!,
      excludedHere: exScored,
    },
    {
      key: "writing",
      label: "✍️ Writing",
      count: writing!,
      excludedHere: exWriting,
    },
    { key: "ready", label: "✅ Ready", count: ready! },
  ];
  for (let i = 0; i < stages.length; i++) {
    stages[i].passedForward =
      i < stages.length - 1 ? stages[i + 1].count : null;
  }
  return stages;
}

function MiniPhaseFunnel({
  label,
  stages,
  maxCount,
  accent,
  totalFound,
  caveat,
}: {
  label: string;
  stages: FunnelStage[];
  maxCount: number;
  accent: string;
  totalFound: number;
  caveat?: string;
}) {
  const cReady = stages[stages.length - 1].count;
  const cNew = stages[0].count;
  const conv = cNew > 0 ? (cReady / cNew) * 100 : 0;
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-900">{label}</span>
        <span className="font-mono text-xs font-bold text-slate-900">
          {conv.toFixed(1)}%
        </span>
      </div>
      <div className="space-y-1">
        {stages.map((s, i) => {
          const widthPct = Math.max(2, (s.count / maxCount) * 100);
          const passed = s.passedForward;
          const excluded = s.excludedHere ?? 0;
          const passedShare =
            passed != null && s.count > 0 ? (passed / s.count) * 100 : 100;
          const excludedShare = s.count > 0 ? (excluded / s.count) * 100 : 0;
          return (
            <div key={s.key} className="flex items-center gap-2 text-[10px]">
              <span className="w-16 shrink-0 text-slate-600">{s.label}</span>
              <span className="w-8 shrink-0 text-right font-mono text-slate-700">
                {s.count}
              </span>
              <div className="relative flex h-3 flex-1 overflow-hidden rounded bg-slate-100">
                <div
                  className="flex h-3 overflow-hidden rounded"
                  style={{ width: `${widthPct}%` }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${passedShare}%`,
                      backgroundColor: accent,
                      opacity: 1 - i * 0.06,
                    }}
                  />
                  {excludedShare > 0 && (
                    <div
                      className="h-full bg-red-400"
                      style={{ width: `${excludedShare}%`, opacity: 0.55 }}
                    />
                  )}
                </div>
              </div>
              {excluded > 0 && (
                <span className="w-12 shrink-0 text-right font-mono text-[10px] text-red-600">
                  −{excluded}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        {totalFound} positions found · {cReady} ready · {cNew - cReady} excluded
        · {totalFound - cNew} in-flight
      </p>
      {caveat && (
        <p className="mt-1 text-[10px] italic text-slate-500">⚠️ {caveat}</p>
      )}
    </div>
  );
}

type SourceBreakdownData = Array<{
  label: string;
  emoji: string;
  total: number;
  ready: number;
  conversion: number;
}>;

function buildSourceBreakdown(cs: CaseStudy): SourceBreakdownData | null {
  const linkedinTotal = metricNum(cs, "source_linkedin_total");
  const linkedinReady = metricNum(cs, "source_linkedin_ready");
  const otherTotal = metricNum(cs, "source_other_total");
  const otherReady = metricNum(cs, "source_other_ready");
  if (
    linkedinTotal == null ||
    linkedinReady == null ||
    otherTotal == null ||
    otherReady == null
  ) {
    return null;
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
  ];
}

function SourceBreakdown({
  sources,
  accent,
}: {
  sources: SourceBreakdownData;
  accent: string;
}) {
  const maxTotal = Math.max(...sources.map((s) => s.total), 1);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h5 className="mb-2 text-xs font-bold text-slate-800">📡 By source</h5>
      <div className="space-y-2">
        {sources.map((s) => {
          const widthPct = (s.total / maxTotal) * 100;
          const readyWidth = s.total > 0 ? (s.ready / s.total) * widthPct : 0;
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
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: accent,
                    opacity: 0.3,
                  }}
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
          );
        })}
      </div>
    </div>
  );
}
