import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Database from "better-sqlite3";
import fs from "fs";
import { resolveUser } from "@/lib/team-state/auth";
import { requireAuth } from "@/lib/auth";
import {
  LOCAL_TOKEN_COOKIE,
  isLocalTokenAuthenticated,
} from "@/lib/local-token";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import { isCloudDeploy } from "@/lib/deploy-mode";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Geocoding-on-demand: l'utente "richiede" il geocoding ufficio preciso
// per una posizione cliccando il pulsante "Geocodifica" sulla detail page.
// Setta `positions.geocode_requested = 1` cosi' l'Analista esegue la skill
// `office-geocoding` (3+ tentativi: Nominatim, web search, Photon) solo
// per le posizioni che l'utente ha esplicitamente richiesto. Replica esatta
// del pattern Writer-on-demand (vedi ../write-request/route.ts).
//
// Differenze vs write-request:
//   - Nessun guard di status: il geocoding ha senso su qualunque posizione
//     con loc_city/loc_country valorizzato, indipendentemente da scored/
//     writing/ready/applied. L'Analista skippa autonomamente se non ha
//     materiale geografico utile (skill `office-geocoding`).
//   - Nessun guard application: la presenza di application non blocca il
//     re-geocoding (l'utente puo' voler raffinare le coordinate anche
//     dopo aver applicato).
//
// Due modi operativi identici a write-request:
//   A) Local mode (SQLite presente): UPDATE atomico locale + best-effort
//      cloud per UI cross-device.
//   B) Cloud mode (SQLite assente): UPDATE solo Supabase. Il container al
//      prossimo boot esegue `jht cloud pull-desired-state` e applica il
//      flag al SQLite locale.
//
// Vedi BACKLOG [Cloud Sync — Geocoding opt-in/out] (2026-05-31) e
// migration V8 in `shared/skills/_db.py::_migrate_positions_geocode_requested`
// + Supabase mig 027.

interface PositionRow {
  id: number;
  title: string;
  company: string;
  status: string | null;
  loc_city: string | null;
  loc_country_code: string | null;
  geocode_requested: number;
  geocode_requested_at: string | null;
  office_geocoded: number | null;
}

interface ResponsePosition {
  id: string;
  title: string;
  company: string;
  status: string | null;
  loc_city: string | null;
  loc_country_code: string | null;
  geocode_requested: boolean;
  geocode_requested_at: string | null;
  office_geocoded: boolean;
}

interface ToggleOutcome {
  position: ResponsePosition;
  cloud_synced: boolean | null;
  source: "local" | "cloud";
}

function toggleViaLocal(
  legacyId: number,
  requested: boolean,
):
  | { ok: true; outcome: ToggleOutcome }
  | { ok: false; status: number; body: Record<string, unknown> } {
  const db = new Database(JHT_DB_PATH);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const row = db
      .prepare<[number], PositionRow>(
        `
        SELECT
          p.id, p.title, p.company, p.status,
          p.loc_city, p.loc_country_code,
          p.geocode_requested, p.geocode_requested_at,
          p.office_geocoded
        FROM positions p
        WHERE p.id = ?
      `,
      )
      .get(legacyId);

    if (!row) {
      return {
        ok: false,
        status: 404,
        body: { error: `Posizione #${legacyId} non trovata` },
      };
    }

    db.prepare(
      `
      UPDATE positions
         SET geocode_requested = ?,
             geocode_requested_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?
    `,
    ).run(requested ? 1 : 0, requested ? 1 : 0, legacyId);

    const updated = db
      .prepare<[number], PositionRow>(
        `
        SELECT
          p.id, p.title, p.company, p.status,
          p.loc_city, p.loc_country_code,
          p.geocode_requested, p.geocode_requested_at,
          p.office_geocoded
        FROM positions p
        WHERE p.id = ?
      `,
      )
      .get(legacyId)!;

    return {
      ok: true,
      outcome: {
        position: {
          id: String(updated.id),
          title: updated.title,
          company: updated.company,
          status: updated.status,
          loc_city: updated.loc_city,
          loc_country_code: updated.loc_country_code,
          geocode_requested: updated.geocode_requested === 1,
          geocode_requested_at: updated.geocode_requested_at,
          office_geocoded: updated.office_geocoded === 1,
        },
        cloud_synced: null,
        source: "local",
      },
    };
  } finally {
    db.close();
  }
}

