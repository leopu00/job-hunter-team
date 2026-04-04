/**
 * API Monitoring — Metriche sistema, heartbeat agenti, alert
 */
import { NextResponse } from 'next/server';

let mod: typeof import('../../../../shared/monitoring/index.js') | null = null;
async function load() {
  if (!mod) mod = await import('../../../../shared/monitoring/index.js');
  return mod;
}

// GET — metriche correnti, agenti, alert attivi
export async function GET(req: Request) {
  const m = await load();
  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section');

  if (section === 'history') {
    return NextResponse.json({ history: m.getMetricsHistory() });
  }

  if (section === 'agents') {
    return NextResponse.json({ agents: m.getAllAgentStatuses() });
  }

  if (section === 'alerts') {
    return NextResponse.json({ alerts: m.getActiveAlerts(), thresholds: m.getThresholds() });
  }

  // Default: tutto
  const metrics = m.collectMetrics();
  const agents = m.getAllAgentStatuses();
  const alerts = m.checkThresholds(metrics);
  const unhealthy = m.checkHeartbeats();

  return NextResponse.json({
    metrics,
    agents,
    alerts: m.getActiveAlerts(),
    unhealthyAgents: unhealthy,
    history: m.getMetricsHistory().slice(-10),
  });
}

// POST — registra heartbeat agente o definisci soglia
export async function POST(req: Request) {
  const m = await load();
  try {
    const body = await req.json();

    if (body.type === 'heartbeat') {
      if (!body.agentId) return NextResponse.json({ error: 'agentId richiesto' }, { status: 400 });
      m.registerHeartbeat(body.agentId, body.metadata);
      return NextResponse.json({ ok: true, agentId: body.agentId });
    }

    if (body.type === 'threshold') {
      if (!body.id || !body.metric || !body.operator || body.value === undefined) {
        return NextResponse.json({ error: 'Campi id, metric, operator, value richiesti' }, { status: 400 });
      }
      m.defineThreshold({
        id: body.id, metric: body.metric, operator: body.operator,
        value: body.value, description: body.description || '',
      });
      return NextResponse.json({ ok: true, thresholdId: body.id }, { status: 201 });
    }

    return NextResponse.json({ error: 'type deve essere heartbeat o threshold' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
