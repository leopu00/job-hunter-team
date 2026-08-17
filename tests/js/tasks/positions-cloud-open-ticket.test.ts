import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * O-31 ramo cloud — la lista del sito deve dire quello che dice il box.
 *
 * ⚠️ Questo test guarda il SORGENTE, e va detto perché: il ramo cloud parla
 * con Supabase, e senza un'istanza con dati non è eseguibile qui. Quindi non
 * dimostra che a schermo si veda: fissa il criterio e la sua identità con il
 * ramo locale, che è la parte che può divergere in silenzio. La verifica
 * visiva sul cloud resta da fare, ed è dichiarata come tale.
 */
const ROOT = resolve(__dirname, "../../..");
const CLOUD = readFileSync(resolve(ROOT, "web/lib/queries.ts"), "utf-8");
const LOCAL = readFileSync(resolve(ROOT, "web/lib/local-queries.ts"), "utf-8");

describe("ticket senza risposta: cloud e locale dicono la stessa cosa", () => {
  it("il ramo cloud interroga i ticket per la lista", () => {
    expect(CLOUD).toContain("position_tickets");
    expect(CLOUD).toContain("position_legacy_id");
    expect(CLOUD).toContain("has_open_ticket");
  });

  it("entrambi i rami contano 'assigned' quanto 'open'", () => {
    // Se i due criteri divergessero, la stessa posizione direbbe due cose
    // diverse a seconda di dove la si guarda — ed è il difetto che nessuno
    // nota, perché ciascuna metà è coerente con sé stessa.
    expect(CLOUD).toContain('["open", "assigned"]');
    expect(LOCAL).toContain("'open','assigned'");
  });

  it("il cloud non filtra a mano per utente: lo fa la RLS", () => {
    // Un `.eq("user_id", ...)` qui sarebbe un secondo filtro che può
    // divergere da quello vero. Le altre letture di questa funzione si
    // affidano alla RLS: questa fa lo stesso.
    const block = CLOUD.slice(
      CLOUD.indexOf("O-31 (ramo cloud)"),
      CLOUD.indexOf('Filtri "intelligenti" sidebar'),
    );
    expect(block).not.toContain('eq("user_id"');
  });

  it("una sola query in più, non una per posizione", () => {
    // `.in(position_legacy_id, [...])`: N+1 su una lista da 200 righe
    // sarebbe 200 round-trip verso Supabase.
    const block = CLOUD.slice(
      CLOUD.indexOf("O-31 (ramo cloud)"),
      CLOUD.indexOf('Filtri "intelligenti" sidebar'),
    );
    expect(block).toContain('.in("position_legacy_id"');
  });
});
