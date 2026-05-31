import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface MonthData {
  month: string;
  sent: number;
  responses: number;
}
interface PhaseTime {
  phase: string;
  avgDays: number;
}
interface TopCompany {
  company: string;
  applications: number;
  responses: number;
}

const PERIODS: Record<string, number> = { "30d": 30, "90d": 90, "6m": 180 };

const MONTH_LABEL = (d: Date) =>
  d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" });

function emptyMonthly(days: number): MonthData[] {
  const months: MonthData[] = [];
  const now = new Date();
  const count = Math.max(1, Math.ceil(days / 30));
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: MONTH_LABEL(d), sent: 0, responses: 0 });
  }
  return months;
}

// Bug #20: pagina /reports tutta mock. Sostituiamo con query Supabase reali.
// Il design "user-curated apply" (bug #9 declassato) prevede che molti KPI
// siano 0 finché l'utente non marca manualmente "inviata" via dashboard —
// è il comportamento atteso, non un bug. La pagina deve mostrare il funnel
// reale, non numeri inventati.
export async function GET(req: NextRequest) {
  const periodKey = req.nextUrl.searchParams.get("period") ?? "30d";
  const days = PERIODS[periodKey] ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const emptyKpi = {
    totalApplications: 0,
    responseRate: 0,
    interviewsScheduled: 0,
    offersReceived: 0,
    avgResponseDays: null as number | null,
  };

  if (!user) {
    return NextResponse.json({
      period: periodKey,
      days,
      kpi: emptyKpi,
      monthly: emptyMonthly(days),
      phaseTimes: [],
      topCompanies: [],
    });
  }

  // Recupero tutte le applications recenti dell'utente + position.company per
  // top companies, in una sola round-trip. Manteniamo `applied_at` come
  // unico anchor temporale (l'utente è quello che marca "inviata", quindi
  // tutto ciò che è prima di `applied_at` non è nello scope del report
  // "candidature inviate").
  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, status, response, applied_at, response_at, position:positions(company)",
    )
    .eq("user_id", user.id)
    .not("applied_at", "is", null)
    .gte("applied_at", since);

  const applied = apps ?? [];
  const totalApplications = applied.length;

  // KPI risposta: response_at popolato. `response` è TEXT libero, ma per
  // contare colloqui/offerte usiamo i marker più comuni (interview / offer)
  // case-insensitive. Quando un utente marca manualmente la risposta,
  // dovrebbe usare uno di questi termini (UI futuro lo enforcerà).
  let responseCount = 0;
  let interviewsScheduled = 0;
  let offersReceived = 0;
  let avgResponseDaysSum = 0;
  let avgResponseDaysN = 0;

  for (const a of applied) {
    if (a.response_at) {
      responseCount += 1;
      if (a.applied_at) {
        const days =
          (new Date(a.response_at).getTime() -
            new Date(a.applied_at).getTime()) /
          86_400_000;
        if (Number.isFinite(days) && days >= 0) {
          avgResponseDaysSum += days;
          avgResponseDaysN += 1;
        }
      }
    }
    const tag = (a.response ?? "").toLowerCase();
    if (tag.includes("interview") || tag.includes("colloquio")) {
      interviewsScheduled += 1;
    }
    if (tag.includes("offer") || tag.includes("offerta")) {
      offersReceived += 1;
    }
  }

  const kpi = {
    totalApplications,
    responseRate:
      totalApplications > 0
        ? Math.round((responseCount / totalApplications) * 100)
        : 0,
    interviewsScheduled,
    offersReceived,
    avgResponseDays:
      avgResponseDaysN > 0
        ? Math.round((avgResponseDaysSum / avgResponseDaysN) * 10) / 10
        : null,
  };

  // Aggregazione mensile: per ogni applied_at ricaviamo year-month.
  const bucket = new Map<string, MonthData>();
  for (const m of emptyMonthly(days)) bucket.set(m.month, m);
  for (const a of applied) {
    if (!a.applied_at) continue;
    const d = new Date(a.applied_at);
    const label = MONTH_LABEL(new Date(d.getFullYear(), d.getMonth(), 1));
    if (!bucket.has(label)) continue; // out-of-window
    const slot = bucket.get(label)!;
    slot.sent += 1;
    if (a.response_at) slot.responses += 1;
  }
  const monthly = Array.from(bucket.values());

  // Top companies — group by company name. Lasciamo vuoto se nessuna
  // application è ancora stata marcata come inviata.
  const byCompany = new Map<string, TopCompany>();
  for (const a of applied) {
    const pos = a.position as
      | { company?: string }
      | { company?: string }[]
      | null;
    const company = Array.isArray(pos) ? pos[0]?.company : pos?.company;
    if (!company) continue;
    const cur =
      byCompany.get(company) ??
      ({ company, applications: 0, responses: 0 } as TopCompany);
    cur.applications += 1;
    if (a.response_at) cur.responses += 1;
    byCompany.set(company, cur);
  }
  const topCompanies = Array.from(byCompany.values())
    .sort((x, y) => y.applications - x.applications)
    .slice(0, 6);

  // Phase times: per ora non calcolabili senza un event-log della pipeline
  // (bug #14). Ritornare array vuoto è preferibile a stringere numeri fake.
  const phaseTimes: PhaseTime[] = [];

  return NextResponse.json({
    period: periodKey,
    days,
    kpi,
    monthly,
    phaseTimes,
    topCompanies,
  });
}
