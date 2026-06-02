import type { FiveHourWindow, BurnSample, AgentActivity } from "./types"
import { FiveHourWindowChart } from "./FiveHourWindowChart"
import { ZoomableChart } from "./ZoomableChart"

type Props = {
  windows: FiveHourWindow[]
  accentColor: string
  burnSamples?: BurnSample[]
  agentActivity?: AgentActivity[]
}

type WinStats = {
  win: FiveHourWindow
  peakCap5h: number // 0..100, peak window_usage_pct inside this slice
  endCap5h: number // window_usage_pct at the slice end
  startCap5h: number // window_usage_pct at the slice start
  weeklyDeltaPp: number // weekly burn pp consumed inside this slice
  weeklyEndPct: number // cumulative weekly burn at slice end
}

const CAP_5H = 92 // hard cap della 5h rolling window (Codex Pro)

function computeStats(
  windows: FiveHourWindow[],
  burnSamples: BurnSample[] | undefined,
): WinStats[] {
  const samples = (burnSamples ?? [])
    .map((s) => ({ t: new Date(s.ts).getTime(), w: s.window_usage_pct ?? 0, wk: s.weekly_usage_pct ?? 0 }))
    .sort((a, b) => a.t - b.t)
  return windows.map((w) => {
    const start = new Date(w.started_at).getTime()
    const end = new Date(w.ended_at).getTime()
    const inside = samples.filter((s) => s.t >= start && s.t <= end)
    if (inside.length === 0) {
      return {
        win: w,
        peakCap5h: 0,
        startCap5h: 0,
        endCap5h: 0,
        weeklyDeltaPp: Math.round((w.usage_delta_pct ?? 0) * 10) / 10,
        weeklyEndPct: w.usage_end_pct ?? 0,
      }
    }
    // I primi sample di una slice possono ereditare il valore della rolling 5h
    // della slice precedente (es. W7 inizia a 97% perché W6 stava ancora a 97%
    // e il reset arriva qualche minuto dopo). Se l'inizio è alto, scartiamo
    // i primi sample finché la curva non si svuota sotto soglia: da lì
    // parte il vero "lavoro fresco" della slice. Reset successivi non sono
    // eredità, sono parte del comportamento naturale (vecchi prompt che escono
    // dalla rolling 5h) e vanno tenuti.
    let firstFreshIdx = 0
    const INHERITED_THRESHOLD = 50 // primo sample > 50% = ereditato
    const RESET_FLOOR = 20 // sotto questa soglia consideriamo la 5h "svuotata"
    if (inside[0].w > INHERITED_THRESHOLD) {
      for (let i = 0; i < inside.length; i++) {
        if (inside[i].w <= RESET_FLOOR) {
          firstFreshIdx = i
          break
        }
      }
    }
    const fresh = inside.slice(firstFreshIdx)
    const peakCap5h = Math.max(...fresh.map((s) => s.w))
    const startCap5h = fresh[0].w
    const endCap5h = fresh[fresh.length - 1].w
    return {
      win: w,
      peakCap5h,
      startCap5h,
      endCap5h,
      weeklyDeltaPp: Math.round((w.usage_delta_pct ?? 0) * 10) / 10,
      weeklyEndPct: w.usage_end_pct ?? 0,
    }
  })
}

