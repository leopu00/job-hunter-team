import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const DATA_PATH = path.join(os.homedir(), '.jht', 'sentinel-data.jsonl')

type Point = { ts: string; usage: number; velocity: number; velocity_smooth: number; velocity_ideal: number; projection: number; status: string; throttle?: number }
type DailyBar = { date: string; peak: number; consumed: number; sessions: number }

function loadPoints(): Point[] {
  if (!fs.existsSync(DATA_PATH)) return []
  return fs.readFileSync(DATA_PATH, 'utf-8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter((p): p is Point => p !== null)
}

function buildDaily(points: Point[]): DailyBar[] {
  // Group by day, detect session resets (usage drop), count sessions and peak per session
  const byDay: Record<string, Point[]> = {}
  for (const p of points) {
    const day = p.ts.slice(0, 10)
    ;(byDay[day] ??= []).push(p)
  }
  return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, pts]) => {
    let sessions = 1, sessionPeak = 0, totalConsumed = 0, prevUsage = -1, sessionStart = pts[0]?.usage ?? 0
    for (const p of pts) {
      if (prevUsage >= 0 && p.usage < prevUsage - 5) {
        // Session reset detected
        totalConsumed += sessionPeak - sessionStart
        sessions++; sessionPeak = p.usage; sessionStart = p.usage
      }
      if (p.usage > sessionPeak) sessionPeak = p.usage
      prevUsage = p.usage
    }
    totalConsumed += sessionPeak - sessionStart
    return { date, peak: sessionPeak, consumed: Math.max(0, totalConsumed), sessions }
  })
}

export async function GET() {
  const points = loadPoints()
  if (!points.length) return NextResponse.json({ current: null, daily: [], velocity_history: [] })

  const current = points.at(-1)!
  const prev    = points.at(-2)

  // Velocity history: last 20 points for sparkline
  const velocity_history = points.slice(-20).map(p => ({
    ts:       p.ts.slice(11, 16),
    velocity: p.velocity,
    usage:    p.usage,
  }))

  const daily = buildDaily(points)

  // Budget reset context: next reset assumed at 09:00 local (from sentinel pattern)
  const now       = new Date()
  const resetHour = 9
  const nextReset = new Date(now)
  if (now.getHours() >= resetHour) nextReset.setDate(nextReset.getDate() + 1)
  nextReset.setHours(resetHour, 0, 0, 0)
  const hoursLeft = Math.round((nextReset.getTime() - now.getTime()) / 3_600_000 * 10) / 10

  return NextResponse.json({
    current: {
      usage:           current.usage,
      velocity:        current.velocity,
      velocity_smooth: current.velocity_smooth,
      velocity_ideal:  current.velocity_ideal,
      projection:      current.projection,
      status:          current.status,
      throttle:        current.throttle ?? 0,
      delta:           prev ? current.usage - prev.usage : 0,
      hours_to_reset:  hoursLeft,
      ts:              current.ts,
    },
    daily,
    velocity_history,
    total_points: points.length,
  })
}