async function toggleViaCloud(
  supabase: SupabaseClient,
  userId: string,
  legacyId: number,
  requested: boolean,
): Promise<
  | { ok: true; outcome: ToggleOutcome }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const { data: row, error } = await supabase
    .from("positions")
    .select(
      "id, title, company, status, loc_city, loc_country_code, " +
        "geocode_requested, geocode_requested_at, office_geocoded",
    )
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .maybeSingle();

  if (error) {
    // Questo helper ritorna un BODY, non una NextResponse: `sanitizedError`
    // non è applicabile qui, quindi ne replichiamo il contratto — dettaglio
    // nei log del server, codice stabile al client.
    console.error(`[positions/geocode-request] 500 ${error.message}`);
    return { ok: false, status: 500, body: { error: "query_failed" } };
  }
  if (!row) {
    return {
      ok: false,
      status: 404,
      body: { error: `Posizione #${legacyId} non trovata` },
    };
  }

  type R = {
    title: string | null;
    company: string | null;
    status: string | null;
    loc_city: string | null;
    loc_country_code: string | null;
    office_geocoded: boolean | null;
  };
  const r = row as unknown as R;

  const geocodeRequestedAt = requested ? new Date().toISOString() : null;
  const { error: upErr } = await supabase
    .from("positions")
    .update({
      geocode_requested: requested,
      geocode_requested_at: geocodeRequestedAt,
    })
    .eq("user_id", userId)
    .eq("legacy_id", legacyId);

  if (upErr) {
    return {
      ok: false,
      status: 500,
      body: { error: `Supabase update failed: ${upErr.message}` },
    };
  }

  return {
    ok: true,
    outcome: {
      position: {
        id: String(legacyId),
        title: r.title ?? "",
        company: r.company ?? "",
        status: r.status,
        loc_city: r.loc_city,
        loc_country_code: r.loc_country_code,
        geocode_requested: requested,
        geocode_requested_at: geocodeRequestedAt,
        office_geocoded: r.office_geocoded === true,
      },
      cloud_synced: true,
      source: "cloud",
    },
  };
}

async function handleToggle(
  req: NextRequest,
  legacyIdParam: string,
  requested: boolean,
): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  // [JHT-DASHBOARD-NATIVE] Desktop nativo: con local-token valido scrivi SOLO
  // su SQLite locale (riusa toggleViaLocal) e ritorna, senza cloud.
  if (
    isLocalTokenAuthenticated(
      req.headers.get("authorization"),
      (await cookies()).get(LOCAL_TOKEN_COOKIE)?.value,
    )
  ) {
    // Sito local-only DICHIARATO: dentro il ramo local-token, che su deploy
    // cloud non si apre mai (`isLocalTokenAuthenticated()` e' false per
    // costruzione, lib/local-token.ts). DB assente = box a meta' → 503.
    if (!fs.existsSync(JHT_DB_PATH)) {
      return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
    }
    const local = toggleViaLocal(legacyId, requested);
    if (!local.ok) {
      return NextResponse.json(local.body, { status: local.status });
    }
    return NextResponse.json({
      position: local.outcome.position,
      cloud_synced: null,
      source: "local",
    });
  }

  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      {
        error: "Solo il browser puo' richiedere il geocoding (no Bearer token)",
      },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;

  const hasLocal = !isCloudDeploy() && fs.existsSync(JHT_DB_PATH);

  if (hasLocal) {
    const local = toggleViaLocal(legacyId, requested);
    if (!local.ok) {
      return NextResponse.json(local.body, { status: local.status });
    }
    let cloudOk: boolean | null = null;
    try {
      const { error } = await supabase
        .from("positions")
        .update({
          geocode_requested: requested,
          geocode_requested_at: requested ? new Date().toISOString() : null,
        })
        .eq("user_id", userId)
        .eq("legacy_id", legacyId);
      cloudOk = !error;
    } catch {
      cloudOk = false;
    }
    return NextResponse.json({
      position: local.outcome.position,
      cloud_synced: cloudOk,
      source: "local",
    });
  }

  const cloud = await toggleViaCloud(supabase, userId, legacyId, requested);
  if (!cloud.ok) {
    return NextResponse.json(cloud.body, { status: cloud.status });
  }
  return NextResponse.json({
    position: cloud.outcome.position,
    cloud_synced: cloud.outcome.cloud_synced,
    source: cloud.outcome.source,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handleToggle(req, legacyId, true);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handleToggle(req, legacyId, false);
}
