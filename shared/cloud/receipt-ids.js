/**
 * L'identità di una riga nel push verso il cloud — UNA derivazione, due lati.
 *
 * La ricevuta è il modo in cui il server dice al client *quali* righe ha
 * accettato: il client manda un id per riga, il server rimanda gli id delle
 * righe che ha davvero scritto, e se i due insiemi non coincidono il push si
 * ferma (`acknowledgement_mismatch`). È un buon protocollo, e fermarsi è il
 * comportamento giusto.
 *
 * ⚠️ Questo file esiste perché le due parti derivavano l'identità
 * INDIPENDENTEMENTE — stesso algoritmo, due implementazioni — e sono
 * divergute in silenzio (#163): il client la costruiva dalla riga letta da
 * SQLite, il server da come gliela rendeva PostgREST dopo la scrittura.
 * `position_transitions` porta una data nella chiave, SQLite la scrive
 * `2026-08-16 18:24:28` e il cloud la rende `2026-08-16T18:24:28+00:00`, e due
 * stringhe diverse hanno due hash diversi: 271 transizioni ferme, su due
 * macchine, per sempre.
 *
 * 📌 La regola che ne esce, e che questo modulo rende l'unica praticabile:
 * **l'identità si deriva dalla riga che il client ha MANDATO**, mai da come
 * un driver la rende al ritorno. Il ritorno serve a un'altra cosa — provare
 * che la riga è sul cloud — e quella prova resta un confronto sui valori.
 *
 * Il modulo è ESM senza dipendenze, così lo importano sia la CLI Node sia le
 * route Next (stesso trattamento di `shared/release/version.js`).
 */
import { createHash } from "node:crypto";

/** Le tabelle che viaggiano con una ricevuta per riga. */
export const RECEIPT_TABLES = Object.freeze([
  "companies",
  "positions",
  "scores",
  "applications",
  "position_highlights",
  "position_transitions",
  "tombstones",
  "pending_user_messages",
  "profile",
]);

const TABLE_SET = new Set(RECEIPT_TABLES);

/**
 * Errore di identità: la riga non ha una chiave utilizzabile.
 *
 * Non è un caso limite da assorbire con un `?? 0`: una chiave assente o di
 * tipo sbagliato vuol dire che non sappiamo *di quale riga* stiamo parlando,
 * e una ricevuta su una riga sbagliata è peggio di nessuna ricevuta.
 */
export class ReceiptKeyInvalid extends Error {}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ReceiptKeyInvalid(`invalid cloud push source identity: ${label}`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReceiptKeyInvalid(`invalid cloud push source identity: ${label}`);
  }
  return value;
}

/**
 * La chiave sorgente di una riga, dalla riga COME VIAGGIA SUL FILO.
 *
 * I nomi dei campi sono quelli del payload del push, che è l'unica forma che
 * le due parti vedono uguale: il client la costruisce, il server la riceve.
 * Le righe che tornano dal database NON si passano di qui — hanno altri nomi
 * e altre rese, ed è esattamente da lì che è nato #163.
 */
export function receiptKey(table, row) {
  switch (table) {
    case "companies":
    case "positions":
    case "position_highlights":
    case "pending_user_messages":
      return [positiveInteger(row?.id, `${table}.id`)];
    case "scores":
    case "applications":
      return [positiveInteger(row?.legacy_id, `${table}.legacy_id`)];
    case "position_transitions":
      return [
        positiveInteger(
          row?.position_legacy_id,
          "position_transitions.position_legacy_id",
        ),
        nonEmptyString(row?.ts, "position_transitions.ts"),
        nonEmptyString(row?.by_agent, "position_transitions.by_agent"),
        nonEmptyString(row?.to_state, "position_transitions.to_state"),
      ];
    case "tombstones":
      return [
        nonEmptyString(row?.table_name, "tombstones.table_name"),
        positiveInteger(row?.legacy_id, "tombstones.legacy_id"),
        nonEmptyString(row?.deleted_at, "tombstones.deleted_at"),
      ];
    case "profile":
      return ["candidate_profile"];
    default:
      throw new ReceiptKeyInvalid(`unsupported receipt table: ${table}`);
  }
}

/** L'id opaco di una chiave già estratta. Stessa forma su entrambi i lati. */
export function receiptIdForKey(table, key) {
  if (!TABLE_SET.has(table)) {
    throw new ReceiptKeyInvalid(`unsupported receipt table: ${table}`);
  }
  const parts = Array.isArray(key) ? key : [key];
  return `q_${createHash("sha256")
    .update(`${table}\0${JSON.stringify(parts)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

/**
 * L'id opaco di una riga del payload.
 *
 * Opaco di proposito: sta nei file di quarantena e nei bundle di supporto, e
 * non deve esporre una chiave primaria locale.
 */
export function receiptId(table, row) {
  return receiptIdForKey(table, receiptKey(table, row));
}
