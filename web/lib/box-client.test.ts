/**
 * Test unitari — lib/box-client.ts (vitest, girati da tests/js).
 *
 * Il gate del composer ha due modi di sbagliare, e non si equivalgono:
 *  · non scattare quando dovrebbe → il turno parte verso un box che non
 *    saprà mai ritirarlo (il difetto misurato: quattro giorni di silenzio);
 *  · scattare quando non dovrebbe → un utente il cui box funziona si trova
 *    la chat spenta, e per lui il prodotto è rotto.
 *
 * Il secondo è peggiore, perché colpisce chi non ha alcun problema e non ha
 * rete sotto: per il primo esiste comunque il timeout visibile della
 * corsia. Da qui la regola che questi test presidiano — si blocca solo
 * davanti a una smentita esplicita, mai sul silenzio.
 */
import { describe, it, expect } from "vitest";
import {
  boxSupports,
  chatComposerBlocked,
  pickActiveBox,
  type BoxClientRow,
} from "./box-client";

function row(over: Partial<BoxClientRow> = {}): BoxClientRow {
  return {
    id: "tok-1",
    client_version: "0.3.5",
    client_platform: "linux",
    client_capabilities: ["chat", "file-bridge"],
    client_seen_at: "2026-08-08T10:00:00Z",
    ...over,
  };
}

describe("quale device è il box", () => {
  it("il device attivo vince su ogni altra euristica", () => {
    const tokens = [
      row({ id: "vecchio", client_seen_at: "2026-08-08T23:00:00Z" }),
      row({ id: "attivo", client_seen_at: "2026-08-01T00:00:00Z" }),
    ];
    expect(pickActiveBox(tokens, "attivo")?.id).toBe("attivo");
  });

  it("senza device attivo si prende l'ultimo che si è fatto vivo", () => {
    const tokens = [
      row({ id: "a", client_seen_at: "2026-08-01T00:00:00Z" }),
      row({ id: "b", client_seen_at: "2026-08-08T09:00:00Z" }),
    ];
    expect(pickActiveBox(tokens, null)?.id).toBe("b");
  });

  it("un token creato e mai usato non è il box che sta lavorando", () => {
    const tokens = [
      row({ id: "mai-usato", client_seen_at: null }),
      row({ id: "vivo", client_seen_at: "2026-08-08T09:00:00Z" }),
    ];
    expect(pickActiveBox(tokens, null)?.id).toBe("vivo");
    expect(pickActiveBox([row({ id: "solo", client_seen_at: null })], null)).toBe(
      null,
    );
  });

  it("un active_device_id che non corrisponde a nessun token non inventa", () => {
    // Token revocato e sostituito: si ripiega sull'ultimo visto invece di
    // restituire un device che non esiste più.
    const tokens = [row({ id: "b", client_seen_at: "2026-08-08T09:00:00Z" })];
    expect(pickActiveBox(tokens, "sparito")?.id).toBe("b");
    expect(pickActiveBox([], "sparito")).toBe(null);
  });
});

describe("cosa il box dichiara di saper fare", () => {
  it("capability presente: sì", () => {
    expect(boxSupports(row(), "chat")).toBe("yes");
  });

  it("ha parlato e la capability non c'è: no — è l'unico caso che blocca", () => {
    const old = row({ client_capabilities: ["file-bridge"], client_version: "0.3.1" });
    expect(boxSupports(old, "chat")).toBe("no");
    expect(chatComposerBlocked(old)).toBe(true);
  });

  it("silenzio in ogni sua forma: non so, e si lascia scrivere", () => {
    // Nessun box, box mai visto, colonne vuote perché il progetto non è
    // migrato: in nessuno di questi casi sappiamo qualcosa di male.
    expect(boxSupports(null, "chat")).toBe("unknown");
    expect(boxSupports(row({ client_capabilities: null }), "chat")).toBe(
      "unknown",
    );
    expect(chatComposerBlocked(null)).toBe(false);
    expect(chatComposerBlocked(row({ client_capabilities: null }))).toBe(false);
  });

  it("una dichiarazione vuota è una dichiarazione, non silenzio", () => {
    // `capabilities=` senza valori: il box ha parlato e non sa fare nulla di
    // quello che ci interessa. Diverso da non aver mai parlato.
    expect(boxSupports(row({ client_capabilities: [] }), "chat")).toBe("no");
  });
});
