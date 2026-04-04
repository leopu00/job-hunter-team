import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface MonthData { month: string; sent: number; responses: number }
interface PhaseTime { phase: string; avgDays: number }
interface TopCompany { company: string; applications: number; responses: number }

const PERIODS: Record<string, number> = { '30d': 30, '90d': 90, '6m': 180 }

function buildMonthly(days: number): MonthData[] {
  const months: MonthData[] = []
  const now = new Date()
  const count = Math.max(1, Math.ceil(days / 30))
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })
    const seed = d.getMonth() + d.getFullYear() * 12
    const sent = 8 + Math.abs(Math.round(Math.sin(seed * 1.7) * 12))
    const responses = Math.round(sent * (0.25 + Math.abs(Math.sin(seed * 2.3)) * 0.35))
    months.push({ month: label, sent, responses })
  }
  return months
}

function buildPhaseTimes(): PhaseTime[] {
  return [
    { phase: 'Screening CV', avgDays: 3.2 },
    { phase: 'Primo colloquio', avgDays: 8.5 },
    { phase: 'Colloquio tecnico', avgDays: 14.1 },
    { phase: 'Offerta', avgDays: 21.7 },
    { phase: 'Rifiuto', avgDays: 12.3 },
  ]
}

function buildTopCompanies(): TopCompany[] {
  return [
    { company: 'TechFlow', applications: 4, responses: 3 },
    { company: 'Acme Corp', applications: 3, responses: 2 },
    { company: 'DataWise S.r.l.', applications: 3, responses: 1 },
    { company: 'CloudBase', applications: 2, responses: 2 },
    { company: 'CodeLab S.p.A.', applications: 2, responses: 1 },
    { company: 'NetPrime', applications: 2, responses: 0 },
  ]
}

/** GET — report aggregati: ?period=30d|90d|6m */
export async function GET(req: NextRequest) {
  const periodKey = req.nextUrl.searchParams.get('period') ?? '30d'
  const days = PERIODS[periodKey] ?? 30

  const monthly = buildMonthly(days)
  const totalSent = monthly.reduce((s, m) => s + m.sent, 0)
  const totalResponses = monthly.reduce((s, m) => s + m.responses, 0)

  const kpi = {
    totalApplications: totalSent,
    responseRate: totalSent > 0 ? Math.round((totalResponses / totalSent) * 100) : 0,
    interviewsScheduled: Math.round(totalResponses * 0.6),
    offersReceived: Math.max(1, Math.round(totalResponses * 0.15)),
    avgResponseDays: 5.4,
  }

  return NextResponse.json({
    period: periodKey, days, kpi,
    monthly, phaseTimes: buildPhaseTimes(), topCompanies: buildTopCompanies(),
  })
}
