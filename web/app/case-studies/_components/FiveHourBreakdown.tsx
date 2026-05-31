import type { FiveHourWindow, BurnSample, AgentActivity } from "./types"
import { FiveHourWindowChart } from "./FiveHourWindowChart"
import { ZoomableChart } from "./ZoomableChart"

type Props = {
  windows: FiveHourWindow[]
  accentColor: string
  burnSamples?: BurnSample[]
  agentActivity?: AgentActivity[]
}

// Renders the rolling 5h sub-windows derived from a weekly window's burn curve.
// Combines (a) bar chart of per-window Δ usage, (b) cumulative-usage line on the
// same SVG, (c) a tabular summary, and (d) per-window detailed charts when
// high-frequency samples + activity intervals are available.
export function FiveHourBreakdown({ windows, accentColor, burnSamples, agentActivity }: Props) {
  if (!windows || windows.length === 0) return null

  const hasDetail = (burnSamples?.length ?? 0) > 0 || (agentActivity?.length ?? 0) > 0

  return (
    <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h6 className="text-xs font-semibold text-slate-800">
          ⏱ Rolling 5h windows ({windows.length})
        </h6>
        <span className="text-[10px] text-slate-500">
          Δ bars · cumulative weekly burn overlay
        </span>
      </header>

      <Chart windows={windows} accentColor={accentColor} />

      <Table windows={windows} accentColor={accentColor} />

      {hasDetail && (
        <div className="mt-4 flex flex-col gap-4">
          {windows.map((fhw) => {
            const start = new Date(fhw.started_at).getTime()
            const end = new Date(fhw.ended_at).getTime()
            const inWin = (ts: string) => {
              const t = new Date(ts).getTime()
              return t >= start && t <= end
            }
            const samples = (burnSamples ?? []).filter((s) => inWin(s.ts))
            const activity = (agentActivity ?? []).filter((a) => {
              const s = new Date(a.ts_start).getTime()
              const e = new Date(a.ts_end).getTime()
              return s <= end && e >= start
            })
            return (
              <ZoomableChart key={fhw.window_number} label={`Finestra ${fhw.window_number}`}>
                <FiveHourWindowChart
                  fiveHourWindow={fhw}
                  samples={samples}
                  activity={activity}
                  accentColor={accentColor}
                />
              </ZoomableChart>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Chart({ windows, accentColor }: { windows: FiveHourWindow[]; accentColor: string }) {
  const w = 720
  const h = 200
  const padL = 36
  const padR = 24
  const padT = 28
  const padB = 30
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const totalH = windows.reduce((s, x) => s + x.duration_hours, 0)
  const maxDelta = Math.max(...windows.map((x) => Math.abs(x.usage_delta_pct)))
  const deltaScale = Math.max(20, Math.ceil(maxDelta / 5) * 5)

  // Cumulative offset along x for each window
  let acc = 0
  const segments = windows.map((win) => {
    const x0 = padL + (acc / totalH) * innerW
    acc += win.duration_hours
    const x1 = padL + (acc / totalH) * innerW
    return { win, x0, x1 }
  })

  const yPct = (pct: number) => padT + innerH * (1 - pct / 100)
  const yDelta = (pp: number) => padT + innerH * (1 - pp / deltaScale)

  // Cumulative line points: start of window 1, then end of each window
  const linePoints: Array<{ x: number; y: number }> = []
  linePoints.push({ x: segments[0].x0, y: yPct(segments[0].win.usage_start_pct) })
  for (const s of segments) {
    linePoints.push({ x: s.x1, y: yPct(s.win.usage_end_pct) })
  }
  const linePath = linePoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ")

  // Y-axis ticks (cumulative %)
  const yTicks = [0, 25, 50, 75, 100]

  // Helper to format wall-clock label
  const tickLabel = (iso: string) => iso.slice(11, 16)

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-44 w-full"
      role="img"
      aria-label="Rolling 5-hour windows: per-window delta bars and cumulative weekly burn"
    >
      {/* Background bands per window */}
      {segments.map((s, i) => (
        <rect
          key={`band-${s.win.window_number}`}
          x={s.x0}
          y={padT}
          width={s.x1 - s.x0}
          height={innerH}
          fill={i % 2 === 0 ? "#f8fafc" : "#ffffff"}
        />
      ))}

      {/* Y grid + tick labels (cumulative %) */}
      {yTicks.map((t) => (
        <g key={`tick-${t}`}>
          <line
            x1={padL}
            x2={w - padR}
            y1={yPct(t)}
            y2={yPct(t)}
            stroke={t === 100 ? "#fca5a5" : "#e2e8f0"}
            strokeWidth="0.5"
            strokeDasharray={t === 100 ? "3 3" : undefined}
          />
          <text
            x={padL - 4}
            y={yPct(t) + 3}
            fontSize="9"
            textAnchor="end"
            fill={t === 100 ? "#ef4444" : "#64748b"}
          >
            {t}%
          </text>
        </g>
      ))}

      {/* Δ bars (background-ish: drawn before the line) */}
      {segments.map((s) => {
        const barW = Math.max(8, (s.x1 - s.x0) * 0.55)
        const cx = (s.x0 + s.x1) / 2
        const bx = cx - barW / 2
        const by = yDelta(s.win.usage_delta_pct)
        const bh = padT + innerH - by
        return (
          <g key={`bar-${s.win.window_number}`}>
            <rect
              x={bx}
              y={by}
              width={barW}
              height={bh}
              fill={accentColor}
              fillOpacity="0.25"
              rx="2"
            />
            <text
              x={cx}
              y={by - 3}
              fontSize="9"
              textAnchor="middle"
              fill="#334155"
              fontWeight="600"
            >
              {s.win.usage_delta_pct >= 0 ? "+" : ""}
              {Math.round(s.win.usage_delta_pct)}pp
            </text>
          </g>
        )
      })}

      {/* Window separators + W# labels at top */}
      {segments.map((s, i) => (
        <g key={`sep-${s.win.window_number}`}>
          {i > 0 && (
            <line
              x1={s.x0}
              x2={s.x0}
              y1={padT}
              y2={padT + innerH}
              stroke="#cbd5e1"
              strokeWidth="0.5"
              strokeDasharray="2 3"
            />
          )}
          <rect
            x={s.x0 + 2}
            y={padT - 16}
            width={Math.max(18, s.x1 - s.x0 - 4)}
            height="13"
            fill={accentColor}
            fillOpacity="0.85"
            rx="2"
          />
          <text
            x={(s.x0 + s.x1) / 2}
            y={padT - 6}
            fontSize="9"
            textAnchor="middle"
            fill="white"
            fontWeight="700"
          >
            W{s.win.window_number}
          </text>
        </g>
      ))}

      {/* Cumulative line on top */}
      <path d={linePath} fill="none" stroke={accentColor} strokeWidth="1.6" />
      {linePoints.map((p, i) => (
        <circle key={`pt-${i}`} cx={p.x} cy={p.y} r="2" fill={accentColor} />
      ))}

      {/* X-axis: time labels at each window boundary (sparse to avoid overlap) */}
      {segments.map((s, i) => (
        <text
          key={`xl-${i}`}
          x={s.x0}
          y={h - padB + 12}
          fontSize="8"
          textAnchor="middle"
          fill="#64748b"
        >
          {tickLabel(s.win.started_at)}
        </text>
      ))}
      <text
        x={segments[segments.length - 1].x1}
        y={h - padB + 12}
        fontSize="8"
        textAnchor="middle"
        fill="#64748b"
      >
        {tickLabel(segments[segments.length - 1].win.ended_at)}
      </text>

      {/* Legend */}
      <g transform={`translate(${padL}, ${h - 10})`}>
        <rect width="9" height="6" y="-5" fill={accentColor} fillOpacity="0.25" rx="1" />
        <text x="13" y="0" fontSize="8" fill="#475569">
          Δ usage per 5h (left)
        </text>
        <g transform="translate(120, 0)">
          <line x1="0" x2="14" y1="-2" y2="-2" stroke={accentColor} strokeWidth="1.6" />
          <text x="18" y="0" fontSize="8" fill="#475569">
            cumulative weekly %
          </text>
        </g>
      </g>
    </svg>
  )
}

function Table({ windows, accentColor }: { windows: FiveHourWindow[]; accentColor: string }) {
  // Estimate the rolling 5h cap as a fraction of the weekly budget. The
  // design doc (docs/internal/2026-05-25-work-hours-design.md) calibrates
  // Codex Pro at ~92% of 5h cap ≈ 13.5pp of weekly → cap5h ≈ 14.7pp. We use
  // the observed maximum delta + a small margin so other case studies with
  // different providers degrade gracefully.
  const observedMax = Math.max(...windows.map((w) => Math.abs(w.usage_delta_pct)))
  const cap5h = Math.max(15, Math.ceil(observedMax / 5) * 5 + 2)

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-1 pr-2 font-medium">#</th>
            <th className="py-1 pr-2 font-medium">range (UTC)</th>
            <th className="py-1 pr-2 text-right font-medium">dur</th>
            <th className="py-1 pr-2 text-right font-medium">cum. start →</th>
            <th className="py-1 pr-2 text-right font-medium">cum. end</th>
            <th className="py-1 pr-3 font-medium" colSpan={2}>
              5h burn <span className="text-slate-400">(cap ~{cap5h}pp)</span>
            </th>
            <th className="py-1 pr-2 text-right font-medium">peak</th>
          </tr>
        </thead>
        <tbody className="font-mono text-slate-800">
          {windows.map((w) => {
            const pctOfCap = Math.min(100, (Math.abs(w.usage_delta_pct) / cap5h) * 100)
            const overCap = w.usage_delta_pct > cap5h
            return (
              <tr key={w.window_number} className="border-b border-slate-100 last:border-0">
                <td className="py-1 pr-2">
                  <span
                    className="inline-block rounded px-1 py-0.5 text-[9px] font-bold text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    W{w.window_number}
                  </span>
                </td>
                <td className="py-1 pr-2 text-slate-600">
                  {w.started_at.slice(5, 16).replace("T", " ")} →{" "}
                  {w.ended_at.slice(5, 16).replace("T", " ")}
                </td>
                <td className="py-1 pr-2 text-right">{w.duration_hours}h</td>
                <td className="py-1 pr-2 text-right">{w.usage_start_pct}%</td>
                <td className="py-1 pr-2 text-right font-semibold">{w.usage_end_pct}%</td>
                <td className="py-1 pr-1 text-right">
                  <span style={{ color: accentColor }} className="font-semibold">
                    {w.usage_delta_pct >= 0 ? "+" : ""}
                    {w.usage_delta_pct}pp
                  </span>
                </td>
                <td className="py-1 pr-3" style={{ minWidth: 140 }}>
                  <div
                    className="relative h-3 w-full overflow-hidden rounded-sm bg-slate-100"
                    title={`${Math.round(pctOfCap)}% of estimated 5h cap`}
                  >
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${pctOfCap}%`,
                        backgroundColor: overCap ? "#ef4444" : accentColor,
                        opacity: 0.55,
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-end pr-1 text-[9px] font-semibold text-slate-700">
                      {Math.round(pctOfCap)}%
                    </span>
                  </div>
                </td>
                <td className="py-1 pr-2 text-right">{w.peak_usage_pct}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-slate-500">
        <strong>cum. start / end / peak</strong> = cumulative weekly budget at window
        boundaries. <strong>5h burn</strong> = Δ consumed inside this 5h window, expressed in
        weekly-budget percentage points and as % of the estimated rolling 5h cap.
      </p>
    </div>
  )
}
