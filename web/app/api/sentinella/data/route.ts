import { NextResponse } from "next/server";
import { isLocalRequest, requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

// Legge lo storico scritto dalla Sentinella (Vigil-style) a ogni tick.
// Una riga per check, formato:
//   {"ts":"2026-04-20T16:30:05+02:00","provider":"openai","usage":45,
//    "delta":3,"velocity":60,"velocity_smooth":40,"velocity_ideal":23,
//    "projection":84,"status":"OK","throttle":0,"reset_at":"18:00"}
//
// Fallback: se il file non esiste o è vuoto → [].

type Entry = {
  ts: string;
  provider: string;
  usage: number;
  delta?: number;
  velocity?: number;
  velocity_smooth?: number;
  velocity_ideal?: number;
  projection?: number;
  status:
    | "OK"
    | "ATTENZIONE"
    | "CRITICO"
    | "SOTTOUTILIZZO"
    | "RESET"
    | "ANOMALIA"
    | string;
  throttle?: number;
  reset_at?: string;
  weekly_usage?: number;
  projection_naive?: number;
  velocity_decreasing?: boolean;
  source?: string;
  session_id?: string;
  host?: Record<string, unknown> | null;
  host_level?: string | null;
};

function resolveDataFile(): string {
  // La Sentinella scrive in $JHT_HOME/logs/sentinel-data.jsonl.
  // Nel container $JHT_HOME = /jht_home. Nel dev-server fuori dal
  // container leggiamo il bind-mount su ~/.jht (equivalente).
  const jhtHome =
    process.env.JHT_HOME ||
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".jht");
  return path.join(jhtHome, "logs", "sentinel-data.jsonl");
}

function trimCurrentSession(entries: Entry[]): Entry[] {
  // Mostra solo la sessione corrente: dal piu' recente RESET in poi.
  // Senza questo filtro il grafico trascina sample di sessioni vecchie
  // (anche di giorni fa) comprimendo l'asse x su gap enormi.
  let lastResetIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === "RESET") {
      lastResetIdx = i;
      break;
    }
  }
  const sessionEntries =
    lastResetIdx >= 0 ? entries.slice(lastResetIdx) : entries;
  return sessionEntries.slice(-500);
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  if (!(await isLocalRequest())) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({
        ok: true,
        entries: [],
        count: 0,
        remote: true,
        note: "not authenticated",
      });
    }

    const { data, error } = await supabase
      .from("sentinel_ticks")
      .select(
        [
          "ts",
          "provider",
          "usage",
          "delta",
          "velocity",
          "velocity_smooth",
          "velocity_ideal",
          "projection",
          "projection_naive",
          "velocity_decreasing",
          "status",
          "throttle",
          "reset_at",
          "weekly_usage",
          "source",
          "session_id",
          "host",
          "host_level",
        ].join(","),
      )
      .eq("user_id", user.id)
      .order("ts", { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, remote: true },
        { status: 500 },
      );
    }

    const entries: Entry[] = (data ?? [])
      .slice()
      .reverse()
      .map((row: any) => ({
        ts: row.ts,
        provider: row.provider,
        usage: Number(row.usage),
        delta: numberOrUndefined(row.delta),
        velocity: numberOrUndefined(row.velocity),
        velocity_smooth: numberOrUndefined(row.velocity_smooth),
        velocity_ideal: numberOrUndefined(row.velocity_ideal),
        projection: numberOrUndefined(row.projection),
        projection_naive: numberOrUndefined(row.projection_naive),
        velocity_decreasing:
          typeof row.velocity_decreasing === "boolean"
            ? row.velocity_decreasing
            : undefined,
        status: row.status,
        throttle: numberOrUndefined(row.throttle),
        reset_at: row.reset_at ?? undefined,
        weekly_usage: numberOrUndefined(row.weekly_usage),
        source: row.source ?? undefined,
        session_id: row.session_id ?? undefined,
        host: row.host ?? null,
        host_level: row.host_level ?? null,
      }));

    const trimmed = trimCurrentSession(entries);
    return NextResponse.json({
      ok: true,
      entries: trimmed,
      count: trimmed.length,
      remote: true,
      source: "supabase",
    });
  }

  const file = resolveDataFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return NextResponse.json({
        ok: true,
        entries: [],
        file,
        note: "no data yet",
      });
    }
    return NextResponse.json(
      { ok: false, error: err?.message ?? "read error" },
      { status: 500 },
    );
  }

  const entries: Entry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }

  const trimmed = trimCurrentSession(entries);
  return NextResponse.json({
    ok: true,
    entries: trimmed,
    file,
    count: trimmed.length,
  });
}
