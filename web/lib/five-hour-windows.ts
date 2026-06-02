// Derives rolling 5-hour rate-limit windows for a weekly burn cycle.
//
// Codex/Anthropic plans expose two budgets: a weekly cap and a rolling 5h
// sub-window that resets at the first prompt. The DB only stores the weekly
// burn (`case_study_windows.burn_curve_json`), so we partition that timeline
// into 5h slices and compute per-slice deltas + peaks for visualisation.

export type BurnPoint = { t: string; w: number }

export type FiveHourWindow = {
  window_number: number
  started_at: string // ISO
  ended_at: string // ISO
  duration_hours: number
  usage_start_pct: number
  usage_end_pct: number
  usage_delta_pct: number
  peak_usage_pct: number
}

// Reconstruct full timestamps for each burn point from "HH:MM" labels.
// Points are assumed chronologically ordered; we walk forward and bump the
// day whenever HH:MM appears to go backwards. `frozen` is mapped to `ended_at`.
export type AnchoredPoint = { ts: number; w: number }

export function anchorBurnCurve(
  startedAt: string,
  endedAt: string,
  burn: BurnPoint[],
): AnchoredPoint[] {
  if (burn.length === 0) return []
  const start = parseSqlTs(startedAt)
  const end = parseSqlTs(endedAt)
  const out: AnchoredPoint[] = []
  let prev: number | null = null
  for (const p of burn) {
    let ts: number
    if (p.t === "frozen") {
      ts = end
    } else {
      const [hh, mm] = p.t.split(":").map(Number)
      if (prev == null) {
        // The bridge sometimes logs the first point a few minutes before the
        // window's declared started_at — accept that as-is (same calendar day
        // as started_at) and let subsequent points wrap forward from there.
        ts = setHourMinute(start, hh, mm)
      } else {
        const candidate = setHourMinute(prev, hh, mm)
        ts = candidate < prev ? candidate + 24 * 3600_000 : candidate
      }
    }
    out.push({ ts, w: p.w })
    prev = ts
  }
  return out
}

export function deriveFiveHourWindows(
  startedAt: string,
  endedAt: string,
  burn: BurnPoint[],
): FiveHourWindow[] {
  if (!burn || burn.length < 2) return []
  const start = parseSqlTs(startedAt)
  const end = parseSqlTs(endedAt)
  const totalHours = (end - start) / 3600_000
  const n = Math.max(1, Math.ceil(totalHours / 5))
  const anchored = anchorBurnCurve(startedAt, endedAt, burn)

  const out: FiveHourWindow[] = []
  for (let i = 0; i < n; i++) {
    const wStart = start + i * 5 * 3600_000
    const wEnd = Math.min(start + (i + 1) * 5 * 3600_000, end)
    const usageStart = interpolate(anchored, wStart)
    const usageEnd = interpolate(anchored, wEnd)
    const peak = peakInRange(anchored, wStart, wEnd, usageStart, usageEnd)
    out.push({
      window_number: i + 1,
      started_at: new Date(wStart).toISOString(),
      ended_at: new Date(wEnd).toISOString(),
      duration_hours: Number(((wEnd - wStart) / 3600_000).toFixed(2)),
      usage_start_pct: round1(usageStart),
      usage_end_pct: round1(usageEnd),
      usage_delta_pct: round1(usageEnd - usageStart),
      peak_usage_pct: round1(peak),
    })
  }
  return out
}

function interpolate(points: AnchoredPoint[], ts: number): number {
  if (points.length === 0) return 0
  if (ts <= points[0].ts) return points[0].w
  if (ts >= points[points.length - 1].ts) return points[points.length - 1].w
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (ts >= a.ts && ts <= b.ts) {
      const span = b.ts - a.ts
      if (span === 0) return b.w
      const f = (ts - a.ts) / span
      return a.w + f * (b.w - a.w)
    }
  }
  return points[points.length - 1].w
}

function peakInRange(
  points: AnchoredPoint[],
  from: number,
  to: number,
  startVal: number,
  endVal: number,
): number {
  let peak = Math.max(startVal, endVal)
  for (const p of points) {
    if (p.ts >= from && p.ts <= to && p.w > peak) peak = p.w
  }
  return peak
}

// SQLite "YYYY-MM-DD HH:MM:SS" → epoch ms. Treated as UTC since the seed
// uses bare timestamps without timezone offset.
function parseSqlTs(s: string): number {
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z"
  return new Date(iso).getTime()
}

function setHourMinute(epoch: number, hh: number, mm: number): number {
  const d = new Date(epoch)
  d.setUTCHours(hh, mm, 0, 0)
  return d.getTime()
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
