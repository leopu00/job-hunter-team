/**
 * O-105 — perché hanno detto di no: la regola, senza browser.
 *
 * Il vincolo che dà forma a tutto: **due campi separati**, i predefiniti
 * restano contabili dal Mentor e il testo libero è un di più ACCANTO, mai
 * un'alternativa che li sostituisce.
 *
 * Quel vincolo nasce da una misura che va tenuta insieme al codice, perché da
 * sola dice il contrario di quello che sembra. Sulle 127 esclusioni con
 * motivo: «altro» 31, e tutte e 31 con la nota; ogni altro motivo, ZERO note.
 * Quello zero **non è un comportamento degli utenti**: è un'interfaccia che la
 * casella non gliel'ha mai offerta, perché `needsFreeText()` la mostra solo
 * scegliendo «altro». Chi legge lo zero senza questa riga conclude che il
 * campo libero non serve.
 */
import { describe, expect, it } from "vitest";
import {
  REJECTION_REASONS,
  REJECTION_NOTE_MAX,
  isRejectionReason,
  rejectionDetailFor,
} from "../../../web/lib/applications/outcome";

describe("il vocabolario dei motivi", () => {
  it("è quello deciso dall'operatore, e non contiene «altro»", () => {
    // I quattro valori sono una decisione di prodotto, non una scelta di chi
    // scrive: stanno qui perché il test fallisca se qualcuno ne aggiunge di
    // propri senza passare dall'operatore.
    expect([...REJECTION_REASONS]).toEqual([
      "location",
      "salary",
      "experience",
      "language",
    ]);
    // «altro» servirebbe solo se il testo libero fosse nascosto dietro una
    // scelta. Qui è sempre disponibile, quindi sarebbe una voce che significa
    // «guarda nell'altro campo».
    expect(REJECTION_REASONS as readonly string[]).not.toContain("other");
  });

  it("non è il vocabolario dell'esclusione", async () => {
    // Le due liste rispondono a due domande diverse — «perché NON MI
    // interessa» contro «perché HANNO detto di no» — e il giorno che qualcuno
    // le fondesse «per riuso» questo test glielo direbbe.
    const { REASON_ORDER } =
      await import("../../../web/app/(protected)/positions/[id]/exclusion-reasons");
    const comuni = (REJECTION_REASONS as readonly string[]).filter((r) =>
      (REASON_ORDER as readonly string[]).includes(r),
    );
    expect(comuni).toEqual([]);
  });

  it("riconosce i suoi valori e rifiuta gli altri", () => {
    for (const r of REJECTION_REASONS) expect(isRejectionReason(r)).toBe(true);
    // La clausola falsa: un motivo dell'ALTRA lista non deve passare di qui.
    expect(isRejectionReason("not_interested")).toBe(false);
    expect(isRejectionReason("")).toBe(false);
    expect(isRejectionReason(null)).toBe(false);
  });
});

describe("cosa si registra quando l'utente dichiara un rifiuto", () => {
  it("motivo e testo insieme: si salvano tutti e due", () => {
    // È il caso che il vincolo esiste per rendere possibile, e che oggi
    // l'esclusione NON permette.
    expect(
      rejectionDetailFor("salary", "sotto del 30% rispetto al mio"),
    ).toEqual({
      kind: "ok",
      reason: "salary",
      note: "sotto del 30% rispetto al mio",
    });
  });

  it("il testo non viene mai promosso a motivo", () => {
    // «hanno preso un altro» è il rifiuto più comune del mondo reale e NON è
    // fra i quattro predefiniti. Deve poter essere registrato come testo senza
    // che nessuno lo trasformi in una categoria che l'operatore non ha scelto:
    // se fra un mese ricorre, si promuove con un dato in mano.
    expect(rejectionDetailFor(null, "hanno preso un altro candidato")).toEqual({
      kind: "ok",
      reason: null,
      note: "hanno preso un altro candidato",
    });
  });

  it("un rifiuto senza niente resta un rifiuto", () => {
    // Obbligare a scegliere fra quattro motivi che non coprono il caso più
    // comune vorrebbe dire farsi dare un motivo falso: il conteggio del Mentor
    // peggiorerebbe invece di migliorare. E toglierebbe la dichiarazione in un
    // clic che esiste da #187.
    expect(rejectionDetailFor(null, null)).toEqual({
      kind: "ok",
      reason: null,
      note: null,
    });
    expect(rejectionDetailFor("", "   ")).toEqual({
      kind: "ok",
      reason: null,
      note: null,
    });
  });

  it("un motivo che non conosciamo si rifiuta, non si salva com'è", () => {
    // Il campo è TEXT libero sul database — nessun CHECK, come per `response`,
    // così un motivo nuovo costa una riga e non una migrazione. Il prezzo è
    // che questo è il SOLO punto in cui la lista viene fatta rispettare.
    expect(rejectionDetailFor("hanno_preso_un_altro", null)).toEqual({
      kind: "invalid",
      field: "reason",
    });
    expect(rejectionDetailFor("not_interested", null)).toEqual({
      kind: "invalid",
      field: "reason",
    });
  });

  it("il testo ha un limite, e oltre quello si rifiuta invece di troncare", () => {
    // Troncare in silenzio perderebbe la parte che spiega, che è l'unica
    // ragione per cui quel campo esiste.
    expect(
      rejectionDetailFor(null, "x".repeat(REJECTION_NOTE_MAX)),
    ).toMatchObject({ kind: "ok" });
    expect(
      rejectionDetailFor(null, "x".repeat(REJECTION_NOTE_MAX + 1)),
    ).toEqual({ kind: "invalid", field: "note" });
  });

  it("non si fida di quello che arriva dalla rete", () => {
    expect(rejectionDetailFor(null, { toString: () => "x" })).toEqual({
      kind: "invalid",
      field: "note",
    });
    expect(rejectionDetailFor(42, null)).toEqual({
      kind: "ok",
      reason: null,
      note: null,
    });
  });
});
