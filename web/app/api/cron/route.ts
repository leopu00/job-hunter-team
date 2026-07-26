import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  readStore,
  writeStore,
  type CronJob,
  type CronPayload,
  type CronSchedule,
} from "@/lib/cron-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = readStore();
  return NextResponse.json({ jobs: store.jobs });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body non valido" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name)
    return NextResponse.json({ error: "name obbligatorio" }, { status: 400 });

  const schedule = body.schedule as Record<string, unknown> | undefined;
  if (!schedule || typeof schedule !== "object")
    return NextResponse.json(
      { error: "schedule obbligatorio" },
      { status: 400 },
    );

  const payload = body.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== "object")
    return NextResponse.json(
      { error: "payload obbligatorio" },
      { status: 400 },
    );

  // Prevenzione injection nel command
  const command = typeof payload.command === "string" ? payload.command : "";
  if (/[\n\r\0]/.test(command))
    return NextResponse.json(
      { error: "command contiene caratteri non validi" },
      { status: 400 },
    );

  const now = Date.now();
  const job: CronJob = {
    id: randomUUID(),
    name,
    description:
      typeof body.description === "string"
        ? body.description.trim()
        : undefined,
    enabled: body.enabled !== false,
    deleteAfterRun: body.deleteAfterRun === true,
    createdAtMs: now,
    updatedAtMs: now,
    // Il body arriva dal client e qui è verificato solo per presenza e
    // tipo object (più il controllo injection sul command): la forma
    // esatta della schedule resta una promessa del chiamante, come da
    // sempre in questa route. Il cast la dichiara invece di nasconderla
    // dietro un Record<string, unknown>.
    schedule: schedule as unknown as CronSchedule,
    payload: payload as unknown as CronPayload,
    state: {},
  };

  const store = readStore();
  store.jobs.push(job);
  writeStore(store);
  return NextResponse.json({ ok: true, job });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body non valido" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id)
    return NextResponse.json({ error: "id obbligatorio" }, { status: 400 });

  const store = readStore();
  const job = store.jobs.find((j) => j.id === id);
  if (!job)
    return NextResponse.json({ error: "job non trovato" }, { status: 404 });

  // Campi aggiornabili: enabled, name, description, schedule, payload
  if (typeof body.enabled === "boolean") job.enabled = body.enabled;
  if (typeof body.name === "string") job.name = body.name.trim();
  if (typeof body.description === "string")
    job.description = body.description.trim();
  if (body.schedule && typeof body.schedule === "object")
    job.schedule = body.schedule as CronSchedule;
  if (body.payload && typeof body.payload === "object") {
    const command =
      typeof (body.payload as Record<string, unknown>).command === "string"
        ? ((body.payload as Record<string, unknown>).command as string)
        : "";
    if (/[\n\r\0]/.test(command))
      return NextResponse.json(
        { error: "command contiene caratteri non validi" },
        { status: 400 },
      );
    job.payload = body.payload as CronPayload;
  }
  job.updatedAtMs = Date.now();

  writeStore(store);
  return NextResponse.json({ ok: true, job });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();
  if (!id)
    return NextResponse.json(
      { error: "id obbligatorio (query param)" },
      { status: 400 },
    );

  const store = readStore();
  const idx = store.jobs.findIndex((j) => j.id === id);
  if (idx === -1)
    return NextResponse.json({ error: "job non trovato" }, { status: 404 });

  const removed = store.jobs.splice(idx, 1)[0];
  writeStore(store);
  return NextResponse.json({ ok: true, removed });
}
