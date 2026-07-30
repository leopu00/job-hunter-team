/**
 * API Scheduler — Lista task, stats, enqueue, cancel
 * Modulo shared/scheduler non ancora disponibile — restituisce dati stub.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const _status = searchParams.get('status');

  return NextResponse.json({
    tasks: [],
    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
    _note: 'shared/scheduler non disponibile — dati stub',
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === 'cancel') {
      if (!body.id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 });
      return NextResponse.json({ ok: false, id: body.id, _note: 'stub' });
    }

    if (body.action === 'enqueue') {
      if (!body.id || !body.name) return NextResponse.json({ error: 'id e name richiesti' }, { status: 400 });
      return NextResponse.json({
        id: body.id, name: body.name, priority: body.priority || 'normal', status: 'queued', _note: 'stub',
      }, { status: 201 });
    }

    return NextResponse.json({ error: 'action deve essere enqueue o cancel' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
