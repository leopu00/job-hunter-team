import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { sanitizedError } from "@/lib/error-response";
import { fetchPostgrestRowsByKey } from "@/lib/postgrest-pages";

export const dynamic = "force-dynamic";

// GET /api/cloud-sync/full-dump
//
// Disaster recovery endpoint: ritorna lo snapshot di positions / scores /
// applications per l'utente autenticato via bearer token. Usato da
// `jht cloud restore` per ricostruire SQLite locale dopo un wipe (disco
// pieno, container corrotto, reset onboarding parziale).
//
// Scope: 3 tabelle nel RESTORE (download cloud→locale). NB: dal 2026-06-22
// companies e position_highlights SONO sincronizzate cloud↔locale dal PUSH
// (mig 046 ha aggiunto loro `legacy_id`, vedi cloud-sync/push/route.ts) — la
// Company card e i Pro/Contro non sono più vuoti sul cloud. Restano fuori solo
// QUI nel restore perché ricostruire gli id interi SQLite locali dalle FK UUID
// è più complesso; l'Analista le ripopola autonomamente dopo un restore.
//
// Differenze vs pull-desired-state (mig 024 + 027):
//   - pull-desired-state ritorna SOLO i flag user-driven (write/geocode_
//     requested) per finestra `since` e UPDATE-a SQLite esistente.
//   - full-dump ritorna TUTTI i campi delle 3 tabelle vive (deleted_at
//     IS NULL) — è una sostituzione, non un merge per-row.
//
// Safety cap: 10000 righe per tabella. Oltre, ritorna 413 con istruzioni
// per usare push delta inverso (out-of-scope MVP). Il servizio impone un
// suo cap più basso per risposta (1000): la lettura va a pagine, e il
// conteggio esatto sotto impedisce di dichiarare completo un risultato che
// non lo è (una pagina persa, righe cambiate fra una pagina e l'altra).
//
// Auth: Bearer jht_sync_ token (stesso schema di push/pull). Rate limit
// 5/min/token: il restore è operazione rara, ma cap basso protegge da
// abuso e da retry loop accidentali.

const ROW_CAP_PER_TABLE = 10_000;

export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("full-dump", tokenId, 5);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // SELECT * per tabella, filtrando per user_id e righe vive (deleted_at
  // IS NULL). Tutte e 3 le tabelle hanno deleted_at (mig 025 tombstones).
  const tables = ["positions", "scores", "applications"] as const;
  const dump: Record<string, unknown[]> = {};
  const totals: Record<string, number> = {};

  for (const table of tables) {
    // A pagine per id (keyset), non per posizione: in un colpo solo
    // arrivavano le prime 1000 righe e il restore di chi ne ha di più finiva
    // sempre in 413; per offset, un push durante il restore farebbe uscire
    // una riga due volte e ne perderebbe un'altra con lo stesso totale.
    const { data, error, count } = await fetchPostgrestRowsByKey(
      (after) => {
        // Il totale serve una volta sola, alla prima pagina.
        const q = admin
          .from(table)
          .select("*", after === null ? { count: "exact" } : undefined)
          .eq("user_id", userId)
          .is("deleted_at", null);
        return (after === null ? q : q.gt("id", after)).order("id");
      },
      "id",
      { limit: ROW_CAP_PER_TABLE + 1 },
    );
    if (error) {
      return sanitizedError(error, {
        status: 500,
        scope: "cloud-sync/full-dump",
        publicMessage: `${table}_dump_failed`,
      });
    }
    const rows = data || [];
    // Il totale è l'unica evidenza che tutte le righe siano arrivate: senza,
    // un restore ricostruirebbe un database parziale credendolo uno snapshot
    // completo.
    if (count === null) {
      return NextResponse.json(
        { ok: false, error: `${table}_dump_count_unavailable` },
        { status: 503 },
      );
    }
    // Righe nate durante la lettura possono aggiungersi (id oltre l'ultimo
    // letto): uno snapshot un po' più nuovo. Meno righe del totale no.
    if (count > ROW_CAP_PER_TABLE || rows.length < count) {
      return NextResponse.json(
        {
          ok: false,
          error:
            count > ROW_CAP_PER_TABLE
              ? `${table} oltre cap di ${ROW_CAP_PER_TABLE} righe (il restore da full-dump si ferma lì)`
              : `${table} dump troncato (${rows.length} di ${count} righe ricevute)`,
        },
        { status: 413 },
      );
    }
    dump[table] = rows;
    totals[table] = rows.length;
  }

  return NextResponse.json({
    ok: true,
    dump,
    totals,
    dumped_at: new Date().toISOString(),
  });
}
