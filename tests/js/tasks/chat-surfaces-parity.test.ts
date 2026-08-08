/**
 * Test di parità fra le due superfici della stessa conversazione (vitest).
 *
 * La chat dell'utente vive in due posti — la pagina `/messages`
 * (`MessagesList`) e il drawer della navbar (`MessagesDrawer`) — e leggono
 * le stesse righe. Quando una delle due resta indietro non si ottiene una
 * versione ridotta: si ottiene una versione che **racconta un'altra cosa**.
 * È successo davvero. Fino al 2026-08-08 il drawer disegnava un turno
 * `author='user'` come bolla dell'AGENTE: le parole dell'utente comparivano
 * attribuite a chi non le aveva scritte, e nessuna bolla portava lo stato di
 * consegna — quindi il turno che non arrivava all'agente lì non si vedeva
 * proprio, mentre a due clic di distanza era segnato in giallo.
 *
 * Questi test asseriscono sul SORGENTE, che è l'unico modo di dire «le due
 * superfici usano lo stesso vocabolario» senza montare due alberi React con
 * mezzo mondo mockato: nessun typecheck e nessun test funzionale si accorge
 * che un componente ha smesso di guardare `author`, perché è codice
 * perfettamente valido che disegna la cosa sbagliata.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = join(__dirname, "../../../web/app/components");

const SURFACES = [
  ["MessagesList.tsx", "la chat a tutta pagina"],
  ["MessagesDrawer.tsx", "il drawer della navbar"],
] as const;

function source(file: string): string {
  return readFileSync(join(COMPONENTS, file), "utf-8");
}

describe.each(SURFACES)("%s (%s)", (file) => {
  const src = source(file);

  it("decide il mittente dal campo author, non dalla forma della riga", () => {
    // Il difetto storico in una riga: senza questo confronto un turno
    // dell'utente finisce nel ramo dell'agente e viene attribuito a lui.
    expect(src).toContain('author === "user"');
  });

  it("mostra lo stato di consegna sui turni dell'utente", () => {
    expect(src).toContain("ChatDeliveryMark");
    expect(src).toContain("chatTurnDelivery");
    // Serve la corsia, non solo l'età della riga: è ciò che distingue «il
    // box non ritira più niente» da «questo messaggio è appena partito».
    expect(src).toContain("useChatLaneLive");
  });

  it("quando un turno resta fermo lo dice e offre di richiamare il box", () => {
    expect(src).toContain("hasStalledTurn");
    expect(src).toContain("stalled_hint");
    expect(src).toContain("retryChatSignal");
  });

  it("spegne il composer se il box ha dichiarato di non saper ricevere", () => {
    expect(src).toContain("chatComposerBlocked");
    expect(src).toContain("composerBlocked");
  });

  it("misura il tempo con l'orologio del server, non con quello locale", () => {
    // I timestamp confrontati li scrive il server: misurarli con
    // `Date.now()` del browser rende il verdetto una funzione dello skew
    // del client — dieci minuti avanti e un turno appena spedito risulta
    // già perduto, indietro e un turno perduto sembra appena spedito.
    expect(src).toContain("serverNow()");
    expect(src).not.toContain("setClock(Date.now())");
  });

  it("continua a rendere le vecchie risposte appese", () => {
    // Il modello pre-unificazione non si riscrive: le conversazioni già
    // salvate devono restare leggibili com'erano.
    expect(src).toContain("user_reply");
  });
});
