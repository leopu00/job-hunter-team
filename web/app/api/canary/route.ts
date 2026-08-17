/**
 * Canary endpoint per diagnostica veloce Supabase vs Vercel.
 *
 * P2 da docs/internal/architecture/cloud-sync-architecture.md: durante l'incident
 * RobertHalf 2026-05-19 il middleware Next.js timeout (504 GATEWAY_TIMEOUT)
 * mascherava la causa reale (Supabase Nano connection pool saturo). Senza
 * un endpoint dedicato, oncall non poteva distinguere "Supabase saturo"
 * da "Vercel slow" guardando solo la dashboard di uno dei due servizi.
 *
 * Questo endpoint:
 *  - NON e' auth'd (e' un health-check pubblico, no dati sensibili)
 *  - Fa una query Postgres minimale (SELECT 1) con timeout 2s
 *  - Ritorna latency_ms + status testuale ('ok'/'slow'/'timeout'/'error')
 *  - Mostra anche il tempo "Vercel-side" (process_ms) per separare le 2 cause
 *
 * Uso da oncall:
 *   curl https://jobhunterteam.ai/api/canary
 *   {
 *     "supabase": { "status": "ok",    "latency_ms": 47 },
 *     "vercel":   { "status": "ok",    "process_ms": 51 },
 *     "interpretation": "all good"
 *   }
 *
 *   curl https://jobhunterteam.ai/api/canary
 *   {
 *     "supabase": { "status": "timeout", "latency_ms": 2000 },
 *     "vercel":   { "status": "ok",      "process_ms": 2010 },
 *     "interpretation": "Supabase saturated/down — Vercel responding normally"
 *   }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPABASE_TIMEOUT_MS = 2_000;
const SLOW_THRESHOLD_MS = 800;

type ProbeStatus = "ok" | "slow" | "timeout" | "error" | "not-configured";

interface ProbeResult {
  status: ProbeStatus;
  latency_ms: number;
  error?: string;
}

async function probeSupabase(): Promise<ProbeResult> {
  if (!isSupabaseConfigured) {
    return { status: "not-configured", latency_ms: 0 };
  }

  const supabase = await createClient();
  const t0 = Date.now();

  // Race fra la query e un timeout hard di 2s. La query mira a una tabella
  // pubblica con RLS solo SELECT: countSync = HEAD request che non scarica
  // payload, e' la query piu' leggera che valida che il connection pool
  // risponde e l'auth chain Postgres funziona.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        status: "timeout",
        latency_ms: SUPABASE_TIMEOUT_MS,
        error: `query exceeded ${SUPABASE_TIMEOUT_MS}ms`,
      });
    }, SUPABASE_TIMEOUT_MS);
  });

  const queryPromise = (async (): Promise<ProbeResult> => {
    try {
      // `count: 'exact', head: true` evita di scaricare row e fa solo HEAD.
      // companies e' una delle tabelle piu' piccole e ha sempre almeno 0 row.
      const { error } = await supabase
        .from("companies")
        .select("*", { count: "exact", head: true });
      const latency = Date.now() - t0;
      if (error) {
        return {
          status: "error",
          latency_ms: latency,
          error: "database probe failed",
        };
      }
      return {
        status: latency > SLOW_THRESHOLD_MS ? "slow" : "ok",
        latency_ms: latency,
      };
    } catch (err) {
      return {
        status: "error",
        latency_ms: Date.now() - t0,
        error: "database probe failed",
      };
    }
  })();

  const result = await Promise.race([queryPromise, timeoutPromise]);
  if (timer) clearTimeout(timer);
  return result;
}

function interpret(supabase: ProbeResult, vercelProcessMs: number): string {
  if (supabase.status === "not-configured") {
    return "Supabase not configured on this deployment";
  }
  if (supabase.status === "timeout") {
    return "Supabase saturated/down — Vercel responding normally";
  }
  if (supabase.status === "error") {
    return `Supabase error — check Postgres logs: ${supabase.error ?? "unknown"}`;
  }
  if (supabase.status === "slow") {
    return `Supabase responding but slow (${supabase.latency_ms}ms > ${SLOW_THRESHOLD_MS}ms) — check advisors`;
  }
  if (vercelProcessMs > 3_000) {
    return `Supabase ok but Vercel slow (${vercelProcessMs}ms total) — check Vercel function logs`;
  }
  return "all good";
}

export async function GET() {
  const t0 = Date.now();
  const supabase = await probeSupabase();
  const vercelProcessMs = Date.now() - t0;

  const body = {
    supabase: {
      status: supabase.status,
      latency_ms: supabase.latency_ms,
      ...(supabase.error ? { error: supabase.error } : {}),
    },
    vercel: {
      status: vercelProcessMs > 3_000 ? "slow" : "ok",
      process_ms: vercelProcessMs,
    },
    interpretation: interpret(supabase, vercelProcessMs),
    ts: new Date().toISOString(),
  };

  // HTTP 200 anche su timeout/slow: e' un report, non un controller.
  // Oncall vede il JSON, decide. 503 sarebbe ambiguo (Supabase down? Vercel?).
  return NextResponse.json(body, {
    headers: {
      // No-cache: oncall vuole letture fresche.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