// Rolling 5h sub-windows: per-window peak of the 5h provider cap.
// Cap 5h = 92% (provider rate limit). Bars > 92% = throttling.
export function FiveHourBreakdown({ windows, accentColor, burnSamples, agentActivity }: Props) {
  if (!windows || windows.length === 0) return null

  const stats = computeStats(windows, burnSamples)
  const hasDetail = (burnSamples?.length ?? 0) > 0 || (agentActivity?.length ?? 0) > 0
  const overCapCount = stats.filter((s) => s.peakCap5h > CAP_5H).length

  return (
    <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h6 className="text-xs font-semibold text-slate-800">
          ⏱ Rolling 5h windows ({windows.length}) — peak della 5h-cap per finestra
        </h6>
        <span className="text-[10px] text-slate-500">
          cap = 92%
          {overCapCount > 0 && (
            <span className="ml-2 text-rose-600">
              · {overCapCount}/{windows.length} finestre oltre cap
            </span>
          )}
        </span>
      </header>

      <Chart stats={stats} accentColor={accentColor} />

      <Table stats={stats} accentColor={accentColor} />

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

function Chart({ stats, accentColor }: { stats: WinStats[]; accentColor: string }) {
  const w = 720
  const h = 200
  const padL = 36
  const padR = 24
  const padT = 28
  const padB = 30
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const totalH = stats.reduce((s, x) => s + x.win.duration_hours, 0)
  let acc = 0
  const segments = stats.map((s) => {
    const x0 = padL + (acc / totalH) * innerW
    acc += s.win.duration_hours
    const x1 = padL + (acc / totalH) * innerW
    return { ...s, x0, x1 }
  })

  const yPct = (pct: number) => padT + innerH * (1 - pct / 100)
  const yTicks = [0, 25, 50, 75, 100]
  const tickLabel = (iso: string) => iso.slice(11, 16)

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-44 w-full"
      role="img"
      aria-label="Rolling 5-hour windows: peak 5h cap usage per window"
    >
      {/* background bands per window */}
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

      {/* Y grid */}
      {yTicks.map((t) => (
        <g key={`tick-${t}`}>
          <line
            x1={padL}
            x2={w - padR}
            y1={yPct(t)}
            y2={yPct(t)}
            stroke="#e2e8f0"
            strokeWidth="0.5"
          />
          <text x={padL - 4} y={yPct(t) + 3} fontSize="9" textAnchor="end" fill="#64748b">
            {t}%
          </text>
        </g>
      ))}

      {/* 92% cap line */}
      <line
        x1={padL}
        x2={w - padR}
        y1={yPct(CAP_5H)}
        y2={yPct(CAP_5H)}
        stroke="#ef4444"
        strokeWidth="0.7"
        strokeDasharray="3 3"
      />
      <text x={w - padR - 2} y={yPct(CAP_5H) - 3} fontSize="9" textAnchor="end" fill="#ef4444">
        cap {CAP_5H}%
      </text>

      {/* peak bars */}
      {segments.map((s) => {
        const barW = Math.max(8, (s.x1 - s.x0) * 0.55)
        const cx = (s.x0 + s.x1) / 2
        const bx = cx - barW / 2
        const by = yPct(s.peakCap5h)
        const bh = padT + innerH - by
        const overCap = s.peakCap5h > CAP_5H
        return (
          <g key={`bar-${s.win.window_number}`}>
            <rect
              x={bx}
              y={by}
              width={barW}
              height={bh}
              fill={overCap ? "#ef4444" : accentColor}
              fillOpacity={overCap ? 0.55 : 0.4}
              rx="2"
            />
            <text
              x={cx}
              y={by - 3}
              fontSize="9.5"
              textAnchor="middle"
              fill={overCap ? "#b91c1c" : "#0f172a"}
              fontWeight="700"
            >
              {Math.round(s.peakCap5h)}%
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

      {/* X-axis: time labels */}
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
        <rect width="9" height="6" y="-5" fill={accentColor} fillOpacity="0.4" rx="1" />
        <text x="13" y="0" fontSize="8" fill="#475569">
          peak 5h-cap %
        </text>
        <g transform="translate(110, 0)">
          <rect width="9" height="6" y="-5" fill="#ef4444" fillOpacity="0.55" rx="1" />
          <text x="13" y="0" fontSize="8" fill="#475569">
            oltre cap 92%
          </text>
        </g>
      </g>
    </svg>
  )
}

function Table({ stats, accentColor }: { stats: WinStats[]; accentColor: string }) {
  const fmt = new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  })
  const formatRange = (startIso: string, endIso: string) => {
    const a = fmt.format(new Date(startIso))
    const b = fmt.format(new Date(endIso))
    return `${a} → ${b}`
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2 pr-2 text-[10px] font-medium uppercase tracking-wide">finestra</th>
            <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">orario (UTC)</th>
            <th
              className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide"
              title="quanto la finestra rolling 5h è arrivata vicino al limite del provider (cap 92%). Sopra cap = throttle"
            >
              quanto vicino al limite 5h?
            </th>
            <th
              className="py-2 pr-2 text-right text-[10px] font-medium uppercase tracking-wide"
              title="totale del budget settimanale consumato fino a fine slice"
            >
              budget settimanale
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-slate-800">
          {stats.map((s) => {
            const overCap = s.peakCap5h > CAP_5H
            return (
              <tr key={s.win.window_number} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-2 align-middle">
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    W{s.win.window_number}
                  </span>
                </td>
                <td className="py-2 pr-3 align-middle text-[11px] text-slate-600">
                  {formatRange(s.win.started_at, s.win.ended_at)}
                </td>
                <td className="py-2 pr-3 align-middle">
                  <div className="flex items-center gap-2" style={{ minWidth: 220 }}>
                    <div
                      className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-slate-100"
                      title={`picco 5h = ${Math.round(s.peakCap5h)}% (cap provider 92%)`}
                    >
                      {/* Barra proporzionale 0..100% del peak diretto */}
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{
                          width: `${Math.min(100, Math.round(s.peakCap5h))}%`,
                          backgroundColor: overCap ? "#ef4444" : accentColor,
                          opacity: 0.55,
                        }}
                      />
                      {/* Tacca cap a 92% della barra (posizione vera del limite) */}
                      <div
                        className="absolute inset-y-0 w-px bg-slate-600"
                        style={{ left: `${CAP_5H}%` }}
                        title="cap 92%"
                      />
                    </div>
                    <span
                      className="whitespace-nowrap text-[12px] font-semibold tabular-nums"
                      style={{ color: overCap ? "#b91c1c" : "#0f172a" }}
                    >
                      {Math.round(s.peakCap5h)}%
                      {overCap && <span className="ml-1 text-[10px]">⚠️</span>}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-2 text-right align-middle">
                  <span className="text-[13px] font-semibold tabular-nums">
                    {s.weeklyEndPct}%
                  </span>
                  <span className="ml-1 text-[10px] text-slate-500 tabular-nums">
                    (+{s.weeklyDeltaPp}pp)
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
        <p className="mb-1 font-semibold text-slate-800">Come leggere</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>Quanto vicino al limite 5h?</strong> Il provider (Codex Pro) blocca
            quando le ultime 5h superano il <strong>92%</strong> di consumo. La barra
            mostra il <em>picco</em> raggiunto dentro la slice. Tacca grigia = soglia
            cap. Barra rossa = soglia sforata → throttle scattato.
          </li>
          <li>
            <strong>Budget settimanale</strong> = totale cumulativo della quota
            settimanale fino a fine slice (parte da 0%, finisce vicino al 100%).
            <em>+Xpp</em> = quanti punti percentuali di quel budget sono stati
            spesi <em>solo</em> in questa slice.
          </li>
        </ul>
      </div>
    </div>
  )
}
