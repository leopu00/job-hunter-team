/**
 * O-97 — le due metà di un contratto che nessun compilatore mette in relazione.
 *
 * I trigger del cloud rifiutano una scrittura con `RAISE EXCEPTION '<token>'`.
 * Senza SQLSTATE dedicato PostgreSQL classifica quell'eccezione come `P0001` e
 * PostgREST la rende un 500 opaco: il client non può sapere se ha davanti un
 * guasto del server o il rifiuto di UNA riga. La route lo distingue tenendo
 * l'elenco di quei token (`ROW_P0001_MESSAGES`), e solo per quelli dichiara
 * `rejection_scope: 'row'` — che è ciò che permette al push di isolare la riga
 * invece di fermare il convoglio.
 *
 * La stringa nel trigger e la stringa nella route sono due file senza un tipo
 * in mezzo: il giorno che una delle due si muove, il client torna cieco **senza
 * che niente diventi rosso**. Questo test è quel rosso, e guarda in tutti e due
 * i versi:
 *
 * - un token nell'elenco che nessun trigger vivo alza è una riga che non
 *   protegge più niente;
 * - un rifiuto di riga alzato da un trigger e **assente** dall'elenco è O-97
 *   che ricomincia da capo su un'altra tabella: 500 opaco, nessuna isolata,
 *   push fermo a ogni tick.
 *
 * ⚠️ Le migrazioni sono storia congelata, non lo stato del database. La 072
 * definisce entrambe queste funzioni e nessuna delle due è quella viva: la
 * positions è ridefinita dalla 081, la applications dalla 076. Leggere l'intera
 * cartella farebbe rispondere «c'è» a un token che nessuno alza più — cioè
 * lascerebbe verde esattamente il caso per cui il test esiste. Vale solo
 * l'ULTIMA definizione di ogni funzione.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const routePath = join(root, "web/app/api/cloud-sync/push/route.ts");
const migrationsDir = join(root, "supabase/migrations");

/** La famiglia di rifiuti che il client deve poter isolare riga per riga. */
const ROW_REFUSAL_FAMILY = /^stale_[a-z0-9_]+_downgrade$/;

const FUNCTION_HEADER =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;

interface LiveFunction {
  migration: string;
  body: string;
}

/**
 * Il corpo VIVO di ogni funzione: quello dell'ultima migrazione che la
 * ridefinisce. Le migrazioni si applicano in ordine di numero, quindi l'ultima
 * vince — e tutto ciò che sta nelle precedenti è archeologia.
 */
function liveFunctions(): Map<string, LiveFunction> {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  if (files.length === 0) {
    throw new Error(`nessuna migrazione letta da ${migrationsDir}`);
  }
  const live = new Map<string, LiveFunction>();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const header of sql.matchAll(FUNCTION_HEADER)) {
      const name = header[1];
      // Il corpo è delimitato da `$$ … $$`: prendiamo dalla prima apertura
      // dopo l'intestazione alla chiusura successiva.
      const open = sql.indexOf("$$", header.index! + header[0].length);
      if (open === -1) continue;
      const close = sql.indexOf("$$", open + 2);
      const body = sql.slice(open + 2, close === -1 ? sql.length : close);
      // I file sono ordinati per numero, quindi l'ultimo che passa di qui è
      // quello che vince.
      live.set(name, { migration: file, body });
    }
  }
  return live;
}

/** Token → funzioni vive che lo alzano. */
function liveRefusalTokens(): Map<string, string[]> {
  const tokens = new Map<string, string[]>();
  for (const [name, fn] of liveFunctions()) {
    for (const raise of fn.body.matchAll(/RAISE EXCEPTION '([a-z0-9_]+)'/g)) {
      const token = raise[1];
      tokens.set(token, [...(tokens.get(token) ?? []), name]);
    }
  }
  return tokens;
}

/**
 * I token che la route riconosce come «rifiuto di una riga».
 *
 * ⚠️ Se l'estrazione non trova niente si ROMPE, non restituisce un elenco
 * vuoto: un confronto contro il vuoto passa sempre, e un test che passa senza
 * aver guardato niente è peggio di un test assente — sembra copertura. Il
 * blocco può essere rinominato o riformattato, e in quel caso questo test deve
 * chiedere di essere aggiornato invece di dire di sì.
 */
function routeTokens(): string[] {
  const source = readFileSync(routePath, "utf8");
  const anchor = "const ROW_P0001_MESSAGES = new Set([";
  const at = source.indexOf(anchor);
  if (at === -1) {
    throw new Error(
      `ancora non trovata in ${routePath}: ROW_P0001_MESSAGES è stata rinominata o spostata`,
    );
  }
  const body = source.slice(at + anchor.length);
  const tokens = [
    ...body.slice(0, body.indexOf("]);")).matchAll(/"([a-z0-9_]+)"/g),
  ].map((match) => match[1]);
  if (tokens.length === 0) {
    throw new Error(
      "ROW_P0001_MESSAGES è vuota: nessun rifiuto sarebbe isolabile",
    );
  }
  return tokens;
}

describe("O-97 — i token P0001 stanno allineati fra trigger vivi e route", () => {
  it("legge le definizioni vive, non l'archeologia delle migrazioni", () => {
    // Se questa lettura si rompe, i due test sotto direbbero di sì guardando
    // il vuoto: la prima cosa da provare è che il parser veda davvero i
    // trigger, e che veda l'ULTIMA definizione.
    const funzioni = liveFunctions();

    expect(
      funzioni.get("reject_stale_applied_position_downgrade")?.migration,
    ).toBe("081_live_schema_reconciliation.sql");
    // Il gemello non sta in un trigger ma nella RPC che scrive le
    // candidature, ed e' anch'esso ridefinito dopo la 072.
    expect(funzioni.get("sync_upsert_applications")?.migration).toBe(
      "076_application_sync_identity.sql",
    );
    expect(liveRefusalTokens().size).toBeGreaterThan(0);
  });

  it("ogni token dell'elenco è alzato da un trigger vivo", () => {
    const alzati = liveRefusalTokens();
    const orfani = routeTokens().filter((token) => !alzati.has(token));

    // Un token che nessun trigger vivo alza è o un residuo, o — peggio — un
    // trigger riscritto: in quel caso il client non riconosce più quel rifiuto
    // e nessuno se ne accorge, perché il push continua a fallire come sempre.
    expect(orfani).toEqual([]);
  });

  it("ogni rifiuto di riga alzato da un trigger vivo è nell'elenco", () => {
    /**
     * Il verso che morde davvero, ed è il prossimo caso identico a questo:
     * qualcuno aggiunge un trigger che rifiuta una riga e non aggiunge la voce.
     * Senza questo test lo si scopre come l'abbiamo scoperto stavolta — da un
     * push fermo da giorni e da un utente che non riceve più niente.
     */
    const elenco = new Set(routeTokens());
    const mancanti = [...liveRefusalTokens()]
      .filter(([token]) => ROW_REFUSAL_FAMILY.test(token))
      .filter(([token]) => !elenco.has(token))
      .map(([token, funzioni]) => `${token} (${funzioni.join(", ")})`);

    expect(mancanti).toEqual([]);
  });

  it("il rifiuto del downgrade di una posizione è fra quelli riconosciuti", () => {
    // Il caso che ha fermato il push per giorni, tenuto per nome: i test sopra
    // vietano il disallineamento, questo pretende che proprio questo rifiuto
    // resti isolabile.
    expect(liveRefusalTokens().has("stale_position_downgrade")).toBe(true);
    expect(routeTokens()).toContain("stale_position_downgrade");
  });
});
