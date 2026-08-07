/**
 * Censimento delle tabelle utente, con una fonte INDIPENDENTE.
 *
 * Il test che avevo scritto prima confrontava `USER_DATA_TABLES` con
 * `EXPORT_COLUMNS`, cioè due elenchi scritti a mano nello stesso momento
 * dalla stessa persona. Quando ne ho dimenticati due — `candidate_skills`
 * e `sentinel_ticks` — coincidevano perfettamente nel dimenticarli, e il
 * test è rimasto verde. Un censimento che guarda solo sé stesso tace
 * proprio nel caso che dovrebbe cogliere.
 *
 * Qui la verità arriva dalle MIGRATION: si leggono i `create table` e si
 * tiene quelli che hanno una colonna `user_id`. È fail-closed — se domani
 * nasce una tabella con dati dell'utente e nessuno la aggiunge agli
 * elenchi, questo test diventa rosso da solo.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CASCADE_TABLES,
  MANUAL_DELETE_ORDER,
  USER_DATA_TABLES,
} from "@/lib/account-data-tables";
import { EXPORT_COLUMNS } from "@/lib/account-export-columns";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "../../../supabase/migrations");

/** Tabelle con una colonna `user_id`, ricavate dai `create table` delle
 *  migration. Non tocca il database: legge il repository. */
function tablesWithUserIdFromMigrations(): Set<string> {
  const found = new Set<string>();
  for (const file of fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    const re =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_]+)"?\s*\(([\s\S]*?)\n\)\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      if (/\buser_id\b/i.test(m[2])) found.add(m[1]);
    }
  }
  return found;
}

describe("censimento tabelle utente — fonte indipendente", () => {
  const fromSchema = tablesWithUserIdFromMigrations();

  it("le migration dichiarano almeno trenta tabelle con user_id", () => {
    // Se il parser smettesse di funzionare — sintassi nuova, formattazione
    // diversa — troverebbe zero tabelle e ogni altro controllo passerebbe
    // a vuoto. Questa soglia fa fallire il test invece di renderlo inerte.
    expect(fromSchema.size).toBeGreaterThanOrEqual(30);
  });

  it("nessuna tabella con user_id manca da USER_DATA_TABLES", () => {
    const declared = new Set<string>(USER_DATA_TABLES);
    const missing = [...fromSchema].filter((t) => !declared.has(t)).sort();
    // È il controllo che avrebbe preso `candidate_skills` e
    // `sentinel_ticks` la prima volta.
    expect(missing).toEqual([]);
  });

  it("nessuna tabella dichiarata è sconosciuta allo schema", () => {
    // L'altro verso: una tabella rinominata o rimossa resterebbe negli
    // elenchi e produrrebbe query verso qualcosa che non esiste.
    const unknown = [...USER_DATA_TABLES].filter((t) => !fromSchema.has(t));
    expect(unknown).toEqual([]);
  });

  it("ogni tabella dichiarata ha la sua allowlist di export", () => {
    const missing = [...USER_DATA_TABLES].filter((t) => !EXPORT_COLUMNS[t]);
    expect(missing).toEqual([]);
  });

  it("nessuna allowlist descrive una tabella che non esportiamo", () => {
    // `sentinel_ticks` aveva l'allowlist ma nessuno la iterava: colonne
    // dichiarate e mai usate sono un pezzo di lavoro che sembra fatto.
    const declared = new Set<string>(USER_DATA_TABLES);
    const orphans = Object.keys(EXPORT_COLUMNS).filter((t) => !declared.has(t));
    expect(orphans).toEqual([]);
  });

  it("le due metà non si sovrappongono e coprono il totale", () => {
    const manual = new Set<string>(MANUAL_DELETE_ORDER);
    const overlap = [...CASCADE_TABLES].filter((t) => manual.has(t));
    expect(
      overlap,
      "una tabella sia a cascata sia da cancellare a mano",
    ).toEqual([]);
    expect(USER_DATA_TABLES.length).toBe(
      MANUAL_DELETE_ORDER.length + CASCADE_TABLES.length,
    );
  });
});
