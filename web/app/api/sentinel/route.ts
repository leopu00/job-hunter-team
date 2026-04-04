import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const LOG_PATH = path.join(os.homedir(), '.jht', 'sentinel-log.txt')

const USAGE_RE = /^\[(\S+)\] usage=(\d+)% \| delta=([+-]?\d+)% in 10m \| velocita=(\d+)%\/h \| vel_smussata=(\d+)%\/h \| vel_ideale=(\d+)%\/h \| rapporto=([\d.]+) \| throttle=(\d+) \| proiezione_reset=(\d+)% \| (.+)$/
const ORDER_RE = /^\[(\S+)\] (Ordine .+)$/
const NEXT_RE  = /prossimo reset: (\S+)/

type UsagePoint = { ts: string; usage: number; velocity: number; throttle: number; projection: number }
type Order      = { ts: string; text: string }

export async function GET() {
  if (!fs.existsSync(LOG_PATH)) {
    return NextResponse.json({ current: null, history: [], orders: [], next_reset: null })
  }

  const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n').filter(l => l.trim())

  const history: UsagePoint[] = []
  const orders:  Order[]      = []
  let next_reset: string | null = null

  for (const line of lines) {
    const u = line.match(USAGE_RE)
    if (u) {
      history.push({
        ts:         u[1],
        usage:      Number(u[2]),
        velocity:   Number(u[4]),
        throttle:   Number(u[8]),
        projection: Number(u[9]),
      })
      const nr = line.match(NEXT_RE)
      if (nr) next_reset = nr[1]
      continue
    }
    const o = line.match(ORDER_RE)
    if (o) orders.push({ ts: o[1], text: o[2] })
  }

  const last = history.at(-1)
  const prev = history.at(-2)

  const current = last ? {
    usage:      last.usage,
    delta:      prev ? last.usage - prev.usage : 0,
    velocity:   last.velocity,
    throttle:   last.throttle,
    projection: last.projection,
    ts:         last.ts,
    status:     history.at(-1) ? lines.find(l => l.includes(last.ts) && l.includes('usage='))?.split('| ').at(-1)?.split(' (')[0]?.trim() ?? '' : '',
  } : null

  return NextResponse.json({
    current,
    history:    history.slice(-30),
    orders:     orders.slice(-20).reverse(),
    next_reset,
    total_ticks: history.length,
  })
}
