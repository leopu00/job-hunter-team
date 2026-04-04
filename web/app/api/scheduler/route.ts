/**
 * API Scheduler — Lista task, stats, enqueue, cancel
 */
import { NextResponse } from 'next/server';

let mod: typeof import('../../../../shared/scheduler/index.js') | null = null;
async function load() {
  if (!mod) mod = await import('../../../../shared/scheduler/index.js');
  return mod;
}

// GET — lista task e stats
export async function GET(req: Request) {
  const m = await load();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as any;

  const tasks = m.listTasks(status || undefined).map(t => ({
    id: t.id, name: t.name, priority: t.priority, status: t.status,
    dependsOn: t.dependsOn, createdAt: t.createdAt, startedAt: t.startedAt,
    completedAt: t.completedAt, error: t.error,
  }));

  return NextResponse.json({ tasks, stats: m.getStats() });
}

// POST — enqueue nuovo task (demo) o cancel
export async function POST(req: Request) {
  const m = await load();
  try {
    const body = await req.json();

    if (body.action === 'cancel') {
      if (!body.id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 });
      const ok = m.cancel(body.id);
      return NextResponse.json({ ok, id: body.id });
    }

    if (body.action === 'enqueue') {
      if (!body.id || !body.name) return NextResponse.json({ error: 'id e name richiesti' }, { status: 400 });
      const task = m.enqueue(body.id, body.name, async () => body.name, {
        priority: body.priority || 'normal', dependsOn: body.dependsOn || [],
      });
      return NextResponse.json({
        id: task.id, name: task.name, priority: task.priority, status: task.status,
      }, { status: 201 });
    }

    return NextResponse.json({ error: 'action deve essere enqueue o cancel' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
