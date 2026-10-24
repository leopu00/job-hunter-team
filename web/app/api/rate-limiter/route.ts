import { NextResponse } from "next/server";
import path from "node:path";
import { JHT_HOME } from "@/lib/jht-paths";
import { readJsonSafe } from "@/lib/json-files";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Il consumo che frena davvero la squadra è quello che la sentinella misura:
// il bridge scrive `logs/role-usage.json` a ogni lettura (ogni 5 minuti) con i
// token pesati per ruolo nella finestra 5 ore e nella settimana del provider, e
// per agente nell'ultima ora. Questa route lo rilegge, in sola lettura. I
// limiti di richieste non sono configurabili: nessun codice legge una chiave
// `rate_limiter` di jht.config.json, quindi qui non se ne mostra nessuna.
const usageFile = () => path.join(JHT_HOME, "logs", "role-usage.json");
// Oltre questa età non è più «l'ultima ora»: lo stesso tetto del desktop e di
// agent_control.py.
const FRESH_MAX_AGE_S = 15 * 60;
const WINDOWS = ["5h", "week"] as const;
const MAX_ROLES = 20;
const MAX_AGENTS = 50;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

type RawRole = {
  kt?: unknown;
  share_pct?: unknown;
  agents?: unknown;
  events?: unknown;
};
type RawWindow = {
  since?: unknown;
  total_kt?: unknown;
  unattributed_kt?: unknown;
  roles?: unknown;
};
type RawUsage = {
  generated_at?: unknown;
  provider?: unknown;
  windows?: unknown;
  agents_1h?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Un numero che il bridge non ha scritto è «non so», mai zero.
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function name(value: unknown): string | null {
  return typeof value === "string" && NAME.test(value) ? value : null;
}

function shapeWindow(id: string, raw: unknown) {
  const w = record(raw) as RawWindow | null;
  if (!w) return null;
  const roles = Object.entries(record(w.roles) ?? {})
    .flatMap(([role, value]) => {
      const r = record(value) as RawRole | null;
      const label = name(role);
      if (!r || !label) return [];
      return [
        {
          role: label,
          kt: count(r.kt),
          sharePct: count(r.share_pct),
          agents: Array.isArray(r.agents) ? r.agents.length : null,
          events: count(r.events),
        },
      ];
    })
    .slice(0, MAX_ROLES);
  return {
    id,
    since: typeof w.since === "string" ? w.since.slice(0, 40) : null,
    totalKt: count(w.total_kt),
    unattributedKt: count(w.unattributed_kt),
    roles,
  };
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const raw = record(readJsonSafe<RawUsage>(usageFile())) as RawUsage | null;
  const generatedMs =
    raw && typeof raw.generated_at === "string"
      ? Date.parse(raw.generated_at)
      : NaN;
  const now = Date.now();
  const ageSec = Number.isFinite(generatedMs)
    ? Math.round((now - generatedMs) / 1000)
    : null;
  const readings = record(raw?.windows);
  const windows = WINDOWS.flatMap((id) => {
    const shaped = readings ? shapeWindow(id, readings[id]) : null;
    return shaped ? [shaped] : [];
  });
  const agents1h = Object.entries(record(raw?.agents_1h) ?? {})
    .flatMap(([agent, tokens]) => {
      const label = name(agent);
      const value = count(tokens);
      return label && value !== null ? [{ agent: label, tokens: value }] : [];
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, MAX_AGENTS);

  return NextResponse.json({
    // Nessun limite si imposta da qui: la pagina lo dice apertamente.
    limitsConfigurable: false,
    available: ageSec !== null && windows.length > 0,
    generatedAt: ageSec !== null ? new Date(generatedMs).toISOString() : null,
    ageSec,
    fresh: ageSec !== null && ageSec >= -60 && ageSec <= FRESH_MAX_AGE_S,
    provider:
      raw && typeof raw.provider === "string" && NAME.test(raw.provider)
        ? raw.provider
        : null,
    windows,
    agents1h,
    ts: now,
  });
}
