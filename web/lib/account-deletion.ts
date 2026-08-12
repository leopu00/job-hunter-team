// Cancellazione dell'account e di tutti i dati cloud dell'utente.
//
// ⚠️ IRREVERSIBILE. Le protezioni non sono decorative, sono la ragione per
// cui questo file esiste separato dalla route.
//
// ── Perché una RPC, non una sequenza dal server web ───────────────────
// Sei tabelle referenziano `auth.users` con `NO ACTION`, non `CASCADE`, e
// vanno quindi svuotate prima della riga Auth:
//
//   applications · candidate_profiles · companies · position_highlights
//   positions · scores
//
// Farlo con sei REST delete seguite da `auth.admin.deleteUser` non è una
// transazione: un errore al quarto passo lascia i primi tre già committati.
// La migration 074 espone una sola RPC SECURITY DEFINER, riservata al
// service_role, che prende il lock dell'utente e fa tutte le delete dentro la
// transazione PostgreSQL della chiamata. Un errore restituisce zero modifiche
// al database, non una cancellazione parziale.
//
// ── L'ordine, e da dove viene ─────────────────────────────────────────
// Dipendenze interne verificate sullo stesso catalogo:
//
//   companies ← positions ← { applications, position_highlights, scores }
//
// quindi la funzione va dai figli ai padri. Le FK composite della stessa
// migration rendono strutturalmente impossibile che una riga di un altro
// tenant dipenda da quelle che la RPC sta rimuovendo.

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

/**
 * Errore di cancellazione con un codice stabile.
 *
 * Il messaggio libero non basta e non è sicuro: quello di Supabase può
 * riportare frammenti del dato che ha fatto fallire il vincolo, e i
 * percorsi dei file sono nomi scelti dall'utente. La route propaga il
 * `code` e lo `stage`, mai il testo grezzo — né al client né nei log.
 */
export class DeletionError extends Error {
  constructor(
    readonly code: string,
    readonly stage: string,
    readonly count?: number,
  ) {
    super(`${code} @ ${stage}${count === undefined ? "" : ` (${count})`}`);
    this.name = "DeletionError";
  }
}

export interface DeletionOutcome {
  /** Righe rimosse per tabella. Serve al record tecnico e ai test. */
  removed: Record<string, number>;
  /** Tabelle svuotate a mano, in ordine. */
  order: readonly string[];
}

type DatabaseDeletionPayload = {
  removed?: unknown;
};

function parseDatabaseDeletion(data: unknown): Record<string, number> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DeletionError("database_delete_invalid_response", "database");
  }
  const removed = (data as DatabaseDeletionPayload).removed;
  if (!removed || typeof removed !== "object" || Array.isArray(removed)) {
    throw new DeletionError("database_delete_invalid_response", "database");
  }
  const counts = removed as Record<string, unknown>;
  if (
    Object.keys(counts).length !== MANUAL_DELETE_ORDER.length ||
    MANUAL_DELETE_ORDER.some(
      (table) =>
        !Number.isSafeInteger(counts[table]) || (counts[table] as number) < 0,
    )
  ) {
    throw new DeletionError("database_delete_invalid_response", "database");
  }
  return Object.fromEntries(
    MANUAL_DELETE_ORDER.map((table) => [table, counts[table] as number]),
  );
}

/**
 * Cancella file, righe PostgreSQL e utente Auth senza successi ottimistici.
 *
 * `userId` arriva SEMPRE dalla sessione del chiamante, mai dal corpo della
 * richiesta: è così che si rende impossibile cancellare l'account di
 * qualcun altro, invece di provare a validarlo dopo.
 */
export async function deleteAccountData(
  admin: SupabaseClient,
  userId: string,
): Promise<DeletionOutcome> {
  // Anche questo come codice stabile: così la route non ha mai un ramo
  // in cui deve indovinare cosa è successo.
  if (!userId) throw new DeletionError("missing_user_id", "input");

  // ── Prima i file, poi le righe ──────────────────────────────────────
  // Gli oggetti nel bucket `file-transit` non cadono per cascata: senza
  // questo passo sopravvivrebbero alla cancellazione. E non ci si può
  // appoggiare a un purge automatico — nel bucket è stato trovato un
  // oggetto rimasto per otto giorni.
  //
  // I percorsi si leggono dal BUCKET, non dalle righe: vedi
  // `deleteStorageObjects` per il perché.
  const storage = await deleteStorageObjects(admin, userId);
  if (storage.failed.length > 0) {
    // Un file che resta è una cancellazione incompleta, e va detto invece
    // di dichiarare completato: l'operatore ha scelto la cancellazione
    // immediata proprio perché fosse vera.
    // Nessun percorso nel messaggio, nemmeno a campione.
    //
    // Una versione precedente ne includeva cinque «per capire dove
    // guardare», subito sotto un commento che diceva che i nomi dei file
    // sono dati dell'utente: commento e codice si contraddicevano nello
    // stesso blocco. E l'errore finisce nei log del server e nel corpo
    // della risposta, quindi cinque nomi di CV erano cinque nomi di CV
    // usciti da una funzione il cui scopo è cancellarli.
    //
    // Per diagnosticare bastano il codice, la fase e il numero: il bucket
    // si ispeziona a parte, con i permessi giusti.
    throw new DeletionError(
      "storage_incomplete",
      STORAGE_BUCKET,
      storage.failed.length,
    );
  }

  // Una sola chiamata = una sola transazione PostgreSQL privilegiata. Non
  // esiste fallback alla vecchia sequenza REST: se la RPC manca o fallisce,
  // fermarsi è l'unico comportamento che non dichiara cancellati dati rimasti.
  const { data, error } = await admin.rpc("delete_account_data", {
    p_user_id: userId,
  });
  if (error) {
    // Niente `error.message`: Postgres può includere il valore che ha fatto
    // fallire un vincolo o un trigger.
    throw new DeletionError("database_delete_failed", "database");
  }
  const databaseRemoved = parseDatabaseDeletion(data);

  return {
    removed: {
      "storage:file-transit": storage.removed,
      ...databaseRemoved,
    },
    order: MANUAL_DELETE_ORDER,
  };
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
    // Nemmeno il prefisso: contiene l'id utente ed è comunque un percorso.
    throw new DeletionError("storage_too_many", STORAGE_BUCKET);
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
      throw new DeletionError("storage_list_failed", STORAGE_BUCKET);
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
          // Niente `prefix` nel messaggio: contiene l'id utente e i nomi
          // delle cartelle, che sono nomi scelti dall'utente. Era l'ultimo
          // throw rimasto col dato dentro — aggiunto con la paginazione e
          // sfuggito alla conversione a codici stabili.
          throw new DeletionError("storage_too_many", STORAGE_BUCKET);
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
  // In security: pre-migration rows accepted INSERT with only
  // `auth.uid() = user_id`, so `storage_path` was untrusted input while this
  // function runs with service_role. The current schema generates the path,
  // but historical rows still must never become an object census.
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
