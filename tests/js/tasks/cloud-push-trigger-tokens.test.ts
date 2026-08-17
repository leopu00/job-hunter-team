/**
 * O-97 — le due meta' di un contratto che non ha un tipo che lo tenga.
 *
 * I trigger del cloud rifiutano una scrittura con `RAISE EXCEPTION '<token>'`.
 * Senza SQLSTATE dedicato PostgreSQL classifica quell'eccezione come `P0001` e
 * PostgREST la rende un 500 opaco: il client non puo' sapere se ha davanti un
 * guasto del server o il rifiuto di UNA riga. La route lo distingue tenendo un
 * elenco di quei token (`ROW_P0001_MESSAGES`), e solo per quelli dichiara
 * `rejection_scope: 'row'` — che e' cio' che permette al push di isolare la
 * riga invece di fermare il convoglio.
 *
 * Il contratto sta quindi in due file che nessun compilatore mette in
 * relazione: la stringa nel trigger e la stringa nella route. `P0001` non e'
 * un codice nostro, non ci sono tipi, e il giorno che qualcuno riscrive il
 * messaggio del trigger il client smette di capire **senza che niente diventi
 * rosso**. Questo test e' quel rosso.
 *
 * Come si e' visto che serviva: `stale_application_downgrade` era nell'elenco
 * e `stale_position_downgrade` no. Il push di una VPS con una fotografia
 * vecchia prendeva un 500, nessuna riga finiva in quarantena, il cursore non
 * avanzava e la macchina rispediva lo stesso chunk a ogni tick.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const routePath = join(root, "web/app/api/cloud-sync/push/route.ts");
const migrationsDir = join(root, "supabase/migrations");

/** I token che la route riconosce come «rifiuto di una riga». */
function routeTokens(): string[] {
  const source = readFileSync(routePath, "utf8");
  const block = source.slice(
    source.indexOf("const ROW_P0001_MESSAGES = new Set(["),
  );
  const body = block.slice(0, block.indexOf("]);"));
  return [...body.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
}

/** I token che i trigger alzano davvero, letti dalle migrazioni. */
function migrationTokens(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const name of readdirSync(migrationsDir).filter((f) =>
    f.endsWith(".sql"),
  )) {
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    for (const match of sql.matchAll(/RAISE EXCEPTION '([a-z0-9_]+)'/g)) {
      const token = match[1];
      found.set(token, [...(found.get(token) ?? []), name]);
    }
  }
  return found;
}

describe("O-97 — i token P0001 che la route riconosce esistono nei trigger", () => {
  it("ogni token dell'elenco e' alzato da almeno una migrazione", () => {
    const alzati = migrationTokens();
    const orfani = routeTokens().filter((token) => !alzati.has(token));

    // Un token che nessun trigger alza piu' e' una riga che non protegge
    // niente: o il trigger e' stato riscritto (e il client ora e' cieco su
    // quel rifiuto) o la voce e' un residuo.
    expect(orfani).toEqual([]);
  });

  it("il rifiuto del downgrade di una posizione e' fra quelli riconosciuti", () => {
    /**
     * Il caso che ha fermato il push per giorni. Non e' coperto dal test qui
     * sopra: quello vieta i token che NON esistono, questo pretende che questo
     * token specifico ci sia — cioe' che il rifiuto piu' comune del cloud
     * resti isolabile riga per riga.
     */
    const alzati = migrationTokens();

    expect(alzati.has("stale_position_downgrade")).toBe(true);
    expect(routeTokens()).toContain("stale_position_downgrade");
  });
});
