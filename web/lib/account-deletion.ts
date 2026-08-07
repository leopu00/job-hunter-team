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

/** Quanti oggetti si chiedono per ogni livello. */
const STORAGE_PAGE_LIMIT = 1000;

/** Quanti oggetti in tutto si accetta di enumerare. Oltre questa soglia la
 *  cancellazione si ferma invece di dichiararsi completa avendone lasciati
 *  fuori: un numero alto ma finito è meglio di una ricorsione che nessuno
 *  ha mai provato con quei volumi. */
const STORAGE_TOTAL_LIMIT = 5000;

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
/**
 * Elenca RICORSIVAMENTE gli oggetti sotto un prefisso.
 *
 * `list(path)` di Supabase restituisce i file **e le cartelle immediate**,
 * e le cartelle si riconoscono da `id === null`. Non scende da sola.
 *
 * La prima versione di questo codice si fermava al primo livello, e il
 * suo test simulava percorsi a due segmenti: era verde confermando
 * un'assunzione sbagliata. I file veri stanno in
 * `${userId}/${requestId}/${nome}` — tre segmenti — quindi al primo
 * livello si trovavano solo cartelle, e `remove()` su una cartella non
 * cancella nulla. Segnalato da HQ-DOCS con il percorso reale alla mano.
 */
async function listRecursive(
  admin: SupabaseClient,
  prefix: string,
  budget: { left: number },
): Promise<string[]> {
  if (budget.left <= 0) {
    throw new Error(
      `troppi file sotto ${prefix}: enumerazione interrotta per non ` +
        `dichiarare completa una cancellazione parziale`,
    );
  }
  // Si pagina fino a una pagina corta. Con una sola `list` a limite fisso,
  // una cartella con più figli del limite verrebbe troncata in silenzio e
  // la cancellazione si dichiarerebbe completa avendone lasciati fuori.
  const out: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage
      .from(STORAGE_BUCKET)
      .list(prefix, { limit: STORAGE_PAGE_LIMIT, offset });
    if (error) {
      throw new Error(`impossibile elencare ${prefix}: ${error.message}`);
    }
    const page = data ?? [];
    for (const entry of page) {
      const e = entry as { name?: string; id?: string | null };
      if (!e.name) continue;
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null || e.id === undefined) {
        // Cartella: si scende. È il ramo che mancava del tutto.
        out.push(...(await listRecursive(admin, full, budget)));
      } else {
        if (budget.left <= 0) {
          throw new Error(
            `troppi file sotto ${prefix}: enumerazione interrotta per non ` +
              `dichiarare completa una cancellazione parziale`,
          );
        }
        budget.left -= 1;
        out.push(full);
      }
    }
    if (page.length < STORAGE_PAGE_LIMIT) break;
    offset += page.length;
  }
  return out;
}

async function deleteStorageObjects(
  admin: SupabaseClient,
  userId: string,
): Promise<{ removed: number; failed: string[] }> {
  // ── Perché non basta leggere le righe ────────────────────────────────
  // Ricavare i percorsi da `file_bridge_requests` non è sufficiente:
  // HQ-DOCS ha trovato un oggetto reale rimasto nel bucket senza più la
  // sua riga. Un caricamento interrotto, una riga ripulita da un job, un
  // errore a metà — e il file resta lì mentre il database dice che non
  // esiste. Si enumera quindi il bucket, e le righe servono solo ad
  // aggiungere percorsi eventualmente fuori dal prefisso dell'utente.
  const paths = new Set<string>();

  const budget = { left: STORAGE_TOTAL_LIMIT };
  for (const p of await listRecursive(admin, userId, budget)) paths.add(p);

  const { data: rows, error } = await admin
    .from("file_bridge_requests")
    .select("storage_path")
    .eq("user_id", userId);
  if (error) {
    throw new Error(
      `impossibile leggere i file da cancellare: ${error.message}`,
    );
  }
  // ── I percorsi delle righe NON sono affidabili ──────────────────────
  // `file_bridge_requests` accetta INSERT da qualunque utente autenticato
  // con il solo controllo `auth.uid() = user_id` (migrazione 037): il
  // campo `storage_path` non è verificato. Un utente può quindi inserire
  // una propria riga che punta al file di un altro, e questa funzione gira
  // con service_role, che bypassa RLS — cancellando il proprio account
  // farebbe sparire un file altrui.
  //
  // Quindi si accettano solo i percorsi dentro il namespace dell'utente.
  // Un percorso fuori non viene rimosso: se ne esistessero di storici, si
  // preferisce lasciarli e dirlo, piuttosto che aprire una cancellazione
  // fra utenti. Segnalato da HQ-BACKEND.
  const namespace = `${userId}/`;
  const outsideNamespace: string[] = [];
  for (const row of rows ?? []) {
    const p = (row as { storage_path: string | null }).storage_path;
    if (typeof p !== "string" || p.length === 0) continue;
    if (p.startsWith(namespace)) {
      paths.add(p);
    } else {
      outsideNamespace.push(p);
    }
  }
  if (outsideNamespace.length > 0) {
    console.warn(
      "[account-deletion] percorsi fuori dal namespace ignorati:",
      outsideNamespace.length,
    );
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
