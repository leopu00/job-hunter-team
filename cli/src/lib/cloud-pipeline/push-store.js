import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { JHT_HOME } from '../../jht-paths.js';
import { writePrivateJson } from '../secure-config-io.js';

// Cursor delta-sync: per ogni tabella memorizziamo l'ultimo updated_at
// pushato. Al tick successivo selezioniamo solo righe con updated_at >
// cursor. Crollo bandwidth ~95% (vedi docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md).
export const CLOUD_CURSOR_FILE = join(JHT_HOME, '.cloud-sync-cursor.json');
export function readSqliteTable(db, table, columns) {
  try {
    return db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
  } catch (err) {
    if (/no such table/i.test(err.message)) return [];
    throw err;
  }
}

// Vero se la tabella SQLite locale ha la colonna richiesta. Serve per
// includere nel push solo colonne che lo schema locale possiede davvero
// (es. logo_* della feature loghi): un jobs.db piu' vecchio del codice non
// deve far fallire il tick di sync.
export function sqliteHasColumn(db, table, col) {
  try {
    return db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((r) => r.name === col);
  } catch {
    return false;
  }
}

/**
 * Legge una tabella SQLite filtrando per updated_at > cursor.
 * Se cursor e' null/undefined ritorna tutte le righe (first push o cursor
 * cancellato). Include updated_at nelle colonne selezionate (serve per
 * calcolare il nuovo cursor lato chiamante).
 *
 * Robust: se la tabella non esiste o non ha la colonna updated_at,
 * ricade su full SELECT (compatibile con schema vecchi / tabelle senza
 * timestamp di mutazione).
 */
export function readSqliteTableDelta(db, table, columns, cursor) {
  const cols = columns.includes('updated_at') ? columns : [...columns, 'updated_at'];
  try {
    if (cursor) {
      return db.prepare(
        `SELECT ${cols.join(', ')} FROM ${table} WHERE updated_at > ?`
      ).all(cursor);
    }
    return db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
  } catch (err) {
    if (/no such table/i.test(err.message)) return [];
    if (/no such column/i.test(err.message)) {
      // schema legacy senza updated_at: fallback a full read
      return readSqliteTable(db, table, columns);
    }
    throw err;
  }
}

/**
 * Carica il cursor di sync. Le tabelle usano l'ISO dell'ultimo updated_at;
 * `profile_hash` è invece il fingerprint raw dell'ultimo snapshot confermato.
 * Missing keys = first push (legge tutto).
 */
export function loadCloudCursor() {
  if (!existsSync(CLOUD_CURSOR_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CLOUD_CURSOR_FILE, 'utf-8'));
  } catch {
    // corrotto: meglio ripartire da zero (full push) che fallire
    return {};
  }
}

/**
 * Salva il cursor di sync. Scritto solo dopo push API HTTP 200. Su
 * errore di scrittura logghiamo ma non blocchiamo il daemon: al prossimo
 * tick verra' rifatto il delta (al massimo ri-pusha righe gia' upsertate,
 * idempotente lato server).
 */
export async function saveCloudCursor(cursor) {
  try {
    writePrivateJson(CLOUD_CURSOR_FILE, cursor);
    return true;
  } catch (err) {
    console.error(pc.yellow(`  warn: cursor save failed (${err.message})`));
    return false;
  }
}

/** Cursor over rows whose outcome is durable (ACK or persisted quarantine). */
export function settledCursor(rows, field) {
  let max = null;
  for (const r of rows) {
    const v = r?.[field];
    if (!v) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}
