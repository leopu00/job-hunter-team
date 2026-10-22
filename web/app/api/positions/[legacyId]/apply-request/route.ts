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
import { requestAction } from "@/lib/request-action";
import {
  AUTHORISABLE_STATUS,
  applyToggleVerdict,
  nextApplyInstant,
  type ApplyToggleRefusal,
} from "@/lib/apply-request-rule";

export const dynamic = "force-dynamic";

// [JHT-CLOSER] L'AUTORIZZAZIONE PER-POSIZIONE alla candidatura.
//
// È il click con cui l'utente dice «candidati a questa». Non è una richiesta
// che qualcuno valuterà dopo: il flag È l'autorizzazione a inviare (decisione
// dell'operatore, 2026-09-12), quindi il CLOSER compila e spedisce senza
// fermarsi su un secondo bottone. Fra questo POST e la casella di un recruiter
// resta solo il gate (`shared/skills/apply_gate.py`) e le difese della fase C.
//
// Due strade, secondo dove gira il web:
//   - sul sito (deploy cloud): la porta unica `requestAction`. Autorizzare è L3: prima
//     chiamata = conferma con il ruolo e l'azienda composti dal database dalla riga vera, seconda
//     chiamata = l'id della conferma, entro 2 minuti, dalla stessa sessione; sessione recente e
//     tetto giornaliero stanno nel database. Ritirare è L1 e vale subito (è l'annullo).
//   - accanto alla macchina dell'utente (desktop nativo o web nel container): SQLite locale è la
//     source of truth, e il push delta porta il flag al cloud.
// L'operatore sta su una VPS e flagga dal browser: il flag arriva alla macchina con
// pull-desired-state, dopo che `request_action` l'ha scritto sul cloud.
//
// ⚠️ Vale la regola di [APPLIED-STATE-NEVER-COMES-HOME] (#186): dal cloud si
// prende l'AZIONE DELL'UTENTE, mai lo stato generico. Per questo la route
// scrive SEMPRE `apply_requested_by`, e lo scrive con un valore che nomina il
// canale di una persona — `user_web` dal browser, `user_local` dalla dashboard
// desktop. Il gate rifiuta qualunque altro valore, incluso quello con cui il
// team firma le proprie candidature: un flag acceso da un processo non è
// un'autorizzazione, è il percorso in cui la squadra si autorizza da sola.
//
// Solo `ready`: è lo stato in cui il CV esiste ed è passato dal Critico.
// Autorizzare prima significherebbe autorizzare l'invio di qualcosa che non è
// ancora stato scritto, e il rifiuto è un 409 esplicito perché l'utente possa
// capire che deve aspettare, non che il bottone è rotto.
//
// La regola (stato autorizzabile, stati «già inviata») non vive in questo
// file: sta in `shared/cloud/apply-request-rule.json`, la stessa che legge il
// gate e il comando `jht apply`. Una candidatura già partita non si autorizza
// né si ritira, da nessun canale.

/** Il canale che ha acceso il flag. Il vocabolario è quello di apply_gate.py. */
type ApplyRequestOrigin = "user_web" | "user_local";

function refused(
  legacyId: number,
  status: string | null,
  reason: ApplyToggleRefusal,
): NextResponse {
  const detail =
    reason === "already_submitted"
      ? "La candidatura è già stata inviata: non si autorizza né si ritira"
      : reason === "position_not_ready"
        ? `Posizione in stato '${status}': l'autorizzazione alla candidatura è ` +
          `ammessa solo per '${AUTHORISABLE_STATUS}'`
        : "Regola di autorizzazione non leggibile";
  return NextResponse.json(
    { error: reason, detail, position: { id: String(legacyId), status } },
    { status: reason === "rule_unavailable" ? 503 : 409 },
  );
}

