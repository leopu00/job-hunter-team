import { NextRequest, NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/cron-store";
import { requireAuth, requireLocalWrite } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Stesso store — e stesso gate — di `../route.ts`: questi handler abilitano,
// rinominano e cancellano job che eseguono comandi shell schedulati.

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const ro = await requireLocalWrite();
  if (ro) return ro;
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body non valido" }, { status: 400 });
  }

  const store = readStore();
  const job = store.jobs.find((j) => j.id === id);
  if (!job)
    return NextResponse.json({ error: "job non trovato" }, { status: 404 });

  if (typeof body.enabled === "boolean") job.enabled = body.enabled;
  if (typeof body.name === "string" && body.name.trim())
    job.name = body.name.trim();
  if (typeof body.description === "string")
    job.description = body.description.trim();
  job.updatedAtMs = Date.now();

  writeStore(store);
  return NextResponse.json({ ok: true, job });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const ro = await requireLocalWrite();
  if (ro) return ro;
  const { id } = await ctx.params;
  const store = readStore();
  const idx = store.jobs.findIndex((j) => j.id === id);
  if (idx === -1)
    return NextResponse.json({ error: "job non trovato" }, { status: 404 });

  store.jobs.splice(idx, 1);
  writeStore(store);
  return NextResponse.json({ ok: true });
}
