/**
 * O-77 — lo swipe registrava `dislike` + `less_like_this` SENZA motivo.
 *
 * È lo stesso difetto che #167 ha tolto dalla pagina di dettaglio, sulla
 * superficie che si usa di più: un gesto solo, nessuna domanda, e una
 * posizione ottima ma SCADUTA insegnava allo Scout a evitarne di simili
 * (`agents/scout/scout.md` deprioritizza azienda, famiglia di ruolo e
 * località quando vede `less_like_this`).
 *
 * Qui il vincolo in più è il gesto: un selettore obbligatorio PRIMA lo
 * rovinerebbe. Quindi il motivo si chiede DOPO — e finché non arriva non
 * dev'essere stato scritto niente.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  VERDICT_ORDER,
  VERDICT_SIGNAL,
  needsReason,
} from "@/lib/position-verdict";

const ROOT = resolve(import.meta.dirname, "../../..");
const read = (relative: string) =>
  readFileSync(resolve(ROOT, relative), "utf8");

describe("quale verdetto non si registra senza motivo", () => {
  it("è quello che insegna cosa evitare, e solo quello", () => {
    // Il criterio è il segnale, non una seconda lista: se un domani un altro
    // verdetto mandasse `less_like_this`, chiederebbe il motivo da solo.
    expect(needsReason("no")).toBe(true);
    for (const verdict of VERDICT_ORDER) {
      expect(needsReason(verdict), verdict).toBe(
        VERDICT_SIGNAL[verdict].direction === "less_like_this",
      );
    }
    expect(VERDICT_ORDER.filter(needsReason)).toEqual(["no"]);
  });

  it("«poco interessante» resta un gesto secco", () => {
    // Scelta utente 18/07: non è un dislike, è un keep con entusiasmo basso.
    // Chiedergli un motivo sarebbe attrito su un giudizio che non insegna
    // niente da evitare.
    expect(needsReason("review_low")).toBe(false);
    expect(VERDICT_SIGNAL.review_low.direction).toBeNull();
  });
});

describe("il mazzo non scrive prima di sapere il perché", () => {
  const SWIPE = "web/app/(protected)/swipe/SwipeDeck.tsx";

  it("il verdetto che chiede il motivo non passa dalla scrittura diretta", () => {
    const source = read(SWIPE);
    // La regola arriva dalle due funzioni pure, non ricopiata qui dentro:
    // `needsReason` decide CHI deve chiedere, `negativeSignalFor` decide che
    // cosa diventa il motivo (esclusione o giudizio).
    expect(source).toContain("needsReason");
    expect(source).toContain("negativeSignalFor");
    // Nessuna lista di motivi ricopiata: il vocabolario ha una casa sola.
    expect(source).not.toMatch(/"already_applied"|"not_interested"/);
  });

  it("il gesto negativo non scrive né timbra prima del motivo", () => {
    // NB: questo guarda il SORGENTE, non il comportamento — un test che
    // monti davvero il mazzo vorrebbe mezzo browser (visualViewport,
    // SpeechRecognition, portal, gesti touch). Il comportamento è verificato
    // a mano nel browser; qui si tiene fermo il punto in cui è facile
    // riaprire il buco: le due scritture dentro `judge`.
    const source = read(SWIPE);
    const judge = source.slice(
      source.indexOf("const judge = useCallback"),
      source.indexOf("// Chiude il pannello del motivo"),
    );
    expect(judge.length).toBeGreaterThan(0);
    expect(judge).toContain("const needsWhy = needsReason(verdict);");
    // La riga su `position_feedback`: una sola, e sotto guardia.
    expect(judge.match(/persist\(/g)).toHaveLength(1);
    expect(judge).toMatch(/if \(!needsWhy\) \{\s*void persist\(/);
    // Il timbro è la promessa visiva che qualcosa è stato registrato: se
    // comparisse prima del motivo, l'utente vedrebbe un giudizio che nel
    // database non c'è.
    expect(judge.match(/setGiven\(/g)).toHaveLength(1);
    expect(judge).toMatch(/if \(!needsWhy\) setGiven\(/);
    // E il pannello si apre DOPO il volo della carta, dentro il timeout.
    expect(judge).toMatch(/if \(needsWhy\) \{\s*setWhyReason/);
  });
});
