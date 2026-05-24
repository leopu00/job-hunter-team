import type { Window, BurnCurvePoint } from "./types"

type Props = {
  windows: Window[]
  accentColor: string
}

// Renders a per-case-study "Windows" section.
// Weekly windows are top-level cards; phase windows (parent_window_id != null) are
// nested under their parent as indented sub-cards.
export function WindowsSection({ windows, accentColor }: Props) {
  if (!windows || windows.length === 0) return null

  const weekly = windows.filter((w) => w.kind === "weekly").sort((a, b) => a.display_order - b.display_order)
  const phasesByParent = new Map<number, Window[]>()
  for (const w of windows.filter((w) => w.kind === "phase")) {
    if (w.parent_window_id == null) continue
    const arr = phasesByParent.get(w.parent_window_id) ?? []
    arr.push(w)
    phasesByParent.set(w.parent_window_id, arr)
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
      <h4 className="mb-3 text-sm font-bold text-slate-800">
        🪟 Windows ({weekly.length} weekly{windows.length > weekly.length ? ` · ${windows.length - weekly.length} phases` : ""})
      </h4>
      <p className="mb-4 text-xs text-slate-600">
        Each weekly subscription cycle is its own window. When something material changed mid-cycle
        (e.g. enabling a new scout source), the cycle is split into <strong>phases</strong>.
      </p>
      <div className="space-y-4">
        {weekly.map((w) => (
          <WeeklyCard
            key={w.id}
            w={w}
            phases={phasesByParent.get(w.id) ?? []}
            accentColor={accentColor}
          />
        ))}
      </div>
    </section>
  )
}

function WeeklyCard({
  w,
  phases,
  accentColor,
}: {
  w: Window
  phases: Window[]
  accentColor: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h5 className="text-sm font-semibold text-slate-900">
          <span
            className="mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
            style={{ backgroundColor: accentColor }}
          >
            W{w.window_number}
          </span>
          {w.label}
        </h5>
        {w.peak_usage_pct != null && (
          <span className="font-mono text-sm font-bold text-slate-900">
            peak {w.peak_usage_pct}%
          </span>
        )}
      </div>

      <WindowMetricsRow w={w} />

      {w.burn_curve && w.burn_curve.length > 1 && (
        <div className="mt-3">
          <BurnSparkline points={w.burn_curve} accentColor={accentColor} />
        </div>
      )}

      {w.notes_md && (
        <p
          className="mt-3 text-xs leading-relaxed text-slate-600"
          dangerouslySetInnerHTML={{ __html: renderInlineMd(w.notes_md) }}
        />
      )}

      {phases.length > 0 && (
        <div className="mt-4 space-y-2 border-l-2 border-slate-200 pl-3">
          {phases.map((p) => (
            <PhaseCard key={p.id} p={p} accentColor={accentColor} />
          ))}
        </div>
      )}
    </div>
  )
}

function PhaseCard({ p, accentColor }: { p: Window; accentColor: string }) {
  return (
    <div className="rounded border border-dashed border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h6 className="text-xs font-semibold text-slate-800">
          <span
            className="mr-2 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
            style={{ backgroundColor: accentColor, opacity: 0.7 }}
          >
            phase {p.window_number}
          </span>
          {p.label}
        </h6>
        {p.conversion_pct != null && (
          <span className="font-mono text-xs font-bold text-slate-800">
            {p.conversion_pct}% conv.
          </span>
        )}
      </div>
      <WindowMetricsRow w={p} compact />
      {p.notes_md && (
        <p
          className="mt-2 text-xs leading-relaxed text-slate-600"
          dangerouslySetInnerHTML={{ __html: renderInlineMd(p.notes_md) }}
        />
      )}
    </div>
  )
}

function WindowMetricsRow({ w, compact = false }: { w: Window; compact?: boolean }) {
  const items = [
    { label: "duration", value: w.duration_hours != null ? `${w.duration_hours}h` : null },
    { label: "positions", value: w.positions_found != null ? `${w.positions_found}` : null },
    { label: "ready", value: w.ready_cvs != null ? `${w.ready_cvs}` : null },
    {
      label: "conversion",
      value: w.conversion_pct != null ? `${w.conversion_pct}%` : null,
    },
  ].filter((i) => i.value != null)

  if (items.length === 0) return null

  return (
    <dl className={`grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4 ${compact ? "text-xs" : "text-sm"}`}>
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">{i.label}</dt>
          <dd className="font-mono font-semibold text-slate-800">{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function BurnSparkline({ points, accentColor }: { points: BurnCurvePoint[]; accentColor: string }) {
  const w = 320
  const h = 60
  const padX = 6
  const padY = 6
  const xs = points.map((_, i) => padX + (i * (w - 2 * padX)) / (points.length - 1))
  const ys = points.map((p) => h - padY - (p.w / 100) * (h - 2 * padY))
  const path = points.map((_, i) => `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join(" ")
  const area = `${path} L ${xs[xs.length - 1].toFixed(1)} ${h - padY} L ${xs[0].toFixed(1)} ${h - padY} Z`
  const lastPoint = points[points.length - 1]

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
        <span>Weekly budget burn (sampled)</span>
        <span className="font-mono">
          {lastPoint.t} → {lastPoint.w}%
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-12 w-full rounded bg-white"
        role="img"
        aria-label="Burn rate sparkline"
      >
        {/* 100% reference line */}
        <line
          x1={padX}
          x2={w - padX}
          y1={padY}
          y2={padY}
          stroke="#fca5a5"
          strokeDasharray="2 3"
          strokeWidth="0.5"
        />
        <text x={w - padX} y={padY + 3} fontSize="6" fill="#ef4444" textAnchor="end">
          100% cap
        </text>
        <path d={area} fill={accentColor} fillOpacity="0.15" />
        <path d={path} fill="none" stroke={accentColor} strokeWidth="1.5" />
        {/* End dot */}
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2" fill={accentColor} />
      </svg>
    </div>
  )
}

function renderInlineMd(md: string): string {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1 py-0.5 text-[10px]">$1</code>')
}
