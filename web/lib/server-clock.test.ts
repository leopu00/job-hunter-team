/**
 * Test unitari — lib/server-clock.ts (vitest).
 *
 * Lo stato di consegna della chat misura timestamp scritti dal SERVER
 * usando, fino a qui, l'orologio del BROWSER. I due casi che questo modulo
 * esiste per chiudere sono asimmetrici e vanno tenuti entrambi:
 *
 *  · client avanti → un turno spedito un secondo fa si marca «non
 *    consegnato» subito, e il pulsante «richiama il box» non cambia nulla a
 *    schermo: per l'utente è un pulsante finto;
 *  · client indietro → un turno fermo da ore resta «inviato», cioè il
 *    guasto torna invisibile proprio dove doveva vedersi.
 *
 * Il secondo è quello che si nota meno ed è il più grave, perché riporta le
 * cose a com'erano prima di tutto questo lavoro.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  clockOffset,
  currentClockOffset,
  noteServerTime,
  noteServerTimeFromResponse,
  resetClockOffsetForTests,
  serverNow,
} from "./server-clock";
import { chatTurnDelivery, CHAT_DELIVERY_STALE_MS } from "./chat-delivery";
import type { PendingMessage } from "./types";

const SERVER = "2026-08-08T12:00:00.000Z";
const SERVER_MS = Date.parse(SERVER);

beforeEach(() => {
  resetClockOffsetForTests();
});

describe("misura dello scarto", () => {
  it("client avanti di dieci minuti: scarto negativo", () => {
    const browserNow = SERVER_MS + 10 * 60_000;
    expect(clockOffset(SERVER, browserNow)).toBe(-10 * 60_000);
  });

  it("client indietro di un'ora: scarto positivo", () => {
    expect(clockOffset(SERVER, SERVER_MS - 3_600_000)).toBe(3_600_000);
  });

  it("orologi allineati: nessuno scarto", () => {
    expect(clockOffset(SERVER, SERVER_MS)).toBe(0);
  });

  it("data illeggibile: non si inventa uno scarto", () => {
    expect(clockOffset(null, SERVER_MS)).toBeNull();
    expect(clockOffset(undefined, SERVER_MS)).toBeNull();
    expect(clockOffset("", SERVER_MS)).toBeNull();
    expect(clockOffset("domani", SERVER_MS)).toBeNull();
  });
});

describe("lo scarto registrato", () => {
  it("serverNow ricostruisce l'ora del server", () => {
    const browserNow = Date.now();
    // Il server è avanti di 7 minuti rispetto a questo browser.
    noteServerTime(new Date(browserNow + 7 * 60_000).toISOString(), browserNow);
    expect(serverNow() - Date.now()).toBeGreaterThanOrEqual(7 * 60_000 - 50);
    expect(serverNow() - Date.now()).toBeLessThanOrEqual(7 * 60_000 + 50);
  });

  it("una data illeggibile non cancella quello che sapevamo", () => {
    // Meglio uno scarto vecchio di qualche minuto che tornare all'orologio
    // locale, che è esattamente quello di cui non ci fidiamo.
    const browserNow = Date.now();
    noteServerTime(new Date(browserNow + 60_000).toISOString(), browserNow);
    const known = currentClockOffset();
    noteServerTime("non una data", browserNow);
    expect(currentClockOffset()).toBe(known);
  });

  it("senza notizie dal server vale l'orologio locale", () => {
    // Zero non è un valore di comodo: è «uso quello che ho», cioè il
    // comportamento di prima, che per un client allineato è corretto.
    expect(currentClockOffset()).toBe(0);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
  });
});

describe("lettura dall'header di una risposta", () => {
  it("prende l'header Date quando c'è", () => {
    const browserNow = Date.now();
    noteServerTimeFromResponse({
      headers: {
        get: () => new Date(browserNow + 5 * 60_000).toUTCString(),
      },
    });
    // `toUTCString` ha risoluzione al secondo: la tolleranza è quella.
    expect(currentClockOffset()).toBeGreaterThan(5 * 60_000 - 1500);
    expect(currentClockOffset()).toBeLessThan(5 * 60_000 + 1500);
  });

  it("una risposta senza header non fa saltare nulla", () => {
    // Sta sul percorso dell'invio di un messaggio: sapere che ore sono non
    // vale il rischio di far fallire l'invio. Mock nei test, polyfill,
    // proxy che spogliano gli header — nessuno di questi è un errore.
    expect(() => noteServerTimeFromResponse({})).not.toThrow();
    expect(() => noteServerTimeFromResponse({ headers: {} })).not.toThrow();
    expect(() =>
      noteServerTimeFromResponse({ headers: { get: () => null } }),
    ).not.toThrow();
    expect(currentClockOffset()).toBe(0);
  });
});

describe("effetto sullo stato di consegna", () => {
  // La riga è nata sul server un secondo fa; il browser crede che siano le
  // 12:10. È il caso descritto: senza correzione il turno risulta vecchio
  // di dieci minuti e viene accusato appena spedito.
  const justSent: PendingMessage = {
    id: "42",
    agent: "capitano",
    body: "ciao",
    kind: "notification",
    author: "user",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: null,
    acknowledged_at: SERVER,
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: new Date(SERVER_MS - 1000).toISOString(),
  };

  it("client avanti: col tempo del server il turno è appena partito", () => {
    const browserNow = SERVER_MS + 10 * 60_000;
    // Come faceva prima: orologio del browser, verdetto sbagliato.
    expect(chatTurnDelivery(justSent, null, browserNow)).toBe("stalled");
    // Come fa adesso.
    noteServerTime(SERVER, browserNow);
    const corrected = browserNow + currentClockOffset();
    expect(chatTurnDelivery(justSent, null, corrected)).toBe("sent");
  });

  it("client indietro: un turno fermo da ore resta accusato", () => {
    const old = {
      ...justSent,
      created_at: new Date(SERVER_MS - 6 * 3_600_000).toISOString(),
    };
    const browserNow = SERVER_MS - 6 * 3_600_000 + 1000; // orologio indietro
    // Prima: il turno sembrava appena spedito, e il guasto spariva.
    expect(chatTurnDelivery(old, null, browserNow)).toBe("sent");
    noteServerTime(SERVER, browserNow);
    const corrected = browserNow + currentClockOffset();
    expect(chatTurnDelivery(old, null, corrected)).toBe("stalled");
  });

  it("la soglia resta quella, non si allarga per compensare lo skew", () => {
    // Correggere l'orologio non cambia il patto con l'utente: cinque minuti
    // restano cinque minuti, misurati bene.
    const browserNow = SERVER_MS + 10 * 60_000;
    noteServerTime(SERVER, browserNow);
    const corrected = browserNow + currentClockOffset();
    const justOver = {
      ...justSent,
      created_at: new Date(
        SERVER_MS - CHAT_DELIVERY_STALE_MS - 1000,
      ).toISOString(),
    };
    expect(chatTurnDelivery(justOver, null, corrected)).toBe("stalled");
  });
});
