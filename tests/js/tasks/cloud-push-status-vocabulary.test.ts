/**
 * #194 — le due metà di un vocabolario che nessun compilatore mette in relazione.
 *
 * Il box scrive `cloud_push_status` in JavaScript; ad ammetterlo o rifiutarlo è
 * un CHECK in SQL sul cloud (`team_state_cloud_push_status_valid`, migrazione
 * 073, ribadito dalla 081). Fra i due non c'è un tipo, e il disaccordo non
 * diventa rosso da nessuna parte: si manifesta a runtime, in produzione, come
 * un UPDATE rifiutato con 23514.
 *
 * E rifiutato per INTERO — quindi non avanza lo stato e nemmeno il suo istante.
 * Ciò che non arriva è proprio la notizia che qualcosa non va: la riga resta
 * viva e aggiornata, con dentro una fotografia vecchia, e nessuno ha modo di
 * accorgersene. È andata avanti sedici ore con `quarantined:N`, interpolato dal
 * box e mai stato nel CHECK.
 *
 * Questo test guarda in tutti e due i versi, ma il caso che conta è il terzo:
 * non confronta due elenchi scritti a mano, ESEGUE il ciclo e pretende che ogni
 * stato che il box sa produrre esca come un valore che il cloud accetta. È il
 * caso che sarebbe stato rosso il 13/08, il giorno che l'interpolazione è nata.
 *
 * La prova che il vincolo VERO accetta davvero quel valore sta dall'altra parte
 * del confine e non può stare qui: `tests/test_cloud_push_status_check_postgres.py`
 * lo scrive contro un PostgreSQL con il CHECK montato.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOUD_PUSH_STATUSES,
  nextPeriodicCheckState,
  nextPeriodicPushState,
  periodicPushObservation,
  periodicPushResultStatus,
} from "../../../cli/src/lib/periodic-push.js";

const root = resolve(__dirname, "../../..");
const migrationsDir = join(root, "supabase/migrations");
const CONSTRAINT = "team_state_cloud_push_status_valid";
const T0 = Date.UTC(2026, 7, 18, 6, 13, 20);

/**
 * I valori che il CHECK VIVO ammette: quelli dell'ultima migrazione che lo
 * definisce. Le migrazioni si applicano in ordine di numero, l'ultima vince, e
 * quello che sta nelle precedenti è archeologia.
 *
 * ⚠️ Se non trova niente si ROMPE invece di restituire un elenco vuoto: un
 * confronto contro il vuoto passa sempre, e un test che passa senza aver
 * guardato niente è peggio di un test assente, perché sembra copertura.
 */
function liveCheckVocabulary(): string[] {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const marker = `ADD CONSTRAINT ${CONSTRAINT} CHECK (`;
  let body: string | null = null;
  let migration = "";
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const at = sql.lastIndexOf(marker);
    if (at === -1) continue;
    // Le parentesi si contano: il predicato ne ha di sue e un match pigro lo
    // troncherebbe al primo `)`, leggendo un vincolo che non è quello vivo.
    let cursor = at + marker.length;
    let depth = 1;
    while (cursor < sql.length && depth > 0) {
      if (sql[cursor] === "(") depth += 1;
      else if (sql[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) throw new Error(`parentesi non bilanciate in ${file}`);
    body = sql.slice(at, cursor);
    migration = file;
  }
  if (!body) {
    throw new Error(
      `nessuna migrazione definisce ${CONSTRAINT}: rinominato o spostato`,
    );
  }
  const values = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  if (values.length === 0) {
    throw new Error(`nessun valore estratto dal CHECK in ${migration}`);
  }
  return values;
}

/** Ogni stato che il ciclo periodico sa produrre, prodotto davvero. */
function reachableStates() {
  const push = (result: Record<string, unknown>) =>
    nextPeriodicPushState({
      state: {},
      now: T0,
      signature: "synthetic",
      result,
      source: "periodic",
    });
  const check = (reason: string, quarantined = 0) =>
    nextPeriodicCheckState({
      state: { quarantined_count: quarantined },
      now: T0,
      signature: "synthetic",
      reason,
    });
  return [
    push({ ok: true, quarantined: 0 }),
    push({ ok: true, quarantined: 4 }),
    push({ timedOut: true }),
    push({ authFailed: true }),
    push({ ok: false }),
    check("nothing_new"),
    check("nothing_new", 4),
    check("signature_unavailable"),
  ];
}

describe("#194 — il vocabolario dello stato di push attraversa il confine", () => {
  it("l'elenco del box è esattamente quello del CHECK vivo", () => {
    expect([...CLOUD_PUSH_STATUSES].sort()).toEqual(
      [...new Set(liveCheckVocabulary())].sort(),
    );
  });

  it("ogni stato che il box sa produrre esce come valore che il cloud accetta", () => {
    const vocabulary = new Set(liveCheckVocabulary());
    const states = reachableStates();
    // Se l'enumerazione si svuota il caso non prova niente: qui la lista è
    // costruita eseguendo il ciclo, quindi va difesa dal restare a zero.
    expect(states.length).toBeGreaterThan(5);
    for (const state of states) {
      const published = periodicPushObservation({ state })?.cloud_push_status;
      expect(
        vocabulary.has(published as string),
        `stato locale ${state.status} pubblicato come ${published}, che il CHECK rifiuta`,
      ).toBe(true);
    }
  });

  it("con righe in quarantena pubblica partial, e il conteggio resta sul box", () => {
    const state = nextPeriodicPushState({
      state: {},
      now: T0,
      signature: "synthetic",
      result: { ok: true, skipped: 4, quarantined: 4 },
      source: "periodic",
    });
    expect(periodicPushResultStatus({ ok: true, quarantined: 4 })).toBe(
      "partial",
    );
    expect(state.quarantined_count).toBe(4);
    const published = periodicPushObservation({ state });
    expect(published?.cloud_push_status).toBe("partial");
    // Il conteggio non esce: non come stringa formattata dentro lo stato, che
    // è il difetto, e non ancora come numero, che è il passo 2 di #194.
    expect(JSON.stringify(published)).not.toContain("4");
  });

  it("uno stato che oggi non esiste cade su failed invece di uscire crudo", () => {
    // Il difetto non è stato scrivere una parola sbagliata: è stato lasciare
    // che una parola qualsiasi uscisse. Chi domani aggiunge uno stato al ciclo
    // e si scorda del CHECK deve ottenere un valore ammesso, non un 23514
    // silenzioso — e il primo caso di questo file gli chiederà di aggiornare
    // entrambe le liste.
    const published = periodicPushObservation({
      state: {
        status: "rate_limited",
        last_check_at: new Date(T0).toISOString(),
      },
    });
    expect(published?.cloud_push_status).toBe("failed");
  });
});
