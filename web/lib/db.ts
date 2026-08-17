// Porta di sola LETTURA sul jobs.db del box. Il database lo crea e lo migra il
// container (`shared/skills/_db.py`, oggi `PRAGMA user_version = 7`): qui non
// vive alcuno schema, e non deve tornarci.
//
// Fino a #157 il modulo esportava anche `initDb()` — apertura in scrittura piu'
// ~180 righe di DDL — senza un solo chiamante in tutto il repo. Il costo non era
// il codice morto: quello schema era fermo alla versione 5 e, se qualcuno lo
// avesse eseguito su un jobs.db vero, avrebbe timbrato la 5 su un database che
// non l'ha mai visto. Nessun test lo copriva, quindi la distanza dalla sorgente
// di verita' non aveva modo di farsi notare.
//
// Il guard vive in tests/js/tasks/web-schema-authority.test.ts.
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import { isCloudDeploy } from "@/lib/deploy-mode";

declare const globalThis: {
  __jht_db_cache?: {
    path: string;
    sourceMtimeMs: number;
    db: Database.Database;
  };
};

// Docker Desktop bind-mount workaround (Windows): quando il container Linux
// scrive su /jht_home/jobs.db e l'host Windows legge lo stesso file via
// virtiofs/9P, better-sqlite3 ottiene SQLITE_IOERR_SHORT_READ durante pread()
// concorrenti alle scritture, restituendo snapshot stantii (es. "25 posizioni"
// invece di 36). Copiamo jobs.db + WAL + SHM su path Windows nativo prima di
// aprirli: la lettura cross-FS avviene una sola volta tramite fs.copyFileSync
// (che fa un read() pieno, non pread), poi SQLite legge da NTFS senza
// ambiguita'.
function resolveReadablePath(): { dbPath: string; sourceMtimeMs: number } {
  const srcStat = fs.statSync(JHT_DB_PATH);
  if (process.platform !== "win32") {
    return { dbPath: JHT_DB_PATH, sourceMtimeMs: srcStat.mtimeMs };
  }
  const cacheDir = path.join(os.tmpdir(), "jht-web-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const dbPath = path.join(cacheDir, "jobs.db");
  const walPath = dbPath + "-wal";
  const shmPath = dbPath + "-shm";

  let needsCopy = true;
  try {
    const dstStat = fs.statSync(dbPath);
    if (dstStat.mtimeMs >= srcStat.mtimeMs && dstStat.size === srcStat.size)
      needsCopy = false;
  } catch {
    /* missing */
  }

  if (needsCopy) {
    fs.copyFileSync(JHT_DB_PATH, dbPath);
    // WAL/SHM possono non esistere (DB checkpointato a fondo); copiarli
    // se presenti assicura che SQLite veda anche i commit post-checkpoint.
    // Se spariti dopo la checkpoint nel container, rimuoviamo i vecchi
    // nella cache per evitare di leggere WAL scollegata dal main DB.
    for (const [src, dst] of [
      [JHT_DB_PATH + "-wal", walPath],
      [JHT_DB_PATH + "-shm", shmPath],
    ]) {
      try {
        if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        else if (fs.existsSync(dst)) fs.unlinkSync(dst);
      } catch {
        /* best effort */
      }
    }
  }
  return { dbPath, sourceMtimeMs: srcStat.mtimeMs };
}

export function getDb(_workspacePath?: string): Database.Database {
  // Un deploy cloud non legge MAI SQLite: la source of truth e' Supabase.
  // Oggi tutti i chiamanti passano da `workspaceHasDb()`/`localWorkspace()`,
  // gia' cloud-guarded — ma quel guard vive nei chiamanti, e i chiamanti si
  // aggiungono. Se un domani uno se lo dimentica e sull'istanza esiste un
  // jobs.db qualsiasi (bind mount di sviluppo, immagine costruita male,
  // residuo effimero), qui si aprirebbe quel file e si servirebbero dati
  // stantii CREDENDOLI quelli dell'utente: nessun errore, solo numeri
  // sbagliati. L'ultima porta la chiude questo throw, che e' rumoroso.
  if (isCloudDeploy()) {
    throw new Error("SQLite non disponibile: deploy cloud (fonte = Supabase)");
  }
  if (!fs.existsSync(JHT_DB_PATH)) {
    throw new Error(`Database non trovato: ${JHT_DB_PATH}`);
  }
  const { dbPath, sourceMtimeMs } = resolveReadablePath();

  const cached = globalThis.__jht_db_cache;
  if (
    cached?.path === dbPath &&
    cached?.sourceMtimeMs === sourceMtimeMs &&
    cached?.db?.open
  ) {
    return cached.db;
  }
  if (cached?.db?.open) {
    try {
      cached.db.close();
    } catch {
      /* ignore */
    }
  }

  const db = new Database(dbPath, { readonly: true });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  globalThis.__jht_db_cache = { path: dbPath, sourceMtimeMs, db };
  return db;
}
