/**
 * O-43 — un vocabolario solo di motivi per le due superfici che li chiedono:
 * l'esclusione manuale e il giudizio «Non interessante». Finché ne esistevano
 * due, divergevano — e infatti `ReasonKey` ne dichiarava sette mentre
 * l'elenco mostrato ne aveva sei.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  REASON_LABELS,
  REASON_ORDER,
  type ReasonKey,
} from "@/app/(protected)/positions/[id]/exclusion-reasons";
import { ReasonPicker } from "@/app/(protected)/positions/[id]/ReasonPicker";
import type { Locale } from "@/i18n/config";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

const LOCALES: Locale[] = ["it", "en", "hu", "es", "de", "fr", "pt"];

describe("vocabolario dei motivi", () => {
  it("tutti e sette i motivi sono raggiungibili", () => {
    // Il difetto trovato per strada: `ReasonKey` ne dichiarava sette e
    // l'elenco mostrato ne aveva sei — `already_applied` era definito e
    // invisibile, cioè inesistente per chi usa il prodotto.
    expect(REASON_ORDER).toHaveLength(7);
    expect(REASON_ORDER).toContain("already_applied");
    expect(new Set(REASON_ORDER).size).toBe(7);
  });
});

describe("selettore del motivo", () => {
  // NB: il selettore prende la lingua da `useLocale()` (contesto client), che
  // qui non si può pilotare senza montare l'albero React vero. Quindi questo
  // test verifica la STRUTTURA — sette motivi, nell'ordine dichiarato — e le
  // traduzioni si verificano sul dizionario, sotto: fingere un `it.each` sulle
  // lingue renderebbe sette volte la stessa cosa dicendo di averne provate
  // sette.
  it("mostra i sette motivi, nell'ordine dichiarato", () => {
    const html = renderToStaticMarkup(
      createElement(ReasonPicker, {
        value: "",
        onChange: () => {},
        note: "",
        onNoteChange: () => {},
        placeholder: "—",
      }),
    );
    const doc = new JSDOM(html).window.document;
    const options = [...doc.querySelectorAll("option")];
    // La prima voce è il segnaposto della superficie che monta il selettore.
    expect(options).toHaveLength(REASON_ORDER.length + 1);
    expect(options.slice(1).map((o) => o.getAttribute("value"))).toEqual(
      REASON_ORDER,
    );
  });

  it("ogni motivo ha un'etichetta in tutte e sette le lingue", () => {
    for (const locale of LOCALES) {
      for (const key of REASON_ORDER as ReasonKey[]) {
        const label = REASON_LABELS[locale][key];
        expect(label, `manca ${key}.${locale}`).toBeTypeOf("string");
        expect(label.length, `${key}.${locale} vuota`).toBeGreaterThan(0);
      }
      // Etichette duplicate dentro la stessa lingua renderebbero due motivi
      // indistinguibili nel menu.
      const labels = REASON_ORDER.map((k) => REASON_LABELS[locale][k]);
      expect(new Set(labels).size, `duplicati in ${locale}`).toBe(7);
    }
  });
});
