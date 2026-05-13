import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// Sorgente delle azioni del Dottore. File JSONL append-only, una azione
// per riga, scritto da spawn-doctor.sh (event=spawn) e dall'agente
// stesso (event=ping_sent / diagnosis / restart / round_complete).
// Schema: vedi agents/dottore/dottore.md "Schema log azioni".
//
// Path resolution: prima JHT_HOME (env var, set nel container a
// /jht_home), poi /jht_home (default container), poi ~/.jht (host dev).
// Restituiamo il primo file che esiste; se nessuno esiste, ENOENT
// gestito dal caller.
function resolveActionsFile(): string {
  const candidates = [
    process.env.JHT_HOME &&
      path.join(process.env.JHT_HOME, "logs", "dottore-actions.jsonl"),
    "/jht_home/logs/dottore-actions.jsonl",
    process.env.HOME &&
      path.join(process.env.HOME, ".jht", "logs", "dottore-actions.jsonl"),
  ].filter(Boolean) as string[];
  // Sync existsSync per evitare di risolvere a un percorso vuoto.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require("fs") as typeof import("fs");
  for (const c of candidates) {
    try {
      if (fsSync.existsSync(c)) return c;
    } catch {
      // skip
    }
  }
  // Fallback al primo (verrà ENOENT al readFile, gestito a valle).
  return candidates[0];
}

type DoctorEvent = {
  ts: string;
  round_id?: string;
  session?: string;
  role?: string;
  event: string;
  status?: string;
  evidence?: string;
  msg?: string;
  agents_checked?: number;
  agents_restarted?: number;
  duration_sec?: number;
  context_recovered?: string;
};

function parseLines(raw: string): DoctorEvent[] {
  const out: DoctorEvent[] = [];
  for (const line of raw.split("\n")) {
    const trim = line.trim();
    if (!trim) continue;
    try {
      const obj = JSON.parse(trim);
      if (obj && typeof obj === "object" && typeof obj.event === "string") {
        out.push(obj as DoctorEvent);
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sinceMin = Number.parseInt(
    url.searchParams.get("sinceMin") || "180",
    10,
  );
  const limit = Math.min(
    Number.parseInt(url.searchParams.get("limit") || "200", 10),
    1000,
  );

  const actionsFile = resolveActionsFile();
  let raw = "";
  try {
    raw = await fs.readFile(actionsFile, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Manteniamo lo stesso schema del response "happy path" anche
      // quando non c'e' ancora un log: il client (DoctorPanel) accede
      // a data.counts.pings senza optional-chaining e crashava con
      // "Cannot read properties of undefined (reading 'pings')".
      return NextResponse.json({
        ok: true,
        events: [],
        rounds: [],
        counts: { total: 0, pings: 0, restarts: 0, rounds_complete: 0 },
        note: "no actions yet",
      });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  const all = parseLines(raw);
  const cutoffMs = Date.now() - sinceMin * 60 * 1000;
  const recent = all.filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) && t >= cutoffMs;
  });
  const events = recent.slice(-limit);

  // Aggrega per round_id per dare alla UI un riepilogo per giro: quando
  // è iniziato, quanti agenti ha controllato, quanti restart, durata.
  const roundsMap = new Map<
    string,
    {
      round_id: string;
      started_at: string | null;
      ended_at: string | null;
      spawn_at: string | null;
      pings: number;
      diagnoses: Record<string, number>;
      restarts: number;
      duration_sec: number | null;
    }
  >();
  for (const e of recent) {
    if (!e.round_id) continue;
    let r = roundsMap.get(e.round_id);
    if (!r) {
      r = {
        round_id: e.round_id,
        started_at: null,
        ended_at: null,
        spawn_at: null,
        pings: 0,
        diagnoses: {},
        restarts: 0,
        duration_sec: null,
      };
      roundsMap.set(e.round_id, r);
    }
    if (!r.started_at || e.ts < r.started_at) r.started_at = e.ts;
    if (!r.ended_at || e.ts > r.ended_at) r.ended_at = e.ts;
    if (e.event === "spawn") r.spawn_at = e.ts;
    if (e.event === "ping_sent") r.pings += 1;
    if (e.event === "diagnosis" && e.status) {
      r.diagnoses[e.status] = (r.diagnoses[e.status] || 0) + 1;
    }
    if (e.event === "restart") r.restarts += 1;
    if (e.event === "round_complete" && typeof e.duration_sec === "number") {
      r.duration_sec = e.duration_sec;
    }
  }
  const rounds = Array.from(roundsMap.values()).sort((a, b) =>
    (a.started_at || "").localeCompare(b.started_at || ""),
  );

  return NextResponse.json({
    ok: true,
    file: actionsFile,
    sinceMin,
    events,
    rounds,
    counts: {
      total: events.length,
      pings: events.filter((e) => e.event === "ping_sent").length,
      restarts: events.filter((e) => e.event === "restart").length,
      rounds_complete: events.filter((e) => e.event === "round_complete")
        .length,
    },
  });
}
