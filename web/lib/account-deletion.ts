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

/** L'unico bucket in cui finiscono file dell'utente. */
const STORAGE_BUCKET = "file-transit";

/** Quanti oggetti si enumerano al massimo. Oltre questa soglia la
 *  cancellazione si ferma invece di dichiararsi completa avendone lasciati
 *  fuori: un numero alto ma finito è meglio di una paginazione che nessuno
 *  ha mai provato con quei volumi. */
const STORAGE_LIST_LIMIT = 1000;

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

  // ── Prima i file su Storage, poi le righe ───────────────────────────
  // `file_bridge_requests` cade per cascata, ma la riga non è il file: gli
  // oggetti nel bucket `file-transit` sopravvivrebbero alla cancellazione.
  // Non ci si può appoggiare a un purge automatico — nel bucket è stato
  // trovato un oggetto rimasto per otto giorni — quindi si rimuovono qui,
  // e PRIMA di perdere le righe, che sono l'unico posto dove i percorsi
  // sono scritti.
  const storage = await deleteStorageObjects(admin, userId);
  removed["storage:file-transit"] = storage.removed;
  if (storage.failed.length > 0) {
    // Un file che resta è una cancellazione incompleta, e va detto invece
    // di dichiarare completato: l'operatore ha scelto la cancellazione
    // immediata proprio perché fosse vera.
    throw new Error(
      `${storage.failed.length} file su Storage non cancellati: ` +
        `la cancellazione si ferma qui per non dichiararsi completa. ` +
        `Percorsi rimasti: ${storage.failed.join(", ")}`,
    );
  }

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
 * Rimuove gli oggetti dell'utente dal bucket di transito.
 *
 * I percorsi si leggono da `file_bridge_requests`, che è l'unico posto
 * dove sono registrati: per questo va fatto PRIMA di cancellare le righe.
 * Se il bucket non risponde, o qualche oggetto resta, il chiamante lo
 * tratta come un fallimento — meglio fermarsi che dire «cancellato».
 */
async function deleteStorageObjects(
  admin: SupabaseClient,
  userId: string,
): Promise<{ removed: number; failed: string[] }> {
  // ── Perché non basta leggere le righe ────────────────────────────────
  // La prima versione ricavava i percorsi da `file_bridge_requests`. Non
  // è sufficiente: HQ-DOCS ha trovato un oggetto reale rimasto nel bucket
  // senza più la sua riga. Un caricamento interrotto, una riga ripulita da
  // un job, un errore a metà — e il file resta lì mentre il database dice
  // che non esiste. Cancellare in base alle righe lascerebbe indietro
  // proprio i casi che l'utente non può vedere né segnalare.
  //
  // Quindi si enumera direttamente il prefisso `${userId}/` nel bucket, e
  // le righe servono solo ad aggiungere eventuali percorsi fuori da quel
  // prefisso. L'unione delle due fonti è ciò che si cancella.
  const paths = new Set<string>();

  const { data: listed, error: listError } = await admin.storage
    .from(STORAGE_BUCKET)
    .list(userId, { limit: STORAGE_LIST_LIMIT });
  if (listError) {
    // Non si può sapere cosa c'è: fermarsi è l'unica risposta onesta.
    throw new Error(
      `impossibile elencare i file dell'utente: ${listError.message}`,
    );
  }
  for (const obj of listed ?? []) {
    const name = (obj as { name?: string }).name;
    if (name) paths.add(`${userId}/${name}`);
  }
  if ((listed?.length ?? 0) >= STORAGE_LIST_LIMIT) {
    // Con più oggetti del limite ne resterebbero fuori senza dirlo: si
    // preferisce fallire piuttosto che cancellare a metà in silenzio.
    throw new Error(
      `l'utente ha almeno ${STORAGE_LIST_LIMIT} file: enumerazione ` +
        `incompleta, cancellazione interrotta per non dichiararsi completa`,
    );
  }

  // Le righe possono puntare fuori dal prefisso (percorsi storici): si
  // aggiungono, non si sostituiscono.
  const { data: rows, error } = await admin
    .from("file_bridge_requests")
    .select("storage_path")
    .eq("user_id", userId);
  if (error) {
    throw new Error(
      `impossibile leggere i file da cancellare: ${error.message}`,
    );
  }
  for (const row of rows ?? []) {
    const p = (row as { storage_path: string | null }).storage_path;
    if (typeof p === "string" && p.length > 0) paths.add(p);
  }

  const all = [...paths];
  if (all.length === 0) return { removed: 0, failed: [] };

  const { data: removedList, error: rmError } = await admin.storage
    .from(STORAGE_BUCKET)
    .remove(all);
  if (rmError) {
    return { removed: 0, failed: all };
  }

  // `remove` non fallisce per i percorsi inesistenti: si confronta ciò che
  // dice di aver rimosso con ciò che si è chiesto, così un file rimasto
  // non passa per cancellato.
  const done = new Set(
    (removedList ?? []).map((o) => (o as { name: string }).name),
  );
  const failed = all.filter(
    (p) => !done.has(p) && !done.has(p.split("/").pop() ?? p),
  );
  return { removed: all.length - failed.length, failed };
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
