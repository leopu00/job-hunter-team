// Cancellazione dell'account e di tutti i dati cloud dell'utente.
//
// ⚠️ IRREVERSIBILE. Le protezioni non sono decorative, sono la ragione per
// cui questo file esiste separato dalla route.
//
// ── Perché non basta `auth.admin.deleteUser` ──────────────────────────
// L'assunzione naturale è che cancellare la riga in `auth.users` porti via
// tutto per cascata. **Non è vero su questo schema.** Verificato sul
// catalogo di produzione il 7 agosto 2026: sei tabelle referenziano
// `auth.users` con `NO ACTION`, non `CASCADE`, e sono proprio quelle che
// contengono il lavoro dell'utente:
//
//   applications · candidate_profiles · companies · position_highlights
//   positions · scores
//
// Con `NO ACTION` Postgres RIFIUTA di cancellare il padre finché esistono
// figli: un `deleteUser` diretto fallirebbe con violazione di chiave, e
// l'utente vedrebbe un errore dopo aver confermato una cancellazione.
// Vanno quindi svuotate esplicitamente, e nell'ordine giusto.
//
// ── L'ordine, e da dove viene ─────────────────────────────────────────
// Dipendenze interne verificate sullo stesso catalogo:
//
//   companies ← positions ← { applications, position_highlights, scores }
//
// quindi si va dai figli ai padri. Il resto delle tabelle (candidate_*,
// cloud_sync_*, team_*, notification_prefs, …) ha `CASCADE` e sparisce da
// sé quando cade `auth.users`, che è l'ultimo passo.
//
// `companies` è per-utente: verificato che nessuna azienda è referenziata
// da posizioni di un altro utente, quindi cancellarla non tocca dati
// altrui. Se un giorno le aziende diventassero condivise, questa riga va
// ripensata prima di ogni altra cosa.

import type { SupabaseClient } from "@supabase/supabase-js";

// L'ordine vive in `account-data-tables`, insieme all'elenco che usa
// anche l'export: due copie divergerebbero al primo cambio di schema.
import { MANUAL_DELETE_ORDER } from "./account-data-tables";

export { MANUAL_DELETE_ORDER };

export interface DeletionOutcome {
  /** Righe rimosse per tabella. Serve al record tecnico e ai test. */
  removed: Record<string, number>;
  /** Tabelle svuotate a mano, in ordine. */
  order: readonly string[];
}

/**
 * Svuota le tabelle senza cascata e poi cancella l'utente.
 *
 * `userId` arriva SEMPRE dalla sessione del chiamante, mai dal corpo della
 * richiesta: è così che si rende impossibile cancellare l'account di
 * qualcun altro, invece di provare a validarlo dopo.
 */
export async function deleteAccountData(
  admin: SupabaseClient,
  userId: string,
): Promise<DeletionOutcome> {
  if (!userId) throw new Error("userId mancante: cancellazione rifiutata");

  const removed: Record<string, number> = {};

  for (const table of MANUAL_DELETE_ORDER) {
    // `count: "exact"` serve al record tecnico: quante righe sono sparite,
    // senza conservare nulla di ciò che contenevano.
    const { count, error } = await admin
      .from(table)
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) {
      throw new Error(
        `cancellazione interrotta su ${table}: ${error.message}. ` +
          `Le tabelle già svuotate: ${Object.keys(removed).join(", ") || "nessuna"}.`,
      );
    }
    removed[table] = count ?? 0;
  }

  // Ultimo passo: cade l'utente e con lui tutto ciò che ha CASCADE.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(
      `dati cancellati ma utente ancora presente: ${error.message}`,
    );
  }

  return { removed, order: MANUAL_DELETE_ORDER };
}

/**
 * Riga di log dell'avvenuta cancellazione, **senza i dati cancellati**.
 *
 * Contiene solo: quando, un identificativo non reversibile dell'utente, e
 * quante righe per tabella. L'id utente in chiaro sarebbe esso stesso un
 * dato personale sopravvissuto alla cancellazione — che è esattamente ciò
 * che l'utente ha chiesto di far sparire.
 */
export function deletionAuditLine(
  userRef: string,
  outcome: DeletionOutcome,
  now: string,
): string {
  const totals = Object.entries(outcome.removed)
    .map(([table, n]) => `${table}=${n}`)
    .join(" ");
  return `[account-deletion] ${now} ref=${userRef} ${totals}`;
}
