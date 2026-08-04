/**
 * /api/team/working-hours — GET/PUT delle ore di lavoro del team.
 *
 * Storage: jht.config.json local-first (lo stesso che legge il CLI e
 * il pacing-bridge). Validazione Zod riusa lo schema centralizzato
 * in shared/config/schema.ts. La PUT scrive in modo atomico (tmp +
 * rename) per evitare config corrotti se il processo viene killato
 * a metà write.
 *
 * Risposta GET include anche un "preview" calcolato dal modulo Python
 * work_hours_target via `docker exec` quando il container è attivo:
 * ore_attive_settimana, target_window_pct atteso "ora", next_phase_
 * transition_at. Best-effort: se il container non gira, la response
 * resta col solo schedule senza preview.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { z } from "zod";
import { JHT_CONFIG_PATH, JHT_HOME } from "@/lib/jht-paths";
import { requireAuth, isLocalRequest, requireLocalWrite } from "@/lib/auth";
import { WorkingHoursSchema } from "../../../../../shared/config/schema";
import { invalidJsonBody } from "@/app/api/_lib/error-body";

export const dynamic = "force-dynamic";

const PutBodySchema = z.object({
  // null/undefined → rimuovi la config (team 24/7)
  working_hours: WorkingHoursSchema.nullable().optional(),
});

async function readConfig(): Promise<any> {
  try {
    const raw = await fs.readFile(JHT_CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeConfig(cfg: any): Promise<void> {
  await fs.mkdir(JHT_HOME, { recursive: true });
  const tmp = JHT_CONFIG_PATH + `.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, JHT_CONFIG_PATH);
}

async function simulateTarget(): Promise<unknown | null> {
  // Best-effort: chiama il modulo Python dentro il container.
  // Se docker exec non risponde entro 3s, ritorna null.
  return new Promise((resolve) => {
    const p = spawn(
      "docker",
      [
        "exec",
        "jht",
        "python3",
        "-c",
        `import sys,json
sys.path.insert(0,'/app/shared/skills')
import work_hours_target as wht, provider_capacity as pcap
from datetime import datetime, timedelta, timezone
now = datetime.now(timezone.utc)
ws = now.replace(minute=0,second=0,microsecond=0)
we = ws + timedelta(hours=5)
ratio = pcap.get_window_cap_pct_of_weekly()
r = wht.compute_target(now, ws, we, ratio)
r['provider_active'] = pcap.read_active_provider()
r['provider'] = pcap.describe()
print(json.dumps(r, default=str))`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    const to = setTimeout(() => {
      p.kill();
      resolve(null);
    }, 3000);
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => {
      clearTimeout(to);
      if (code !== 0) return resolve(null);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(null);
      }
    });
    p.on("error", () => {
      clearTimeout(to);
      resolve(null);
    });
  });
}

export async function GET() {
  const auth = await requireAuth();
  if (auth) return auth;

  const cfg = await readConfig();
  const wh = cfg?.team?.working_hours ?? null;
  const preview = await simulateTarget();
  // Le modifiche agli orari si fanno solo dall'app desktop (host localhost);
  // dal browser cloud la UI e' sola visualizzazione (pattern WEB-READONLY).
  const editable = await isLocalRequest();
  return NextResponse.json({ working_hours: wh, preview, editable });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (auth) return auth;

  // Write-guard WEB-READONLY: modifiche solo dall'app desktop (host localhost).
  const ro = await requireLocalWrite();
  if (ro) return ro;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const parsed = PutBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const cfg = (await readConfig()) ?? {};
  cfg.team = cfg.team ?? {};
  if (parsed.data.working_hours == null) {
    delete cfg.team.working_hours;
  } else {
    cfg.team.working_hours = parsed.data.working_hours;
  }
  await writeConfig(cfg);

  const preview = await simulateTarget();
  return NextResponse.json({
    working_hours: cfg.team.working_hours ?? null,
    preview,
    saved: true,
  });
}
