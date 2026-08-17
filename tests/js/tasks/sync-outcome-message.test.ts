/**
 * Il messaggio che l'utente legge quando un Sync now non si chiude.
 *
 * La dashboard mostrava «La VPS non è riuscita a inviare i dati» in due casi
 * in cui i dati erano arrivati: quando il push si ferma su un chunk tenendo i
 * checkpoint già confermati (il caso di #163, 4305 tick di fila) e quando
 * arriva in fondo isolando qualche riga. Chi legge va a cercare un guasto di
 * rete o della VPS che non c'è, e intanto il problema vero — righe che
 * restano indietro — non viene nominato.
 *
 * Adesso l'esito distingue i due casi, e questi test tengono la distinzione
 * dove serve: nella catena che porta lo stato dal box allo schermo, e nei
 * sette cataloghi di lingua.
 *
 * ⚠️ Il confine NON è stato spostato: con righe isolate l'ACK non si scrive
 * comunque, perché il sync non è integro. Cambia il nome dell'esito e quindi
 * la frase, non la decisione.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { pushRendezvousOutcome } from "../../../cli/src/lib/sync-rendezvous.js";
import { syncTerminalOutcome } from "@/lib/sync-rendezvous";

const root = resolve(__dirname, "../../..");
const componentPath = join(root, "web/app/components/CloudRefreshButton.tsx");
const LOCALES = ["it", "en", "es", "fr", "de", "hu", "pt"];

describe("l'esito di un Sync now dice il vero", () => {
  it("un push arrivato in fondo con righe isolate non è un invio fallito", () => {
    expect(pushRendezvousOutcome({ ok: true, skipped: 2 })).toEqual({
      status: "push_partial",
      retryable: true,
    });
    // E resta comunque fuori da `ready_to_ack`: nessun ACK, come prima.
    expect(pushRendezvousOutcome({ ok: true, skipped: 2 }).status).not.toBe(
      "ready_to_ack",
    );
  });

  it("un push interrotto resta un fallimento, e l'auth non è ritentabile", () => {
    expect(pushRendezvousOutcome({ ok: false })).toEqual({
      status: "push_failed",
      retryable: true,
    });
    expect(pushRendezvousOutcome({ ok: false, authFailed: true })).toEqual({
      status: "push_failed",
      retryable: false,
    });
  });

  it("lo stato attraversa il canale fino alla dashboard", () => {
    // Il box pubblica `sync:<stato>` su team_state; se il lettore web non lo
    // riconosce, il nuovo esito muore a metà strada e l'utente rivede la
    // frase vecchia — un contratto in due file senza un tipo in mezzo.
    const osservato = syncTerminalOutcome(
      {
        requestedAt: "2026-08-17T21:00:00Z",
        completedAt: null,
        lastAction: "sync:push_partial",
        lastActionAt: "2026-08-17T21:00:05Z",
      },
      null,
      "2026-08-17T21:00:00Z",
    );

    expect(osservato).toEqual({ status: "push_partial" });
  });

  it("la frase esiste in tutte e sette le lingue ed è diversa da quella di prima", () => {
    const sorgente = readFileSync(componentPath, "utf8");
    const parziali = [
      ...sorgente.matchAll(/syncPushPartial:\s*\n?\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    const falliti = [
      ...sorgente.matchAll(/syncPushFailed:\s*\n?\s*"([^"]+)"/g),
    ].map((match) => match[1]);

    expect(parziali).toHaveLength(LOCALES.length);
    expect(falliti).toHaveLength(LOCALES.length);
    // Sette frasi diverse: una lingua che ne copia un'altra è una lingua non
    // tradotta, non una coincidenza.
    expect(new Set(parziali).size).toBe(LOCALES.length);
    expect(new Set(falliti).size).toBe(LOCALES.length);
    // E nessuna delle due promette più che NIENTE sia arrivato: il push
    // interrotto tiene i checkpoint già confermati.
    for (const frase of [...parziali, ...falliti]) {
      expect(frase).not.toMatch(/VPS|VPS non|couldn't send|no pudo enviar/);
    }
  });

  it("il ramo che sceglie la frase copre il nuovo esito", () => {
    const sorgente = readFileSync(componentPath, "utf8");

    expect(sorgente).toContain(
      'outcome.status === "push_partial") setError(t.syncPushPartial)',
    );
    expect(sorgente).toContain(
      'outcome.status === "push_failed") setError(t.syncPushFailed)',
    );
  });
});
