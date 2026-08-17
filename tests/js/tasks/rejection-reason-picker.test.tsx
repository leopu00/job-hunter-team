/**
 * O-105 — le due cose che l'interfaccia deve garantire, misurate a schermo.
 *
 * 1. IL TESTO LIBERO È SEMPRE PRESENTE, con qualunque motivo e anche senza.
 *    È il vincolo dell'intero ticket, e l'`ReasonPicker` dell'esclusione fa
 *    l'opposto: mostra la casella SOLO scegliendo «altro», quindi là il testo
 *    è un'alternativa ai predefiniti. Da lì viene lo zero che sembra dire
 *    qualcosa sugli utenti — «altro» 31 esclusioni e 31 note, ogni altro
 *    motivo zero note — e sta dicendo qualcosa sul codice.
 *
 * 2. SALVARE IL MOTIVO NON ANNULLA IL RIFIUTO. È un difetto vero, scritto e
 *    corretto lo stesso giorno: il «Salva» chiamava la funzione che annulla
 *    quando si ri-clicca l'esito già attivo. Chi spiegava perché l'avevano
 *    scartato si vedeva cancellare il fatto di essere stato scartato.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REJECTION_REASONS,
  outcomeClickIntent,
} from "@/lib/applications/outcome";
import {
  RejectionReasonPicker,
  REJECTION_LABELS,
} from "@/app/(protected)/positions/[id]/RejectionReasonPicker";
import type { Locale } from "@/i18n/config";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

const LOCALES: Locale[] = ["it", "en", "hu", "es", "de", "fr", "pt"];

function rendi(reason: string, note = "") {
  return renderToStaticMarkup(
    createElement(RejectionReasonPicker, {
      reason,
      note,
      onReasonChange: () => {},
      onNoteChange: () => {},
      onSave: () => {},
      dirty: false,
    }),
  ) as string;
}

describe("il testo libero è un di più accanto, mai un'alternativa", () => {
  it("la casella c'è con ogni motivo e anche senza nessuno", () => {
    // Si guarda l'attributo del campo, non una parola nel markup: contare una
    // sottostringa nell'HTML è il modo in cui una verifica sembra fatta e non
    // lo è.
    for (const reason of ["", ...REJECTION_REASONS]) {
      expect(
        rendi(reason),
        `la casella del testo manca con motivo «${reason || "nessuno"}»`,
      ).toContain("data-rejection-note");
    }
  });

  it("tutti e quattro i motivi sono raggiungibili, e nessun altro", () => {
    const markup = rendi("");
    for (const r of REJECTION_REASONS) {
      expect(markup).toContain(`value="${r}"`);
    }
    // La clausola falsa: il vocabolario dell'esclusione non deve comparire qui.
    expect(markup).not.toContain('value="not_interested"');
    expect(markup).not.toContain('value="other"');
  });

  it("la prima voce è «nessun motivo»: il motivo non è obbligatorio", () => {
    // Obbligare a scegliere fra quattro motivi che non coprono «hanno preso un
    // altro» vorrebbe dire farsi dare un motivo falso, e il conteggio del
    // Mentor peggiorerebbe invece di migliorare.
    expect(rendi("")).toContain('value=""');
  });
});

describe("le etichette esistono in tutte e sette le lingue", () => {
  // F02: una stringa nuova in una lingua sola è un bug, non un TODO.
  //
  // Si guarda il DIZIONARIO e non sette render, come fa il test gemello
  // dell'esclusione: `useLocale()` in render statico non cambia lingua, quindi
  // un ciclo di render produrrebbe sette volte lo stesso italiano e
  // sembrerebbe una copertura di sette lingue. L'ho scritto così alla prima
  // stesura, ed è esattamente la forma di prova vuota che stiamo inventariando.
  for (const locale of LOCALES) {
    it(`${locale}: quattro etichette piene e distinte`, () => {
      for (const key of REJECTION_REASONS) {
        const label = REJECTION_LABELS[locale][key];
        expect(label, `manca ${key}.${locale}`).toBeTypeOf("string");
        expect(label.trim().length, `${key}.${locale} vuota`).toBeGreaterThan(
          0,
        );
      }
      const tutte = REJECTION_REASONS.map((k) => REJECTION_LABELS[locale][k]);
      expect(new Set(tutte).size, `duplicati in ${locale}`).toBe(
        REJECTION_REASONS.length,
      );
    });
  }
});

describe("salvare il motivo non annulla il rifiuto", () => {
  it("il «Salva» chiede di aggiornare il motivo, non di annullare", () => {
    // È il difetto che questa funzione esiste per rendere impossibile.
    expect(
      outcomeClickIntent({
        current: "rejected",
        clicked: "rejected",
        reasonOnly: true,
      }),
    ).toBe("update_reason");
  });

  it("ma ri-cliccare il pulsante dell'esito annulla ancora", () => {
    // La clausola falsa: se la correzione avesse spento l'annullamento, questi
    // due test insieme lo direbbero. Un bottone già premuto che non si può
    // ripremere è il difetto opposto.
    expect(
      outcomeClickIntent({ current: "rejected", clicked: "rejected" }),
    ).toBe("undo");
    expect(
      outcomeClickIntent({ current: "rejected", clicked: "interview" }),
    ).toBe("declare");
    expect(outcomeClickIntent({ current: null, clicked: "rejected" })).toBe(
      "declare",
    );
  });
});
