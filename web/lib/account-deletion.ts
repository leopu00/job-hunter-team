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

/** Quanti percorsi si passano a `remove` per chiamata. È il massimo che
 *  Supabase accetta: oltre, la chiamata viene rifiutata. */
const STORAGE_REMOVE_BATCH = 1000;

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

  // ── Prima i file, poi le righe ──────────────────────────────────────
  // Gli oggetti nel bucket `file-transit` non cadono per cascata: senza
  // questo passo sopravvivrebbero alla cancellazione. E non ci si può
  // appoggiare a un purge automatico — nel bucket è stato trovato un
  // oggetto rimasto per otto giorni.
  //
  // I percorsi si leggono dal BUCKET, non dalle righe: vedi
  // `deleteStorageObjects` per il perché.
  const storage = await deleteStorageObjects(admin, userId);
  removed["storage:file-transit"] = storage.removed;
  if (storage.failed.length > 0) {
    // Un file che resta è una cancellazione incompleta, e va detto invece
    // di dichiarare completato: l'operatore ha scelto la cancellazione
    // immediata proprio perché fosse vera.
    // Nessun percorso nel messaggio, nemmeno a campione.
    //
    // La versione precedente ne includeva cinque «per capire dove
    // guardare», subito sotto un commento che diceva che i nomi dei file
    // sono dati dell'utente: il commento e il codice si contraddicevano
    // nello stesso blocco. E quell'errore finisce nei log del server e
    // nel corpo della risposta al client, quindi cinque nomi di CV sono
    // cinque nomi di CV usciti da una funzione il cui scopo è cancellarli.
    //
    // Per diagnosticare bastano il numero e la fase: il bucket si può
    // sempre ispezionare a parte, con i permessi giusti. Rilievo di
    // HQ-DOCS.
    throw new Error(
      `${storage.failed.length} file non cancellati nel bucket ` +
        `${STORAGE_BUCKET}: la cancellazione si ferma qui per non ` +
        `dichiararsi completa`,
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
  // ── L'unica fonte è il bucket ────────────────────────────────────────
  // Le righe di `file_bridge_requests` NON servono a trovare i file, e
  // usarle faceva danno in due modi opposti.
  //
  // In sicurezza: la migrazione 037 accetta INSERT con il solo controllo
  // `auth.uid() = user_id`, quindi `storage_path` è input non verificato,
  // e questa funzione gira con service_role che bypassa RLS.
  //
  // In disponibilità, ed è il caso che ha rotto davvero: il purge
  // ordinario rimuove l'oggetto ma CONSERVA la riga, marcandola
  // `expired` col percorso ancora dentro. Alla cancellazione dell'account
  // quel percorso fossile veniva rimesso nella `remove`; Supabase risponde
  // elencando solo i file davvero cancellati, quindi non compariva, e il
  // confronto lo dichiarava non rimosso — bloccando per sempre la
  // cancellazione dell'account dopo un purge riuscito. Trovato da
  // HQ-BACKEND.
  //
  // Le righe cadono comunque per cascata insieme all'utente: non c'è
  // niente da recuperare da lì.
  const budget = { left: STORAGE_TOTAL_LIMIT };
  const paths = await listRecursive(admin, userId, budget);
  if (paths.length === 0) return { removed: 0, failed: [] };

  // ── `remove` accetta al massimo 1000 percorsi per chiamata ──────────
  // Il limite è di Supabase. La versione precedente ne passava fino a
  // 5000 in una sola chiamata, e il test da 2500 la dava per buona solo
  // perché il doppio non rifiutava i lotti troppo grandi: l'ennesimo caso
  // di un finto client che conferma l'assunzione invece di controllarla.
  // Segnalato da HQ-DOCS con la fonte, confermato da HQ-BACKEND.
  //
  // Al primo errore ci si ferma senza lanciare i lotti successivi: se il
  // bucket sta rifiutando, insistere allarga il danno invece di ridurlo.
  for (let i = 0; i < paths.length; i += STORAGE_REMOVE_BATCH) {
    const batch = paths.slice(i, i + STORAGE_REMOVE_BATCH);
    const { error: rmError } = await admin.storage
      .from(STORAGE_BUCKET)
      .remove(batch);
    if (rmError) {
      // Ciò che è stato cancellato prima resta cancellato: la
      // rienumerazione qui sotto dirà con precisione cosa è rimasto.
      break;
    }
  }

  // La prova non è la risposta di `remove` ma il bucket stesso: si
  // rienumera e ciò che resta è ciò che non è stato cancellato. Evita
  // anche il confronto per basename della versione precedente, ambiguo
  // quando lo stesso nome esiste in cartelle diverse.
  const leftover = await listRecursive(admin, userId, {
    left: STORAGE_TOTAL_LIMIT,
  });
  return { removed: paths.length - leftover.length, failed: leftover };
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