async function handleToggle(
  req: NextRequest,
  legacyIdParam: string,
  requested: boolean,
): Promise<NextResponse> {
  // Sul sito (deploy cloud) l'autorizzazione passa dalla porta unica: autorizzare è L3 (conferma a due
  // tempi col ruolo e l'azienda composti dal database, sessione recente, tetto giornaliero), ritirare è L1
  // e vale subito. Qui non si legge né si scrive niente prima della porta, e nessun client scrive più la
  // posizione: è `request_action` che lo fa, per l'utente della sessione.
  if (isCloudDeploy()) {
    if (!/^[1-9][0-9]{0,9}$/.test(legacyIdParam)) {
      return NextResponse.json(
        { error: "legacyId non valido" },
        { status: 400 },
      );
    }
    const params = { legacy_id: Number(legacyIdParam) };
    return requested
      ? requestAction(req, {
          action: "position.apply_authorize",
          level: "L3",
          params,
        })
      : requestAction(req, {
          action: "position.apply_revoke",
          level: "L1",
          method: "DELETE",
          params,
        });
  }

  const denied = await requireAuth();
  if (denied) return denied;
  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  // [JHT-DASHBOARD-NATIVE] Desktop nativo: con local-token valido si scrive
  // SOLO su SQLite locale e si ritorna, senza cloud (resolveUser→Supabase
  // rifiuterebbe il Bearer local-token). Su deploy cloud questo ramo non si
  // apre mai per costruzione (lib/local-token.ts).
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
    const outcome = toggleViaLocal(legacyId, requested, "user_local");
    if (!outcome.ok) return outcome.res;
    return NextResponse.json({
      id: String(legacyId),
      apply_requested: requested,
      apply_requested_at: outcome.at,
      apply_requested_by: outcome.by,
      cloud_synced: null,
      source: "local",
    });
  }

  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      {
        error:
          "Solo il browser può autorizzare una candidatura (no Bearer token)",
      },
      { status: 403 },
    );
  }

  // Qui non si è sul sito: il web gira accanto alla macchina dell'utente, che ha il suo SQLite. Il cloud
  // lo raggiunge il push delta della macchina, non questa route (nessun client scrive più la posizione
  // sul cloud: sta dietro `request_action`).
  const hasLocal = !isCloudDeploy() && fs.existsSync(JHT_DB_PATH);
  if (!hasLocal) {
    return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
  }
  const outcome = toggleViaLocal(legacyId, requested, "user_web");
  if (!outcome.ok) return outcome.res;
  return NextResponse.json({
    id: String(legacyId),
    apply_requested: requested,
    apply_requested_at: outcome.at,
    apply_requested_by: outcome.by,
    cloud_synced: null,
    source: "local",
  });
}

/**
 * Path A: SQLite locale è la source of truth (desktop nativo, o web dentro al
 * container). Esportata perché è la parte verificabile senza un browser e
 * senza Supabase: è qui che vive la regola, non nel giro HTTP attorno.
 */
export function toggleViaLocal(
  legacyId: number,
  requested: boolean,
  by: ApplyRequestOrigin,
):
  | { ok: true; at: string | null; by: ApplyRequestOrigin | null }
  | { ok: false; res: NextResponse } {
  const db = new Database(JHT_DB_PATH);
  try {
    db.pragma("journal_mode = WAL");
    const row = db
      .prepare<
        [number],
        {
          id: number;
          status: string | null;
          apply_requested: number | null;
          apply_requested_at: string | null;
          applied: number | null;
        }
      >(
        `SELECT p.id, p.status, p.apply_requested, p.apply_requested_at,
                a.applied
           FROM positions p
           LEFT JOIN applications a ON a.position_id = p.id
          WHERE p.id = ?`,
      )
      .get(legacyId);
    if (!row) {
      return {
        ok: false,
        res: NextResponse.json(
          { error: `Posizione #${legacyId} non trovata` },
          { status: 404 },
        ),
      };
    }
    const verdict = applyToggleVerdict({
      status: row.status,
      applied: row.applied === 1,
      requested,
    });
    if (!verdict.ok) {
      return { ok: false, res: refused(legacyId, row.status, verdict.reason) };
    }

    // Lo spegnimento azzera l'autore insieme al flag. Lasciare
    // `apply_requested_by` valorizzato accanto a un flag spento darebbe una
    // riga che dice «l'utente ha autorizzato» a chi legge solo quella colonna,
    // e il gate di domani potrebbe essere scritto proprio così.
    //
    // Ritirare ciò che non è autorizzato non scrive niente: un no-op che
    // muovesse `updated_at` spingerebbe al cloud una riga che non è cambiata.
    // Negli altri casi `updated_at` si muove, sempre in avanti: è il cursore
    // del push delta, e un flag che non lo muove non arriva mai al sito.
    if (requested || row.apply_requested === 1) {
      db.prepare(
        `UPDATE positions
            SET apply_requested = ?,
                apply_requested_at = ?,
                apply_requested_by = ?,
                updated_at = CASE
                  WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
                       > COALESCE(updated_at, '')
                  THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
                  ELSE strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds')
                END
          WHERE id = ?`,
      ).run(
        requested ? 1 : 0,
        nextApplyInstant(row.apply_requested_at),
        requested ? by : null,
        legacyId,
      );
    }

    const after = db
      .prepare<
        [number],
        { apply_requested_at: string | null }
      >("SELECT apply_requested_at FROM positions WHERE id = ?")
      .get(legacyId);
    return {
      ok: true,
      at: after?.apply_requested_at ?? null,
      by: requested ? by : null,
    };
  } finally {
    db.close();
  }
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
