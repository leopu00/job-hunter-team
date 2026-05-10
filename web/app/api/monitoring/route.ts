/**
 * API Monitoring — Metriche sistema, heartbeat agenti, alert
 * Modulo shared/monitoring non ancora disponibile — restituisce dati stub.
 */
import { NextResponse } from 'next/server';
import { sanitizedError } from '@/lib/error-response';

export const dynamic = 'force-dynamic';

const STUB_METRICS = {
  cpu: 0, memoryMb: 0, uptimeSec: 0, requestsTotal: 0,
  errorsTotal: 0, avgResponseMs: 0,
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section');

  if (section === 'history') {
    return NextResponse.json({ history: [] });
  }
  if (section === 'agents') {
    return NextResponse.json({ agents: [] });
  }
  if (section === 'alerts') {
    return NextResponse.json({ alerts: [], thresholds: [] });
  }

  return NextResponse.json({
    metrics: STUB_METRICS,
    agents: [],
    alerts: [],
    unhealthyAgents: [],
    history: [],
    _note: 'shared/monitoring non disponibile — dati stub',
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.type === 'heartbeat') {
      if (!body.agentId) return NextResponse.json({ error: 'agentId richiesto' }, { status: 400 });
      return NextResponse.json({ ok: true, agentId: body.agentId, _note: 'stub' });
    }

    if (body.type === 'threshold') {
      if (!body.id || !body.metric || !body.operator || body.value === undefined) {
        return NextResponse.json({ error: 'Campi id, metric, operator, value richiesti' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, thresholdId: body.id, _note: 'stub' }, { status: 201 });
    }

    return NextResponse.json({ error: 'type deve essere heartbeat o threshold' }, { status: 400 });
  } catch (err) {
    return sanitizedError(err, { scope: 'monitoring' });
  }
}
