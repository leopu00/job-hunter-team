/**
 * L'azione «Escludi» richiede un motivo e persiste lo stato canonico.
 *
 * Perché non è cosmetico: `agents/scout/scout.md` dice che con
 * `latest_direction='less_like_this'` lo Scout deprioritizza quella azienda,
 * famiglia di ruolo e località nelle ricerche future. Una posizione ottima ma
 * SCADUTA archiviata con quel gesto insegna quindi a evitarne di simili — è il
 * difetto segnalato da chi usa la piattaforma per cercare lavoro davvero.
 *
 * La regola che separa un fatto («è scaduta») da un gusto («l'azienda non mi
 * piace») vive in una funzione pura, così si verifica senza browser: è IL
 * contenuto del ticket, non un dettaglio di rendering.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  FACTUAL_REASONS,
  REASON_LABELS,
  REASON_ORDER,
  negativeSignalFor,
  type ReasonKey,
} from "@/app/(protected)/positions/[id]/exclusion-reasons";
import { ReasonPicker } from "@/app/(protected)/positions/[id]/ReasonPicker";
import type { Locale } from "@/i18n/config";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

const LOCALES: Locale[] = ["it", "en", "hu", "es", "de", "fr", "pt"];

describe("motivo obbligatorio sull'esclusione", () => {
  it("tutti e sette i motivi sono raggiungibili", () => {
    // Il difetto trovato per strada: `ReasonKey` ne dichiarava sette e
    // l'elenco mostrato ne aveva sei — `already_applied` era definito e
    // invisibile, cioè inesistente per chi usa il prodotto.
    expect(REASON_ORDER).toHaveLength(7);
    expect(REASON_ORDER).toContain("already_applied");
    expect(new Set(REASON_ORDER).size).toBe(7);
  });

  it("senza motivo non si registra niente", () => {
    expect(negativeSignalFor("", "")).toEqual({
      kind: "invalid",
      missing: "reason",
    });
    expect(negativeSignalFor(null, "un testo qualsiasi")).toEqual({
      kind: "invalid",
      missing: "reason",
    });
    // Un codice inventato non passa: sarebbe un motivo che nessuno sa leggere.
    expect(negativeSignalFor("qualcosa_altro", "")).toEqual({
      kind: "invalid",
      missing: "reason",
    });
  });

  it("«altro» senza testo non è un motivo", () => {
    expect(negativeSignalFor("other", "   ")).toEqual({
      kind: "invalid",
      missing: "text",
    });
    expect(negativeSignalFor("other", "cercano un profilo junior")).toEqual({
      kind: "exclude",
      reason: "other",
      note: "cercano un profilo junior",
      feedback: {
        reason: "other",
        comment: "cercano un profilo junior",
      },
    });
  });

  it("scaduta e già gestita ESCLUDONO e non insegnano niente", () => {
    for (const reason of FACTUAL_REASONS) {
      const signal = negativeSignalFor(reason, "");
      expect(signal.kind, `${reason} deve escludere`).toBe("exclude");
      // La forma è quella che la route user-exclude si aspetta.
      expect(signal).toEqual({ kind: "exclude", reason });
    }
    expect(FACTUAL_REASONS).toEqual(["closed", "already_applied"]);
  });

  it("i motivi di gusto escludono e conservano il feedback", () => {
    const taste = REASON_ORDER.filter(
      (r) => !(FACTUAL_REASONS as string[]).includes(r),
    );
    expect(taste).toEqual([
      "not_interested",
      "mismatch",
      "company",
      "conditions",
      "other",
    ]);
    for (const reason of taste) {
      const signal = negativeSignalFor(reason, "nota");
      expect(signal.kind, `${reason} deve escludere`).toBe("exclude");
      if (signal.kind === "exclude") {
        expect(signal.reason).toBe(reason);
        expect(signal.feedback).toEqual({ reason, comment: "nota" });
      }
    }
  });

  it("scaduta e non-interessante escludono entrambe, ma solo il gusto insegna", () => {
    const expired = negativeSignalFor("closed", "");
    const disliked = negativeSignalFor("not_interested", "");
    expect(expired.kind).toBe("exclude");
    expect(disliked.kind).toBe("exclude");
    if (expired.kind === "exclude") expect(expired.feedback).toBeUndefined();
    if (disliked.kind === "exclude") {
      expect(disliked.feedback).toEqual({ reason: "not_interested" });
    }
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
